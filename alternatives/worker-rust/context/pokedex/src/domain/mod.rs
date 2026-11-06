//! Tipos del dominio. Todo número expuesto es `i32` o `f64` para que ts-rs lo
//! mapee a `number` (un `i64` sería `bigint` en TypeScript).

pub mod entities;
pub mod reports;

pub use entities::{Pokemon, PokemonType};
pub use reports::{LevelClassification, MonthlyCaptureGrowth, TopTrainer, TypeSummary};
