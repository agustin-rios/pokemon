//! Carga de `staging` a las tablas finales contra Postgres real (necesita `TEST_DATABASE_URL`).
use std::time::Duration;

use crate::support::TestDb;
use pokemon_context_ingestion::application::ports::{
    CommitOutcome, DatasetLoader, EtlRunQueue, Fence, StagingStore,
};
use pokemon_context_ingestion::domain::{
    ErrorClass, StepError, StepName, ValidationReport, classify, validate_dataset,
};
use pokemon_context_ingestion::infra::adapters::{PgDatasetLoader, PgEtlRunQueue, PgStagingStore};
use pokemon_data::dataset::{Dataset, PokemonRow, PokemonTypeRow, TypeRow};

/// Checksum de las 6 tablas del dataset de referencia (`data-current`).
pub(super) const CHECKSUM_SQL: &str = "\
SELECT string_agg(t || '=' || n || ':' || left(h, 8), ' ' ORDER BY o) FROM (
  SELECT 1 o,'types' t,count(*) n,md5(coalesce(string_agg(x::text,'|' ORDER BY x.id),'')) h FROM types x UNION ALL
  SELECT 2,'pokemon',count(*),md5(coalesce(string_agg(x::text,'|' ORDER BY x.id),'')) FROM pokemon x UNION ALL
  SELECT 3,'pokemon_types',count(*),md5(coalesce(string_agg(x::text,'|' ORDER BY x.pokemon_id,x.type_id),'')) FROM pokemon_types x UNION ALL
  SELECT 4,'trainers',count(*),md5(coalesce(string_agg(x::text,'|' ORDER BY x.id),'')) FROM trainers x UNION ALL
  SELECT 5,'captures',count(*),md5(coalesce(string_agg(x::text,'|' ORDER BY x.id),'')) FROM captures x UNION ALL
  SELECT 6,'battles',count(*),md5(coalesce(string_agg(x::text,'|' ORDER BY x.id),'')) FROM battles x) s";

pub(super) const REFERENCE_CHECKSUM: &str = "types=16:9cd5bd13 pokemon=100:143cf1f5 pokemon_types=148:68d4999e \
    trainers=50:3f0d0ce2 captures=5000:5e25ca6a battles=1996:be06adb5";

/// `staging` con el dataset de referencia y su informe de validación.
pub(super) async fn reference_staging() -> Option<(TestDb, ValidationReport)> {
    let schema = TestDb::create().await?;
    schema.copy_reference_into_staging().await;
    let read = PgStagingStore::new(schema.pool.clone())
        .read_all()
        .await
        .unwrap();
    Some((schema, validate_dataset(&read).unwrap()))
}

#[tokio::test]
async fn loads_the_reference_staging_with_the_expected_checksum() {
    let Some((schema, report)) = reference_staging().await else {
        return;
    };
    let loader = PgDatasetLoader::new(schema.pool.clone());

    let outcome = loader.load(&report, None).await.unwrap();
    let checksum = schema.scalar_text(CHECKSUM_SQL).await;
    let staged = schema
        .scalar_i64("SELECT count(*) FROM staging.battles")
        .await;
    schema.drop().await;

    assert_eq!(outcome, CommitOutcome::Committed);
    assert_eq!(checksum, REFERENCE_CHECKSUM);
    // `staging` no se toca: los descartes solo se excluyen de la carga.
    assert_eq!(staged, 2000);
    assert_eq!(report.discarded_battles, [171, 290, 1278, 1813]);
}

#[tokio::test]
async fn loading_twice_is_idempotent() {
    let Some((schema, report)) = reference_staging().await else {
        return;
    };
    let loader = PgDatasetLoader::new(schema.pool.clone());

    loader.load(&report, None).await.unwrap();
    loader.load(&report, None).await.unwrap();
    let checksum = schema.scalar_text(CHECKSUM_SQL).await;
    schema.drop().await;

    assert_eq!(checksum, REFERENCE_CHECKSUM);
}

#[tokio::test]
async fn a_failing_load_leaves_the_previous_data_intact() {
    let Some((schema, report)) = reference_staging().await else {
        return;
    };
    let loader = PgDatasetLoader::new(schema.pool.clone());
    loader.load(&report, None).await.unwrap();

    // Un tipo que no existe rompe la FK a mitad de la carga (ya se había vaciado todo).
    schema
        .exec("INSERT INTO staging.pokemon_types VALUES (4, 9999, 2)")
        .await;
    let error = loader.load(&report, None).await.unwrap_err();
    let checksum = schema.scalar_text(CHECKSUM_SQL).await;
    schema.drop().await;

    assert_eq!(error.sqlstate.as_deref(), Some("23503"));
    assert_eq!(
        classify(StepName::Load, &StepError::Storage(error)),
        ErrorClass::Permanent
    );
    assert_eq!(checksum, REFERENCE_CHECKSUM);
}

#[tokio::test]
async fn a_failing_load_works_again_on_the_same_pool_afterwards() {
    let Some((schema, report)) = reference_staging().await else {
        return;
    };
    let loader = PgDatasetLoader::new(schema.pool.clone());
    schema
        .exec("INSERT INTO staging.types VALUES (1, 'repetido')")
        .await; // id repetido
    assert!(loader.load(&report, None).await.is_err());
    schema
        .exec("DELETE FROM staging.types WHERE name = 'repetido'")
        .await;

    let outcome = loader.load(&report, None).await.unwrap();
    let checksum = schema.scalar_text(CHECKSUM_SQL).await;
    schema.drop().await;

    assert_eq!(outcome, CommitOutcome::Committed);
    assert_eq!(checksum, REFERENCE_CHECKSUM);
}

#[tokio::test]
async fn the_fence_is_checked_before_commit() {
    let Some((schema, report)) = reference_staging().await else {
        return;
    };
    let loader = PgDatasetLoader::new(schema.pool.clone());
    let queue = PgEtlRunQueue::new(schema.pool.clone());
    queue.enqueue().await.unwrap();
    let fence = queue.claim("w1", 30.0).await.unwrap().unwrap().fence;

    // Con el token vigente se carga todo.
    let committed = loader.load(&report, Some(&fence)).await.unwrap();
    let loaded = schema.scalar_text(CHECKSUM_SQL).await;

    // Con un token viejo hace rollback: los datos anteriores quedan intactos.
    let smaller = ValidationReport {
        discarded_battles: [report.discarded_battles.clone(), (1..=100).collect()].concat(),
        ..report
    };
    let stale = Fence {
        attempts: fence.attempts + 1,
        ..fence.clone()
    };
    let wrong_worker = Fence {
        worker_id: "w2".into(),
        ..fence
    };
    let lost_attempts = loader.load(&smaller, Some(&stale)).await.unwrap();
    let lost_worker = loader.load(&smaller, Some(&wrong_worker)).await.unwrap();
    let after = schema.scalar_text(CHECKSUM_SQL).await;
    schema.drop().await;

    assert_eq!(committed, CommitOutcome::Committed);
    assert_eq!(loaded, REFERENCE_CHECKSUM);
    assert_eq!(lost_attempts, CommitOutcome::LeaseLost);
    assert_eq!(lost_worker, CommitOutcome::LeaseLost);
    assert_eq!(after, REFERENCE_CHECKSUM);
}

#[tokio::test]
async fn a_finished_run_cannot_load() {
    let Some((schema, report)) = reference_staging().await else {
        return;
    };
    let loader = PgDatasetLoader::new(schema.pool.clone());
    let queue = PgEtlRunQueue::new(schema.pool.clone());
    queue.enqueue().await.unwrap();
    let fence = queue.claim("w1", 30.0).await.unwrap().unwrap().fence;
    assert!(queue.complete_run(&fence).await.unwrap());

    let outcome = loader.load(&report, Some(&fence)).await.unwrap();
    let rows = schema.scalar_i64("SELECT count(*) FROM pokemon").await;
    schema.drop().await;

    assert_eq!(outcome, CommitOutcome::LeaseLost);
    assert_eq!(rows, 0);
}

#[tokio::test]
async fn dropping_the_load_before_the_commit_loads_nothing() {
    let Some((schema, report)) = reference_staging().await else {
        return;
    };
    let loader = PgDatasetLoader::new(schema.pool.clone());
    let queue = PgEtlRunQueue::new(schema.pool.clone());
    queue.enqueue().await.unwrap();
    let fence = queue.claim("w1", 30.0).await.unwrap().unwrap().fence;

    // La carga llega hasta el fence (con todo ya insertado) y queda esperando el lock.
    let mut blocker = schema.pool.begin().await.unwrap();
    sqlx::query("LOCK TABLE etl_runs IN ACCESS EXCLUSIVE MODE")
        .execute(&mut *blocker)
        .await
        .unwrap();
    let abandoned = tokio::time::timeout(
        Duration::from_millis(1500),
        loader.load(&report, Some(&fence)),
    )
    .await;
    blocker.rollback().await.unwrap();
    let rows = schema.scalar_i64("SELECT count(*) FROM pokemon").await;
    schema.drop().await;

    assert!(abandoned.is_err(), "la carga debía quedar esperando");
    assert_eq!(rows, 0);
}

#[tokio::test]
async fn a_statement_timeout_is_a_retryable_error() {
    let Some((schema, report)) = reference_staging().await else {
        return;
    };
    let loader = PgDatasetLoader::new(schema.pool.clone())
        .with_statement_timeout(Duration::from_millis(200));
    let mut blocker = schema.pool.begin().await.unwrap();
    sqlx::query("LOCK TABLE public.pokemon IN ACCESS EXCLUSIVE MODE")
        .execute(&mut *blocker)
        .await
        .unwrap();

    let error = loader.load(&report, None).await.unwrap_err();
    blocker.rollback().await.unwrap();
    schema.drop().await;

    assert_eq!(error.sqlstate.as_deref(), Some("57014"));
    assert_eq!(
        classify(StepName::Load, &StepError::Storage(error)),
        ErrorClass::Retryable
    );
}

#[tokio::test]
async fn special_characters_and_nulls_survive_the_load() {
    let Some(schema) = TestDb::create().await else {
        return;
    };
    let store = PgStagingStore::new(schema.pool.clone());
    let loader = PgDatasetLoader::new(schema.pool.clone());
    let catalog = Dataset {
        pokemon: vec![
            PokemonRow {
                id: 1,
                name: "comma,name".into(),
                height: 1,
                weight: 1,
                base_experience: None,
                sprite: None,
            },
            PokemonRow {
                id: 2,
                name: "ñandú \\ N \\N".into(),
                height: 2,
                weight: 2,
                base_experience: Some(7),
                sprite: Some("https://img/2.png?a=1,2&b=\"x\"".into()),
            },
        ],
        types: vec![TypeRow {
            id: 1,
            name: "a \"quoted\", name\nwith break\r".into(),
        }],
        pokemon_types: vec![PokemonTypeRow {
            pokemon_id: 1,
            type_id: 1,
            slot: 1,
        }],
    };
    store.replace_catalog(&catalog, None).await.unwrap();

    loader
        .load(&ValidationReport::default(), None)
        .await
        .unwrap();
    let type_name = schema.scalar_text("SELECT name FROM types").await;
    let names = schema
        .scalar_text("SELECT string_agg(name, '|' ORDER BY id) FROM pokemon")
        .await;
    let nulls = schema
        .scalar_i64("SELECT count(*) FROM pokemon WHERE sprite_url IS NULL")
        .await;
    let experience = schema
        .scalar_text("SELECT string_agg(base_experience::text, ',' ORDER BY id) FROM pokemon")
        .await;
    let sprite = schema
        .scalar_text("SELECT sprite_url FROM pokemon WHERE id = 2")
        .await;
    schema.drop().await;

    assert_eq!(type_name, "a \"quoted\", name\nwith break\r");
    assert_eq!(names, "comma,name|ñandú \\ N \\N");
    assert_eq!(nulls, 1);
    // `base_experience` NULL se carga como 0.
    assert_eq!(experience, "0,7");
    assert_eq!(sprite, "https://img/2.png?a=1,2&b=\"x\"");
}

#[tokio::test]
async fn an_empty_staging_truncates_the_tables() {
    let Some((schema, report)) = reference_staging().await else {
        return;
    };
    let loader = PgDatasetLoader::new(schema.pool.clone());
    loader.load(&report, None).await.unwrap();
    schema
        .exec("TRUNCATE staging.types, staging.pokemon, staging.pokemon_types, staging.trainers, staging.captures, staging.battles")
        .await;

    loader
        .load(&ValidationReport::default(), None)
        .await
        .unwrap();
    let rows = schema.scalar_i64("SELECT count(*) FROM pokemon").await;
    schema.drop().await;

    assert_eq!(rows, 0);
}
