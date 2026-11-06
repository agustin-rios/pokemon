use std::collections::BTreeMap;

/// Resultado de validar: qué se va a cargar y qué se descarta, con su motivo.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct ValidationReport {
    /// Cantidad de filas que se cargan por tabla (sin las descartadas).
    pub counts: BTreeMap<&'static str, usize>,
    /// Por tabla: `battles id 171: duration_seconds debe ser >= 0`, etc.
    /// Solo tiene las tablas con descartes.
    pub discarded: BTreeMap<&'static str, Vec<String>>,
    /// Ids de `captures` descartadas: la carga las excluye.
    pub discarded_captures: Vec<i32>,
    /// Ids de `battles` descartadas: la carga las excluye.
    pub discarded_battles: Vec<i32>,
}
