use super::table_row::{Key, TableRow, UniqueKey, show};

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct PokemonTypeRecord {
    pub pokemon_id: Option<i32>,
    pub type_id: Option<i32>,
    pub slot: Option<i32>,
}

impl TableRow for PokemonTypeRecord {
    const TABLE: &'static str = "pokemon_types";

    fn id(&self) -> Option<i32> {
        None
    }

    fn label(&self) -> String {
        format!(
            "pokemon_types ({}, {})",
            show(self.pokemon_id),
            show(self.type_id)
        )
    }

    fn missing_column(&self) -> Option<&'static str> {
        if self.pokemon_id.is_none() {
            Some("pokemon_id")
        } else if self.type_id.is_none() {
            Some("type_id")
        } else if self.slot.is_none() {
            Some("slot")
        } else {
            None
        }
    }

    fn unique_keys() -> Vec<UniqueKey<Self>> {
        vec![
            UniqueKey {
                columns: &["pokemon_id", "type_id"],
                extract: |r| Some(vec![Key::Int(r.pokemon_id?), Key::Int(r.type_id?)]),
            },
            UniqueKey {
                columns: &["pokemon_id", "slot"],
                extract: |r| Some(vec![Key::Int(r.pokemon_id?), Key::Int(r.slot?)]),
            },
        ]
    }

    fn violations(&self) -> Vec<&'static str> {
        if self.slot.is_none_or(|slot| matches!(slot, 1 | 2)) {
            Vec::new()
        } else {
            vec!["slot debe ser 1 o 2"]
        }
    }
}
