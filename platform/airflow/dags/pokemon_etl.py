"""DAG pokemon_etl: la única vía por la que entran datos a la base `pokemon`.

1. validate: lee los 6 CSV de data/ (montada en solo lectura) y los valida con
   pokemon_csv (columnas, ids repetidos, referencias, reglas de la base). Si algo
   falla, la corrida termina acá y la base no se toca.
2. load: vacía las 6 tablas y las vuelve a cargar en orden de FK, en una sola
   transacción. Idempotente: correrlo de nuevo deja exactamente los mismos datos,
   y si algo falla a mitad de camino no queda nada a medias.
3. build_views: crea o actualiza las vistas de las consultas con
   db/main/sql/views.sql (fuente única, montada en /opt/airflow/sql).

Las tablas las crean las migraciones de Prisma (servicio `migrate`), no este DAG.
Sin schedule: se dispara a mano (botón de la web, POST /api/etl/runs, UI o CLI).
"""

import logging
from datetime import datetime, timezone
from pathlib import Path

from airflow.providers.common.sql.operators.sql import SQLExecuteQueryOperator
from airflow.providers.postgres.hooks.postgres import PostgresHook
from airflow.sdk import dag, task

from pokemon_csv import LOAD_ORDER, TABLES, Dataset, read_dataset

log = logging.getLogger(__name__)

CONN_ID = "pokemon_db"  # AIRFLOW_CONN_POKEMON_DB en docker-compose.base.yml
DATA_DIR = Path("/opt/airflow/data")
SQL_DIR = "/opt/airflow/sql"
MAX_DISCARDED_LOGGED = 20


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
    doc_md=__doc__,
    tags=["pokemon"],
)
def pokemon_etl():
    @task
    def validate() -> dict[str, int]:
        dataset = read_dataset(DATA_DIR)
        log_discarded(dataset)
        counts = {table: len(rows) for table, rows in dataset.rows.items()}
        log.info("CSV válidos: %s", counts)
        return counts

    @task
    def load() -> dict[str, int]:
        # Vuelve a leer y validar: lo que se escribe es exactamente lo validado,
        # aunque data/ haya cambiado después de `validate`.
        dataset = read_dataset(DATA_DIR)
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

    validate() >> load() >> build_views


pokemon_etl()
