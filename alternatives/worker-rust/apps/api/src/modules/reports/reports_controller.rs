use std::sync::Arc;

use axum::Json;
use axum::extract::State;
use pokemon_context_pokedex::application::use_cases::{
    GetLevelClassificationByType, GetMonthlyCaptureGrowth, GetTopTrainersByRegion,
};
use pokemon_context_pokedex::domain::{LevelClassification, MonthlyCaptureGrowth, TopTrainer};

use crate::common::filters::ApiError;

/// Los casos de uso que sirve `/reports`.
pub struct ReportsController {
    monthly_capture_growth: GetMonthlyCaptureGrowth,
    top_trainers_by_region: GetTopTrainersByRegion,
    level_classification_by_type: GetLevelClassificationByType,
}

impl ReportsController {
    pub fn new(
        monthly_capture_growth: GetMonthlyCaptureGrowth,
        top_trainers_by_region: GetTopTrainersByRegion,
        level_classification_by_type: GetLevelClassificationByType,
    ) -> Self {
        Self {
            monthly_capture_growth,
            top_trainers_by_region,
            level_classification_by_type,
        }
    }
}

/// `GET /reports/monthly-growth`: capturas por mes y % de cambio vs. el mes anterior.
pub async fn monthly_growth(
    State(controller): State<Arc<ReportsController>>,
) -> Result<Json<Vec<MonthlyCaptureGrowth>>, ApiError> {
    Ok(Json(controller.monthly_capture_growth.execute().await?))
}

/// `GET /reports/top-trainers`: los 3 entrenadores con más capturas de cada región.
pub async fn top_trainers(
    State(controller): State<Arc<ReportsController>>,
) -> Result<Json<Vec<TopTrainer>>, ApiError> {
    Ok(Json(controller.top_trainers_by_region.execute().await?))
}

/// `GET /reports/level-classification`: por tipo, capturas con nivel ≥ 50 y su porcentaje.
pub async fn level_classification(
    State(controller): State<Arc<ReportsController>>,
) -> Result<Json<Vec<LevelClassification>>, ApiError> {
    Ok(Json(
        controller.level_classification_by_type.execute().await?,
    ))
}
