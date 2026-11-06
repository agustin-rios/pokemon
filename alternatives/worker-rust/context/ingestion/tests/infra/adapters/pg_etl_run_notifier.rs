//! `LISTEN etl_runs` contra Postgres real (necesita `TEST_DATABASE_URL`).
//!
//! NOTIFY es de toda la base: otros tests que corren en paralelo también
//! avisan, así que se espera el aviso con el id de la corrida propia.

use std::time::{Duration, Instant};

use crate::support::TestDb;
use pokemon_context_ingestion::application::ports::{EtlRunQueue, RunNotifier};
use pokemon_context_ingestion::infra::adapters::{PgEtlRunNotifier, PgEtlRunQueue};
use uuid::Uuid;

async fn wait_for(notifier: &PgEtlRunNotifier, run_id: Uuid, within: Duration) -> bool {
    let deadline = Instant::now() + within;
    while Instant::now() < deadline {
        if notifier.wait(Duration::from_millis(500)).await == Some(run_id) {
            return true;
        }
    }
    false
}

#[tokio::test]
async fn an_enqueued_run_notifies_with_its_own_id() {
    let Some(schema) = TestDb::create().await else {
        return;
    };
    let notifier = PgEtlRunNotifier::connect(schema.pool.clone())
        .await
        .unwrap();
    let queue = PgEtlRunQueue::new(schema.pool.clone());

    let run = queue.enqueue().await.unwrap();
    let received = wait_for(&notifier, run.run_id, Duration::from_secs(10)).await;
    schema.drop().await;

    assert!(received);
}

#[tokio::test]
async fn a_requeued_run_notifies_again() {
    let Some(schema) = TestDb::create().await else {
        return;
    };
    let notifier = PgEtlRunNotifier::connect(schema.pool.clone())
        .await
        .unwrap();
    let queue = PgEtlRunQueue::new(schema.pool.clone());
    let run = queue.enqueue().await.unwrap();
    assert!(wait_for(&notifier, run.run_id, Duration::from_secs(10)).await);
    let fence = queue.claim("w1", 30.0).await.unwrap().unwrap().fence;

    // running → queued (fallo reintentable): el trigger avisa de nuevo.
    queue
        .fail_step(
            &fence,
            pokemon_context_ingestion::domain::StepName::Scrape,
            "sin red",
            true,
        )
        .await
        .unwrap();
    let received = wait_for(&notifier, run.run_id, Duration::from_secs(10)).await;
    schema.drop().await;

    assert!(received);
}

#[tokio::test]
async fn wait_times_out_without_notifications() {
    let Some(schema) = TestDb::create().await else {
        return;
    };
    let notifier = PgEtlRunNotifier::connect(schema.pool.clone())
        .await
        .unwrap();

    let started = Instant::now();
    let received = notifier.wait(Duration::from_millis(200)).await;
    // Se mide antes de borrar el esquema: el borrado también tarda.
    let elapsed = started.elapsed();
    schema.drop().await;

    // Puede llegar un aviso ajeno (NOTIFY es global): entonces `wait` vuelve antes del plazo.
    assert!(received.is_none() || elapsed < Duration::from_millis(200));
    assert!(elapsed < Duration::from_secs(5));
}

#[tokio::test]
async fn the_listener_recovers_after_its_connection_is_killed() {
    let Some(schema) = TestDb::create().await else {
        return;
    };
    let notifier = PgEtlRunNotifier::connect(schema.pool.clone())
        .await
        .unwrap();
    let queue = PgEtlRunQueue::new(schema.pool.clone());

    // Solo la conexión de este test escucha con su `application_name` propio.
    let killed = schema
        .scalar_i64(&format!(
            "SELECT count(pg_terminate_backend(pid)) FROM pg_stat_activity \
             WHERE application_name = '{}' AND query ILIKE 'listen%'",
            schema.name()
        ))
        .await;
    let _ = notifier.wait(Duration::from_millis(300)).await;
    let run = queue.enqueue().await.unwrap();
    let received = wait_for(&notifier, run.run_id, Duration::from_secs(15)).await;
    schema.drop().await;

    assert_eq!(killed, 1);
    assert!(received);
}
