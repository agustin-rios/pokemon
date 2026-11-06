import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import {
  EnqueueEtlRun,
  GetEtlRun,
  RetryEtlRun,
  type EtlRun,
} from '@pokemon/context-ingestion';
import { z } from 'zod';

const runId = z.guid();

@Controller('etl/runs')
export class EtlController {
  constructor(
    @Inject(EnqueueEtlRun) private readonly enqueueEtlRun: EnqueueEtlRun,
    @Inject(GetEtlRun) private readonly getEtlRun: GetEtlRun,
    @Inject(RetryEtlRun) private readonly retryEtlRun: RetryEtlRun,
  ) {}

  /** Encola la corrida del pipeline, o devuelve la que ya está activa. 202: la ejecuta el worker. */
  @Post()
  @HttpCode(HttpStatus.ACCEPTED)
  run(): Promise<EtlRun> {
    return this.enqueueEtlRun.execute();
  }

  /** Estado de una corrida y de sus pasos: 400 si el id no es un UUID, 404 si no existe. */
  @Get(':runId')
  async findOne(
    @Param('runId', { schema: runId }) id: string,
  ): Promise<EtlRun> {
    const run = await this.getEtlRun.execute(id);
    if (!run) throw new NotFoundException(`No existe la corrida ${id}`);
    return run;
  }

  /** Vuelve a encolar una corrida fallida: retoma desde el paso que falló. */
  @Post(':runId/retry')
  @HttpCode(HttpStatus.ACCEPTED)
  retry(@Param('runId', { schema: runId }) id: string): Promise<EtlRun> {
    return this.retryEtlRun.execute(id);
  }
}
