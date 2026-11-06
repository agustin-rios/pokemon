//! Dominio del contexto: validación de las filas de `staging`, modelo de las
//! corridas y clasificación de errores.
#![allow(clippy::unwrap_used)]

#[path = "../support/mod.rs"]
mod support;

mod dataset {
    mod validate_dataset;
}
mod errors;
mod run;
