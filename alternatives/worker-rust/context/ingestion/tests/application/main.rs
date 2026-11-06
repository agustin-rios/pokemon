//! Casos de uso del contexto con puertos falsos (sin base de datos).
#![allow(clippy::unwrap_used)]

mod stubs;
#[path = "../support/mod.rs"]
mod support;

mod use_cases {
    mod generate_data;
    mod process_run;
}
