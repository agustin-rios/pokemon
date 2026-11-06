use chrono::NaiveDateTime;

use super::table_row::{TableRow, UniqueKey, blank, id_key, int_key};

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct CaptureRecord {
    pub id: Option<i32>,
    pub trainer_id: Option<i32>,
    pub pokemon_id: Option<i32>,
    pub captured_at: Option<NaiveDateTime>,
    pub level: Option<i32>,
    pub location: Option<String>,
}

impl TableRow for CaptureRecord {
    const TABLE: &'static str = "captures";
    const DISCARDABLE: bool = true;

    fn id(&self) -> Option<i32> {
        self.id
    }

    fn missing_column(&self) -> Option<&'static str> {
        if self.id.is_none() {
            Some("id")
        } else if self.trainer_id.is_none() {
            Some("trainer_id")
        } else if self.pokemon_id.is_none() {
            Some("pokemon_id")
        } else if self.captured_at.is_none() {
            Some("captured_at")
        } else if self.level.is_none() {
            Some("level")
        } else if blank(&self.location) {
            Some("location")
        } else {
            None
        }
    }

    fn unique_keys() -> Vec<UniqueKey<Self>> {
        vec![id_key(|r| int_key(r.id))]
    }

    fn violations(&self) -> Vec<&'static str> {
        if self.level.is_none_or(|level| (1..=100).contains(&level)) {
            Vec::new()
        } else {
            vec!["level debe estar entre 1 y 100"]
        }
    }
}
