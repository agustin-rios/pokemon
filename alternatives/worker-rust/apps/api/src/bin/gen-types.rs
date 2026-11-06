//! Genera los tipos TypeScript de la web en `TS_RS_EXPORT_DIR`
//! (`.cargo/config.toml`); se corre con `pnpm gen:types`.

use std::path::PathBuf;

use anyhow::{Context, Result};

fn main() -> Result<()> {
    let dir = PathBuf::from(
        std::env::var_os("TS_RS_EXPORT_DIR")
            .context("falta TS_RS_EXPORT_DIR (ver .cargo/config.toml)")?,
    );
    pokemon_api::types::export_all(&dir).context("no se pudieron exportar los tipos")?;
    println!("tipos exportados a {}", dir.display());
    Ok(())
}
