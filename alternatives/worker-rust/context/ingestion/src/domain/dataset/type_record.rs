use super::table_row::{TableRow, UniqueKey, blank, id_key, int_key, name_key, text_key};

#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct TypeRecord {
    pub id: Option<i32>,
    pub name: Option<String>,
}

impl TableRow for TypeRecord {
    const TABLE: &'static str = "types";

    fn id(&self) -> Option<i32> {
        self.id
    }

    fn missing_column(&self) -> Option<&'static str> {
        if self.id.is_none() {
            Some("id")
        } else if blank(&self.name) {
            Some("name")
        } else {
            None
        }
    }

    fn unique_keys() -> Vec<UniqueKey<Self>> {
        vec![id_key(|r| int_key(r.id)), name_key(|r| text_key(&r.name))]
    }
}
