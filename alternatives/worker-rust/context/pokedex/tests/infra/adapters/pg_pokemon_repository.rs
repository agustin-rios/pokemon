//! Adapter del catálogo contra Postgres real (schema propio, ver `support`).
//! Necesita `TEST_DATABASE_URL`; sin ella se omite.

use crate::support::TestDb;
use pokemon_context_pokedex::application::ports::{PageQuery, PokemonRepository};
use pokemon_context_pokedex::infra::adapters::PgPokemonRepository;

const FIXTURE: &str = "
  INSERT INTO types (id, name) VALUES (4, 'poison'), (12, 'grass'), (10, 'fire');
  INSERT INTO pokemon (id, name, height, weight, base_experience, sprite_url) VALUES
    (1, 'bulbasaur', 7, 69, 64, 'http://img/1.png'),
    (2, 'charmander', 6, 85, 62, NULL),
    (3, 'caterpie', 3, 29, 39, NULL);
  INSERT INTO pokemon_types (pokemon_id, type_id, slot) VALUES
    (1, 4, 2), (1, 12, 1), (2, 10, 1);
";

#[tokio::test]
async fn list_pages_by_id_with_types_ordered_by_slot() {
    let Some(schema) = TestDb::create().await else {
        return;
    };
    schema.exec(FIXTURE).await;
    let repository = PgPokemonRepository::new(schema.pool.clone());
    let first = repository
        .list(PageQuery {
            page: 1,
            page_size: 2,
        })
        .await
        .unwrap();
    let second = repository
        .list(PageQuery {
            page: 2,
            page_size: 2,
        })
        .await
        .unwrap();
    schema.drop().await;

    assert_eq!((first.total, first.page, first.page_size), (3, 1, 2));
    let names: Vec<_> = first.items.iter().map(|p| p.name.as_str()).collect();
    assert_eq!(names, ["bulbasaur", "charmander"]);
    let bulbasaur = &first.items[0];
    assert_eq!(bulbasaur.sprite.as_deref(), Some("http://img/1.png"));
    let types: Vec<_> = bulbasaur
        .types
        .iter()
        .map(|t| (t.id, t.name.as_str(), t.slot))
        .collect();
    assert_eq!(types, [(12, "grass", 1), (4, "poison", 2)]);
    assert_eq!(first.items[1].sprite, None);

    assert_eq!(second.items.len(), 1);
    assert_eq!(second.items[0].name, "caterpie");
    assert!(second.items[0].types.is_empty());
}

#[tokio::test]
async fn find_by_id_returns_the_pokemon_or_none() {
    let Some(schema) = TestDb::create().await else {
        return;
    };
    schema.exec(FIXTURE).await;
    let repository = PgPokemonRepository::new(schema.pool.clone());
    let found = repository.find_by_id(1).await.unwrap();
    let missing = repository.find_by_id(999).await.unwrap();
    schema.drop().await;

    let found = found.unwrap();
    assert_eq!(found.name, "bulbasaur");
    assert_eq!(found.base_experience, 64);
    assert_eq!(found.types.len(), 2);
    assert!(missing.is_none());
}
