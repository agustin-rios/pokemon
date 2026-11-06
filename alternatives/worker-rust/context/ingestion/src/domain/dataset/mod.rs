//! Filas de `staging` (una por tabla, con sus claves únicas y reglas por fila: los CHECK
//! de la base) y su validación. Las columnas son opcionales a propósito: `staging` no
//! tiene restricciones y la validación informa cada valor que falta.

mod battle_record;
mod capture_record;
mod data_validation_error;
mod load_order;
mod pokemon_record;
mod pokemon_type_record;
mod staging_dataset;
mod table_row;
mod trainer_record;
mod type_record;
mod validate_dataset;
mod validation_report;

pub use battle_record::BattleRecord;
pub use capture_record::CaptureRecord;
pub use data_validation_error::{DataValidationError, MAX_ERRORS_IN_MESSAGE};
pub use load_order::LOAD_ORDER;
pub use pokemon_record::PokemonRecord;
pub use pokemon_type_record::PokemonTypeRecord;
pub use staging_dataset::StagingDataset;
pub use table_row::{Key, TableRow, UniqueKey, json_quote};
pub use trainer_record::TrainerRecord;
pub use type_record::TypeRecord;
pub use validate_dataset::validate_dataset;
pub use validation_report::ValidationReport;
