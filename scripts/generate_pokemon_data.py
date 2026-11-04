"""
Genera datos sintéticos para el desafío fullstack Pokémon:
  trainers.csv, captures.csv, battles.csv

Solo usa la librería estándar. Semilla fija: dos corridas producen el mismo dataset.

Uso:
  python generate_pokemon_data.py --out ./data --pokemon 100
  python generate_pokemon_data.py --out ./data --pokemon-csv pokemon.csv

Si se pasa --pokemon-csv, toma los ids de la columna "id" de ese archivo.
Si no, usa ids 1..N (los primeros N de la Pokémon API).
"""

import argparse
import csv
import os
import random
from datetime import datetime, timedelta

SEED = 42

REGIONS = ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos"]
LOCATIONS = [
    "Viridian Forest", "Mt. Moon", "Cerulean Cave", "Safari Zone", "Route 1",
    "Route 10", "Lavender Town", "Seafoam Islands", "Victory Road", "Pallet Town",
    "Ilex Forest", "Petalburg Woods", "Eterna Forest", "Pinwheel Forest",
]
FIRST_NAMES = [
    "Ash", "Misty", "Brock", "Gary", "May", "Dawn", "Serena", "Clemont", "Iris",
    "Cilan", "Red", "Blue", "Leaf", "Ethan", "Lyra", "Brendan", "Lucas", "Hilda",
    "Nate", "Rosa", "Calem", "Elio", "Selene", "Gloria", "Victor", "Juliana",
]
LAST_NAMES = [
    "Ketchum", "Oak", "Waterflower", "Stone", "Berlitz", "Rowan", "Elm", "Birch",
    "Sycamore", "Kukui", "Magnolia", "Sada", "Turo", "Harrison", "Platt",
]


def month_weights(months):
    """Peso por mes con tendencia creciente y un par de picos (temporada)."""
    weights = []
    for i in range(months):
        base = 1.0 + i * 0.12          # tendencia al alza
        if i in (3, 9):                 # dos meses de evento
            base *= 1.8
        if i == 6:                      # un mes flojo
            base *= 0.6
        weights.append(base)
    return weights


def add_months(d, n):
    """Primer día del mes d + n meses, sin drift."""
    y, m = divmod(d.month - 1 + n, 12)
    return d.replace(year=d.year + y, month=m + 1, day=1)


def gen_trainers(n, start, rng):
    trainers = []
    region_weights = [5, 4, 3, 3, 2, 1]  # Kanto domina
    for i in range(1, n + 1):
        name = f"{rng.choice(FIRST_NAMES)} {rng.choice(LAST_NAMES)}"
        region = rng.choices(REGIONS, weights=region_weights)[0]
        created_at = start - timedelta(days=rng.randint(0, 400))
        trainers.append({
            "id": i,
            "name": name,
            "region": region,
            "created_at": created_at.date().isoformat(),
        })
    return trainers


def gen_captures(n, trainers, pokemon_ids, start, months, rng):
    # Actividad por entrenador sesgada: pocos muy activos, muchos ocasionales
    trainer_weights = [rng.paretovariate(1.5) for _ in trainers]
    # Popularidad por pokémon sesgada también
    pokemon_weights = [rng.paretovariate(2.0) for _ in pokemon_ids]
    mweights = month_weights(months)

    captures = []
    for i in range(1, n + 1):
        trainer = rng.choices(trainers, weights=trainer_weights)[0]
        pokemon_id = rng.choices(pokemon_ids, weights=pokemon_weights)[0]
        month_idx = rng.choices(range(months), weights=mweights)[0]
        month_start = add_months(start.replace(day=1), month_idx)
        captured_at = month_start + timedelta(
            days=rng.randint(0, 27), hours=rng.randint(0, 23), minutes=rng.randint(0, 59)
        )
        # Nivel sesgado hacia abajo, con cola larga
        level = min(100, max(1, int(rng.expovariate(1 / 25)) + 1))
        captures.append({
            "id": i,
            "trainer_id": trainer["id"],
            "pokemon_id": pokemon_id,
            "captured_at": captured_at.strftime("%Y-%m-%d %H:%M:%S"),
            "level": level,
            "location": rng.choice(LOCATIONS),
        })
    captures.sort(key=lambda c: c["captured_at"])
    for i, c in enumerate(captures, start=1):
        c["id"] = i
    return captures


def gen_battles(n, pokemon_ids, start, months, rng):
    battles = []
    end = start + timedelta(days=30 * months)
    span = int((end - start).total_seconds())
    for i in range(1, n + 1):
        a, b = rng.sample(pokemon_ids, 2)
        # Pokémon con id más alto gana un poco más seguido (correlación débil)
        p_a_wins = 0.5 + 0.2 * ((a - b) / max(pokemon_ids))
        winner = a if rng.random() < p_a_wins else b
        fought_at = start + timedelta(seconds=rng.randint(0, span))
        battles.append({
            "id": i,
            "pokemon_a_id": a,
            "pokemon_b_id": b,
            "winner_id": winner,
            "fought_at": fought_at.strftime("%Y-%m-%d %H:%M:%S"),
            "duration_seconds": int(rng.gauss(180, 60)) if rng.random() > 0.05 else int(rng.gauss(600, 120)),
        })
    battles.sort(key=lambda b: b["fought_at"])
    for i, b in enumerate(battles, start=1):
        b["id"] = i
    return battles


def write_csv(path, rows):
    with open(path, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def load_pokemon_ids(path):
    """Ids únicos y ordenados: el resultado no depende del orden del CSV."""
    with open(path, newline="", encoding="utf-8") as f:
        ids = sorted({int(r["id"]) for r in csv.DictReader(f)})
    if not ids:
        raise SystemExit(f"{path}: no ids found")
    return ids


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--out", default="./data")
    parser.add_argument("--pokemon", type=int, default=100, help="usar ids 1..N")
    parser.add_argument("--pokemon-csv", help="CSV con columna id (ignora --pokemon)")
    parser.add_argument("--trainers", type=int, default=50)
    parser.add_argument("--captures", type=int, default=5000)
    parser.add_argument("--battles", type=int, default=2000)
    parser.add_argument("--months", type=int, default=12)
    parser.add_argument("--start", default="2025-11-01", help="primer mes YYYY-MM-DD")
    args = parser.parse_args()

    rng = random.Random(SEED)
    start = datetime.strptime(args.start, "%Y-%m-%d")
    pokemon_ids = load_pokemon_ids(args.pokemon_csv) if args.pokemon_csv else list(range(1, args.pokemon + 1))

    trainers = gen_trainers(args.trainers, start, rng)
    captures = gen_captures(args.captures, trainers, pokemon_ids, start, args.months, rng)
    battles = gen_battles(args.battles, pokemon_ids, start, args.months, rng)

    os.makedirs(args.out, exist_ok=True)
    write_csv(os.path.join(args.out, "trainers.csv"), trainers)
    write_csv(os.path.join(args.out, "captures.csv"), captures)
    write_csv(os.path.join(args.out, "battles.csv"), battles)

    print(f"trainers: {len(trainers)}  captures: {len(captures)}  battles: {len(battles)}  -> {args.out}")


if __name__ == "__main__":
    main()
