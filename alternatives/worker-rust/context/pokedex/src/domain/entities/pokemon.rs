use serde::Serialize;
use ts_rs::TS;

/// Un tipo asignado a un Pokémon; `slot` 1 es el principal y 2 el secundario.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct PokemonType {
    pub id: i32,
    pub name: String,
    pub slot: i32,
}

/// Pokémon de la Pokédex. Solo lectura: los datos los carga el worker, la
/// aplicación no los crea ni los modifica.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct Pokemon {
    pub id: i32,
    pub name: String,
    pub height: i32,
    pub weight: i32,
    pub base_experience: i32,
    /// URL de la imagen.
    pub sprite: Option<String>,
    /// Ordenados por slot.
    pub types: Vec<PokemonType>,
}
