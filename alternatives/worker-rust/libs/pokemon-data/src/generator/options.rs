use chrono::NaiveDate;

/// Parámetros del generador; los valores por defecto son los del script original.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GeneratorOptions {
    pub trainers: u32,
    pub captures: u32,
    pub battles: u32,
    pub months: u32,
    /// Primer mes (se usa la fecha completa como inicio de los combates).
    pub start: NaiveDate,
}

impl Default for GeneratorOptions {
    fn default() -> Self {
        Self {
            trainers: 50,
            captures: 5000,
            battles: 2000,
            months: 12,
            start: NaiveDate::from_ymd_opt(2025, 11, 1).unwrap_or(NaiveDate::MIN),
        }
    }
}
