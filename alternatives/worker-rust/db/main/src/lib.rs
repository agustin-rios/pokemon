//! Base principal: migraciones, vistas y conexión.
//!
//! El esquema vive en `migrations/` (las dos migraciones originales de Prisma
//! más `etl_runs` y `staging`) y las vistas de reportes en `sql/views.sql`, que es la única
//! fuente de verdad de las vistas.

use sqlx::migrate::Migrator;
use sqlx::postgres::{PgPool, PgPoolOptions};

/// Migraciones embebidas en el binario.
pub static MIGRATOR: Migrator = sqlx::migrate!("./migrations");

/// SQL de las vistas de reportes (idempotente: `CREATE OR REPLACE VIEW`).
pub const VIEWS_SQL: &str = include_str!("../sql/views.sql");

/// Conexiones máximas del pool: la API y el worker son procesos chicos y la
/// cola solo mantiene una conexión de escucha aparte.
const MAX_CONNECTIONS: u32 = 10;

/// Abre un pool contra `database_url`.
///
/// # Errors
///
/// Falla si la URL es inválida o no se puede conectar a la base.
pub async fn connect(database_url: &str) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(MAX_CONNECTIONS)
        .connect(database_url)
        .await
}
