//! Generador sintético de entrenadores, capturas y combates.
//!
//! Port exacto del script de Python del desafío (`generate_pokemon_data.py`): con la misma semilla y entradas
//! produce las mismas filas que CPython 3.10. El orden de las llamadas al RNG es parte
//! del contrato (una sola instancia: entrenadores, capturas y combates, en ese orden).

mod data;
mod error;
mod generate;
mod options;
mod records;

pub use error::GeneratorError;
pub use generate::{SEED, generate};
pub use options::GeneratorOptions;
pub use records::{Battle, Capture, Generated, Trainer};
