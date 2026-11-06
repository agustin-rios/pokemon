//! El RNG debe reproducir `random.Random(42)` de CPython 3.10 (valores de `rng_reference.json`).
#![allow(clippy::unwrap_used)]

use pokemon_data::rng::PythonRandom;
use serde_json::Value;

fn reference() -> Value {
    let raw = include_str!("fixtures/rng_reference.json");
    serde_json::from_str(raw).unwrap()
}

fn fresh() -> PythonRandom {
    PythonRandom::new(42)
}

fn ints(reference: &Value, key: &str) -> Vec<i64> {
    reference[key]
        .as_array()
        .unwrap()
        .iter()
        .map(|v| v.as_i64().unwrap())
        .collect()
}

/// Los flotantes de Python vienen como `repr`, que `f64::from_str` lee sin pérdida.
fn float(value: &Value) -> f64 {
    value.as_str().unwrap().parse().unwrap()
}

fn floats(reference: &Value, key: &str) -> Vec<f64> {
    reference[key]
        .as_array()
        .unwrap()
        .iter()
        .map(float)
        .collect()
}

/// Los resultados que pasan por libm pueden diferir en 1-2 ulp entre implementaciones.
fn assert_close(actual: f64, expected: f64, context: &str) {
    let tolerance = 4e-16 * expected.abs();
    assert!(
        (actual - expected).abs() <= tolerance,
        "{context}: {actual:?} != {expected:?}"
    );
}

fn assert_all_close(actual: &[f64], expected: &[f64], key: &str) {
    assert_eq!(actual.len(), expected.len(), "{key}");
    for (i, (a, e)) in actual.iter().zip(expected).enumerate() {
        assert_close(*a, *e, &format!("{key}[{i}]"));
    }
}

#[test]
fn getrandbits32_matches() {
    let mut rng = fresh();
    let actual: Vec<i64> = (0..12).map(|_| i64::from(rng.next_u32())).collect();
    assert_eq!(actual, ints(&reference(), "getrandbits32"));
}

#[test]
fn random_matches_exactly() {
    let mut rng = fresh();
    let actual: Vec<f64> = (0..12).map(|_| rng.random()).collect();
    assert_eq!(actual, floats(&reference(), "random"));
}

#[test]
fn getrandbits_with_k_bits_matches() {
    let reference = reference();
    let mut rng = fresh();
    for pair in reference["getrandbits_k"].as_array().unwrap() {
        let k = pair[0].as_u64().unwrap() as u32;
        assert_eq!(rng.getrandbits(k), pair[1].as_u64().unwrap(), "k = {k}");
    }
}

#[test]
fn randint_matches() {
    let reference = reference();
    for (key, high) in [
        ("randint_0_27", 27),
        ("randint_0_400", 400),
        ("randint_0_31103999", 31_103_999),
    ] {
        let mut rng = fresh();
        let expected = ints(&reference, key);
        let actual: Vec<i64> = expected
            .iter()
            .map(|_| rng.randint(0, high).unwrap())
            .collect();
        assert_eq!(actual, expected, "{key}");
    }
}

#[test]
fn choice_matches() {
    let mut rng = fresh();
    let expected = ints(&reference(), "choice_26");
    let actual: Vec<i64> = expected
        .iter()
        .map(|_| rng.choice_index(26).unwrap() as i64)
        .collect();
    assert_eq!(actual, expected);
}

#[test]
fn choices_with_weights_match() {
    let reference = reference();

    let mut rng = fresh();
    let expected = ints(&reference, "choices_weights_int");
    let weights = [5.0, 4.0, 3.0, 3.0, 2.0, 1.0];
    let actual: Vec<i64> = expected
        .iter()
        .map(|_| rng.choice_weighted(&weights).unwrap() as i64)
        .collect();
    assert_eq!(actual, expected, "choices_weights_int");

    let mut rng = fresh();
    let expected = ints(&reference, "choices_weights_float");
    let weights: Vec<f64> = (0..12).map(|i| 1.0 + f64::from(i) * 0.12).collect();
    let actual: Vec<i64> = expected
        .iter()
        .map(|_| rng.choice_weighted(&weights).unwrap() as i64)
        .collect();
    assert_eq!(actual, expected, "choices_weights_float");
}

#[test]
fn sample_matches_in_both_branches() {
    let reference = reference();
    // 100 elementos usan la rama de conjunto; 10, la de pool.
    for (key, n) in [("sample_100_2", 100), ("sample_10_2", 10)] {
        let mut rng = fresh();
        let expected = reference[key].as_array().unwrap();
        for (i, pair) in expected.iter().enumerate() {
            let picked: Vec<i64> = rng
                .sample_indices(n, 2)
                .unwrap()
                .into_iter()
                .map(|idx| idx as i64 + 1) // la población es 1..=n
                .collect();
            let want: Vec<i64> = pair
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_i64().unwrap())
                .collect();
            assert_eq!(picked, want, "{key}[{i}]");
        }
    }
}

#[test]
fn libm_distributions_match_within_two_ulp() {
    let reference = reference();

    let mut rng = fresh();
    let expected = floats(&reference, "paretovariate_1_5");
    let actual: Vec<f64> = expected.iter().map(|_| rng.paretovariate(1.5)).collect();
    assert_all_close(&actual, &expected, "paretovariate_1_5");

    let mut rng = fresh();
    let expected = floats(&reference, "expovariate_0_04");
    let actual: Vec<f64> = expected
        .iter()
        .map(|_| rng.expovariate(1.0 / 25.0))
        .collect();
    assert_all_close(&actual, &expected, "expovariate_0_04");

    let mut rng = fresh();
    let expected = floats(&reference, "gauss_180_60");
    let actual: Vec<f64> = expected.iter().map(|_| rng.gauss(180.0, 60.0)).collect();
    assert_all_close(&actual, &expected, "gauss_180_60");
}

#[test]
fn gauss_next_survives_interleaved_random_calls() {
    let reference = reference();
    let mut rng = fresh();
    for (i, entry) in reference["mixed_random_gauss"]
        .as_array()
        .unwrap()
        .iter()
        .enumerate()
    {
        let kind = entry[0].as_str().unwrap();
        let expected = float(&entry[1]);
        match kind {
            "random" => assert_eq!(rng.random(), expected, "mixed[{i}]"),
            _ => assert_close(rng.gauss(180.0, 60.0), expected, &format!("mixed[{i}]")),
        }
    }
}

#[test]
fn randbelow_zero_draws_nothing_but_one_does() {
    let mut a = fresh();
    let mut b = fresh();
    assert_eq!(a.randbelow(0), 0);
    assert_eq!(a.next_u32(), b.next_u32());
    // randbelow(1) pide 1 bit: consume un valor aunque el resultado sea siempre 0.
    let mut c = fresh();
    assert_eq!(c.randbelow(1), 0);
    assert_ne!(c.next_u32(), fresh().next_u32());
}

#[test]
fn invalid_arguments_are_errors() {
    use pokemon_data::rng::RngError;
    let mut rng = fresh();
    assert_eq!(
        rng.randint(5, 4),
        Err(RngError::EmptyRange { low: 5, high: 4 })
    );
    assert_eq!(rng.choice_index(0), Err(RngError::EmptySequence));
    assert_eq!(
        rng.sample_indices(1, 2),
        Err(RngError::SampleTooLarge { k: 2, n: 1 })
    );
    assert_eq!(rng.choice_weighted(&[]), Err(RngError::WeightsMismatch));
    assert_eq!(
        rng.choice_weighted(&[0.0, 0.0]),
        Err(RngError::InvalidWeights)
    );
}
