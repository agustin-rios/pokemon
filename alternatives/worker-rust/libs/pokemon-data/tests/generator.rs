//! Goldens: el generador debe producir exactamente lo que el script de Python.
#![allow(clippy::unwrap_used)]

use chrono::NaiveDate;
use pokemon_data::generator::{Generated, GeneratorError, GeneratorOptions, generate};
use sha2::{Digest, Sha256};

mod csv_fixtures;
use csv_fixtures::{battles_csv, captures_csv, fixture, trainers_csv};

/// Los tres CSV del generador como `(nombre de archivo, contenido)`.
fn csv_files(generated: &Generated) -> [(&'static str, String); 3] {
    [
        ("trainers.csv", trainers_csv(&generated.trainers)),
        ("captures.csv", captures_csv(&generated.captures)),
        ("battles.csv", battles_csv(&generated.battles)),
    ]
}

fn assert_matches_fixtures(set: &str, ids: &[i32], options: &GeneratorOptions) {
    let generated = generate(ids, options).unwrap();
    for (name, content) in csv_files(&generated) {
        assert_eq!(content, fixture(set, name), "{set}/{name}");
    }
}

fn ids(n: i32) -> Vec<i32> {
    (1..=n).collect()
}

#[test]
fn small_set_matches_python() {
    let options = GeneratorOptions {
        trainers: 5,
        captures: 40,
        battles: 20,
        months: 3,
        ..GeneratorOptions::default()
    };
    assert_matches_fixtures("gen-small", &ids(30), &options);
}

#[test]
fn pool_branch_of_sample_matches_python() {
    // 10 ids ⇒ `sample` usa la rama de pool.
    let options = GeneratorOptions {
        trainers: 3,
        captures: 12,
        battles: 15,
        months: 2,
        start: NaiveDate::from_ymd_opt(2026, 1, 15).unwrap(),
    };
    assert_matches_fixtures("gen-pool", &ids(10), &options);
}

fn sha256(content: &str) -> String {
    Sha256::digest(content.as_bytes())
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

#[test]
fn default_set_matches_python_sha256() {
    let generated = generate(&ids(100), &GeneratorOptions::default()).unwrap();
    let expected = [
        (
            "trainers.csv",
            "6db2f840da3a2ff4cda10ccdf677c76b193d24c6e755935546f1a0ce29168f30",
        ),
        (
            "captures.csv",
            "42fea6ba21f459e8b7aa3d5d61c8c721563b3188748b825081580e6cfc58fb40",
        ),
        (
            "battles.csv",
            "e2123e6a481934196653be4f0a39388d23505c1aa1b1e5fcf48c7255fa057141",
        ),
    ];
    for ((name, content), (expected_name, hash)) in csv_files(&generated).iter().zip(expected) {
        assert_eq!(*name, expected_name);
        assert_eq!(sha256(content), hash, "{name}");
    }
    assert_eq!(generated.trainers.len(), 50);
    assert_eq!(generated.captures.len(), 5000);
    assert_eq!(generated.battles.len(), 2000);
}

#[test]
fn ids_are_reassigned_after_sorting_by_date() {
    let generated = generate(&ids(30), &GeneratorOptions::default()).unwrap();
    assert!(
        generated
            .captures
            .windows(2)
            .all(|w| w[0].captured_at <= w[1].captured_at)
    );
    assert!(
        generated
            .battles
            .windows(2)
            .all(|w| w[0].fought_at <= w[1].fought_at)
    );
    assert!(generated.captures.iter().zip(1..).all(|(c, id)| c.id == id));
    assert!(generated.battles.iter().zip(1..).all(|(b, id)| b.id == id));
}

#[test]
fn invalid_inputs_are_errors_not_panics() {
    let options = GeneratorOptions::default();
    assert_eq!(
        generate(&[1], &options),
        Err(GeneratorError::NotEnoughPokemon)
    );
    let no_trainers = GeneratorOptions {
        trainers: 0,
        ..options.clone()
    };
    assert_eq!(
        generate(&ids(5), &no_trainers),
        Err(GeneratorError::NoTrainers)
    );
    let no_months = GeneratorOptions {
        months: 0,
        ..options.clone()
    };
    assert_eq!(generate(&ids(5), &no_months), Err(GeneratorError::NoMonths));
    let too_late = GeneratorOptions {
        start: NaiveDate::from_ymd_opt(9999, 12, 1).unwrap(),
        ..options
    };
    assert_eq!(
        generate(&ids(5), &too_late),
        Err(GeneratorError::DateOutOfRange)
    );
}

#[test]
fn zero_rows_requested_gives_empty_tables() {
    let options = GeneratorOptions {
        trainers: 0,
        captures: 0,
        battles: 0,
        ..GeneratorOptions::default()
    };
    let generated = generate(&ids(5), &options).unwrap();
    assert!(generated.trainers.is_empty());
    assert!(generated.captures.is_empty());
    assert!(generated.battles.is_empty());
}
