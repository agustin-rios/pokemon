use super::table_row::{TableRow, UniqueKey, blank, id_key, int_key, name_key, text_key};

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PokemonRecord {
    pub id: Option<i32>,
    pub name: Option<String>,
    pub height: Option<i32>,
    pub weight: Option<i32>,
    /// Puede faltar: la PokeAPI lo trae `null` en algunos Pokémon (se carga como 0).
    pub base_experience: Option<i32>,
    pub sprite_url: Option<String>,
}

impl TableRow for PokemonRecord {
    const TABLE: &'static str = "pokemon";

    fn id(&self) -> Option<i32> {
        self.id
    }

    fn missing_column(&self) -> Option<&'static str> {
        if self.id.is_none() {
            Some("id")
        } else if blank(&self.name) {
            Some("name")
        } else if self.height.is_none() {
            Some("height")
        } else if self.weight.is_none() {
            Some("weight")
        } else {
            None
        }
    }

    fn unique_keys() -> Vec<UniqueKey<Self>> {
        vec![id_key(|r| int_key(r.id)), name_key(|r| text_key(&r.name))]
    }

    fn violations(&self) -> Vec<&'static str> {
        let mut broken = Vec::new();
        if self.height.is_some_and(|height| height <= 0) {
            broken.push("height debe ser > 0");
        }
        if self.weight.is_some_and(|weight| weight <= 0) {
            broken.push("weight debe ser > 0");
        }
        // NULL cuenta como 0, el default de la columna.
        if self.base_experience.unwrap_or(0) < 0 {
            broken.push("base_experience debe ser >= 0");
        }
        broken
    }
}
