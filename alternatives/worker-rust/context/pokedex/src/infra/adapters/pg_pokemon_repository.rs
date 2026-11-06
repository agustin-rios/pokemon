use std::collections::HashMap;

use async_trait::async_trait;
use sqlx::{FromRow, PgPool};

use super::map_error;
use crate::application::RepositoryError;
use crate::application::ports::{Page, PageQuery, PokemonRepository};
use crate::domain::{Pokemon, PokemonType};

#[derive(FromRow)]
struct PokemonRow {
    id: i32,
    name: String,
    height: i32,
    weight: i32,
    base_experience: i32,
    sprite_url: Option<String>,
}

#[derive(FromRow)]
struct TypeRow {
    pokemon_id: i32,
    id: i32,
    name: String,
    slot: i16,
}

/// Catálogo sobre las tablas `pokemon`, `pokemon_types` y `types`.
pub struct PgPokemonRepository {
    pool: PgPool,
}

impl PgPokemonRepository {
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }

    /// Arma los Pokémon con sus tipos (una sola consulta para todos), ordenados
    /// por slot.
    async fn with_types(&self, rows: Vec<PokemonRow>) -> Result<Vec<Pokemon>, RepositoryError> {
        let ids: Vec<i32> = rows.iter().map(|row| row.id).collect();
        let type_rows: Vec<TypeRow> = sqlx::query_as(
            "SELECT pt.pokemon_id, t.id, t.name, pt.slot
             FROM pokemon_types pt
             JOIN types t ON t.id = pt.type_id
             WHERE pt.pokemon_id = ANY($1)
             ORDER BY pt.pokemon_id, pt.slot",
        )
        .bind(&ids)
        .fetch_all(&self.pool)
        .await
        .map_err(map_error)?;

        let mut types_by_pokemon: HashMap<i32, Vec<PokemonType>> = HashMap::new();
        for row in type_rows {
            types_by_pokemon
                .entry(row.pokemon_id)
                .or_default()
                .push(PokemonType {
                    id: row.id,
                    name: row.name,
                    slot: i32::from(row.slot),
                });
        }

        Ok(rows
            .into_iter()
            .map(|row| Pokemon {
                types: types_by_pokemon.remove(&row.id).unwrap_or_default(),
                id: row.id,
                name: row.name,
                height: row.height,
                weight: row.weight,
                base_experience: row.base_experience,
                sprite: row.sprite_url,
            })
            .collect())
    }
}

#[async_trait]
impl PokemonRepository for PgPokemonRepository {
    async fn list(&self, query: PageQuery) -> Result<Page<Pokemon>, RepositoryError> {
        // i64 para que `(page - 1) * page_size` no desborde con páginas enormes.
        let offset = i64::from(query.page - 1) * i64::from(query.page_size);
        let rows = sqlx::query_as::<_, PokemonRow>(
            "SELECT id, name, height, weight, base_experience, sprite_url
             FROM pokemon
             ORDER BY id
             LIMIT $1 OFFSET $2",
        )
        .bind(i64::from(query.page_size))
        .bind(offset)
        .fetch_all(&self.pool);
        let total =
            sqlx::query_scalar::<_, i32>("SELECT count(*)::int FROM pokemon").fetch_one(&self.pool);
        let (rows, total) = tokio::try_join!(rows, total).map_err(map_error)?;

        Ok(Page {
            items: self.with_types(rows).await?,
            total,
            page: query.page,
            page_size: query.page_size,
        })
    }

    async fn find_by_id(&self, id: i32) -> Result<Option<Pokemon>, RepositoryError> {
        let row = sqlx::query_as::<_, PokemonRow>(
            "SELECT id, name, height, weight, base_experience, sprite_url
             FROM pokemon
             WHERE id = $1",
        )
        .bind(id)
        .fetch_optional(&self.pool)
        .await
        .map_err(map_error)?;

        match row {
            Some(row) => Ok(self.with_types(vec![row]).await?.pop()),
            None => Ok(None),
        }
    }
}
