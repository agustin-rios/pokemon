import { Controller, HttpCode, HttpStatus, Inject, Post } from '@nestjs/common';
import { AirflowClient, type DagRun } from './airflow.client.ts';

/** DAG que carga los CSV en la base (platform/airflow/dags/pokemon_etl.py). */
export const POKEMON_ETL_DAG_ID = 'pokemon_etl';

@Controller('etl')
export class EtlController {
  constructor(@Inject(AirflowClient) private readonly airflow: AirflowClient) {}

  /** Dispara el DAG de carga. 202: Airflow encola la corrida y responde sin esperarla. */
  @Post('runs')
  @HttpCode(HttpStatus.ACCEPTED)
  run(): Promise<DagRun> {
    return this.airflow.triggerDag(POKEMON_ETL_DAG_ID);
  }
}
