import {
  StandardSchemaValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { HttpAdapterHost } from '@nestjs/core';
import { ApiExceptionFilter } from './common/filters/api-exception.filter.ts';

/** Configuración HTTP común a main.ts y a los tests de los controllers. */
export function setupApp(app: INestApplication): INestApplication {
  app.setGlobalPrefix('api');
  // Valida (y convierte) contra el schema Zod de @Query/@Body/@Param({ schema }): 400 si falla.
  app.useGlobalPipes(new StandardSchemaValidationPipe());
  app.useGlobalFilters(
    new ApiExceptionFilter(app.get(HttpAdapterHost).httpAdapter),
  );
  return app;
}
