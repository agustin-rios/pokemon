//! Repositorios falsos de los casos de uso (sin base de datos).
#![allow(dead_code, clippy::unwrap_used)]

use std::sync::Mutex;

use async_trait::async_trait;
use pokemon_context_pokedex::application::ports::{
    Page, PageQuery, PokemonRepository, ReportsRepository,
};
use pokemon_context_pokedex::application::{PokedexError, RepositoryError};
use pokemon_context_pokedex::domain::{
    LevelClassification, MonthlyCaptureGrowth, Pokemon, PokemonType, TopTrainer, TypeSummary,
};

/// Repositorio de Pokémon falso: devuelve lo configurado y recuerda las llamadas.
#[derive(Default)]
pub struct StubPokemonRepository {
    pub found: Option<Pokemon>,
    pub list_calls: Mutex<Vec<PageQuery>>,
    pub find_calls: Mutex<Vec<i32>>,
}

#[async_trait]
impl PokemonRepository for StubPokemonRepository {
    async fn list(&self, query: PageQuery) -> Result<Page<Pokemon>, RepositoryError> {
        self.list_calls.lock().unwrap().push(query);
        Ok(Page {
            items: vec![],
            total: 0,
            page: query.page,
            page_size: query.page_size,
        })
    }

    async fn find_by_id(&self, id: i32) -> Result<Option<Pokemon>, RepositoryError> {
        self.find_calls.lock().unwrap().push(id);
        Ok(self.found.clone())
    }
}

pub fn bulbasaur() -> Pokemon {
    Pokemon {
        id: 1,
        name: "bulbasaur".into(),
        height: 7,
        weight: 69,
        base_experience: 64,
        sprite: None,
        types: vec![
            PokemonType {
                id: 12,
                name: "grass".into(),
                slot: 1,
            },
            PokemonType {
                id: 4,
                name: "poison".into(),
                slot: 2,
            },
        ],
    }
}

pub fn validation_message(error: PokedexError) -> String {
    match error {
        PokedexError::Validation(e) => e.0,
        other @ PokedexError::Repository(_) => panic!("se esperaba ValidationError: {other}"),
    }
}

/// Los reportes los agrega la base (vistas): cada caso de uso devuelve lo que
/// entrega su método del repositorio, sin recalcular nada.
pub struct StubReportsRepository;

#[async_trait]
impl ReportsRepository for StubReportsRepository {
    async fn type_summary(&self) -> Result<Vec<TypeSummary>, RepositoryError> {
        Ok(vec![TypeSummary {
            type_id: 10,
            type_name: "fire".into(),
            pokemon_count: 12,
            average_base_experience: 145.08,
        }])
    }

    async fn monthly_capture_growth(&self) -> Result<Vec<MonthlyCaptureGrowth>, RepositoryError> {
        Ok(vec![
            MonthlyCaptureGrowth {
                month: "2025-11".into(),
                captures: 233,
                change_percent: None,
            },
            MonthlyCaptureGrowth {
                month: "2025-12".into(),
                captures: 244,
                change_percent: Some(4.72),
            },
        ])
    }

    async fn top_trainers_by_region(&self) -> Result<Vec<TopTrainer>, RepositoryError> {
        Ok(vec![TopTrainer {
            region: "Kanto".into(),
            rank: 1,
            trainer_id: 12,
            trainer_name: "Ash Ketchum".into(),
            captures: 1270,
        }])
    }

    async fn level_classification_by_type(
        &self,
    ) -> Result<Vec<LevelClassification>, RepositoryError> {
        Err(RepositoryError::DataNotLoaded)
    }
}
