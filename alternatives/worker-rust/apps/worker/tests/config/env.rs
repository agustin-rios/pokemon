use std::collections::HashMap;
use std::time::Duration;

use pokemon_worker::config::{Config, ConfigError, is_production};

fn config(vars: &[(&str, &str)]) -> Result<Config, ConfigError> {
    let vars: HashMap<String, String> = vars
        .iter()
        .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
        .collect();
    Config::from_lookup(|name| vars.get(name).cloned())
}

#[test]
fn aplica_los_defaults() {
    let config = config(&[]).unwrap();

    assert_eq!(
        config.database_url,
        "postgresql://postgres:postgres@localhost:5451/pokemon"
    );
    assert_eq!(config.pokeapi_url, "https://pokeapi.co/api/v2");
    assert_eq!(config.pokemon_limit, 100);
    assert_eq!(config.lease, Duration::from_secs(30));
    assert_eq!(config.poll, Duration::from_secs(5));
    assert_eq!(config.step_deadline, Duration::from_secs(300));
}

#[test]
fn el_worker_id_por_defecto_es_host_pid_y_8_hex() {
    let id = config(&[]).unwrap().worker_id;

    let parts: Vec<&str> = id.rsplitn(3, ':').collect();
    assert_eq!(parts.len(), 3, "{id}");
    assert_eq!(parts[0].len(), 8);
    assert!(parts[0].chars().all(|c| c.is_ascii_hexdigit()));
    assert_eq!(parts[1], std::process::id().to_string());
    assert!(!parts[2].is_empty());
    assert_ne!(
        id,
        config(&[]).unwrap().worker_id,
        "cada arranque genera uno nuevo"
    );
}

#[test]
fn respeta_los_valores_del_entorno() {
    let config = config(&[
        ("DATABASE_URL", "postgres://x/y"),
        ("POKEAPI_URL", "http://stub:3000/api/v2/"),
        ("POKEMON_LIMIT", "151"),
        ("WORKER_ID", "w1"),
        ("LEASE_SECONDS", "60"),
        ("POLL_SECONDS", "2"),
    ])
    .unwrap();

    assert_eq!(config.database_url, "postgres://x/y");
    assert_eq!(config.pokeapi_url, "http://stub:3000/api/v2");
    assert_eq!(config.pokemon_limit, 151);
    assert_eq!(config.worker_id, "w1");
    assert_eq!(config.lease, Duration::from_secs(60));
    assert_eq!(config.poll, Duration::from_secs(2));
}

#[test]
fn pokemon_limit_acepta_de_2_a_1025() {
    assert_eq!(config(&[("POKEMON_LIMIT", "2")]).unwrap().pokemon_limit, 2);
    assert_eq!(
        config(&[("POKEMON_LIMIT", "1025")]).unwrap().pokemon_limit,
        1025
    );
    for limit in ["1", "0", "1026", "-5", "cien", ""] {
        let error = config(&[("POKEMON_LIMIT", limit)]).unwrap_err();
        assert_eq!(error.variable, "POKEMON_LIMIT", "{limit}");
    }
}

#[test]
fn rechaza_leases_y_sondeos_invalidos() {
    for (name, value) in [
        ("LEASE_SECONDS", "0"),
        ("LEASE_SECONDS", "x"),
        ("POLL_SECONDS", "0"),
        ("POLL_SECONDS", "-1"),
    ] {
        assert_eq!(config(&[(name, value)]).unwrap_err().variable, name);
    }
}

#[test]
fn rechaza_valores_vacios() {
    for name in ["DATABASE_URL", "POKEAPI_URL", "WORKER_ID"] {
        assert_eq!(config(&[(name, " ")]).unwrap_err().variable, name);
    }
}

#[test]
fn el_mensaje_de_error_nombra_la_variable() {
    assert_eq!(
        config(&[("POKEMON_LIMIT", "1")]).unwrap_err().to_string(),
        "POKEMON_LIMIT: debe ser un entero entre 2 y 1025"
    );
}

#[test]
fn en_produccion_no_se_lee_el_env() {
    assert!(is_production(
        |n| (n == "APP_ENV").then(|| "production".into())
    ));
    assert!(!is_production(
        |n| (n == "APP_ENV").then(|| "development".into())
    ));
    assert!(!is_production(|_| None));
}

#[test]
fn app_env_solo_acepta_development_production_o_test() {
    for valid in ["development", "production", "test"] {
        assert!(config(&[("APP_ENV", valid)]).is_ok(), "{valid}");
    }
    assert_eq!(
        config(&[("APP_ENV", "prod")]).unwrap_err().to_string(),
        "APP_ENV: debe ser development, production o test"
    );
}
