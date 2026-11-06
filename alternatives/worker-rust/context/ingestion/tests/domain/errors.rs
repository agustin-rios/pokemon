//! Clasificación de errores en permanentes o reintentables.

use std::time::Duration;

use pokemon_context_ingestion::domain::{
    DataValidationError, ErrorClass, StepError, StepName, StorageError, classify,
};
use pokemon_data::generator::GeneratorError;
use pokemon_data::pokeapi::PokeApiError;

fn storage(sqlstate: Option<&str>) -> StepError {
    StepError::Storage(StorageError {
        sqlstate: sqlstate.map(str::to_owned),
        source: "falló".into(),
    })
}

fn class(step: StepName, error: &StepError) -> ErrorClass {
    classify(step, error)
}

#[test]
fn data_and_generator_errors_are_permanent_in_every_step() {
    let validation = StepError::Validation(DataValidationError {
        errors: vec!["x".into()],
    });
    let ids = StepError::NotEnoughPokemon;
    let generator = StepError::Generator(GeneratorError::NotEnoughPokemon);

    for step in StepName::ALL {
        assert_eq!(class(step, &validation), ErrorClass::Permanent);
        assert_eq!(class(step, &ids), ErrorClass::Permanent);
        assert_eq!(class(step, &generator), ErrorClass::Permanent);
    }
}

#[test]
fn pokeapi_errors_split_by_http_status_and_url() {
    let status = |status| {
        StepError::Source(PokeApiError::Status {
            url: "u".into(),
            status,
        })
    };
    // Solo llegan como `Status` los no recuperables (el 429 y 5xx se agotan como `Exhausted`).
    assert_eq!(class(StepName::Scrape, &status(404)), ErrorClass::Permanent);
    assert_eq!(class(StepName::Scrape, &status(418)), ErrorClass::Permanent);
    assert_eq!(
        class(
            StepName::Scrape,
            &StepError::Source(PokeApiError::UnexpectedTypeUrl("x".into()))
        ),
        ErrorClass::Permanent
    );
    assert_eq!(
        class(
            StepName::Scrape,
            &StepError::Source(PokeApiError::InvalidLimit)
        ),
        ErrorClass::Permanent
    );
    let exhausted = PokeApiError::Exhausted {
        url: "u".into(),
        attempts: 4,
        last: pokemon_data::pokeapi::AttemptFailure::Status(503),
    };
    assert_eq!(
        class(StepName::Scrape, &StepError::Source(exhausted)),
        ErrorClass::Retryable
    );
}

#[test]
fn a_step_deadline_is_retryable() {
    let error = StepError::Timeout(Duration::from_secs(300));

    assert_eq!(class(StepName::Scrape, &error), ErrorClass::Retryable);
    assert_eq!(error.to_string(), "el paso superó el plazo de 300 s");
}

#[test]
fn not_enough_pokemon_names_the_staging_table() {
    assert_eq!(
        StepError::NotEnoughPokemon.to_string(),
        "se necesitan al menos 2 Pokémon en staging.pokemon"
    );
}

#[test]
fn sqlstate_classes_22_and_23_are_permanent_in_any_step() {
    for step in StepName::ALL {
        for code in ["23505", "23503", "22P02", "22001"] {
            assert_eq!(
                class(step, &storage(Some(code))),
                ErrorClass::Permanent,
                "{code}"
            );
        }
    }
}

#[test]
fn sqlstate_class_42_is_permanent_only_in_build_views() {
    for code in ["42P01", "42601"] {
        assert_eq!(
            class(StepName::BuildViews, &storage(Some(code))),
            ErrorClass::Permanent
        );
        assert_eq!(
            class(StepName::Load, &storage(Some(code))),
            ErrorClass::Retryable
        );
    }
}

#[test]
fn other_database_errors_are_retryable() {
    for code in ["08006", "40001", "53300", "57P01", "XX000"] {
        for step in StepName::ALL {
            assert_eq!(
                class(step, &storage(Some(code))),
                ErrorClass::Retryable,
                "{code}"
            );
        }
    }
    // Sin SQLSTATE (conexión rechazada, timeout, IO).
    assert_eq!(class(StepName::Load, &storage(None)), ErrorClass::Retryable);
    assert!(ErrorClass::Retryable.is_retryable());
    assert!(!ErrorClass::Permanent.is_retryable());
}
