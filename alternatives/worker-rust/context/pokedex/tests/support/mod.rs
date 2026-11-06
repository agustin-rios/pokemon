//! Utilidades de los tests de integración: una base propia por test.
#![allow(dead_code, clippy::unwrap_used, clippy::expect_used)]

use std::str::FromStr;
use std::sync::atomic::{AtomicU32, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use sqlx::postgres::{PgConnectOptions, PgPoolOptions};
use sqlx::{Connection, PgConnection, PgPool};

static COUNTER: AtomicU32 = AtomicU32::new(0);

/// Base de datos temporal con las migraciones aplicadas. Cada test tiene la suya: las
/// migraciones crean el schema `staging` (con nombre fijo) y las tablas y vistas de un
/// test no se pisan con las de otro.
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

        let options = PgConnectOptions::from_str(&url).unwrap().database(&name);
        let pool = PgPoolOptions::new()
            .max_connections(4)
            .connect_with(options)
            .await
            .unwrap();
        pokemon_db::MIGRATOR.run(&pool).await.unwrap();
        Some(Self { pool, admin, name })
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
