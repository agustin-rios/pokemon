use chrono::NaiveDate;

use super::table_row::{TableRow, UniqueKey, blank, id_key, int_key};

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TrainerRecord {
    pub id: Option<i32>,
    pub name: Option<String>,
    pub region: Option<String>,
    pub created_at: Option<NaiveDate>,
}

impl TableRow for TrainerRecord {
    const TABLE: &'static str = "trainers";

    fn id(&self) -> Option<i32> {
        self.id
    }

    fn missing_column(&self) -> Option<&'static str> {
        if self.id.is_none() {
            Some("id")
        } else if blank(&self.name) {
            Some("name")
        } else if blank(&self.region) {
            Some("region")
        } else if self.created_at.is_none() {
            Some("created_at")
        } else {
            None
        }
    }

    fn unique_keys() -> Vec<UniqueKey<Self>> {
        vec![id_key(|r| int_key(r.id))]
    }
}
