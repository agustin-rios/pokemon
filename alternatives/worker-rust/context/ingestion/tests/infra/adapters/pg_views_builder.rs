//! Vistas contra Postgres real (necesita `TEST_DATABASE_URL`).

use pokemon_context_ingestion::application::ports::{DatasetLoader, ViewsBuilder};
use pokemon_context_ingestion::domain::{ErrorClass, StepError, StepName, classify};
use pokemon_context_ingestion::infra::adapters::{PgDatasetLoader, PgViewsBuilder};

use super::pg_dataset_loader::reference_staging;
use crate::support::TestDb;

#[tokio::test]
async fn views_are_built_and_rebuilt_over_the_loaded_data() {
    let Some((schema, report)) = reference_staging().await else {
        return;
    };
    let loader = PgDatasetLoader::new(schema.pool.clone());
    let views = PgViewsBuilder::new(schema.pool.clone());
    loader.load(&report, None).await.unwrap();

    views.build().await.unwrap();
    views.build().await.unwrap(); // CREATE OR REPLACE: idempotente
    let by_type = schema.scalar_i64("SELECT count(*) FROM type_summary").await;
    let monthly = schema
        .scalar_i64("SELECT count(*) FROM capture_monthly_growth")
        .await;
    schema.drop().await;

    assert!(by_type > 0);
    assert!(monthly > 0);
}

#[tokio::test]
async fn views_fail_permanently_when_the_tables_do_not_exist() {
    let Some(schema) = TestDb::create().await else {
        return;
    };
    schema.exec("DROP TABLE captures, battles").await;
    let views = PgViewsBuilder::new(schema.pool.clone());

    let error = views.build().await.unwrap_err();
    schema.drop().await;

    assert_eq!(error.sqlstate.as_deref(), Some("42P01"));
    assert_eq!(
        classify(StepName::BuildViews, &StepError::Storage(error)),
        ErrorClass::Permanent
    );
}
