import os
from pathlib import Path

import pytest

from pokemon_files import move_files_atomically, prune_runs, run_dir_name, write_files_atomically


def test_run_dir_name_es_seguro():
    assert run_dir_name("manual__2026-11-06T01:23:45.123+00:00") == (
        "manual__2026-11-06T01_23_45.123_00_00"
    )


def test_write_files_atomically_escribe_todos_sin_temporales(tmp_path):
    write_files_atomically(tmp_path / "run", {"a.csv": "x\r\n1\n", "b.csv": "y\n"})
    assert sorted(p.name for p in (tmp_path / "run").iterdir()) == ["a.csv", "b.csv"]
    assert (tmp_path / "run" / "a.csv").read_bytes() == b"x\r\n1\n"  # sin traducir saltos


def test_write_files_atomically_si_falla_no_toca_lo_anterior(tmp_path, monkeypatch):
    write_files_atomically(tmp_path, {"a.csv": "viejo\n", "b.csv": "viejo\n"})
    original = Path.write_text
    calls = []

    def failing_write(self, *args, **kwargs):
        calls.append(self.name)
        if len(calls) == 2:
            raise OSError("disco lleno")
        return original(self, *args, **kwargs)

    monkeypatch.setattr(Path, "write_text", failing_write)
    with pytest.raises(OSError, match="disco lleno"):
        write_files_atomically(tmp_path, {"a.csv": "nuevo\n", "b.csv": "nuevo\n"})
    assert sorted(p.name for p in tmp_path.iterdir()) == ["a.csv", "b.csv"]
    assert (tmp_path / "a.csv").read_text() == "viejo\n"


def test_move_files_atomically_no_mueve_nada_si_falta_alguno(tmp_path):
    source, target = tmp_path / "src", tmp_path / "dst"
    source.mkdir()
    target.mkdir()
    (source / "a.csv").write_text("a")
    with pytest.raises(FileNotFoundError, match="b.csv"):
        move_files_atomically(source, ["a.csv", "b.csv"], target)
    assert list(target.iterdir()) == []
    move_files_atomically(source, ["a.csv"], target)
    assert (target / "a.csv").read_text() == "a"


def test_prune_runs_deja_las_mas_recientes_y_la_actual(tmp_path):
    for i, name in enumerate(["r1", "r2", "r3", "r4", "actual"]):
        (tmp_path / name).mkdir()
        os.utime(tmp_path / name, (1000 + i, 1000 + i))
    os.utime(tmp_path / "actual", (1, 1))  # la actual es la más vieja y aun así se queda
    removed = prune_runs(tmp_path, keep=3, current="actual")
    assert sorted(removed) == ["r1", "r2"]
    assert sorted(p.name for p in tmp_path.iterdir()) == ["actual", "r3", "r4"]


def test_prune_runs_sin_carpeta(tmp_path):
    assert prune_runs(tmp_path / "no-existe", keep=5, current="x") == []
