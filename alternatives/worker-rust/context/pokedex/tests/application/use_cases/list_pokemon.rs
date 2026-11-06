//! `ListPokemon` con un repositorio falso.

use std::sync::Arc;

use pokemon_context_pokedex::application::ports::PageQuery;
use pokemon_context_pokedex::application::use_cases::{
    DEFAULT_PAGE_SIZE, ListPokemon, ListPokemonInput, MAX_PAGE_SIZE,
};

use crate::stubs::{StubPokemonRepository, validation_message};

#[tokio::test]
async fn list_without_params_asks_first_page_with_default_size() {
    let repo = Arc::new(StubPokemonRepository::default());
    let page = ListPokemon::new(repo.clone())
        .execute(ListPokemonInput::default())
        .await
        .unwrap();

    assert_eq!((page.page, page.page_size), (1, DEFAULT_PAGE_SIZE));
    assert_eq!(
        *repo.list_calls.lock().unwrap(),
        [PageQuery {
            page: 1,
            page_size: DEFAULT_PAGE_SIZE
        }]
    );
}

#[tokio::test]
async fn list_passes_page_and_size_to_the_repository() {
    let repo = Arc::new(StubPokemonRepository::default());
    ListPokemon::new(repo.clone())
        .execute(ListPokemonInput {
            page: Some(3),
            page_size: Some(50),
        })
        .await
        .unwrap();

    assert_eq!(
        *repo.list_calls.lock().unwrap(),
        [PageQuery {
            page: 3,
            page_size: 50
        }]
    );
}

#[tokio::test]
async fn list_rejects_invalid_input_without_querying() {
    let cases = [
        (
            ListPokemonInput {
                page: Some(0),
                page_size: None,
            },
            "page debe ser un entero ≥ 1".to_string(),
        ),
        (
            ListPokemonInput {
                page: Some(-4),
                page_size: None,
            },
            "page debe ser un entero ≥ 1".to_string(),
        ),
        (
            ListPokemonInput {
                page: None,
                page_size: Some(0),
            },
            "pageSize debe ser un entero entre 1 y 100".to_string(),
        ),
        (
            ListPokemonInput {
                page: None,
                page_size: Some(MAX_PAGE_SIZE + 1),
            },
            "pageSize debe ser un entero entre 1 y 100".to_string(),
        ),
    ];
    for (input, message) in cases {
        let repo = Arc::new(StubPokemonRepository::default());
        let error = ListPokemon::new(repo.clone())
            .execute(input)
            .await
            .unwrap_err();
        assert_eq!(validation_message(error), message, "{input:?}");
        assert!(repo.list_calls.lock().unwrap().is_empty(), "{input:?}");
    }
}
