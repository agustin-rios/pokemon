//! `GetPokemon` con un repositorio falso.

use std::sync::Arc;

use pokemon_context_pokedex::application::use_cases::GetPokemon;

use crate::stubs::{StubPokemonRepository, bulbasaur, validation_message};

#[tokio::test]
async fn get_returns_the_repository_pokemon() {
    let repo = Arc::new(StubPokemonRepository {
        found: Some(bulbasaur()),
        ..Default::default()
    });
    let found = GetPokemon::new(repo.clone()).execute(1).await.unwrap();

    assert_eq!(found, Some(bulbasaur()));
    assert_eq!(*repo.find_calls.lock().unwrap(), [1]);
}

#[tokio::test]
async fn get_returns_none_when_missing() {
    let repo = Arc::new(StubPokemonRepository::default());
    assert_eq!(GetPokemon::new(repo).execute(999).await.unwrap(), None);
}

#[tokio::test]
async fn get_rejects_ids_below_one_without_querying() {
    for id in [0, -1, i32::MIN] {
        let repo = Arc::new(StubPokemonRepository::default());
        let error = GetPokemon::new(repo.clone()).execute(id).await.unwrap_err();
        assert_eq!(validation_message(error), "id debe ser un entero ≥ 1");
        assert!(repo.find_calls.lock().unwrap().is_empty());
    }
}
