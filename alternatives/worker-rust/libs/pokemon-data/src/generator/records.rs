use chrono::{NaiveDate, NaiveDateTime};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Trainer {
    pub id: i32,
    pub name: String,
    pub region: &'static str,
    pub created_at: NaiveDate,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Capture {
    pub id: i32,
    pub trainer_id: i32,
    pub pokemon_id: i32,
    pub captured_at: NaiveDateTime,
    pub level: i32,
    pub location: &'static str,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Battle {
    pub id: i32,
    pub pokemon_a_id: i32,
    pub pokemon_b_id: i32,
    pub winner_id: i32,
    pub fought_at: NaiveDateTime,
    pub duration_seconds: i32,
}

/// Las tres tablas sintéticas.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Generated {
    pub trainers: Vec<Trainer>,
    pub captures: Vec<Capture>,
    pub battles: Vec<Battle>,
}
