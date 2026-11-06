//! Modelo de corridas y pasos.

use pokemon_context_ingestion::domain::{EtlRun, EtlStep, RunState, StepName, StepState};
use serde_json::json;
use ts_rs::TS;
use uuid::Uuid;

fn sample_run() -> EtlRun {
    EtlRun {
        run_id: Uuid::nil(),
        state: RunState::Running,
        queued_at: "2026-11-05T22:19:30.778Z".into(),
        started_at: Some("2026-11-05T22:19:31.000Z".into()),
        finished_at: None,
        attempts: 1,
        error: None,
        steps: StepName::ALL
            .iter()
            .map(|name| EtlStep {
                name: *name,
                state: StepState::Pending,
                attempts: 0,
                started_at: None,
                finished_at: None,
                error: None,
                output: None,
            })
            .collect(),
    }
}

#[test]
fn steps_are_in_pipeline_order_with_their_stored_names() {
    let names: Vec<_> = StepName::ALL.iter().map(|s| s.as_str()).collect();

    assert_eq!(
        names,
        ["scrape", "generate", "validate", "load", "build_views"]
    );
    for step in StepName::ALL {
        assert_eq!(StepName::parse(step.as_str()), Some(step));
    }
    assert_eq!(StepName::parse("otro"), None);
    assert_eq!(StepName::BuildViews.to_string(), "build_views");
}

#[test]
fn states_parse_from_the_database_text() {
    assert_eq!(RunState::parse("queued"), Some(RunState::Queued));
    assert_eq!(RunState::parse("failed"), Some(RunState::Failed));
    assert_eq!(RunState::parse("pending"), None);
    assert_eq!(StepState::parse("pending"), Some(StepState::Pending));
    assert_eq!(StepState::parse("queued"), None);
}

#[test]
fn run_serializes_with_camel_case_fields_and_snake_case_states() {
    let mut run = sample_run();
    run.steps[4].name = StepName::BuildViews;
    run.steps[0].output = Some(json!({"pokemon": 100}));

    let value = serde_json::to_value(&run).unwrap();

    assert_eq!(value["runId"], "00000000-0000-0000-0000-000000000000");
    assert_eq!(value["state"], "running");
    assert_eq!(value["queuedAt"], "2026-11-05T22:19:30.778Z");
    assert_eq!(value["finishedAt"], serde_json::Value::Null);
    assert_eq!(value["steps"].as_array().unwrap().len(), 5);
    assert_eq!(value["steps"][0]["output"], json!({"pokemon": 100}));
    assert_eq!(value["steps"][0]["startedAt"], serde_json::Value::Null);
    assert_eq!(value["steps"][4]["name"], "build_views");
    assert_eq!(value["steps"][4]["output"], serde_json::Value::Null);
}

#[test]
fn run_finds_the_state_of_a_step() {
    let mut run = sample_run();
    run.steps[2].state = StepState::Succeeded;

    assert_eq!(
        run.step_state(StepName::Validate),
        Some(StepState::Succeeded)
    );
    assert_eq!(run.step_state(StepName::Load), Some(StepState::Pending));
}

#[test]
fn typescript_types_match_the_api_contract() {
    let step = EtlStep::decl();
    assert!(step.contains("output: unknown | null"), "{step}");
    assert!(step.contains("startedAt: string | null"), "{step}");
    assert!(step.contains("attempts: number"), "{step}");
    let run = EtlRun::decl();
    assert!(run.contains("runId: string"), "{run}");
    assert!(run.contains("steps: Array<EtlStep>"), "{run}");
    assert!(StepName::decl().contains("\"build_views\""));
    assert!(RunState::decl().contains("\"queued\" | \"running\" | \"succeeded\" | \"failed\""));
}
