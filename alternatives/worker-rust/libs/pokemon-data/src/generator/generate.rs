use chrono::{Datelike, Duration, NaiveDate, NaiveDateTime};

use super::data::{FIRST_NAMES, LAST_NAMES, LOCATIONS, REGION_WEIGHTS, REGIONS};
use super::error::GeneratorError;
use super::options::GeneratorOptions;
use super::records::{Battle, Capture, Generated, Trainer};
use crate::rng::{PythonRandom, cumulative};

/// Semilla fija: dos corridas producen el mismo dataset.
pub const SEED: u64 = 42;

/// Genera entrenadores, capturas y combates sobre los `pokemon_ids` dados (únicos y
/// ordenados: el resultado depende del orden).
pub fn generate(
    pokemon_ids: &[i32],
    options: &GeneratorOptions,
) -> Result<Generated, GeneratorError> {
    let mut rng = PythonRandom::new(SEED);
    let start = options.start.and_time(chrono::NaiveTime::MIN);

    let trainers = gen_trainers(options.trainers, start, &mut rng)?;
    let captures = gen_captures(
        options.captures,
        &trainers,
        pokemon_ids,
        start,
        options.months,
        &mut rng,
    )?;
    let battles = gen_battles(
        options.battles,
        pokemon_ids,
        start,
        options.months,
        &mut rng,
    )?;
    Ok(Generated {
        trainers,
        captures,
        battles,
    })
}

/// Peso por mes con tendencia creciente y un par de picos (temporada).
fn month_weights(months: u32) -> Vec<f64> {
    (0..months)
        .map(|i| {
            let mut base = 1.0 + f64::from(i) * 0.12;
            if i == 3 || i == 9 {
                base *= 1.8;
            }
            if i == 6 {
                base *= 0.6;
            }
            base
        })
        .collect()
}

/// Primer día del mes de `date` más `n` meses, sin deriva.
fn add_months(date: NaiveDateTime, n: u32) -> Result<NaiveDateTime, GeneratorError> {
    let total = date.month0() + n;
    let year = i32::try_from(total / 12)
        .ok()
        .and_then(|years| date.year().checked_add(years))
        .ok_or(GeneratorError::DateOutOfRange)?;
    NaiveDate::from_ymd_opt(year, total % 12 + 1, 1)
        .map(|d| d.and_time(date.time()))
        .filter(in_python_range)
        .ok_or(GeneratorError::DateOutOfRange)
}

/// `datetime` de Python solo llega hasta el año 9999 (y desde el 1).
fn in_python_range(date: &NaiveDateTime) -> bool {
    (1..=9999).contains(&date.year())
}

fn shift(date: NaiveDateTime, delta: Duration) -> Result<NaiveDateTime, GeneratorError> {
    date.checked_add_signed(delta)
        .filter(in_python_range)
        .ok_or(GeneratorError::DateOutOfRange)
}

fn gen_trainers(
    n: u32,
    start: NaiveDateTime,
    rng: &mut PythonRandom,
) -> Result<Vec<Trainer>, GeneratorError> {
    let region_cum = cumulative(&REGION_WEIGHTS)?;
    let mut trainers = Vec::with_capacity(n as usize);
    for i in 1..=n {
        let first = FIRST_NAMES[rng.choice_index(FIRST_NAMES.len())?];
        let last = LAST_NAMES[rng.choice_index(LAST_NAMES.len())?];
        let region = REGIONS[rng.choice_cumulative(&region_cum)];
        let created_at = shift(start, Duration::days(-rng.randint(0, 400)?))?.date();
        trainers.push(Trainer {
            id: id(i)?,
            name: format!("{first} {last}"),
            region,
            created_at,
        });
    }
    Ok(trainers)
}

fn gen_captures(
    n: u32,
    trainers: &[Trainer],
    pokemon_ids: &[i32],
    start: NaiveDateTime,
    months: u32,
    rng: &mut PythonRandom,
) -> Result<Vec<Capture>, GeneratorError> {
    if n == 0 {
        return Ok(Vec::new());
    }
    if trainers.is_empty() {
        return Err(GeneratorError::NoTrainers);
    }
    if pokemon_ids.is_empty() {
        return Err(GeneratorError::NoPokemon);
    }
    if months == 0 {
        return Err(GeneratorError::NoMonths);
    }
    // Actividad por entrenador sesgada (pocos muy activos) y popularidad por Pokémon
    // también; se sortean en este orden y antes de las capturas.
    let trainer_cum = cumulative(
        &(0..trainers.len())
            .map(|_| rng.paretovariate(1.5))
            .collect::<Vec<_>>(),
    )?;
    let pokemon_cum = cumulative(
        &(0..pokemon_ids.len())
            .map(|_| rng.paretovariate(2.0))
            .collect::<Vec<_>>(),
    )?;
    let month_cum = cumulative(&month_weights(months))?;
    let first_of_month = start.with_day(1).ok_or(GeneratorError::DateOutOfRange)?;

    let mut captures = Vec::with_capacity(n as usize);
    for _ in 0..n {
        let trainer = &trainers[rng.choice_cumulative(&trainer_cum)];
        let pokemon_id = pokemon_ids[rng.choice_cumulative(&pokemon_cum)];
        let month_idx = rng.choice_cumulative(&month_cum);
        let month_start = add_months(
            first_of_month,
            u32::try_from(month_idx).map_err(|_| GeneratorError::DateOutOfRange)?,
        )?;
        let days = rng.randint(0, 27)?;
        let hours = rng.randint(0, 23)?;
        let minutes = rng.randint(0, 59)?;
        let captured_at = shift(
            month_start,
            Duration::days(days) + Duration::hours(hours) + Duration::minutes(minutes),
        )?;
        // Nivel sesgado hacia abajo, con cola larga.
        let level = (rng.expovariate(1.0 / 25.0) as i64 + 1).clamp(1, 100) as i32;
        let location = LOCATIONS[rng.choice_index(LOCATIONS.len())?];
        captures.push(Capture {
            id: 0,
            trainer_id: trainer.id,
            pokemon_id,
            captured_at,
            level,
            location,
        });
    }
    // El orden estable por fecha formateada (ancho fijo) equivale a ordenar por fecha.
    captures.sort_by_key(|c| c.captured_at);
    for (i, capture) in (1..).zip(captures.iter_mut()) {
        capture.id = i;
    }
    Ok(captures)
}

fn gen_battles(
    n: u32,
    pokemon_ids: &[i32],
    start: NaiveDateTime,
    months: u32,
    rng: &mut PythonRandom,
) -> Result<Vec<Battle>, GeneratorError> {
    if n == 0 {
        return Ok(Vec::new());
    }
    let Some(max_id) = pokemon_ids
        .iter()
        .copied()
        .max()
        .filter(|_| pokemon_ids.len() >= 2)
    else {
        return Err(GeneratorError::NotEnoughPokemon);
    };
    let span = i64::from(months) * 30 * 86_400;
    // Python calcula `end` aunque solo use el tramo: falla si se sale del rango.
    shift(start, Duration::seconds(span))?;

    let mut battles = Vec::with_capacity(n as usize);
    for _ in 0..n {
        let picked = rng.sample_indices(pokemon_ids.len(), 2)?;
        let (a, b) = (pokemon_ids[picked[0]], pokemon_ids[picked[1]]);
        // El Pokémon con id más alto gana un poco más seguido (correlación débil).
        let p_a_wins = 0.5 + 0.2 * (f64::from(a - b) / f64::from(max_id));
        let winner_id = if rng.random() < p_a_wins { a } else { b };
        let fought_at = shift(start, Duration::seconds(rng.randint(0, span)?))?;
        // La condición se sortea ANTES que el gauss; `gauss_next` se comparte.
        let duration_seconds = if rng.random() > 0.05 {
            rng.gauss(180.0, 60.0)
        } else {
            rng.gauss(600.0, 120.0)
        } as i32;
        battles.push(Battle {
            id: 0,
            pokemon_a_id: a,
            pokemon_b_id: b,
            winner_id,
            fought_at,
            duration_seconds,
        });
    }
    battles.sort_by_key(|b| b.fought_at);
    for (i, battle) in (1..).zip(battles.iter_mut()) {
        battle.id = i;
    }
    Ok(battles)
}

fn id(i: u32) -> Result<i32, GeneratorError> {
    i32::try_from(i).map_err(|_| GeneratorError::TooManyRows)
}
