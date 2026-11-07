"""Carpeta de cada corrida (data/runs/<run_id>/) y escritura atómica de los CSV.

Python puro: se testea sin Airflow. Cada corrida del DAG trabaja en su propia
carpeta, así que retomar una corrida (reintento o "clear" de la tarea fallida)
lee lo que dejaron sus propias tareas, nunca los CSV de otra corrida.
"""

from __future__ import annotations

import os
import re
import shutil
import uuid
from pathlib import Path


def run_dir_name(run_id: str) -> str:
    """Nombre de carpeta seguro para un run_id de Airflow (trae ':' y '+')."""
    return re.sub(r"[^A-Za-z0-9._-]", "_", run_id)


def write_files_atomically(directory: Path, files: dict[str, str]) -> None:
    """Escribe todos los archivos o ninguno: primero temporales ocultos en la misma
    carpeta y, solo si se escribieron todos, los renombra (rename es atómico)."""
    directory.mkdir(parents=True, exist_ok=True)
    tag = f"{os.getpid()}-{uuid.uuid4().hex[:8]}"
    written: list[tuple[Path, Path]] = []
    try:
        for name, content in files.items():
            temp = directory / f".{name}.{tag}.tmp"
            temp.write_text(content, encoding="utf-8", newline="")
            written.append((temp, directory / name))
        for temp, final in written:
            os.replace(temp, final)
    except BaseException:
        for temp, _ in written:
            temp.unlink(missing_ok=True)
        raise


def move_files_atomically(source: Path, names: list[str], directory: Path) -> None:
    """Mueve archivos ya escritos en `source` (misma partición) a `directory`.

    Si falta alguno no mueve ninguno, así `directory` nunca queda con una mezcla."""
    missing = [name for name in names if not (source / name).is_file()]
    if missing:
        raise FileNotFoundError(f"faltan en {source}: {', '.join(missing)}")
    for name in names:
        os.replace(source / name, directory / name)


def prune_runs(runs_dir: Path, keep: int, current: str) -> list[str]:
    """Borra las carpetas de corridas más viejas: deja las `keep` más recientes
    (por fecha de modificación) y siempre la actual. Devuelve las borradas."""
    if not runs_dir.is_dir():
        return []
    others = sorted(
        (d for d in runs_dir.iterdir() if d.is_dir() and d.name != current),
        key=lambda d: d.stat().st_mtime,
        reverse=True,
    )
    removed = others[max(keep - 1, 0):]
    for directory in removed:
        shutil.rmtree(directory, ignore_errors=True)
    return [d.name for d in removed]
