//! Datos del pipeline: scraper de PokeAPI y generador sintético compatible con Python.
//!
//! Es una librería pura (sin base de datos ni cola): el worker guarda sus filas en `staging`.

pub mod dataset;
pub mod errors;
pub mod generator;
pub mod pokeapi;
pub mod rng;
