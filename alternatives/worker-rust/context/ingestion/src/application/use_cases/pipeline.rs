use super::{BuildViews, GenerateData, LoadDataset, ScrapeCatalog, StepOutcome, ValidateDataset};
use crate::application::ports::Fence;
use crate::domain::{StepError, StepName};

/// Los 5 pasos del pipeline, listos para ejecutarse por nombre.
pub struct Pipeline {
    scrape: ScrapeCatalog,
    generate: GenerateData,
    validate: ValidateDataset,
    load: LoadDataset,
    build_views: BuildViews,
}

impl Pipeline {
    pub fn new(
        scrape: ScrapeCatalog,
        generate: GenerateData,
        validate: ValidateDataset,
        load: LoadDataset,
        build_views: BuildViews,
    ) -> Self {
        Self {
            scrape,
            generate,
            validate,
            load,
            build_views,
        }
    }

    pub async fn execute(&self, step: StepName, fence: &Fence) -> Result<StepOutcome, StepError> {
        match step {
            StepName::Scrape => self.scrape.execute(fence).await,
            StepName::Generate => self.generate.execute(fence).await,
            StepName::Validate => Ok(StepOutcome::Done(Some(self.validate.execute().await?))),
            StepName::Load => self.load.execute(fence).await,
            StepName::BuildViews => {
                self.build_views.execute().await?;
                Ok(StepOutcome::Done(None))
            }
        }
    }
}
