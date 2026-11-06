use std::collections::HashMap;

use pokemon_api::config::{AppEnv, Config, CorsOrigins};

fn config(vars: &[(&str, &str)]) -> Result<Config, pokemon_api::config::ConfigError> {
    let vars: HashMap<String, String> = vars
        .iter()
        .map(|(k, v)| ((*k).to_owned(), (*v).to_owned()))
        .collect();
    Config::from_lookup(|name| vars.get(name).cloned())
}

#[test]
fn aplica_los_defaults() {
    assert_eq!(
        config(&[]).unwrap(),
        Config {
            app_env: AppEnv::Development,
            port: 3000,
            database_url: "postgresql://postgres:postgres@localhost:5451/pokemon".into(),
            cors_allow_origins: CorsOrigins::Any,
        }
    );
}

#[test]
fn convierte_port_y_separa_los_origenes() {
    let config = config(&[
        ("PORT", "4000"),
        (
            "CORS_ALLOW_ORIGINS",
            "http://localhost:4200, https://pokemon.example",
        ),
    ])
    .unwrap();

    assert_eq!(config.port, 4000);
    assert_eq!(
        config.cors_allow_origins,
        CorsOrigins::List(vec![
            "http://localhost:4200".into(),
            "https://pokemon.example".into()
        ])
    );
}

#[test]
fn rechaza_un_port_invalido() {
    for port in ["abc", "0", "-1", "70000", ""] {
        let error = config(&[("PORT", port)]).unwrap_err();
        assert_eq!(error.variable, "PORT", "{port}");
    }
}

#[test]
fn rechaza_un_database_url_vacio() {
    assert_eq!(
        config(&[("DATABASE_URL", "")]).unwrap_err().variable,
        "DATABASE_URL"
    );
}

#[test]
fn rechaza_un_app_env_desconocido() {
    assert_eq!(
        config(&[("APP_ENV", "staging")]).unwrap_err().variable,
        "APP_ENV"
    );
}

#[test]
fn rechaza_asterisco_en_produccion() {
    let error = config(&[("APP_ENV", "production")]).unwrap_err();

    assert_eq!(error.variable, "CORS_ALLOW_ORIGINS");
    assert_eq!(
        error.to_string(),
        "CORS_ALLOW_ORIGINS: en producción no se permite \"*\""
    );
}

#[test]
fn acepta_origenes_explicitos_en_produccion() {
    let config = config(&[
        ("APP_ENV", "production"),
        ("CORS_ALLOW_ORIGINS", "https://pokemon.example"),
    ])
    .unwrap();

    assert_eq!(config.app_env, AppEnv::Production);
}
