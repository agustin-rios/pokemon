# @pokemon/context-ingestion

Contexto hexagonal del pipeline de datos: `scrape → generate → validate → load → build_views`. Lo ejecuta el worker (`apps/worker`); la API solo encola y consulta corridas. No hay archivos: PokeAPI y generador escriben en las tablas de **staging** de Postgres (schema `staging`, migración `20261106000000_staging`), `validate` las revisa y `load` las pasa a las tablas finales.

| Capa (`src/`)            | Contenido                                                                                                                                                                                 | Puede importar                               |
| ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------- |
| `domain/dataset/`        | forma de las 6 tablas (`tables.ts`) y `validateStaging` (`validation.ts`): las reglas del pipeline original, sobre filas de staging                                                       | solo relativos                               |
| `domain/run/`            | pasos y estados de una corrida (`EtlRun`), qué pasos quedan al retomar                                                                                                                    | solo relativos                               |
| `domain/errors.ts`       | `DataValidationError`, `PermanentError`, `FenceLostError`, `StepDeadlineError`, `sqlState`, `classifyError` (permanente o reintentable, por tipo) y `describeError`                       | solo relativos, errores de `pokemon-data`    |
| `application/ports/`     | `RunQueue`, `RunProgress`, `RunFence`, `StepContext`, `PokemonSource`, `StagingStore`, `DatasetLoader`, `ViewsBuilder`, `Logger`                                                          | `domain/`                                    |
| `application/use-cases/` | un caso de uso por paso, `EnqueueEtlRun`, `GetEtlRun`, `RetryEtlRun` y `ExecuteEtlRun` (ejecuta una corrida)                                                                              | `domain/`, `ports/`, `@pokemon/pokemon-data` |
| `infra/adapters/`        | `PokeApiPokemonSource`, `PrismaStagingStore`, `PrismaDatasetLoader`, `PgViewsBuilder`, `BullMqEtlRunQueue`, `BullMqRunProgress`, `BullMqRunFence` (`@pokemon/context-ingestion/adapters`) | además `@pokemon/db-main`, `pg`, `bullmq`    |

## Corridas

- Los pasos corren siempre en orden y un paso exitoso no se repite dentro de la misma corrida: `ExecuteEtlRun` lee el progreso guardado (`RunProgress`) y ejecuta los que no terminaron, guardándolo en cada transición. Los datos entre pasos están en staging.
- Los fallos de un paso se devuelven **clasificados** (`RunOutcome`): permanente (datos inválidos, HTTP 4xx salvo 429, URL de tipo inesperada, errores 22/23 de la base, 42 al crear las vistas) o reintentable (todo lo demás: intentos agotados contra la PokeAPI, plazos, conexión, timeouts). La clasificación es por **tipo** de error, nunca por su mensaje. El mensaje del resultado (`<paso>: <error>`) trae además la cadena de causas, una línea por causa.
- **Cerco.** Cada escritura en la base (scrape, generate, load) es una sola transacción que, justo antes de confirmar, consulta `RunFence`: si la ejecución ya no es dueña de la corrida, revierte y se detiene. Un paso zombi no puede pisar los datos que usa otra ejecución.
- **Cancelación.** Cada paso recibe un `AbortSignal` (`StepContext`) que llega hasta los requests HTTP, las transacciones y la conexión de las vistas. Se aborta al vencer el plazo del paso (reintentable) o, tras el apagado, pasada la gracia. Después de abortar, `ExecuteEtlRun` espera a que el paso termine de verdad antes de devolver el control.
- **Apagado.** Con `shutdown` abortado, la ejecución termina el paso en curso y no empieza el siguiente (`stopped: drained`); si el paso tarda más que la gracia, lo cancela y espera a lo sumo `abandonSettleMs` (3 s) a que termine (`stopped: abandoned`); una sentencia bloqueada en Postgres no responde a la señal, pero el cerco le impide confirmar y Postgres la deshace al cerrarse la conexión. En ambos casos la corrida no se marca como fallida: se retoma desde ese paso.
- **Plazos.** Cada paso tiene un plazo total (`stepDeadlineMs`) y las sentencias a Postgres, `statement_timeout`; vencido cualquiera, el error es reintentable.
- Los errores de la infraestructura (p. ej. no poder guardar el progreso) no son fallos del paso: se propagan.

## Cola de corridas (BullMQ)

Las corridas viven en Redis (cola `etl`, job `pokemon-etl`, id = el `runId`); `bullmq` necesita además `ioredis`, que es un peer opcional y por eso está en las dependencias.

- **Una corrida activa.** `deduplication: { id: 'pokemon-etl' }` + concurrencia global 1 de la cola (`BullMqEtlRunQueue` la fija al encolar). `attempts: 3`, backoff exponencial de 5 s, se conservan los últimos 100 jobs terminados y fallidos.
- **`enqueue` y `retry` se ordenan con un candado corto en Redis** y buscan antes la corrida activa (en cola, corriendo o esperando un reintento). La deduplicación sola no basta: un reintento manual saca un job de `failed` sin devolverle la clave, y un POST nuevo en ese hueco crearía una segunda corrida. Garantía de la carrera "reintento vs POST nuevo": nunca quedan dos corridas activas. Si gana el reintento, el POST devuelve la corrida reintentada (mismo `runId`); si gana el POST, crea la nueva y el reintento recibe 409 `Ya hay una corrida en curso`. Si no se consigue el candado en 5 s, `enqueue` lanza `EnqueueFailedError`.
- **Estados.** `waiting|delayed|prioritized|waiting-children` → `queued` (también mientras espera el backoff de un fallo reintentable: `error` conserva el último `failedReason`), `active` → `running`, `completed` → `succeeded`, `failed` → `failed`. `attempts` son las ejecuciones **empezadas** (`attemptsStarted`): cuenta también las retomas tras una caída. Los pasos salen del progreso del job (`{ steps }`, que guarda `BullMqRunProgress`).
- **Cerco.** `BullMqRunFence` llama a `job.extendLock(token, lockDuration)`, que comprueba y renueva el lock en un solo paso atómico y devuelve `1` (o `0` si el lock venció o es de otra ejecución, sin recrearlo); con `0` lanza `FenceLostError` y la transacción se revierte.
- **Para el procesador del worker.** Un resultado `stopped` no debe completar ni fallar el job: `await job.moveToWait(token)` y lanzar `WaitingError` lo devuelve a la cola sin gastar un intento. Si el worker muere, el job se retoma por el chequeo de jobs estancados: la marca de ese chequeo dura `stalledInterval` (30 s por defecto), así que hasta que vence nadie revisa y la retoma puede tardar entre uno y dos intervalos más el `lockDuration`.

## Validación de staging

`validateStaging` lee las filas ordenadas por clave (los NULL al final) y junta todos los problemas, en este orden: tabla vacía, valores requeridos (y no vacíos), claves únicas, referencias, reglas y orden de slots. En `captures` y `battles` una regla rota descarta la fila (queda en el `output` de `validate` y `load` no la copia); en el resto es un error. `base_experience` NULL se carga como 0.

## Tests

`tests/domain` y `tests/application` corren sin base de datos, con puertos falsos (`tests/stubs.ts`). `tests/infra` necesita Postgres (`TEST_DATABASE_URL`) y Redis (`TEST_REDIS_URL`; las de la cola usan un prefijo propio por prueba y lo borran al terminar, con workers de BullMQ sin Nest, uno de ellos en un proceso hijo al que se mata con SIGKILL: `tests/infra/stalledWorker.ts`). Cada archivo con Postgres crea su propio schema para las tablas finales y otro para staging, y los borra al terminar. `tests/fixtures/data-current` son los 6 CSV de la corrida de referencia, usados solo como datos de prueba (`tests/fixtures.ts` los pasa a filas).

```sh
TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:5441/pokemon TEST_REDIS_URL=redis://localhost:6411 pnpm nx run @pokemon/context-ingestion:test
```
