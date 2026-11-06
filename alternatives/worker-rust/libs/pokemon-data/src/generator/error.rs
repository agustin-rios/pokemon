use thiserror::Error;

use crate::rng::RngError;

#[derive(Debug, Error, PartialEq, Eq)]
pub enum GeneratorError {
    #[error(transparent)]
    Rng(#[from] RngError),
    #[error("se necesitan al menos 2 Pokémon para generar combates")]
    NotEnoughPokemon,
    #[error("se necesita al menos 1 entrenador para generar capturas")]
    NoTrainers,
    #[error("se necesita al menos 1 Pokémon para generar capturas")]
    NoPokemon,
    #[error("se necesita al menos 1 mes para generar capturas")]
    NoMonths,
    #[error("se pidieron más filas de las que caben en un id de 32 bits")]
    TooManyRows,
    #[error("una fecha generada queda fuera del rango AAAA 0001..9999")]
    DateOutOfRange,
}
