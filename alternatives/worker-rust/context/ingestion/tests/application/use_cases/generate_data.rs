//! `GenerateData`: los ids vienen de `staging.pokemon`.

use pokemon_context_ingestion::application::ports::{CommitOutcome, StagingStore};
use pokemon_context_ingestion::application::use_cases::ProcessOutcome;
use pokemon_context_ingestion::domain::{PokemonRecord, StagingDataset, StepName};
use uuid::Uuid;

use crate::stubs::*;

fn pokemon_with_ids(ids: &[i32]) -> StagingDataset {
    StagingDataset {
        pokemon: ids
            .iter()
            .map(|id| PokemonRecord {
                id: Some(*id),
                ..PokemonRecord::default()
            })
            .collect(),
        ..StagingDataset::default()
    }
}

#[tokio::test]
async fn generate_fails_permanently_with_fewer_than_two_pokemon() {
    for ids in [&[][..], &[1], &[1, 1]] {
        let h = harness(
            StubQueue::new(&[StepName::Scrape]),
            StubStaging::new(pokemon_with_ids(ids), CommitOutcome::Committed),
            StubSource::new(SourceBehavior::Ok),
            StubLoader::new(CommitOutcome::Committed),
            StubViews(None),
        );

        let outcome = h.processor.process_next().await.unwrap();

        assert_eq!(
            outcome,
            ProcessOutcome::Failed(Uuid::from_u128(1)),
            "{ids:?}"
        );
        let (step, message, retryable) = h.queue.state().failure.clone().unwrap();
        assert_eq!(step, StepName::Generate);
        assert_eq!(
            message,
            "se necesitan al menos 2 Pokémon en staging.pokemon"
        );
        assert!(!retryable);
        assert!(h.staging.writes().is_empty());
    }
}

#[tokio::test]
async fn generate_writes_its_three_tables_in_one_operation_from_the_ids() {
    let h = harness(
        StubQueue::new(&[StepName::Scrape]),
        StubStaging::new(pokemon_with_ids(&[5, 3, 3]), CommitOutcome::Committed),
        StubSource::new(SourceBehavior::Ok),
        StubLoader::new(CommitOutcome::Committed),
        StubViews(None),
    );

    // generate escribe sus tres tablas y validate falla después (faltan las del catálogo).
    h.processor.process_next().await.unwrap();

    assert_eq!(h.staging.writes(), ["generated"]);
    let data = h.staging.read_all().await.unwrap();
    assert_eq!(data.trainers.len(), 50);
    assert_eq!(data.captures.len(), 5000);
    assert_eq!(data.battles.len(), 2000);
    assert!(
        data.captures
            .iter()
            .all(|c| matches!(c.pokemon_id, Some(3 | 5)))
    );
}
