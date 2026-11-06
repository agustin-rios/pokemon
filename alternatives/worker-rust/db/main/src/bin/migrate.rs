//! Aplica las migraciones pendientes a la base de `DATABASE_URL`.

use anyhow::{Context, Result};

#[tokio::main]
async fn main() -> Result<()> {
    let url = std::env::var("DATABASE_URL").context("DATABASE_URL no está definida")?;
    let pool = pokemon_db::connect(&url)
        .await
        .context("no se pudo conectar a la base")?;
    pokemon_db::MIGRATOR
        .run(&pool)
        .await
        .context("falló la aplicación de las migraciones")?;
    println!("Migraciones aplicadas.");
    Ok(())
}
