"""DAG pokemon_etl: la única vía por la que entran datos a la base `pokemon`.

Cada corrida trabaja en su propia carpeta, data/runs/<run_id>/ (volumen montado):

1. extract: baja los Pokémon 1..100 de la PokeAPI → pokemon.csv, types.csv y
   pokemon_types.csv (pokemon_extract, la misma salida que `pnpm ops data scrape`).
2. generate: scripts/generate_pokemon_data.py con esos ids → trainers.csv,
   captures.csv y battles.csv.
3. validate: lee los 6 CSV y los valida con pokemon_csv (columnas, ids repetidos,
   referencias, reglas de la base). Si algo falla, la base no se toca.
4. load: vacía las 6 tablas y las vuelve a cargar en orden de FK, en una sola
   transacción. Idempotente: correrlo de nuevo deja exactamente los mismos datos.
5. build_views: crea o actualiza las vistas con db/main/sql/views.sql.

Retomar sin repetir pasos: Airflow guarda el estado de cada tarea y cada una deja
su resultado en la carpeta de la corrida, escrito de forma atómica. Una tarea que
falla se reintenta sola (3 veces, con espera creciente) y una interrumpida (worker
caído) se detecta por heartbeat y también se reintenta: en los dos casos solo esa
tarea. Lo que no se arregla reintentando (datos inválidos, un 404 de la PokeAPI)
falla de una; después de corregir, POST /api/etl/runs/:runId/retry (o "Clear" en
la UI de Airflow) retoma la misma corrida desde la tarea fallida.

Las tablas las crean las migraciones de Prisma (servicio `migrate`), no este DAG.
Sin schedule: se dispara a mano (botón de la web, POST /api/etl/runs, UI o CLI).
"""

import logging
import subprocess
import sys
import tempfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

from airflow.providers.common.sql.operators.sql import SQLExecuteQueryOperator
from airflow.providers.postgres.hooks.postgres import PostgresHook
from airflow.sdk import dag, get_current_context, task
from airflow.sdk.exceptions import AirflowFailException

from pokemon_csv import LOAD_ORDER, TABLES, Dataset, DataValidationError, read_dataset
from pokemon_extract import (
    HttpStatusError,
    UnexpectedTypeUrlError,
    dataset_files,
    fetch_pokemon,
    to_dataset,
)
from pokemon_files import move_files_atomically, prune_runs, run_dir_name, write_files_atomically

log = logging.getLogger(__name__)

CONN_ID = "pokemon_db"  # AIRFLOW_CONN_POKEMON_DB en docker-compose.base.yml
DATA_DIR = Path("/opt/airflow/data")
RUNS_DIR = DATA_DIR / "runs"
GENERATOR = Path("/opt/airflow/scripts/generate_pokemon_data.py")
SQL_DIR = "/opt/airflow/sql"
POKEMON_LIMIT = 100  # igual que `pnpm ops data scrape` y el generador por defecto
GENERATED_FILES = ["trainers.csv", "captures.csv", "battles.csv"]
KEEP_RUNS = 5  # carpetas de corridas que se conservan en data/runs
MAX_DISCARDED_LOGGED = 20


def current_run_dir() -> Path:
    return RUNS_DIR / run_dir_name(get_current_context()["run_id"])


def read_validated(run_dir: Path) -> Dataset:
    """Lee y valida los CSV de la corrida. Datos inválidos no se arreglan reintentando."""
    try:
        return read_dataset(run_dir)
    except DataValidationError as error:
        raise AirflowFailException(str(error)) from error


def log_discarded(dataset: Dataset) -> None:
    for table, reasons in dataset.discarded.items():
        log.warning("%s: %d fila(s) descartada(s)", table, len(reasons))
        for reason in reasons[:MAX_DISCARDED_LOGGED]:
            log.warning("  %s", reason)


@dag(
    dag_id="pokemon_etl",
    schedule=None,
    start_date=datetime(2025, 1, 1, tzinfo=timezone.utc),
    catchup=False,
    max_active_runs=1,  # dos cargas a la vez se pisarían
    is_paused_upon_creation=False,  # sin schedule, despausado no corre solo
    template_searchpath=[SQL_DIR],
    default_args={
        # Errores transitorios (red, PokeAPI 429/5xx, base caída, worker caído):
        # se reintenta solo la tarea que falló, esperando 15 s, 30 s y 60 s.
        "retries": 3,
        "retry_delay": timedelta(seconds=15),
        "retry_exponential_backoff": True,
        "max_retry_delay": timedelta(minutes=5),
    },
    doc_md=__doc__,
    tags=["pokemon"],
)
def pokemon_etl():
    @task
    def extract() -> dict[str, int]:
        run_dir = current_run_dir()
        removed = prune_runs(RUNS_DIR, KEEP_RUNS, run_dir.name)
        if removed:
            log.info("Corridas viejas borradas de data/runs: %s", ", ".join(removed))
        try:
            dataset = to_dataset(fetch_pokemon(POKEMON_LIMIT))
        except (HttpStatusError, UnexpectedTypeUrlError) as error:
            raise AirflowFailException(str(error)) from error
        write_files_atomically(run_dir, dataset_files(dataset))
        counts = {table: len(rows) for table, rows in dataset.items()}
        log.info("PokeAPI → %s: %s", run_dir, counts)
        return counts

    @task
    def generate() -> dict[str, int]:
        run_dir = current_run_dir()
        # El generador escribe en una carpeta temporal dentro de la de la corrida
        # (misma partición) y recién al final se mueven los 3 CSV juntos.
        with tempfile.TemporaryDirectory(dir=run_dir, prefix=".generate-") as tmp:
            result = subprocess.run(
                [
                    sys.executable,
                    str(GENERATOR),
                    "--out",
                    tmp,
                    "--pokemon-csv",
                    str(run_dir / "pokemon.csv"),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            if result.returncode != 0:
                raise RuntimeError(
                    f"el generador terminó con código {result.returncode}: {result.stderr.strip()}"
                )
            log.info("Generador: %s", result.stdout.strip())
            move_files_atomically(Path(tmp), GENERATED_FILES, run_dir)
        return {
            name.removesuffix(".csv"): sum(1 for _ in (run_dir / name).open(encoding="utf-8")) - 1
            for name in GENERATED_FILES
        }

    @task
    def validate() -> dict[str, int]:
        dataset = read_validated(current_run_dir())
        log_discarded(dataset)
        counts = {table: len(rows) for table, rows in dataset.rows.items()}
        log.info("CSV válidos: %s", counts)
        return counts

    @task
    def load() -> dict[str, int]:
        # Vuelve a leer y validar: lo que se escribe es exactamente lo validado.
        dataset = read_validated(current_run_dir())
        # psycopg 3 (provider de Postgres 7): `with conn` hace commit al final o
        # rollback si algo falla, y cierra la conexión.
        with PostgresHook(postgres_conn_id=CONN_ID).get_conn() as conn, conn.cursor() as cur:
            cur.execute(f"TRUNCATE {', '.join(LOAD_ORDER)}")
            for table in LOAD_ORDER:
                columns = ", ".join(column.db_column for column in TABLES[table])
                with cur.copy(f"COPY {table} ({columns}) FROM STDIN") as copy:
                    for row in dataset.rows[table]:
                        copy.write_row(row)
        counts = {table: len(dataset.rows[table]) for table in LOAD_ORDER}
        log.info("Filas cargadas: %s", counts)
        return counts

    build_views = SQLExecuteQueryOperator(
        task_id="build_views",
        conn_id=CONN_ID,
        sql="views.sql",  # se busca en template_searchpath
    )

    extract() >> generate() >> validate() >> load() >> build_views


pokemon_etl()
