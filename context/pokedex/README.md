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

## Contrato de las vistas (las crea el DAG)

La agregación corre en Postgres; el contexto solo lee estas columnas.

| Vista                          | Columnas                                                                          | Reglas                                                                                  |
| ------------------------------ | --------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| `type_summary`                 | `type_id`, `type_name`, `pokemon_count`, `avg_base_experience`                    | un Pokémon de dos tipos cuenta en ambos; promedio con 2 decimales                       |
| `capture_monthly_growth`       | `month` (date, primer día), `captures`, `pct_change`                              | `pct_change` con 2 decimales vs. el mes anterior (`lag`); null en el primer mes         |
| `top_trainers_by_region`       | `region`, `rank`, `trainer_id`, `trainer_name`, `captures`                        | `row_number()` por región, por capturas desc. y luego id; `rank ≤ 3`                    |
| `level_classification_by_type` | `type_id`, `type_name`, `total_captures`, `high_level_captures`, `high_level_pct` | `level ≥ 50`; % con 2 decimales; una captura de un Pokémon de dos tipos cuenta en ambos |

## Notas

- `@pokemon/context-pokedex` exporta `domain` + `application`; los adapters, solo por `@pokemon/context-pokedex/adapters`. Quien compone (la API) elige el adapter y se lo pasa al caso de uso.
- Los adapters devuelven tipos del dominio y normalizan lo que Postgres devuelve en SQL directo (`bigint`, `numeric`, `date`).
- La API ejecuta este código con Node sin compilarlo (quita los tipos): solo sintaxis borrable (sin parameter properties, enums ni namespaces) e `import type` explícito. Lo exigen `erasableSyntaxOnly` y `verbatimModuleSyntax` en `tsconfig.lib.json`.
- Imports relativos con extensión `.ts`. Tests en `tests/` (replica `src/`), con repositorios stub: `pnpm nx run @pokemon/context-pokedex:test`.
