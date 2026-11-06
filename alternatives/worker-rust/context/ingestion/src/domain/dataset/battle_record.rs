use chrono::NaiveDateTime;

use super::table_row::{TableRow, UniqueKey, id_key, int_key};

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct BattleRecord {
    pub id: Option<i32>,
    pub pokemon_a_id: Option<i32>,
    pub pokemon_b_id: Option<i32>,
    pub winner_id: Option<i32>,
    pub fought_at: Option<NaiveDateTime>,
    pub duration_seconds: Option<i32>,
}

impl TableRow for BattleRecord {
    const TABLE: &'static str = "battles";
    const DISCARDABLE: bool = true;

    fn id(&self) -> Option<i32> {
        self.id
    }

    fn missing_column(&self) -> Option<&'static str> {
        if self.id.is_none() {
            Some("id")
        } else if self.pokemon_a_id.is_none() {
            Some("pokemon_a_id")
        } else if self.pokemon_b_id.is_none() {
            Some("pokemon_b_id")
        } else if self.winner_id.is_none() {
            Some("winner_id")
        } else if self.fought_at.is_none() {
            Some("fought_at")
        } else if self.duration_seconds.is_none() {
            Some("duration_seconds")
        } else {
            None
        }
    }

    fn unique_keys() -> Vec<UniqueKey<Self>> {
        vec![id_key(|r| int_key(r.id))]
    }

    fn violations(&self) -> Vec<&'static str> {
        let mut broken = Vec::new();
        if self.pokemon_a_id == self.pokemon_b_id {
            broken.push("pokemon_a_id y pokemon_b_id deben ser distintos");
        }
        if self.winner_id != self.pokemon_a_id && self.winner_id != self.pokemon_b_id {
            broken.push("winner_id debe ser pokemon_a_id o pokemon_b_id");
        }
        if self.duration_seconds.is_some_and(|seconds| seconds < 0) {
            broken.push("duration_seconds debe ser >= 0");
        }
        broken
    }
}
