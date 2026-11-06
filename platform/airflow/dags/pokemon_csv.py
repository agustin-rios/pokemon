"""Lectura y validación de los 6 CSV de data/. Python puro: se testea sin Airflow.

El DAG pokemon_etl la usa antes de escribir en la base. Las reglas siguen a las
tablas y constraints de db/main (migraciones de Prisma):

- Error (la corrida falla y la base no se toca): falta un archivo, una columna o
  filas; un valor vacío o ilegible; un id (o clave única) repetido; una referencia
  a un id que no existe; una regla rota en el catálogo (types, pokemon,
  pokemon_types, trainers), del que dependen las demás tablas.
- Fila descartada (se informa y la corrida sigue): una regla rota en captures o
  battles. Ninguna tabla las referencia, así que sacar la fila no rompe nada.
"""

from __future__ import annotations

import csv
from collections.abc import Callable
from dataclasses import dataclass
from datetime import date, datetime
from pathlib import Path
from typing import Any

Row = dict[str, Any]


def _int(value: str) -> int:
    return int(value)


def _text(value: str) -> str:
    if not value.strip():
        raise ValueError
    return value


def _timestamp(value: str) -> datetime:
    parsed = datetime.fromisoformat(value)
    if parsed.tzinfo is not None:  # la columna es TIMESTAMP sin zona
        raise ValueError
    return parsed


@dataclass(frozen=True)
class Column:
    name: str  # cabecera en el CSV
    parse: Callable[[str], Any]
    kind: str
    # Valor si la celda viene vacía; sin default, vacío es un error.
    default: Any = ...
    # Columna de la tabla, si no se llama igual que en el CSV.
    db: str | None = None

    @property
    def db_column(self) -> str:
        return self.db or self.name


def _id(name: str) -> Column:
    return Column(name, _int, "un entero")


def _text_col(name: str) -> Column:
    return Column(name, _text, "texto no vacío")


# Una entrada por tabla, en orden de carga (primero las referenciadas por FK).
# Las columnas son las de la tabla, con su nombre en el CSV (Column.db si en la
# tabla se llama distinto); el CSV puede traer otras, que se ignoran.
TABLES: dict[str, tuple[Column, ...]] = {
    "types": (_id("id"), _text_col("name")),
    "pokemon": (
        _id("id"),
        _text_col("name"),
        _id("height"),
        _id("weight"),
        # La PokeAPI lo trae null en algunos Pokémon: 0, el default de la columna.
        Column("base_experience", _int, "un entero", default=0),
        # El enunciado fija `sprite` como columna del CSV; en la tabla es sprite_url.
        Column("sprite", _text, "texto", default=None, db="sprite_url"),
    ),
    "pokemon_types": (_id("pokemon_id"), _id("type_id"), _id("slot")),
    "trainers": (
        _id("id"),
        _text_col("name"),
        _text_col("region"),
        Column("created_at", date.fromisoformat, "una fecha AAAA-MM-DD"),
    ),
    "captures": (
        _id("id"),
        _id("trainer_id"),
        _id("pokemon_id"),
        Column("captured_at", _timestamp, "una fecha y hora AAAA-MM-DD HH:MM:SS"),
        _id("level"),
        _text_col("location"),
    ),
    "battles": (
        _id("id"),
        _id("pokemon_a_id"),
        _id("pokemon_b_id"),
        _id("winner_id"),
        Column("fought_at", _timestamp, "una fecha y hora AAAA-MM-DD HH:MM:SS"),
        _id("duration_seconds"),
    ),
}
LOAD_ORDER = tuple(TABLES)

# Clave primaria y claves únicas de cada tabla.
UNIQUE: dict[str, tuple[tuple[str, ...], ...]] = {
    "types": (("id",), ("name",)),
    "pokemon": (("id",), ("name",)),
    "pokemon_types": (("pokemon_id", "type_id"), ("pokemon_id", "slot")),
    "trainers": (("id",),),
    "captures": (("id",),),
    "battles": (("id",),),
}

# (tabla, columna, tabla referenciada): la columna apunta al id de la referenciada.
FOREIGN_KEYS: tuple[tuple[str, str, str], ...] = (
    ("pokemon_types", "pokemon_id", "pokemon"),
    ("pokemon_types", "type_id", "types"),
    ("captures", "trainer_id", "trainers"),
    ("captures", "pokemon_id", "pokemon"),
    ("battles", "pokemon_a_id", "pokemon"),
    ("battles", "pokemon_b_id", "pokemon"),
    ("battles", "winner_id", "pokemon"),
)

# Reglas por fila: los CHECK de la base. (mensaje si se rompe, condición que debe cumplirse)
RULES: dict[str, tuple[tuple[str, Callable[[Row], bool]], ...]] = {
    "pokemon": (
        ("height debe ser > 0", lambda r: r["height"] > 0),
        ("weight debe ser > 0", lambda r: r["weight"] > 0),
        ("base_experience debe ser >= 0", lambda r: r["base_experience"] >= 0),
    ),
    "pokemon_types": (("slot debe ser 1 o 2", lambda r: r["slot"] in (1, 2)),),
    "captures": (("level debe estar entre 1 y 100", lambda r: 1 <= r["level"] <= 100),),
    "battles": (
        (
            "pokemon_a_id y pokemon_b_id deben ser distintos",
            lambda r: r["pokemon_a_id"] != r["pokemon_b_id"],
        ),
        (
            "winner_id debe ser pokemon_a_id o pokemon_b_id",
            lambda r: r["winner_id"] in (r["pokemon_a_id"], r["pokemon_b_id"]),
        ),
        ("duration_seconds debe ser >= 0", lambda r: r["duration_seconds"] >= 0),
    ),
}
# Tablas donde romper una regla descarta la fila en vez de fallar.
DISCARDABLE = frozenset({"captures", "battles"})

MAX_ERRORS_IN_MESSAGE = 50


class DataValidationError(Exception):
    """Los CSV no cumplen: no se debe escribir nada."""

    def __init__(self, errors: list[str]):
        self.errors = errors
        shown = errors[:MAX_ERRORS_IN_MESSAGE]
        more = f"\n- … y {len(errors) - len(shown)} más" if len(errors) > len(shown) else ""
        super().__init__(
            f"{len(errors)} problema(s) en los CSV:\n- " + "\n- ".join(shown) + more
        )


@dataclass(frozen=True)
class Dataset:
    """Filas válidas por tabla (tuplas en el orden de TABLES) y las descartadas."""

    rows: dict[str, list[tuple[Any, ...]]]
    # Por tabla: "battles.csv línea 172: duration_seconds debe ser >= 0", etc.
    discarded: dict[str, list[str]]


def read_dataset(data_dir: Path) -> Dataset:
    """Lee y valida los 6 CSV. Lanza DataValidationError con todos los problemas."""
    errors: list[str] = []
    parsed: dict[str, list[tuple[int, Row]]] = {}
    broken: set[str] = set()  # tablas que no se pudieron leer: no se cruzan
    for table, columns in TABLES.items():
        rows = _read_table(data_dir / f"{table}.csv", columns, errors)
        if rows is None:
            broken.add(table)
        parsed[table] = rows or []

    _check_unique(parsed, errors)
    _check_foreign_keys(parsed, broken, errors)
    discarded_lines = _check_rules(parsed, errors)
    if errors:
        raise DataValidationError(errors)

    rows_out = {
        table: [
            tuple(row[c.name] for c in TABLES[table])
            for line, row in parsed[table]
            if line not in discarded_lines.get(table, {})
        ]
        for table in TABLES
    }
    discarded = {
        table: [f"{table}.csv línea {line}: {reason}" for line, reason in lines.items()]
        for table, lines in discarded_lines.items()
    }
    return Dataset(rows=rows_out, discarded=discarded)


def _read_table(
    path: Path, columns: tuple[Column, ...], errors: list[str]
) -> list[tuple[int, Row]] | None:
    """Filas tipadas con su número de línea; None si el archivo no se puede usar."""
    if not path.is_file():
        errors.append(f"falta {path.name} (se genera con `pnpm ops data prepare`)")
        return None
    with path.open(newline="", encoding="utf-8") as file:
        reader = csv.DictReader(file)
        header = reader.fieldnames or []
        missing = [c.name for c in columns if c.name not in header]
        if missing:
            errors.append(f"{path.name}: faltan las columnas {', '.join(missing)}")
            return None

        rows: list[tuple[int, Row]] = []
        for raw in reader:
            line = reader.line_num
            row: Row = {}
            for column in columns:
                value = raw.get(column.name)
                if value is None or value == "":
                    if column.default is ...:
                        errors.append(f"{path.name} línea {line}: {column.name} vacío")
                        break
                    row[column.name] = column.default
                    continue
                try:
                    row[column.name] = column.parse(value)
                except ValueError:
                    errors.append(
                        f"{path.name} línea {line}: {column.name}={value!r} no es {column.kind}"
                    )
                    break
            else:
                rows.append((line, row))
        if reader.line_num <= 1:
            errors.append(f"{path.name}: no tiene filas")
        return rows


def _check_unique(parsed: dict[str, list[tuple[int, Row]]], errors: list[str]) -> None:
    for table, keys in UNIQUE.items():
        for key in keys:
            seen: dict[tuple[Any, ...], int] = {}
            for line, row in parsed[table]:
                value = tuple(row[c] for c in key)
                if value in seen:
                    errors.append(
                        f"{table}.csv línea {line}: {_format_key(key, value)} repetido"
                        f" (ya está en la línea {seen[value]})"
                    )
                else:
                    seen[value] = line


def _check_foreign_keys(
    parsed: dict[str, list[tuple[int, Row]]], broken: set[str], errors: list[str]
) -> None:
    referenced = {ref for _, _, ref in FOREIGN_KEYS}
    ids = {ref: {row["id"] for _, row in parsed[ref]} for ref in referenced}
    for table, column, ref in FOREIGN_KEYS:
        if table in broken or ref in broken:
            continue
        for line, row in parsed[table]:
            if row[column] not in ids[ref]:
                errors.append(
                    f"{table}.csv línea {line}: {column} {row[column]} no existe en {ref}.csv"
                )


def _check_rules(
    parsed: dict[str, list[tuple[int, Row]]], errors: list[str]
) -> dict[str, dict[int, str]]:
    """Aplica RULES; devuelve las líneas descartadas por tabla con su motivo."""
    discarded: dict[str, dict[int, str]] = {}
    for table, rules in RULES.items():
        for line, row in parsed[table]:
            broken_rules = [message for message, holds in rules if not holds(row)]
            if not broken_rules:
                continue
            reason = "; ".join(broken_rules)
            if table in DISCARDABLE:
                discarded.setdefault(table, {})[line] = reason
            else:
                errors.append(f"{table}.csv línea {line}: {reason}")

    # El slot 2 exige que el mismo Pokémon tenga slot 1 (constraint trigger en la base).
    first_slots = {row["pokemon_id"] for _, row in parsed["pokemon_types"] if row["slot"] == 1}
    for line, row in parsed["pokemon_types"]:
        if row["slot"] == 2 and row["pokemon_id"] not in first_slots:
            errors.append(
                f"pokemon_types.csv línea {line}: pokemon_id {row['pokemon_id']}"
                " tiene slot 2 sin slot 1"
            )
    return discarded


def _format_key(key: tuple[str, ...], value: tuple[Any, ...]) -> str:
    if len(key) == 1:
        return f"{key[0]} {value[0]!r}"
    return f"({', '.join(key)}) {value!r}"
