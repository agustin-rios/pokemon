"""Extracción de la PokeAPI → pokemon.csv, types.csv, pokemon_types.csv.

Port del cliente de platform/ops (src/lib/pokeapi.ts): mismos reintentos y la misma
salida byte a byte que `pnpm ops data scrape`. Python puro (solo la librería
estándar): se testea sin Airflow.

Por request: timeout de 15 s y hasta 4 intentos. Se reintenta ante errores de red,
429 y 5xx, esperando una sola vez entre intentos (el Retry-After de la respuesta si
vino; si no, 0,5 s, 1 s y 2 s). Cualquier otro status falla al tiro con
HttpStatusError, que no tiene sentido reintentar.
"""

from __future__ import annotations

import csv
import io
import json
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from collections.abc import Callable
from concurrent.futures import FIRST_EXCEPTION, ThreadPoolExecutor, wait
from email.utils import parsedate_to_datetime
from typing import Any

API_BASE_URL = "https://pokeapi.co/api/v2"
MAX_POKEMON = 1025
TIMEOUT_S = 15
MAX_ATTEMPTS = 4
RETRY_BASE_DELAY_S = 0.5
CONCURRENCY = 8
# La PokeAPI (detrás de Cloudflare) responde 403 al User-Agent por defecto de urllib.
HEADERS = {"User-Agent": "pokemon-etl/1.0", "Accept": "application/json"}

POKEMON_COLUMNS = ("id", "name", "height", "weight", "base_experience", "sprite")
TYPE_COLUMNS = ("id", "name")
POKEMON_TYPE_COLUMNS = ("pokemon_id", "type_id", "slot")

Sleep = Callable[[float], None]


class HttpStatusError(Exception):
    """La PokeAPI respondió un status que no se reintenta (p. ej. 404)."""


class UnexpectedTypeUrlError(ValueError):
    """La URL de un tipo no termina en /type/{id}/."""


def type_id_from_url(url: str) -> int:
    match = re.search(r"/type/(\d+)/?$", urllib.parse.urlparse(url).path)
    if not match:
        raise UnexpectedTypeUrlError(f"URL de tipo inesperada: {url}")
    return int(match.group(1))


def to_dataset(api_pokemon: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    """Filas de los 3 CSV: pokemon por id, tipos sin repetir por id, y pokemon_types por (pokemon_id, slot)."""
    pokemon: dict[int, dict[str, Any]] = {}
    types: dict[int, dict[str, Any]] = {}
    pokemon_types: list[dict[str, Any]] = []
    for p in api_pokemon:
        pokemon[p["id"]] = {
            "id": p["id"],
            "name": p["name"],
            "height": p["height"],
            "weight": p["weight"],
            "base_experience": p["base_experience"],
            "sprite": p["sprites"]["front_default"],
        }
        for entry in p["types"]:
            type_id = type_id_from_url(entry["type"]["url"])
            types[type_id] = {"id": type_id, "name": entry["type"]["name"]}
            pokemon_types.append(
                {"pokemon_id": p["id"], "type_id": type_id, "slot": entry["slot"]}
            )
    return {
        "pokemon": sorted(pokemon.values(), key=lambda r: r["id"]),
        "types": sorted(types.values(), key=lambda r: r["id"]),
        "pokemon_types": sorted(pokemon_types, key=lambda r: (r["pokemon_id"], r["slot"])),
    }


def to_csv(columns: tuple[str, ...], rows: list[dict[str, Any]]) -> str:
    """Igual que toCsv de ops: cabecera, `\\n` al final de cada línea, None → celda vacía."""
    out = io.StringIO()
    writer = csv.writer(out, lineterminator="\n")
    writer.writerow(columns)
    for row in rows:
        writer.writerow(["" if row[c] is None else row[c] for c in columns])
    return out.getvalue()


def dataset_files(dataset: dict[str, list[dict[str, Any]]]) -> dict[str, str]:
    return {
        "pokemon.csv": to_csv(POKEMON_COLUMNS, dataset["pokemon"]),
        "types.csv": to_csv(TYPE_COLUMNS, dataset["types"]),
        "pokemon_types.csv": to_csv(POKEMON_TYPE_COLUMNS, dataset["pokemon_types"]),
    }


def retry_delay(attempt: int, retry_after: str | None) -> float:
    """Segundos a esperar tras el intento `attempt` (desde 0) que falló."""
    if retry_after:
        try:
            seconds = float(retry_after)
            if seconds >= 0:
                return seconds
        except ValueError:
            pass
        try:
            return max(0.0, parsedate_to_datetime(retry_after).timestamp() - time.time())
        except (TypeError, ValueError):
            pass
    return RETRY_BASE_DELAY_S * 2**attempt


def get_json(url: str, *, sleep: Sleep = time.sleep, timeout: float = TIMEOUT_S) -> Any:
    """GET con reintentos. La espera entre intentos se calcula al fallar y se cumple una sola vez."""
    last_error: Exception | None = None
    delay = 0.0
    for attempt in range(MAX_ATTEMPTS):
        if attempt > 0:
            sleep(delay)
        try:
            request = urllib.request.Request(url, headers=HEADERS)
            with urllib.request.urlopen(request, timeout=timeout) as response:
                return json.load(response)
        except urllib.error.HTTPError as error:
            if error.code != 429 and error.code < 500:
                raise HttpStatusError(f"GET {url} respondió HTTP {error.code}") from error
            last_error = error
            delay = retry_delay(attempt, error.headers.get("Retry-After"))
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            last_error = error
            delay = retry_delay(attempt, None)
    raise RuntimeError(f"GET {url} falló tras {MAX_ATTEMPTS} intentos") from last_error


def fetch_pokemon(
    limit: int,
    *,
    base_url: str = API_BASE_URL,
    concurrency: int = CONCURRENCY,
    sleep: Sleep = time.sleep,
) -> list[dict[str, Any]]:
    """Pokémon 1..limit en orden de id. El primer error corta el resto y es el que se lanza."""
    if not 0 <= limit <= MAX_POKEMON:
        raise ValueError(f"limit debe estar entre 0 y {MAX_POKEMON}")
    if concurrency < 1:
        raise ValueError("concurrency debe ser un entero positivo")
    results: list[Any] = [None] * limit
    stop = threading.Event()

    def fetch(index: int) -> None:
        if stop.is_set():
            return
        results[index] = get_json(f"{base_url}/pokemon/{index + 1}", sleep=sleep)

    with ThreadPoolExecutor(max_workers=min(concurrency, limit or 1)) as pool:
        futures = [pool.submit(fetch, i) for i in range(limit)]
        done, pending = wait(futures, return_when=FIRST_EXCEPTION)
        failed = next((f for f in futures if f.done() and f.exception()), None)
        if failed:
            stop.set()
            for future in pending:
                future.cancel()
            raise failed.exception()  # type: ignore[misc]
    return results
