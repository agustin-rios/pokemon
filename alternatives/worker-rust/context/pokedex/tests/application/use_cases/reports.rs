//! Los casos de uso de reportes (`GetTypeSummary`, `GetMonthlyCaptureGrowth`,
//! `GetTopTrainersByRegion` y `GetLevelClassificationByType`) con un repositorio falso.
//! Un solo archivo porque cada test cruza varios casos de uso.

use std::sync::Arc;

use pokemon_context_pokedex::application::RepositoryError;
use pokemon_context_pokedex::application::ports::ReportsRepository;
use pokemon_context_pokedex::application::use_cases::{
    GetLevelClassificationByType, GetMonthlyCaptureGrowth, GetTopTrainersByRegion, GetTypeSummary,
};

use crate::stubs::StubReportsRepository;

#[tokio::test]
async fn report_use_cases_return_what_the_repository_gives() {
    let reports = Arc::new(StubReportsRepository);

    let summary = GetTypeSummary::new(reports.clone())
        .execute()
        .await
        .unwrap();
    assert_eq!(summary, reports.type_summary().await.unwrap());

    let growth = GetMonthlyCaptureGrowth::new(reports.clone())
        .execute()
        .await
        .unwrap();
    assert_eq!(growth.len(), 2);
    assert_eq!(growth[0].change_percent, None);
    assert_eq!(growth[1].change_percent, Some(4.72));

    let top = GetTopTrainersByRegion::new(reports.clone())
        .execute()
        .await
        .unwrap();
    assert_eq!(top[0].trainer_name, "Ash Ketchum");
}

#[tokio::test]
async fn report_use_cases_propagate_repository_errors() {
    let result = GetLevelClassificationByType::new(Arc::new(StubReportsRepository))
        .execute()
        .await;
    let error = result.unwrap_err();
    assert!(matches!(error, RepositoryError::DataNotLoaded));
    assert_eq!(error.to_string(), "Los datos todavía no están cargados.");
}
