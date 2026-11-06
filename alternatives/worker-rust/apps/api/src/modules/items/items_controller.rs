use std::sync::Arc;

use axum::Json;
use axum::extract::rejection::QueryRejection;
use axum::extract::{Path, Query, State};
use pokemon_context_pokedex::application::ports::Page;
use pokemon_context_pokedex::application::use_cases::{
    GetPokemon, GetTypeSummary, ListPokemon, ListPokemonInput, MAX_PAGE_SIZE,
};
use pokemon_context_pokedex::domain::{Pokemon, TypeSummary};
use serde::Deserialize;

use crate::common::filters::ApiError;

/// Los casos de uso que sirve `/items`.
pub struct ItemsController {
    list_pokemon: ListPokemon,
    get_pokemon: GetPokemon,
    type_summary: GetTypeSummary,
}

impl ItemsController {
    pub fn new(
        list_pokemon: ListPokemon,
        get_pokemon: GetPokemon,
        type_summary: GetTypeSummary,
    ) -> Self {
        Self {
            list_pokemon,
            get_pokemon,
            type_summary,
        }
    }
}

#[derive(Debug, Deserialize)]
pub struct ListQuery {
    page: Option<String>,
    #[serde(rename = "pageSize")]
    page_size: Option<String>,
}

/// Entero de la query: lo que no lo es se rechaza con el mensaje de su regla.
fn parse_param(raw: Option<&str>, message: String) -> Result<Option<i32>, ApiError> {
    raw.map(|text| text.trim().parse::<i32>())
        .transpose()
        .map_err(|_| ApiError::BadRequest(message))
}

/// `GET /items`: lista paginada de Pokémon con sus tipos.
pub async fn list(
    State(controller): State<Arc<ItemsController>>,
    query: Result<Query<ListQuery>, QueryRejection>,
) -> Result<Json<Page<Pokemon>>, ApiError> {
    let Query(query) = query.map_err(|e| ApiError::BadRequest(e.body_text()))?;
    let input = ListPokemonInput {
        page: parse_param(query.page.as_deref(), "page debe ser un entero ≥ 1".into())?,
        page_size: parse_param(
            query.page_size.as_deref(),
            format!("pageSize debe ser un entero entre 1 y {MAX_PAGE_SIZE}"),
        )?,
    };
    Ok(Json(controller.list_pokemon.execute(input).await?))
}

/// `GET /items/summary`: Pokémon y experiencia base promedio por tipo.
pub async fn summary(
    State(controller): State<Arc<ItemsController>>,
) -> Result<Json<Vec<TypeSummary>>, ApiError> {
    Ok(Json(controller.type_summary.execute().await?))
}

/// `GET /items/:id`: un Pokémon con sus tipos; 400 si el id no es un entero
/// positivo, 404 si no existe.
pub async fn find_one(
    State(controller): State<Arc<ItemsController>>,
    Path(raw_id): Path<String>,
) -> Result<Json<Pokemon>, ApiError> {
    let id = raw_id
        .trim()
        .parse::<i32>()
        .ok()
        .filter(|id| *id > 0)
        .ok_or_else(|| ApiError::BadRequest("id debe ser un entero positivo".into()))?;
    controller
        .get_pokemon
        .execute(id)
        .await?
        .map(Json)
        .ok_or_else(|| ApiError::NotFound(format!("No existe el Pokémon {id}")))
}
