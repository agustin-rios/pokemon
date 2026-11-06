use serde::Serialize;
use ts_rs::TS;

/// `GET /items/summary`: cuántos Pokémon tiene cada tipo y su experiencia base
/// promedio. Un Pokémon con dos tipos cuenta en ambos. Vista `type_summary`.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TypeSummary {
    pub type_id: i32,
    pub type_name: String,
    pub pokemon_count: i32,
    /// Redondeado a 2 decimales.
    pub average_base_experience: f64,
}
