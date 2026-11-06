use sqlx::PgPool;

/// Abre el pool de conexiones que comparten la cola, el staging y la carga.
///
/// # Errors
///
/// Falla si la URL es inválida o no se puede conectar a la base.
pub async fn database_module(database_url: &str) -> Result<PgPool, sqlx::Error> {
    pokemon_db::connect(database_url).await
}
