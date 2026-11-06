//! Tipos TypeScript de la web, generados desde los tipos de la API con ts-rs.
//! `pnpm gen:types` los escribe en `apps/pokemon/src/api/generated`.

use std::path::Path;

use pokemon_context_ingestion::domain::{EtlRun, EtlStep};
use pokemon_context_pokedex::application::ports::Page;
use pokemon_context_pokedex::domain::{
    LevelClassification, MonthlyCaptureGrowth, Pokemon, PokemonType, TopTrainer, TypeSummary,
};
use ts_rs::{ExportError, TS};

/// Escribe un `.ts` por tipo en `dir`, junto con los tipos de los que depende.
///
/// # Errors
///
/// Falla si no se puede escribir en `dir`.
pub fn export_all(dir: &Path) -> Result<(), ExportError> {
    Pokemon::export_all_to(dir)?;
    PokemonType::export_all_to(dir)?;
    Page::<Pokemon>::export_all_to(dir)?;
    TypeSummary::export_all_to(dir)?;
    MonthlyCaptureGrowth::export_all_to(dir)?;
    TopTrainer::export_all_to(dir)?;
    LevelClassification::export_all_to(dir)?;
    EtlRun::export_all_to(dir)?;
    EtlStep::export_all_to(dir)?;
    Ok(())
}
