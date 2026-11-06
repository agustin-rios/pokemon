/// Fila de `staging.pokemon`. Los nulos del origen quedan como `None`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PokemonRow {
    pub id: i32,
    pub name: String,
    pub height: i32,
    pub weight: i32,
    pub base_experience: Option<i32>,
    pub sprite: Option<String>,
}

/// Fila de `staging.types`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TypeRow {
    pub id: i32,
    pub name: String,
}

/// Fila de `staging.pokemon_types`.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PokemonTypeRow {
    pub pokemon_id: i32,
    pub type_id: i32,
    pub slot: i32,
}
