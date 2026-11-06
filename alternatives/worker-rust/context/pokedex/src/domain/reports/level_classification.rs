use serde::Serialize;
use ts_rs::TS;

/// Consulta C (clasificación por nivel): por tipo, cuántas capturas tienen
/// nivel 50 o más y qué porcentaje representan sobre las capturas de ese tipo.
/// Una captura de un Pokémon con dos tipos cuenta en ambos.
/// Vista `level_classification_by_type`.
#[derive(Debug, Clone, PartialEq, Serialize, TS)]
#[serde(rename_all = "camelCase")]
pub struct LevelClassification {
    pub type_id: i32,
    pub type_name: String,
    pub total_captures: i32,
    /// Capturas con nivel ≥ 50.
    pub high_level_captures: i32,
    /// % sobre `total_captures`, con 2 decimales.
    pub high_level_percent: f64,
}
