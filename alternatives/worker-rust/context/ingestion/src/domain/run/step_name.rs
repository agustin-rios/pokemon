use std::fmt;

use serde::Serialize;
use ts_rs::TS;

/// Pasos del pipeline, siempre en este orden.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, TS)]
#[serde(rename_all = "snake_case")]
pub enum StepName {
    Scrape,
    Generate,
    Validate,
    Load,
    BuildViews,
}

impl StepName {
    /// En orden de ejecución (`position` 1..5).
    pub const ALL: [Self; 5] = [
        Self::Scrape,
        Self::Generate,
        Self::Validate,
        Self::Load,
        Self::BuildViews,
    ];

    /// Nombre guardado en `etl_run_steps.step`.
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Scrape => "scrape",
            Self::Generate => "generate",
            Self::Validate => "validate",
            Self::Load => "load",
            Self::BuildViews => "build_views",
        }
    }

    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.into_iter().find(|s| s.as_str() == text)
    }
}

impl fmt::Display for StepName {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}
