import csv
from datetime import date, datetime
from pathlib import Path

import pytest

from pokemon_csv import LOAD_ORDER, TABLES, DataValidationError, read_dataset

REPO_DATA = Path(__file__).resolve().parents[3] / "data"


def valid_tables() -> dict[str, list[dict[str, str]]]:
    """Dataset mínimo válido: 2 tipos, 2 Pokémon (uno con dos tipos), 2 entrenadores."""
    return {
        "types": [{"id": "1", "name": "normal"}, {"id": "3", "name": "flying"}],
        "pokemon": [
            {"id": "16", "name": "pidgey", "height": "3", "weight": "18",
             "base_experience": "50", "sprite": "https://img/16.png"},
            {"id": "19", "name": "rattata", "height": "3", "weight": "35",
             "base_experience": "", "sprite": ""},
        ],
        "pokemon_types": [
            {"pokemon_id": "16", "type_id": "1", "slot": "1"},
            {"pokemon_id": "16", "type_id": "3", "slot": "2"},
            {"pokemon_id": "19", "type_id": "1", "slot": "1"},
        ],
        "trainers": [
            {"id": "1", "name": "Ash Ketchum", "region": "Kanto", "created_at": "2025-01-02"},
            {"id": "2", "name": "Misty Waterflower", "region": "Kanto", "created_at": "2025-03-04"},
        ],
        "captures": [
            {"id": "1", "trainer_id": "1", "pokemon_id": "16",
             "captured_at": "2025-11-01 02:22:00", "level": "12", "location": "Route 1"},
            {"id": "2", "trainer_id": "2", "pokemon_id": "19",
             "captured_at": "2025-12-05 10:00:00", "level": "50", "location": "Route 10"},
        ],
        "battles": [
            {"id": "1", "pokemon_a_id": "16", "pokemon_b_id": "19", "winner_id": "19",
             "fought_at": "2025-11-02 08:30:54", "duration_seconds": "120"},
        ],
    }


def write(data_dir: Path, tables: dict[str, list[dict[str, str]]]) -> Path:
    for table, rows in tables.items():
        with (data_dir / f"{table}.csv").open("w", newline="", encoding="utf-8") as file:
            writer = csv.DictWriter(file, fieldnames=list(rows[0]))
            writer.writeheader()
            writer.writerows(rows)
    return data_dir


def errors_for(data_dir: Path) -> list[str]:
    with pytest.raises(DataValidationError) as info:
        read_dataset(data_dir)
    return info.value.errors


def test_devuelve_filas_tipadas_en_el_orden_de_las_columnas(tmp_path):
    dataset = read_dataset(write(tmp_path, valid_tables()))

    assert list(dataset.rows) == list(LOAD_ORDER)
    assert dataset.rows["pokemon"] == [
        (16, "pidgey", 3, 18, 50, "https://img/16.png"),
        (19, "rattata", 3, 35, 0, None),  # base_experience vacío → 0; sprite vacío → NULL
    ]
    assert dataset.rows["trainers"][0] == (1, "Ash Ketchum", "Kanto", date(2025, 1, 2))
    assert dataset.rows["captures"][0][3] == datetime(2025, 11, 1, 2, 22)
    assert dataset.discarded == {}


def test_sprite_del_csv_se_carga_en_sprite_url():
    columns = TABLES["pokemon"]

    assert [c.name for c in columns][-1] == "sprite"
    assert [c.db_column for c in columns] == [
        "id", "name", "height", "weight", "base_experience", "sprite_url",
    ]


def test_ignora_columnas_extra(tmp_path):
    tables = valid_tables()
    for row in tables["types"]:
        row["generation"] = "1"

    assert read_dataset(write(tmp_path, tables)).rows["types"] == [(1, "normal"), (3, "flying")]


def test_falta_un_archivo(tmp_path):
    tables = valid_tables()
    del tables["captures"]

    assert errors_for(write(tmp_path, tables)) == [
        "falta captures.csv (lo escriben las tareas extract y generate del DAG)"
    ]


def test_falta_una_columna(tmp_path):
    tables = valid_tables()
    for row in tables["captures"]:
        del row["level"]

    assert errors_for(write(tmp_path, tables)) == ["captures.csv: faltan las columnas level"]


def test_archivo_sin_filas(tmp_path):
    write(tmp_path, valid_tables())
    (tmp_path / "battles.csv").write_text(
        "id,pokemon_a_id,pokemon_b_id,winner_id,fought_at,duration_seconds\n", encoding="utf-8"
    )

    assert errors_for(tmp_path) == ["battles.csv: no tiene filas"]


def test_valor_vacio_o_ilegible(tmp_path):
    tables = valid_tables()
    tables["captures"][0]["level"] = "doce"
    tables["captures"][1]["location"] = ""
    tables["trainers"][1]["created_at"] = "04/03/2025"

    assert errors_for(write(tmp_path, tables)) == [
        "trainers.csv línea 3: created_at='04/03/2025' no es una fecha AAAA-MM-DD",
        "captures.csv línea 2: level='doce' no es un entero",
        "captures.csv línea 3: location vacío",
    ]


@pytest.mark.parametrize(
    ("table", "column", "value", "error"),
    [
        ("captures", "id", "1", "captures.csv línea 3: id 1 repetido (ya está en la línea 2)"),
        ("types", "name", "normal", "types.csv línea 3: name 'normal' repetido (ya está en la línea 2)"),
    ],
)
def test_id_o_clave_unica_repetida(tmp_path, table, column, value, error):
    tables = valid_tables()
    tables[table][1][column] = value

    assert errors_for(write(tmp_path, tables)) == [error]


def test_pokemon_types_repetido_por_pokemon_y_tipo(tmp_path):
    tables = valid_tables()
    tables["pokemon_types"].append({"pokemon_id": "19", "type_id": "1", "slot": "2"})

    assert errors_for(write(tmp_path, tables)) == [
        "pokemon_types.csv línea 5: (pokemon_id, type_id) (19, 1) repetido (ya está en la línea 4)"
    ]


def test_referencias_que_no_existen(tmp_path):
    tables = valid_tables()
    tables["captures"][0]["pokemon_id"] = "999"
    tables["captures"][1]["trainer_id"] = "7"
    tables["pokemon_types"][2]["type_id"] = "4"

    assert errors_for(write(tmp_path, tables)) == [
        "pokemon_types.csv línea 4: type_id 4 no existe en types.csv",
        "captures.csv línea 3: trainer_id 7 no existe en trainers.csv",
        "captures.csv línea 2: pokemon_id 999 no existe en pokemon.csv",
    ]


def test_regla_rota_en_el_catalogo_es_error(tmp_path):
    tables = valid_tables()
    tables["pokemon"][0]["height"] = "0"
    tables["pokemon_types"][2]["slot"] = "2"  # rattata: slot 2 sin slot 1

    assert errors_for(write(tmp_path, tables)) == [
        "pokemon.csv línea 2: height debe ser > 0",
        "pokemon_types.csv línea 4: pokemon_id 19 tiene slot 2 sin slot 1",
    ]


def test_regla_rota_en_captures_o_battles_descarta_la_fila(tmp_path):
    tables = valid_tables()
    tables["captures"][1]["level"] = "0"
    tables["battles"].append(
        {"id": "2", "pokemon_a_id": "16", "pokemon_b_id": "19", "winner_id": "16",
         "fought_at": "2025-11-03 08:00:00", "duration_seconds": "-20"}
    )

    dataset = read_dataset(write(tmp_path, tables))

    assert [row[0] for row in dataset.rows["captures"]] == [1]
    assert [row[0] for row in dataset.rows["battles"]] == [1]
    assert dataset.discarded == {
        "captures": ["captures.csv línea 3: level debe estar entre 1 y 100"],
        "battles": ["battles.csv línea 3: duration_seconds debe ser >= 0"],
    }


def test_junta_todos_los_problemas_en_el_mensaje(tmp_path):
    tables = valid_tables()
    del tables["types"]
    tables["captures"][0]["id"] = "2"

    with pytest.raises(DataValidationError) as info:
        read_dataset(write(tmp_path, tables))

    # Sin types.csv no se cruzan sus referencias (evita un error por fila).
    assert str(info.value) == (
        "2 problema(s) en los CSV:\n"
        "- falta types.csv (lo escriben las tareas extract y generate del DAG)\n"
        "- captures.csv línea 3: id 2 repetido (ya está en la línea 2)"
    )


@pytest.mark.skipif(not (REPO_DATA / "pokemon.csv").is_file(), reason="sin data/ generada")
def test_los_csv_de_data_son_validos():
    dataset = read_dataset(REPO_DATA)

    assert all(dataset.rows[table] for table in LOAD_ORDER)
    # Lo único que se descarta son batallas con duración negativa (el generador
    # saca la duración de una normal).
    assert set(dataset.discarded) <= {"battles"}
    assert all("duration_seconds" in reason for reason in dataset.discarded.get("battles", []))
