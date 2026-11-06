//! Binario de la API: `pokemon-api` arranca el servidor y `pokemon-api
//! healthcheck` consulta `GET /api/health` (lo usa el healthcheck de Docker).

use std::io::IsTerminal;
use std::net::SocketAddr;
use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result, bail};
use pokemon_api::config::{self, AppEnv, Config};
use pokemon_api::modules::database::database_module;
use pokemon_api::modules::pokedex::PokedexRepositories;
use pokemon_api::{app_module, app_setup};
use pokemon_context_ingestion::infra::adapters::PgEtlRunQueue;
use tokio::net::TcpListener;
use tokio::signal;
use tracing::info;

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        // Los logs van a stdout, normalmente sin terminal (docker logs): sin colores.
        .with_ansi(std::io::stdout().is_terminal())
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    let result = match std::env::args().nth(1).as_deref() {
        None => serve().await,
        Some("healthcheck") => healthcheck().await,
        Some(other) => Err(anyhow::anyhow!("argumento desconocido: {other}")),
    };
    match result {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!("{error:#}");
            ExitCode::FAILURE
        }
    }
}

/// Lee el `.env` del directorio actual y el de `apps/api` salvo en producción (igual que
/// el worker: con pnpm/Nx el directorio actual es la raíz del repo).
fn load_dotenv() -> Result<()> {
    let production = matches!(
        config::app_env(|name| std::env::var(name).ok()),
        Ok(AppEnv::Production)
    );
    if !production {
        dotenvy::dotenv().ok();
        dotenvy::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/.env")).ok();
    }
    Ok(())
}

async fn serve() -> Result<()> {
    load_dotenv()?;
    let config = Config::from_env().context("configuración inválida")?;

    let pool = database_module(&config.database_url)
        .await
        .context("no se pudo conectar a la base de datos")?;
    let app = app_setup(
        app_module(
            &PokedexRepositories::postgres(&pool),
            Arc::new(PgEtlRunQueue::new(pool.clone())),
        ),
        &config.cors_allow_origins,
    );

    let listener = TcpListener::bind(SocketAddr::from(([0, 0, 0, 0], config.port)))
        .await
        .with_context(|| format!("no se pudo escuchar en el puerto {}", config.port))?;
    info!("API en http://localhost:{}/api", config.port);
    axum::serve(listener, app)
        .with_graceful_shutdown(shutdown_signal())
        .await
        .context("el servidor falló")?;

    pool.close().await;
    info!("API detenida");
    Ok(())
}

/// Espera SIGINT o SIGTERM.
async fn shutdown_signal() {
    let ctrl_c = async {
        if signal::ctrl_c().await.is_err() {
            std::future::pending::<()>().await;
        }
    };
    #[cfg(unix)]
    let terminate = async {
        match signal::unix::signal(signal::unix::SignalKind::terminate()) {
            Ok(mut stream) => {
                stream.recv().await;
            }
            Err(_) => std::future::pending::<()>().await,
        }
    };
    #[cfg(not(unix))]
    let terminate = std::future::pending::<()>();

    tokio::select! {
        () = ctrl_c => {},
        () = terminate => {},
    }
    info!("apagando la API");
}

/// Sale con éxito si `GET http://127.0.0.1:$PORT/api/health` responde 2xx.
async fn healthcheck() -> Result<()> {
    load_dotenv()?;
    let port = config::port(|name| std::env::var(name).ok())?;
    let url = format!("http://127.0.0.1:{port}/api/health");
    let response = reqwest::Client::builder()
        .timeout(Duration::from_secs(3))
        .build()?
        .get(&url)
        .send()
        .await
        .with_context(|| format!("GET {url} falló"))?;
    if !response.status().is_success() {
        bail!("GET {url} respondió HTTP {}", response.status().as_u16());
    }
    Ok(())
}
