//! Binario del worker.

use std::io::IsTerminal;
use std::time::Duration;

use anyhow::{Context, Result};
use pokemon_worker::AppModule;
use pokemon_worker::config::{Config, is_production};
use pokemon_worker::modules::etl::etl_processor::{self, RunnerConfig};
use tokio::signal;
use tokio::time::timeout;
use tracing::{info, warn};

/// Tiempo que se espera a que termine el paso en curso al apagar.
const SHUTDOWN_GRACE: Duration = Duration::from_secs(10);
/// Tiempo máximo para cerrar el pool: una consulta abandonada puede seguir bloqueada en
/// la base, y esperarla pasaría el `stop_grace_period` de Docker (que mataría al proceso).
const POOL_CLOSE_TIMEOUT: Duration = Duration::from_secs(3);

#[tokio::main]
async fn main() -> Result<()> {
    tracing_subscriber::fmt()
        // Los logs van a stdout, normalmente sin terminal (docker logs): sin colores.
        .with_ansi(std::io::stdout().is_terminal())
        .with_env_filter(
            tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()),
        )
        .init();

    // Salvo en producción, lee el .env del directorio actual y el de esta carpeta.
    if !is_production(|name| std::env::var(name).ok()) {
        dotenvy::dotenv().ok();
        dotenvy::from_path(concat!(env!("CARGO_MANIFEST_DIR"), "/.env")).ok();
    }
    let config = Config::from_env().context("configuración inválida")?;

    let app = AppModule::create(&config).await?;

    info!(
        "worker {} listo (hasta {} Pokémon)",
        config.worker_id, config.pokemon_limit
    );
    etl_processor::run(
        &app.etl.process,
        &app.etl.notifier,
        RunnerConfig {
            poll: config.poll,
            shutdown_grace: SHUTDOWN_GRACE,
        },
        shutdown_signal(),
    )
    .await;

    if timeout(POOL_CLOSE_TIMEOUT, app.pool.close()).await.is_err() {
        warn!("el pool no cerró a tiempo: se sale igual");
    }
    info!("worker detenido");
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
    info!("señal de apagado recibida");
}
