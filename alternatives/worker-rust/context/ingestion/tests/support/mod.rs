//! Utilidades compartidas por los tests de integración.
#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

use std::path::PathBuf;
use std::str::FromStr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use chrono::{NaiveDate, NaiveDateTime};
use pokemon_context_ingestion::domain::{
    BattleRecord, CaptureRecord, PokemonRecord, PokemonTypeRecord, StagingDataset, TrainerRecord,
    TypeRecord,
};
use sqlx::postgres::{PgConnectOptions, PgPoolCopyExt, PgPoolOptions};
use sqlx::{Connection, PgConnection, PgPool};

/// Los CSV de `tests/fixtures/data-current` son solo los datos de referencia de los
/// tests (el código de producción no usa CSV). Este módulo los lee ya como filas.
fn fixture(table: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures/data-current")
        .join(format!("{table}.csv"));
    std::fs::read_to_string(path).unwrap()
}

/// Filas de un CSV de referencia (sin cabecera). No tienen comillas ni comas en las celdas.
fn cells(table: &str) -> Vec<Vec<String>> {
    fixture(table)
        .lines()
        .skip(1)
        .map(|line| line.split(',').map(str::to_owned).collect())
        .collect()
}

fn int(cell: &str) -> Option<i32> {
    (!cell.is_empty()).then(|| cell.parse().unwrap())
}

fn text(cell: &str) -> Option<String> {
    (!cell.is_empty()).then(|| cell.to_owned())
}

/// Las 6 tablas del dataset de referencia (`data-current`) como filas de `staging`.
pub fn reference_dataset() -> StagingDataset {
    StagingDataset {
        types: cells("types")
            .iter()
            .map(|c| TypeRecord {
                id: int(&c[0]),
                name: text(&c[1]),
            })
            .collect(),
        pokemon: cells("pokemon")
            .iter()
            .map(|c| PokemonRecord {
                id: int(&c[0]),
                name: text(&c[1]),
                height: int(&c[2]),
                weight: int(&c[3]),
                base_experience: int(&c[4]),
                sprite_url: text(&c[5]),
            })
            .collect(),
        pokemon_types: cells("pokemon_types")
            .iter()
            .map(|c| PokemonTypeRecord {
                pokemon_id: int(&c[0]),
                type_id: int(&c[1]),
                slot: int(&c[2]),
            })
            .collect(),
        trainers: cells("trainers")
            .iter()
            .map(|c| TrainerRecord {
                id: int(&c[0]),
                name: text(&c[1]),
                region: text(&c[2]),
                created_at: Some(NaiveDate::parse_from_str(&c[3], "%Y-%m-%d").unwrap()),
            })
            .collect(),
        captures: cells("captures")
            .iter()
            .map(|c| CaptureRecord {
                id: int(&c[0]),
                trainer_id: int(&c[1]),
                pokemon_id: int(&c[2]),
                captured_at: Some(
                    NaiveDateTime::parse_from_str(&c[3], "%Y-%m-%d %H:%M:%S").unwrap(),
                ),
                level: int(&c[4]),
                location: text(&c[5]),
            })
            .collect(),
        battles: cells("battles")
            .iter()
            .map(|c| BattleRecord {
                id: int(&c[0]),
                pokemon_a_id: int(&c[1]),
                pokemon_b_id: int(&c[2]),
                winner_id: int(&c[3]),
                fought_at: Some(NaiveDateTime::parse_from_str(&c[4], "%Y-%m-%d %H:%M:%S").unwrap()),
                duration_seconds: int(&c[5]),
            })
            .collect(),
    }
}

/// Dataset mínimo válido: 2 tipos, 2 Pokémon (uno con dos tipos), 2 entrenadores.
pub fn valid_dataset() -> StagingDataset {
    let date = |s: &str| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok();
    let at = |s: &str| NaiveDateTime::parse_from_str(s, "%Y-%m-%d %H:%M:%S").ok();
    let s = |v: &str| Some(v.to_owned());
    StagingDataset {
        types: vec![
            TypeRecord {
                id: Some(1),
                name: s("normal"),
            },
            TypeRecord {
                id: Some(3),
                name: s("flying"),
            },
        ],
        pokemon: vec![
            PokemonRecord {
                id: Some(16),
                name: s("pidgey"),
                height: Some(3),
                weight: Some(18),
                base_experience: Some(50),
                sprite_url: s("https://img/16.png"),
            },
            PokemonRecord {
                id: Some(19),
                name: s("rattata"),
                height: Some(3),
                weight: Some(35),
                base_experience: None,
                sprite_url: None,
            },
        ],
        pokemon_types: vec![
            PokemonTypeRecord {
                pokemon_id: Some(16),
                type_id: Some(1),
                slot: Some(1),
            },
            PokemonTypeRecord {
                pokemon_id: Some(16),
                type_id: Some(3),
                slot: Some(2),
            },
            PokemonTypeRecord {
                pokemon_id: Some(19),
                type_id: Some(1),
                slot: Some(1),
            },
        ],
        trainers: vec![
            TrainerRecord {
                id: Some(1),
                name: s("Ash Ketchum"),
                region: s("Kanto"),
                created_at: date("2025-01-02"),
            },
            TrainerRecord {
                id: Some(2),
                name: s("Misty Waterflower"),
                region: s("Kanto"),
                created_at: date("2025-03-04"),
            },
        ],
        captures: vec![
            CaptureRecord {
                id: Some(1),
                trainer_id: Some(1),
                pokemon_id: Some(16),
                captured_at: at("2025-11-01 02:22:00"),
                level: Some(12),
                location: s("Route 1"),
            },
            CaptureRecord {
                id: Some(2),
                trainer_id: Some(2),
                pokemon_id: Some(19),
                captured_at: at("2025-12-05 10:00:00"),
                level: Some(50),
                location: s("Route 10"),
            },
        ],
        battles: vec![BattleRecord {
            id: Some(1),
            pokemon_a_id: Some(16),
            pokemon_b_id: Some(19),
            winner_id: Some(19),
            fought_at: at("2025-11-02 08:30:54"),
            duration_seconds: Some(120),
        }],
    }
}

static COUNTER: AtomicU32 = AtomicU32::new(0);

/// Base de datos temporal con las migraciones aplicadas. Cada test tiene la suya: las
/// migraciones crean el schema `staging` (con nombre fijo) y las tablas, vistas y
/// funciones de un test no se pisan con las de otro.
pub struct TestDb {
    pub pool: PgPool,
    admin: PgConnection,
    name: String,
}

impl TestDb {
    /// `None` si no hay `TEST_DATABASE_URL`: el test se omite.
    pub async fn create() -> Option<Self> {
        let Ok(url) = std::env::var("TEST_DATABASE_URL") else {
            eprintln!("TEST_DATABASE_URL no está definida: se omite el test");
            return None;
        };
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let name = format!(
            "test_{}_{nanos}_{}",
            std::process::id(),
            COUNTER.fetch_add(1, Ordering::Relaxed)
        );

        let mut admin = PgConnection::connect(&url).await.unwrap();
        sqlx::query(&format!("CREATE DATABASE \"{name}\""))
            .execute(&mut admin)
            .await
            .unwrap();

        let options = PgConnectOptions::from_str(&url)
            .unwrap()
            .database(&name)
            .application_name(&name);
        let pool = PgPoolOptions::new()
            .max_connections(8)
            .connect_with(options)
            .await
            .unwrap();
        pokemon_db::MIGRATOR.run(&pool).await.unwrap();
        Some(Self { pool, admin, name })
    }

    /// Nombre de la base (también el `application_name` de sus conexiones).
    pub fn name(&self) -> &str {
        &self.name
    }

    pub async fn scalar_i64(&self, sql: &str) -> i64 {
        sqlx::query_scalar(sql).fetch_one(&self.pool).await.unwrap()
    }

    pub async fn scalar_text(&self, sql: &str) -> String {
        sqlx::query_scalar(sql).fetch_one(&self.pool).await.unwrap()
    }

    /// Copia los CSV de referencia a `staging` con `COPY`, sin pasar por el código bajo prueba.
    pub async fn copy_reference_into_staging(&self) {
        for (table, columns) in [
            ("types", "id, name"),
            (
                "pokemon",
                "id, name, height, weight, base_experience, sprite_url",
            ),
            ("pokemon_types", "pokemon_id, type_id, slot"),
            ("trainers", "id, name, region, created_at"),
            (
                "captures",
                "id, trainer_id, pokemon_id, captured_at, level, location",
            ),
            (
                "battles",
                "id, pokemon_a_id, pokemon_b_id, winner_id, fought_at, duration_seconds",
            ),
        ] {
            let mut copy = self
                .pool
                .copy_in_raw(&format!(
                    "COPY staging.{table} ({columns}) FROM STDIN (FORMAT csv, HEADER true)"
                ))
                .await
                .unwrap();
            copy.send(fixture(table).into_bytes()).await.unwrap();
            copy.finish().await.unwrap();
        }
    }

    pub async fn exec(&self, sql: &str) {
        sqlx::raw_sql(sql).execute(&self.pool).await.unwrap();
    }

    /// Borra la base; se llama antes de las aserciones para no dejar basura
    /// si alguna falla.
    pub async fn drop(mut self) {
        self.pool.close().await;
        sqlx::query(&format!(
            "DROP DATABASE IF EXISTS \"{}\" WITH (FORCE)",
            self.name
        ))
        .execute(&mut self.admin)
        .await
        .unwrap();
    }
}
