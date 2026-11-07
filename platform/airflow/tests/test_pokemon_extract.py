import json
import threading
from contextlib import contextmanager
from datetime import datetime, timedelta, timezone
from email.utils import format_datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import pytest

from pokemon_extract import (
    HttpStatusError,
    UnexpectedTypeUrlError,
    dataset_files,
    fetch_pokemon,
    get_json,
    retry_delay,
    to_csv,
    to_dataset,
    type_id_from_url,
)


def api_pokemon(id_, name, types, base_experience=None):
    return {
        "id": id_,
        "name": name,
        "height": 1,
        "weight": 2,
        "base_experience": base_experience,
        "sprites": {"front_default": f"https://img/{id_}.png" if id_ % 2 else None},
        "types": [
            {"slot": i + 1, "type": {"name": t, "url": f"https://pokeapi.co/api/v2/type/{tid}/"}}
            for i, (t, tid) in enumerate(types)
        ],
    }


@contextmanager
def stub_server(script):
    """Servidor HTTP local: `script[path]` es la lista de respuestas (status, headers, body)
    que devuelve en orden a cada request a ese path. Anota los paths pedidos. Como la
    PokeAPI real, responde 403 al User-Agent por defecto de urllib."""
    requests = []
    lock = threading.Lock()

    class Handler(BaseHTTPRequestHandler):
        def do_GET(self):
            with lock:
                requests.append(self.path)
                queue = script.get(self.path, [])
                if self.headers.get("User-Agent", "").startswith("Python-urllib"):
                    status, headers, body = 403, {}, {"detail": "Forbidden"}
                elif queue:
                    status, headers, body = queue.pop(0)
                else:
                    status, headers, body = 404, {}, {"detail": "Not found."}
            payload = json.dumps(body).encode()
            self.send_response(status)
            for key, value in headers.items():
                self.send_header(key, value)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(payload)))
            self.end_headers()
            self.wfile.write(payload)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield f"http://127.0.0.1:{server.server_port}", requests
    finally:
        server.shutdown()
        server.server_close()


OK = (200, {}, api_pokemon(1, "bulbasaur", [("grass", 12)]))


def test_type_id_from_url():
    assert type_id_from_url("https://pokeapi.co/api/v2/type/12/") == 12
    assert type_id_from_url("https://pokeapi.co/api/v2/type/12") == 12
    with pytest.raises(UnexpectedTypeUrlError, match="URL de tipo inesperada"):
        type_id_from_url("https://pokeapi.co/api/v2/pokemon/1/")


def test_to_dataset_ordena_y_deduplica_tipos():
    dataset = to_dataset(
        [
            api_pokemon(4, "charmander", [("fire", 10)]),
            api_pokemon(1, "bulbasaur", [("grass", 12), ("poison", 4)]),
            api_pokemon(2, "ivysaur", [("grass", 12), ("poison", 4)]),
        ]
    )
    assert [p["id"] for p in dataset["pokemon"]] == [1, 2, 4]
    assert dataset["types"] == [
        {"id": 4, "name": "poison"},
        {"id": 10, "name": "fire"},
        {"id": 12, "name": "grass"},
    ]
    assert [(r["pokemon_id"], r["slot"]) for r in dataset["pokemon_types"]] == [
        (1, 1), (1, 2), (2, 1), (2, 2), (4, 1)
    ]


def test_csv_igual_al_de_ops():
    # Cabecera, \n al final de cada línea, None → celda vacía y comillas solo si hacen falta.
    assert to_csv(("id", "name", "sprite"), [{"id": 1, "name": "a,b", "sprite": None}]) == (
        'id,name,sprite\n1,"a,b",\n'
    )
    files = dataset_files(to_dataset([api_pokemon(1, "bulbasaur", [("grass", 12)], 64)]))
    assert files == {
        "pokemon.csv": "id,name,height,weight,base_experience,sprite\n"
        "1,bulbasaur,1,2,64,https://img/1.png\n",
        "types.csv": "id,name\n12,grass\n",
        "pokemon_types.csv": "pokemon_id,type_id,slot\n1,12,1\n",
    }


def test_tras_429_con_retry_after_0_reintenta_sin_sumar_el_backoff():
    sleeps = []
    with stub_server({"/x": [(429, {"Retry-After": "0"}, {}), OK]}) as (url, requests):
        assert get_json(f"{url}/x", sleep=sleeps.append)["name"] == "bulbasaur"
    assert sleeps == [0.0]
    assert requests == ["/x", "/x"]


def test_tras_503_espera_una_sola_vez_el_backoff():
    sleeps = []
    with stub_server({"/x": [(503, {}, {}), OK]}) as (url, _):
        get_json(f"{url}/x", sleep=sleeps.append)
    assert sleeps == [0.5]


def test_4_intentos_con_espera_creciente_y_sin_esperar_despues_del_ultimo():
    sleeps = []
    with stub_server({"/x": [(500, {}, {})] * 4}) as (url, requests):
        with pytest.raises(RuntimeError, match="falló tras 4 intentos"):
            get_json(f"{url}/x", sleep=sleeps.append)
    assert sleeps == [0.5, 1.0, 2.0]
    assert len(requests) == 4


def test_un_404_falla_al_tiro_sin_reintentar():
    sleeps = []
    with stub_server({}) as (url, requests):
        with pytest.raises(HttpStatusError, match="respondió HTTP 404"):
            get_json(f"{url}/x", sleep=sleeps.append)
    assert sleeps == []
    assert len(requests) == 1


def test_error_de_red_se_reintenta_con_backoff():
    with stub_server({}) as (url, _):
        pass  # el puerto queda libre: la conexión se rechaza
    sleeps = []
    with pytest.raises(RuntimeError, match="falló tras 4 intentos"):
        get_json(f"{url}/x", sleep=sleeps.append, timeout=2)
    assert sleeps == [0.5, 1.0, 2.0]


def test_retry_after_como_fecha_http():
    future = datetime.now(timezone.utc) + timedelta(seconds=30)
    assert 25 < retry_delay(0, format_datetime(future, usegmt=True)) <= 30
    past = datetime.now(timezone.utc) - timedelta(seconds=30)
    assert retry_delay(0, format_datetime(past, usegmt=True)) == 0
    assert retry_delay(2, "no-es-fecha") == 2.0


def test_fetch_pokemon_devuelve_en_orden_de_id():
    script = {
        f"/pokemon/{i}": [(200, {}, api_pokemon(i, f"p{i}", [("normal", 1)]))] for i in range(1, 6)
    }
    with stub_server(script) as (url, _):
        result = fetch_pokemon(5, base_url=url, concurrency=3)
    assert [p["id"] for p in result] == [1, 2, 3, 4, 5]


def test_fetch_pokemon_el_primer_error_corta_todo():
    script = {"/pokemon/1": [OK]}  # /pokemon/2 responde 404
    with stub_server(script) as (url, _):
        with pytest.raises(HttpStatusError, match="/pokemon/2 respondió HTTP 404"):
            fetch_pokemon(2, base_url=url, concurrency=1)
