//! Contexto `pokedex`: catálogo de Pokémon y reportes ya agregados. Solo
//! lectura: los datos los carga el worker y las vistas las crea `build_views`.
//!
//! Capas: `domain` → `application` (puertos y casos de uso) → `infra`.

pub mod application;
pub mod domain;
pub mod infra;
