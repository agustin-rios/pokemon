"""Carga los 6 CSV de data/ en la base `pokemon` y crea las vistas que lee la API.

Las tablas las crea Prisma (servicio `migrate`); este DAG solo las vacía, las
recarga y (re)crea las vistas. Contrato de las vistas: context/pokedex/README.md.
Sin schedule: corre solo cuando se dispara (UI, CLI o API REST).
"""

import csv
import io
import logging
from datetime import datetime, timezone
from pathlib import Path

from airflow.providers.common.sql.operators.sql import SQLExecuteQueryOperator
from airflow.providers.postgres.hooks.postgres import PostgresHook
from airflow.sdk import dag, task

log = logging.getLogger(__name__)

CONN_ID = "pokemon_db"
DATA_DIR = Path("/opt/airflow/data")

# Orden de carga: primero las tablas referenciadas por FK.
TABLES = ["types", "pokemon", "pokemon_types", "trainers", "captures", "battles"]



@dag(
    dag_id="pokemon_etl",
    schedule=None,
    start_date=datetime(2025, 1, 1, tzinfo=timezone.utc),
    catchup=False,
    max_active_runs=1,  # dos cargas a la vez se pisarían el TRUNCATE
    is_paused_upon_creation=False,  # sin schedule, despausado no corre solo
    tags=["pokemon"],
)
def pokemon_etl():
    @task
    def check_files():
        pass

    @task
    def load_tables():
        pass


    check_files() >> load_tables()

pokemon_etl()
