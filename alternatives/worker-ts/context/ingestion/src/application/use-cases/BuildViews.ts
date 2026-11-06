import type { StepContext } from '../ports/StepContext.ts';
import type { ViewsBuilder } from '../ports/ViewsBuilder.ts';

/** Paso `build_views`: crea las vistas de las consultas sobre los datos cargados. */
export class BuildViews {
  private readonly builder: ViewsBuilder;

  constructor(builder: ViewsBuilder) {
    this.builder = builder;
  }

  async execute({ signal }: StepContext): Promise<null> {
    await this.builder.build(signal);
    return null;
  }
}
