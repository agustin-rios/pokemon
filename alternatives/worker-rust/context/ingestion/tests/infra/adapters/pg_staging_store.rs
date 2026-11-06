//! Tablas `staging` contra Postgres real (necesita `TEST_DATABASE_URL`).

use std::time::Duration;

use crate::support;
use crate::support::TestDb;
use pokemon_context_ingestion::application::ports::{
    CommitOutcome, EtlRunQueue, Fence, StagingStore,
};
use pokemon_context_ingestion::domain::{
    ErrorClass, PokemonRecord, StepError, StepName, TypeRecord, classify, validate_dataset,
};
use pokemon_context_ingestion::infra::adapters::{PgEtlRunQueue, PgStagingStore};
use pokemon_data::dataset::{Dataset, PokemonRow, PokemonTypeRow, TypeRow};
use pokemon_data::generator::{GeneratorOptions, generate};

fn catalog() -> Dataset {
    Dataset {
        pokemon: vec![
            PokemonRow {
                id: 1,
                name: "bulbasaur".into(),
                height: 7,
                weight: 69,
                base_experience: Some(64),
                sprite: Some("https://img/1.png".into()),
            },
            PokemonRow {
                id: 2,
                name: "ivysaur".into(),
                height: 10,
                weight: 130,
                base_experience: None,
                sprite: None,
            },
        ],
        types: vec![TypeRow {
            id: 12,
            name: "grass".into(),
        }],
        pokemon_types: vec![
            PokemonTypeRow {
                pokemon_id: 1,
                type_id: 12,
                slot: 1,
            },
            PokemonTypeRow {
                pokemon_id: 2,
                type_id: 12,
                slot: 1,
            },
        ],
    }
}

async fn claimed_fence(schema: &TestDb) -> Fence {
    let queue = PgEtlRunQueue::new(schema.pool.clone());
    queue.enqueue().await.unwrap();
    queue.claim("w1", 30.0).await.unwrap().unwrap().fence
}

#[tokio::test]
async fn the_catalog_round_trips_with_nulls() {
    let Some(schema) = TestDb::create().await else {
        return;
    };
    let store = PgStagingStore::new(schema.pool.clone());

    let outcome = store.replace_catalog(&catalog(), None).await.unwrap();
    let read = store.read_all().await.unwrap();
    let ids = store.pokemon_ids().await.unwrap();
    schema.drop().await;

    assert_eq!(outcome, CommitOutcome::Committed);
    assert_eq!(ids, [1, 2]);
    assert_eq!(
        read.types,
        [TypeRecord {
            id: Some(12),
            name: Some("grass".into())
        }]
    );
    assert_eq!(
        read.pokemon[1],
        PokemonRecord {
            id: Some(2),
            name: Some("ivysaur".into()),
            height: Some(10),
            weight: Some(130),
            base_experience: None,
            sprite_url: None,
        }
    );
    assert_eq!(read.pokemon_types.len(), 2);
    assert_eq!(read.pokemon_types[0].slot, Some(1));
    // Lo que no es del catálogo sigue vacío.
    assert!(read.trainers.is_empty() && read.captures.is_empty() && read.battles.is_empty());
}

#[tokio::test]
async fn replacing_twice_leaves_only_the_last_rows() {
    let Some(schema) = TestDb::create().await else {
        return;
    };
    let store = PgStagingStore::new(schema.pool.clone());
    store.replace_catalog(&catalog(), None).await.unwrap();
    let mut smaller = catalog();
    smaller.pokemon.truncate(1);
    smaller.pokemon_types.truncate(1);

    store.replace_catalog(&smaller, None).await.unwrap();
    let ids = store.pokemon_ids().await.unwrap();
    let relations = store.read_all().await.unwrap().pokemon_types.len();
    schema.drop().await;

    assert_eq!(ids, [1]);
    assert_eq!(relations, 1);
}

#[tokio::test]
async fn the_generated_rows_are_stored_exactly() {
    let Some(schema) = TestDb::create().await else {
        return;
    };
    let store = PgStagingStore::new(schema.pool.clone());
    let ids: Vec<i32> = (1..=100).collect();
    let generated = generate(&ids, &GeneratorOptions::default()).unwrap();

    let outcome = store.replace_generated(&generated, None).await.unwrap();
    let read = store.read_all().await.unwrap();
    schema.drop().await;

    assert_eq!(outcome, CommitOutcome::Committed);
    assert_eq!(
        (read.trainers.len(), read.captures.len(), read.battles.len()),
        (50, 5000, 2000)
    );
    let last = generated.captures.last().unwrap();
    let stored = read.captures.last().unwrap();
    assert_eq!(stored.id, Some(last.id));
    assert_eq!(stored.captured_at, Some(last.captured_at));
    assert_eq!(stored.location.as_deref(), Some(last.location));
    let battle = &generated.battles[0];
    assert_eq!(
        read.battles[0].duration_seconds,
        Some(battle.duration_seconds)
    );
    assert_eq!(
        read.trainers[0].created_at,
        Some(generated.trainers[0].created_at)
    );
}

#[tokio::test]
async fn the_reference_data_copied_into_staging_validates_as_expected() {
    let Some(schema) = TestDb::create().await else {
        return;
    };
    schema.copy_reference_into_staging().await;
    let store = PgStagingStore::new(schema.pool.clone());

    let read = store.read_all().await.unwrap();
    schema.drop().await;

    // El CSV de referencia ordena `pokemon_types` por slot; la lectura, por tipo.
    let mut expected = support::reference_dataset();
    expected
        .pokemon_types
        .sort_by_key(|r| (r.pokemon_id, r.type_id));
    assert_eq!(read, expected);
    let report = validate_dataset(&read).unwrap();
    assert_eq!(report.counts["captures"], 5000);
    assert_eq!(report.counts["battles"], 1996);
}

#[tokio::test]
async fn read_all_orders_by_id_with_nulls_last_and_keeps_duplicates() {
    let Some(schema) = TestDb::create().await else {
        return;
    };
    schema
        .exec(
            "INSERT INTO staging.types (id, name) VALUES (5, 'e'), (NULL, 'nul'), (2, 'b'), (2, 'b2'), (1, NULL)",
        )
        .await;
    let store = PgStagingStore::new(schema.pool.clone());

    let types = store.read_all().await.unwrap().types;
    schema.drop().await;

    let seen: Vec<_> = types.iter().map(|t| (t.id, t.name.as_deref())).collect();
    assert_eq!(
        seen,
        [
            (Some(1), None),
            (Some(2), Some("b")),
            (Some(2), Some("b2")),
            (Some(5), Some("e")),
            (None, Some("nul")),
        ]
    );
}

#[tokio::test]
async fn pokemon_ids_are_distinct_ascending_and_skip_nulls() {
    let Some(schema) = TestDb::create().await else {
        return;
    };
    schema
        .exec("INSERT INTO staging.pokemon (id) VALUES (7), (3), (3), (NULL)")
        .await;
    let store = PgStagingStore::new(schema.pool.clone());

    let ids = store.pokemon_ids().await.unwrap();
    schema.drop().await;

    assert_eq!(ids, [3, 7]);
}

#[tokio::test]
async fn the_fence_is_checked_before_commit_on_both_writes() {
    let Some(schema) = TestDb::create().await else {
        return;
    };
    let store = PgStagingStore::new(schema.pool.clone());
    let fence = claimed_fence(&schema).await;
    let generated = generate(&[1, 2, 3], &GeneratorOptions::default()).unwrap();

    // Con el token vigente se escribe.
    let committed = store
        .replace_catalog(&catalog(), Some(&fence))
        .await
        .unwrap();
    let kept = store.pokemon_ids().await.unwrap();

    // Con un token viejo o de otro worker: rollback, lo anterior queda intacto.
    let stale = Fence {
        attempts: fence.attempts + 1,
        ..fence.clone()
    };
    let other = Fence {
        worker_id: "w2".into(),
        ..fence.clone()
    };
    let mut smaller = catalog();
    smaller.pokemon.truncate(1);
    let lost_catalog = store.replace_catalog(&smaller, Some(&stale)).await.unwrap();
    let lost_generated = store
        .replace_generated(&generated, Some(&other))
        .await
        .unwrap();
    let after = store.read_all().await.unwrap();
    schema.drop().await;

    assert_eq!(committed, CommitOutcome::Committed);
    assert_eq!(kept, [1, 2]);
    assert_eq!(lost_catalog, CommitOutcome::LeaseLost);
    assert_eq!(lost_generated, CommitOutcome::LeaseLost);
    assert_eq!(after.pokemon.len(), 2);
    assert!(after.trainers.is_empty());
}

#[tokio::test]
async fn a_failing_write_leaves_the_previous_rows_and_is_permanent() {
    let Some(schema) = TestDb::create().await else {
        return;
    };
    let store = PgStagingStore::new(schema.pool.clone());
    store.replace_catalog(&catalog(), None).await.unwrap();
    // Un slot que no cabe en SMALLINT falla en el último insert, con los anteriores ya hechos.
    let mut broken = catalog();
    broken.pokemon.truncate(1);
    broken.pokemon_types[0].slot = 100_000;

    let error = store.replace_catalog(&broken, None).await.unwrap_err();
    let ids = store.pokemon_ids().await.unwrap();
    schema.drop().await;

    assert_eq!(error.sqlstate.as_deref(), Some("22003"));
    assert_eq!(
        classify(StepName::Scrape, &StepError::Storage(error)),
        ErrorClass::Permanent
    );
    assert_eq!(ids, [1, 2]);
}

#[tokio::test]
async fn dropping_the_write_before_the_commit_writes_nothing() {
    let Some(schema) = TestDb::create().await else {
        return;
    };
    let store = PgStagingStore::new(schema.pool.clone());
    let fence = claimed_fence(&schema).await;
    store.replace_catalog(&catalog(), None).await.unwrap();
    let mut smaller = catalog();
    smaller.pokemon.truncate(1);
    smaller.pokemon_types.truncate(1);

    // Otra conexión bloquea `etl_runs`: la escritura llega hasta la verificación del fence
    // (con el TRUNCATE y los inserts ya hechos) y queda esperando.
    let mut blocker = schema.pool.begin().await.unwrap();
    sqlx::query("LOCK TABLE etl_runs IN ACCESS EXCLUSIVE MODE")
        .execute(&mut *blocker)
        .await
        .unwrap();
    let abandoned = tokio::time::timeout(
        Duration::from_millis(500),
        store.replace_catalog(&smaller, Some(&fence)),
    )
    .await;
    blocker.rollback().await.unwrap();
    let ids = store.pokemon_ids().await.unwrap();
    schema.drop().await;

    assert!(abandoned.is_err(), "la escritura debía quedar esperando");
    assert_eq!(ids, [1, 2]);
}

#[tokio::test]
async fn a_statement_timeout_is_a_retryable_error() {
    let Some(schema) = TestDb::create().await else {
        return;
    };
    let store =
        PgStagingStore::new(schema.pool.clone()).with_statement_timeout(Duration::from_millis(200));
    let mut blocker = schema.pool.begin().await.unwrap();
    sqlx::query("LOCK TABLE staging.types IN ACCESS EXCLUSIVE MODE")
        .execute(&mut *blocker)
        .await
        .unwrap();

    let error = store.replace_catalog(&catalog(), None).await.unwrap_err();
    blocker.rollback().await.unwrap();
    schema.drop().await;

    assert_eq!(error.sqlstate.as_deref(), Some("57014"));
    assert_eq!(
        classify(StepName::Scrape, &StepError::Storage(error)),
        ErrorClass::Retryable
    );
}
