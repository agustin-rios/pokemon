use std::sync::Arc;

use crate::application::ports::ViewsBuilder;
use crate::domain::StepError;

/// Paso `build_views`: crea o actualiza las vistas de reportes.
pub struct BuildViews {
    builder: Arc<dyn ViewsBuilder>,
}

impl BuildViews {
    pub fn new(builder: Arc<dyn ViewsBuilder>) -> Self {
        Self { builder }
    }

    pub async fn execute(&self) -> Result<(), StepError> {
        Ok(self.builder.build().await?)
    }
}
