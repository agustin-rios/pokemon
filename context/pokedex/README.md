# @pokemon/context-pokedex

Contexto hexagonal de la Pokédex, con Repository Pattern. Solo lectura: los datos los carga el DAG de Airflow.

| Capa (`src/`)            | Contenido                                                                                                                          | Puede importar            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- | ------------------------- |
| `domain/entities/`       | `Pokemon` (con sus tipos)                                                                                                          | solo relativos            |
| `domain/reports/`        | `TypeSummary`, `MonthlyCaptureGrowth` (A), `TopTrainer` (B), `LevelClassification` (C)                                             | solo relativos            |
| `application/ports/`     | `PokemonRepository` (catálogo) y `ReportsRepository` (vistas)                                                                      | `domain/`                 |
| `application/use-cases/` | `ListPokemon`, `GetPokemon`, `GetTypeSummary`, `GetMonthlyCaptureGrowth`, `GetTopTrainersByRegion`, `GetLevelClassificationByType` | `domain/`, `ports/`       |
| `infra/adapters/`        | `PrismaPokemonRepository` (tablas), `PrismaReportsRepository` (vistas)                                                             | además `@pokemon/db-main` |

## Endpoints que cubre

| Endpoint (API)       | Caso de uso                    | Lee                                  |
| -------------------- | ------------------------------ | ------------------------------------ |
| `GET /items`         | `ListPokemon` (paginado)       | `pokemon`, `pokemon_types`, `types`  |
| `GET /items/:id`     | `GetPokemon`                   | ídem                                 |
| `GET /items/summary` | `GetTypeSummary`               | vista `type_summary`                 |
| Consulta A           | `GetMonthlyCaptureGrowth`      | vista `capture_monthly_growth`       |
| Consulta B           | `GetTopTrainersByRegion`       | vista `top_trainers_by_region`       |
| Consulta C           | `GetLevelClassificationByType` | vista `level_classification_by_type` |

Errores: entrada inválida → `ValidationError` (la API responde 400); un Pokémon inexistente → `null` (404).

## Contrato con las vistas

Las vistas se definen en un solo lugar, [`db/main/sql/views.sql`](../../db/main/sql/views.sql): el DAG lo ejecuta (tarea `build_views`) y `PrismaReportsRepository` lee sus columnas. La agregación corre en Postgres.

| Vista                          | Columnas                                                                          |
| ------------------------------ | --------------------------------------------------------------------------------- |
| `type_summary`                 | `type_id`, `type_name`, `pokemon_count`, `avg_base_experience`                    |
| `capture_monthly_growth`       | `month` (date, primer día), `captures`, `pct_change`                              |
| `top_trainers_by_region`       | `region`, `rank`, `trainer_id`, `trainer_name`, `captures`                        |
| `level_classification_by_type` | `type_id`, `type_name`, `total_captures`, `high_level_captures`, `high_level_pct` |

El test de contrato (`tests/infra/adapters/PrismaReportsRepository.spec.ts`) aplica las migraciones y ese mismo `views.sql` en un schema propio, carga unos pocos datos y verifica lo que devuelve el adapter: si una vista y el adapter dejan de calzar (columna, tipo o regla), falla. Necesita Postgres; sin `TEST_DATABASE_URL` se salta:

```sh
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5434/postgres pnpm nx run @pokemon/context-pokedex:test
```

Sirve cualquier base: el test crea su schema `contract_*` y lo borra al terminar.

## Notas

- `@pokemon/context-pokedex` exporta `domain` + `application`; los adapters, solo por `@pokemon/context-pokedex/adapters`. Quien compone (la API) elige el adapter y se lo pasa al caso de uso.
- Los adapters devuelven tipos del dominio y normalizan lo que Postgres devuelve en SQL directo (`bigint`, `numeric`, `date`).
- La API ejecuta este código con Node sin compilarlo (quita los tipos): solo sintaxis borrable (sin parameter properties, enums ni namespaces) e `import type` explícito. Lo exigen `erasableSyntaxOnly` y `verbatimModuleSyntax` en `tsconfig.lib.json`.
- Imports relativos con extensión `.ts`. Tests en `tests/` (replica `src/`): casos de uso con repositorios stub y el adapter de reportes contra Postgres (test de contrato).
