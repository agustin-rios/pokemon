use serde::Serialize;
use ts_rs::TS;

/// Consulta B (top entrenadores): los 3 entrenadores con más capturas de cada
/// región, rankeados con una función de ventana. Vista `top_trainers_by_region`.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct TopTrainer {
    pub region: String,
    /// 1 a 3 dentro de la región; empates por capturas se ordenan por id.
    pub rank: i32,
    pub trainer_id: i32,
    pub trainer_name: String,
    pub captures: i32,
}
