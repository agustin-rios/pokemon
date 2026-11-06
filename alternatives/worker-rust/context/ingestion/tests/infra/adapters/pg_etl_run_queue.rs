//! Cola de corridas contra Postgres real (necesita `TEST_DATABASE_URL`; si no
//! está definida los tests se omiten). Cada test usa su propio schema.

use std::sync::Arc;

use crate::support::TestDb;
use pokemon_context_ingestion::application::RetryError;
use pokemon_context_ingestion::application::ports::{EtlRunQueue, FailureOutcome, Fence};
use pokemon_context_ingestion::domain::{
    ErrorClass, RunState, StepError, StepName, StepState, classify,
};
use pokemon_context_ingestion::infra::adapters::{PgEtlRunQueue, storage_error};
use serde_json::json;
use sqlx::postgres::PgPoolOptions;
use uuid::Uuid;

const LEASE: f64 = 30.0;

async fn setup() -> Option<(TestDb, Arc<PgEtlRunQueue>)> {
    let schema = TestDb::create().await?;
    let queue = Arc::new(PgEtlRunQueue::new(schema.pool.clone()));
    Some((schema, queue))
}

async fn claim(queue: &PgEtlRunQueue, worker: &str) -> Fence {
    queue.claim(worker, LEASE).await.unwrap().unwrap().fence
}

fn is_db_timestamp(text: &str) -> bool {
    // 2026-11-05T22:19:30.778Z
    let b = text.as_bytes();
    b.len() == 24
        && text.ends_with('Z')
        && b[10] == b'T'
        && b[19] == b'.'
        && text
            .chars()
            .enumerate()
            .all(|(i, c)| matches!(i, 4 | 7 | 10 | 13 | 16 | 19 | 23) || c.is_ascii_digit())
}

#[tokio::test]
async fn enqueue_creates_a_queued_run_with_five_pending_steps() {
    let Some((schema, queue)) = setup().await else {
        return;
    };

    let run = queue.enqueue().await.unwrap();
    let fetched = queue.get(run.run_id).await.unwrap().unwrap();
    schema.drop().await;

    assert_eq!(run, fetched);
    assert_eq!(run.state, RunState::Queued);
    assert_eq!(run.attempts, 0);
    assert!(is_db_timestamp(&run.queued_at), "{}", run.queued_at);
    assert_eq!(
        (run.started_at, run.finished_at, run.error),
        (None, None, None)
    );
    let names: Vec<_> = run.steps.iter().map(|s| s.name).collect();
    assert_eq!(names, StepName::ALL);
    assert!(run.steps.iter().all(|s| s.state == StepState::Pending
        && s.attempts == 0
        && s.output.is_none()
        && s.started_at.is_none()));
}

#[tokio::test]
async fn enqueue_returns_the_active_run_instead_of_creating_another() {
    let Some((schema, queue)) = setup().await else {
        return;
    };

    let first = queue.enqueue().await.unwrap();
    let second = queue.enqueue().await.unwrap();
    let fence = claim(&queue, "w1").await;
    let while_running = queue.enqueue().await.unwrap();
    let runs = schema.scalar_i64("SELECT count(*) FROM etl_runs").await;
    let steps = schema
        .scalar_i64("SELECT count(*) FROM etl_run_steps")
        .await;
    schema.drop().await;

    assert_eq!(first.run_id, second.run_id);
    assert_eq!(first.run_id, fence.run_id);
    assert_eq!(while_running.run_id, first.run_id);
    assert_eq!((runs, steps), (1, 5));
}

#[tokio::test]
async fn two_concurrent_enqueues_return_the_same_run() {
    let Some((schema, queue)) = setup().await else {
        return;
    };

    let (a, b) = tokio::join!(queue.enqueue(), queue.enqueue());
    let runs = schema.scalar_i64("SELECT count(*) FROM etl_runs").await;
    schema.drop().await;

    assert_eq!(a.unwrap().run_id, b.unwrap().run_id);
    assert_eq!(runs, 1);
}

#[tokio::test]
async fn a_new_run_can_be_enqueued_once_the_previous_one_finished() {
    let Some((schema, queue)) = setup().await else {
        return;
    };
    let first = queue.enqueue().await.unwrap();
    let fence = claim(&queue, "w1").await;
    for step in StepName::ALL {
        assert!(queue.start_step(&fence, step).await.unwrap());
        assert!(queue.finish_step(&fence, step, None).await.unwrap());
    }
    assert!(queue.complete_run(&fence).await.unwrap());

    let second = queue.enqueue().await.unwrap();
    schema.drop().await;

    assert_ne!(first.run_id, second.run_id);
    assert_eq!(second.state, RunState::Queued);
}

#[tokio::test]
async fn get_of_an_unknown_run_is_none() {
    let Some((schema, queue)) = setup().await else {
        return;
    };

    let run = queue.get(Uuid::new_v4()).await.unwrap();
    schema.drop().await;

    assert!(run.is_none());
}

#[tokio::test]
async fn claim_takes_the_run_and_returns_the_fencing_token() {
    let Some((schema, queue)) = setup().await else {
        return;
    };
    let run = queue.enqueue().await.unwrap();

    let claimed = queue.claim("w1", LEASE).await.unwrap().unwrap();
    let again = queue.claim("w2", LEASE).await.unwrap();
    let after = queue.get(run.run_id).await.unwrap().unwrap();
    let locked_by = schema.scalar_text("SELECT locked_by FROM etl_runs").await;
    let lease = schema
        .scalar_i64("SELECT extract(epoch FROM locked_until - now())::bigint FROM etl_runs")
        .await;
    schema.drop().await;

    assert_eq!(claimed.fence.run_id, run.run_id);
    assert_eq!(claimed.fence.worker_id, "w1");
    assert_eq!(claimed.fence.attempts, 1);
    assert_eq!(claimed.max_attempts, 3);
    assert!(again.is_none());
    assert_eq!(after.state, RunState::Running);
    assert_eq!(after.attempts, 1);
    assert!(is_db_timestamp(after.started_at.as_deref().unwrap()));
    assert_eq!(locked_by, "w1");
    assert!((28..=30).contains(&lease), "{lease}");
}

#[tokio::test]
async fn two_concurrent_claimers_split_one_run() {
    let Some((schema, queue)) = setup().await else {
        return;
    };
    queue.enqueue().await.unwrap();

    let (a, b) = tokio::join!(queue.claim("w1", LEASE), queue.claim("w2", LEASE));
    schema.drop().await;

    let claimed: Vec<_> = [a.unwrap(), b.unwrap()].into_iter().flatten().collect();
    assert_eq!(claimed.len(), 1, "exactamente uno toma la corrida");
}

#[tokio::test]
async fn a_run_scheduled_for_later_is_not_claimed() {
    let Some((schema, queue)) = setup().await else {
        return;
    };
    queue.enqueue().await.unwrap();
    schema
        .exec("UPDATE etl_runs SET run_after = now() + interval '1 hour'")
        .await;

    let claimed = queue.claim("w1", LEASE).await.unwrap();
    schema.drop().await;

    assert!(claimed.is_none());
}

#[tokio::test]
async fn an_expired_lease_is_reclaimed_with_a_new_token() {
    let Some((schema, queue)) = setup().await else {
        return;
    };
    let run = queue.enqueue().await.unwrap();
    let old = claim(&queue, "w1").await;
    assert!(queue.claim("w2", LEASE).await.unwrap().is_none());
    schema
        .exec("UPDATE etl_runs SET locked_until = now() - interval '1 second'")
        .await;

    let new = claim(&queue, "w2").await;
    // El worker viejo ya no puede escribir ni renovar.
    let old_heartbeat = queue.heartbeat(&old, LEASE).await.unwrap();
    let old_start = queue.start_step(&old, StepName::Scrape).await.unwrap();
    let new_start = queue.start_step(&new, StepName::Scrape).await.unwrap();
    let after = queue.get(run.run_id).await.unwrap().unwrap();
    schema.drop().await;

    assert_eq!(
        (new.run_id, new.worker_id.as_str(), new.attempts),
        (run.run_id, "w2", 2)
    );
    assert!(!old_heartbeat);
    assert!(!old_start);
    assert!(new_start);
    assert_eq!(after.attempts, 2);
}

#[tokio::test]
async fn a_dead_run_without_attempts_left_is_failed_instead_of_reclaimed() {
    let Some((schema, queue)) = setup().await else {
        return;
    };
    let run = queue.enqueue().await.unwrap();
    let fence = claim(&queue, "w1").await;
    assert!(queue.start_step(&fence, StepName::Scrape).await.unwrap());
    schema
        .exec(
            "UPDATE etl_runs SET attempts = max_attempts, \
             locked_until = now() - interval '1 second'",
        )
        .await;

    let claimed = queue.claim("w2", LEASE).await.unwrap();
    let after = queue.get(run.run_id).await.unwrap().unwrap();
    schema.drop().await;

    assert!(claimed.is_none());
    assert_eq!(after.state, RunState::Failed);
    assert_eq!(
        after.error.as_deref(),
        Some("el worker se detuvo sin terminar y se agotaron los intentos")
    );
    assert!(after.finished_at.is_some());
    let scrape = &after.steps[0];
    assert_eq!(scrape.state, StepState::Failed);
    assert_eq!(
        scrape.error.as_deref(),
        Some("interrumpido: el worker se detuvo")
    );
    assert!(scrape.finished_at.is_some());
    assert_eq!(after.steps[1].state, StepState::Pending);
}

#[tokio::test]
async fn heartbeat_extends_the_lease_only_with_the_right_token() {
    let Some((schema, queue)) = setup().await else {
        return;
    };
    queue.enqueue().await.unwrap();
    let fence = claim(&queue, "w1").await;

    let extended = queue.heartbeat(&fence, 600.0).await.unwrap();
    let lease = schema
        .scalar_i64("SELECT extract(epoch FROM locked_until - now())::bigint FROM etl_runs")
        .await;
    let wrong_attempts = Fence {
        attempts: fence.attempts + 1,
        ..fence.clone()
    };
    let wrong_worker = Fence {
        worker_id: "w2".into(),
        ..fence.clone()
    };
    let wrong_run = Fence {
        run_id: Uuid::new_v4(),
        ..fence.clone()
    };
    let results = [
        queue.heartbeat(&wrong_attempts, LEASE).await.unwrap(),
        queue.heartbeat(&wrong_worker, LEASE).await.unwrap(),
        queue.heartbeat(&wrong_run, LEASE).await.unwrap(),
    ];
    schema.drop().await;

    assert!(extended);
    assert!(lease > 500, "{lease}");
    assert_eq!(results, [false, false, false]);
}

#[tokio::test]
async fn release_requeues_the_run_without_spending_the_attempt() {
    let Some((schema, queue)) = setup().await else {
        return;
    };
    let run = queue.enqueue().await.unwrap();
    let fence = claim(&queue, "w1").await;
    assert!(queue.start_step(&fence, StepName::Scrape).await.unwrap());
    let stale = Fence {
        attempts: fence.attempts + 1,
        ..fence.clone()
    };

    let not_released = queue.release(&stale).await.unwrap();
    let released = queue.release(&fence).await.unwrap();
    let again = queue.release(&fence).await.unwrap();
    let after = queue.get(run.run_id).await.unwrap().unwrap();
    // Un relevo la toma de inmediato (sin esperar a que venza la lease) con el token siguiente.
    let next = claim(&queue, "w2").await;
    schema.drop().await;

    assert!(!not_released);
    assert!(released);
    assert!(!again);
    assert_eq!((after.state, after.attempts), (RunState::Queued, 0));
    assert_eq!(after.steps[0].state, StepState::Pending);
    assert_eq!((next.run_id, next.attempts), (run.run_id, 1));
}

#[tokio::test]
async fn step_transitions_are_guarded_by_the_fence() {
    let Some((schema, queue)) = setup().await else {
        return;
    };
    let run = queue.enqueue().await.unwrap();
    let fence = claim(&queue, "w1").await;
    let stale = Fence {
        attempts: 99,
        ..fence.clone()
    };

    // Con el token equivocado no se escribe nada.
    assert!(!queue.start_step(&stale, StepName::Scrape).await.unwrap());
    // Un paso que no está en ejecución no se puede terminar.
    assert!(
        !queue
            .finish_step(&fence, StepName::Scrape, None)
            .await
            .unwrap()
    );

    assert!(queue.start_step(&fence, StepName::Scrape).await.unwrap());
    let running = queue.get(run.run_id).await.unwrap().unwrap();
    assert!(
        !queue
            .finish_step(&stale, StepName::Scrape, None)
            .await
            .unwrap()
    );
    let output = json!({"pokemon": 100, "types": 16, "pokemonTypes": 148});
    assert!(
        queue
            .finish_step(&fence, StepName::Scrape, Some(&output))
            .await
            .unwrap()
    );
    // Un paso exitoso no se vuelve a ejecutar dentro de la misma corrida.
    let restart = queue.start_step(&fence, StepName::Scrape).await.unwrap();
    let after = queue.get(run.run_id).await.unwrap().unwrap();
    let complete_stale = queue.complete_run(&stale).await.unwrap();
    let complete = queue.complete_run(&fence).await.unwrap();
    let done = queue.get(run.run_id).await.unwrap().unwrap();
    let locked = schema
        .scalar_i64(
            "SELECT count(*) FROM etl_runs WHERE locked_by IS NULL AND locked_until IS NULL",
        )
        .await;
    schema.drop().await;

    let step = &running.steps[0];
    assert_eq!((step.state, step.attempts), (StepState::Running, 1));
    assert!(is_db_timestamp(step.started_at.as_deref().unwrap()));
    assert!(!restart);
    let step = &after.steps[0];
    assert_eq!(step.state, StepState::Succeeded);
    assert_eq!(step.output, Some(output));
    assert!(step.finished_at.is_some());
    assert!(!complete_stale);
    assert!(complete);
    assert_eq!(done.state, RunState::Succeeded);
    assert!(done.finished_at.is_some());
    assert_eq!(locked, 1);
}

#[tokio::test]
async fn restarting_a_step_resets_its_previous_result() {
    let Some((schema, queue)) = setup().await else {
        return;
    };
    let run = queue.enqueue().await.unwrap();
    let fence = claim(&queue, "w1").await;
    assert!(queue.start_step(&fence, StepName::Scrape).await.unwrap());
    assert_eq!(
        queue
            .fail_step(&fence, StepName::Scrape, "boom", false)
            .await
            .unwrap(),
        FailureOutcome::Failed
    );
    queue.retry(run.run_id).await.unwrap();
    let fence = claim(&queue, "w1").await;

    assert!(queue.start_step(&fence, StepName::Scrape).await.unwrap());
    let step = queue.get(run.run_id).await.unwrap().unwrap().steps[0].clone();
    schema.drop().await;

    assert_eq!((step.state, step.attempts), (StepState::Running, 2));
    assert_eq!(
        (step.error, step.finished_at, step.output),
        (None, None, None)
    );
}

#[tokio::test]
async fn retryable_failure_requeues_with_exponential_backoff() {
    let Some((schema, queue)) = setup().await else {
        return;
    };
    let run = queue.enqueue().await.unwrap();
    let fence = claim(&queue, "w1").await;
    assert!(queue.start_step(&fence, StepName::Scrape).await.unwrap());

    let outcome = queue
        .fail_step(&fence, StepName::Scrape, "sin red", true)
        .await
        .unwrap();
    let first_delay = schema
        .scalar_i64("SELECT round(extract(epoch FROM run_after - now()))::bigint FROM etl_runs")
        .await;
    let requeued = queue.get(run.run_id).await.unwrap().unwrap();
    let not_due = queue.claim("w2", LEASE).await.unwrap();

    // Segundo intento: la espera se duplica (5, 10, 20… hasta 60 s).
    schema.exec("UPDATE etl_runs SET run_after = now()").await;
    let second = claim(&queue, "w2").await;
    assert!(queue.start_step(&second, StepName::Scrape).await.unwrap());
    queue
        .fail_step(&second, StepName::Scrape, "sin red", true)
        .await
        .unwrap();
    let second_delay = schema
        .scalar_i64("SELECT round(extract(epoch FROM run_after - now()))::bigint FROM etl_runs")
        .await;
    schema.drop().await;

    assert_eq!(outcome, FailureOutcome::Requeued);
    assert!((4..=5).contains(&first_delay), "{first_delay}");
    assert!((9..=10).contains(&second_delay), "{second_delay}");
    assert!(not_due.is_none());
    assert_eq!(second.attempts, 2);
    // La corrida en cola expone lo que quedó: error, inicio, intentos y estado de los pasos.
    assert_eq!(requeued.state, RunState::Queued);
    assert_eq!(requeued.error.as_deref(), Some("scrape: sin red"));
    assert!(requeued.started_at.is_some());
    assert_eq!(requeued.attempts, 1);
    assert_eq!(requeued.steps[0].state, StepState::Failed);
    assert_eq!(requeued.steps[0].error.as_deref(), Some("sin red"));
}

#[tokio::test]
async fn permanent_failure_and_exhausted_retries_fail_the_run() {
    let Some((schema, queue)) = setup().await else {
        return;
    };
    let run = queue.enqueue().await.unwrap();
    let fence = claim(&queue, "w1").await;
    assert!(queue.start_step(&fence, StepName::Scrape).await.unwrap());
    let permanent = queue
        .fail_step(&fence, StepName::Scrape, "datos inválidos", false)
        .await
        .unwrap();
    let failed = queue.get(run.run_id).await.unwrap().unwrap();

    queue.retry(run.run_id).await.unwrap();
    let last = claim(&queue, "w1").await;
    schema
        .exec("UPDATE etl_runs SET attempts = max_attempts")
        .await;
    let last = Fence {
        attempts: 3,
        ..last
    };
    assert!(queue.start_step(&last, StepName::Scrape).await.unwrap());
    let exhausted = queue
        .fail_step(&last, StepName::Scrape, "sin red", true)
        .await
        .unwrap();
    let after = queue.get(run.run_id).await.unwrap().unwrap();
    schema.drop().await;

    assert_eq!(permanent, FailureOutcome::Failed);
    assert_eq!(failed.state, RunState::Failed);
    assert_eq!(failed.error.as_deref(), Some("scrape: datos inválidos"));
    assert!(failed.finished_at.is_some());
    assert_eq!(exhausted, FailureOutcome::Failed);
    assert_eq!(after.state, RunState::Failed);
    assert_eq!(after.error.as_deref(), Some("scrape: sin red"));
}

#[tokio::test]
async fn failure_with_a_stale_token_writes_nothing() {
    let Some((schema, queue)) = setup().await else {
        return;
    };
    let run = queue.enqueue().await.unwrap();
    let fence = claim(&queue, "w1").await;
    assert!(queue.start_step(&fence, StepName::Scrape).await.unwrap());
    let stale = Fence {
        attempts: 7,
        ..fence
    };

    let retryable = queue
        .fail_step(&stale, StepName::Scrape, "x", true)
        .await
        .unwrap();
    let permanent = queue
        .fail_step(&stale, StepName::Scrape, "x", false)
        .await
        .unwrap();
    let after = queue.get(run.run_id).await.unwrap().unwrap();
    schema.drop().await;

    assert_eq!(retryable, FailureOutcome::LeaseLost);
    assert_eq!(permanent, FailureOutcome::LeaseLost);
    assert_eq!(after.state, RunState::Running);
    assert_eq!(after.steps[0].state, StepState::Running);
    assert_eq!(after.error, None);
}

#[tokio::test]
async fn retry_requeues_a_failed_run_and_resumes_from_the_failed_step() {
    let Some((schema, queue)) = setup().await else {
        return;
    };
    let run = queue.enqueue().await.unwrap();
    let fence = claim(&queue, "w1").await;
    let output = json!({"pokemon": 2});
    assert!(queue.start_step(&fence, StepName::Scrape).await.unwrap());
    assert!(
        queue
            .finish_step(&fence, StepName::Scrape, Some(&output))
            .await
            .unwrap()
    );
    assert!(queue.start_step(&fence, StepName::Generate).await.unwrap());
    queue
        .fail_step(&fence, StepName::Generate, "boom", false)
        .await
        .unwrap();
    let failed = queue.get(run.run_id).await.unwrap().unwrap();

    let retried = queue.retry(run.run_id).await.unwrap();
    let again = claim(&queue, "w2").await;
    let resumed = queue.get(run.run_id).await.unwrap().unwrap();
    schema.drop().await;

    assert_eq!(failed.state, RunState::Failed);
    assert_eq!(retried.state, RunState::Queued);
    assert_eq!(
        (retried.attempts, retried.error, retried.finished_at),
        (0, None, None)
    );
    // El inicio original y los pasos se conservan.
    assert_eq!(retried.started_at, failed.started_at);
    assert_eq!(retried.steps[0].state, StepState::Succeeded);
    assert_eq!(retried.steps[0].output, Some(output));
    assert_eq!(retried.steps[1].state, StepState::Failed);
    // Se toma de nuevo, con intentos reiniciados, y los pasos exitosos siguen exitosos.
    assert_eq!(again.attempts, 1);
    assert_eq!(resumed.steps[0].state, StepState::Succeeded);
    assert_eq!(resumed.steps[1].state, StepState::Failed);
}

#[tokio::test]
async fn retry_errors_unknown_not_failed_and_already_active() {
    let Some((schema, queue)) = setup().await else {
        return;
    };
    let unknown = Uuid::new_v4();
    let not_found = queue.retry(unknown).await.unwrap_err();

    // Una corrida en cola o corriendo no se puede reintentar.
    let queued = queue.enqueue().await.unwrap();
    let not_failed_queued = queue.retry(queued.run_id).await.unwrap_err();
    let fence = claim(&queue, "w1").await;
    assert!(queue.start_step(&fence, StepName::Scrape).await.unwrap());
    queue
        .fail_step(&fence, StepName::Scrape, "boom", false)
        .await
        .unwrap();
    // Con otra corrida activa, reintentar la fallida choca con el índice único.
    let other = queue.enqueue().await.unwrap();
    let active = queue.retry(queued.run_id).await.unwrap_err();
    let fence = claim(&queue, "w1").await;
    for step in StepName::ALL {
        assert!(queue.start_step(&fence, step).await.unwrap());
        assert!(queue.finish_step(&fence, step, None).await.unwrap());
    }
    assert!(queue.complete_run(&fence).await.unwrap());
    let not_failed_done = queue.retry(other.run_id).await.unwrap_err();
    schema.drop().await;

    assert!(matches!(not_found, RetryError::NotFound(id) if id == unknown));
    assert_eq!(
        not_found.to_string(),
        format!("No existe la corrida {unknown}")
    );
    assert!(matches!(not_failed_queued, RetryError::NotFailed));
    assert!(matches!(active, RetryError::AlreadyActive));
    assert_eq!(active.to_string(), "Ya hay una corrida en curso");
    assert!(matches!(not_failed_done, RetryError::NotFailed));
    assert_eq!(
        not_failed_done.to_string(),
        "Solo se puede reintentar una corrida fallida"
    );
}

#[tokio::test]
async fn database_errors_keep_their_sqlstate_for_classification() {
    let Some((schema, queue)) = setup().await else {
        return;
    };
    queue.enqueue().await.unwrap();

    // 23505: un segundo run activo viola el índice único parcial.
    let unique = sqlx::query("INSERT INTO etl_runs DEFAULT VALUES")
        .execute(&schema.pool)
        .await
        .unwrap_err();
    // 22P02: texto que no es entero.
    let invalid = sqlx::query("SELECT 'x'::int")
        .execute(&schema.pool)
        .await
        .unwrap_err();
    // Sin SQLSTATE: conexión rechazada (puerto cerrado).
    let refused = PgPoolOptions::new()
        .acquire_timeout(std::time::Duration::from_secs(5))
        .connect("postgres://postgres:pw@127.0.0.1:1/postgres")
        .await
        .unwrap_err();
    schema.drop().await;

    let step = StepName::Load;
    let unique = storage_error(unique);
    let invalid = storage_error(invalid);
    let refused = storage_error(refused);
    assert_eq!(unique.sqlstate.as_deref(), Some("23505"));
    assert_eq!(invalid.sqlstate.as_deref(), Some("22P02"));
    assert_eq!(refused.sqlstate, None);
    assert_eq!(
        classify(step, &StepError::Storage(unique)),
        ErrorClass::Permanent
    );
    assert_eq!(
        classify(step, &StepError::Storage(invalid)),
        ErrorClass::Permanent
    );
    assert_eq!(
        classify(step, &StepError::Storage(refused)),
        ErrorClass::Retryable
    );
}
