//! Los CSV de `tests/fixtures` son solo datos de referencia de los tests (la salida del
//! script de Python y el catálogo de la PokeAPI): el código de producción no lee ni
//! escribe CSV. Este módulo los lee y escribe con el mismo formato para compararlos.
#![allow(dead_code, clippy::unwrap_used)]

use std::fs;
use std::path::PathBuf;

use pokemon_data::dataset::{PokemonRow, PokemonTypeRow, TypeRow};
use pokemon_data::generator::{Battle, Capture, Trainer};

const TIMESTAMP_FORMAT: &str = "%Y-%m-%d %H:%M:%S";

/// Contenido de `tests/fixtures/<set>/<file>`.
pub fn fixture(set: &str, file: &str) -> String {
    let path = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("tests/fixtures")
        .join(set)
        .join(file);
    fs::read_to_string(path).unwrap()
}

/// Filas de un CSV de referencia como celdas por nombre de columna. Los archivos de
/// referencia no tienen comillas ni comas dentro de las celdas.
pub fn read_rows(set: &str, file: &str) -> Vec<std::collections::HashMap<String, String>> {
    let content = fixture(set, file);
    let mut lines = content.lines();
    let columns: Vec<&str> = lines.next().unwrap().split(',').collect();
    lines
        .map(|line| {
            line.split(',')
                .enumerate()
                .map(|(i, cell)| (columns[i].to_owned(), cell.to_owned()))
                .collect()
        })
        .collect()
}

fn csv(columns: &[&str], rows: impl IntoIterator<Item = Vec<String>>) -> String {
    let mut out = format!("{}\n", columns.join(","));
    for row in rows {
        out.push_str(&row.join(","));
        out.push('\n');
    }
    out
}

pub fn trainers_csv(rows: &[Trainer]) -> String {
    csv(
        &["id", "name", "region", "created_at"],
        rows.iter().map(|r| {
            vec![
                r.id.to_string(),
                r.name.clone(),
                r.region.to_owned(),
                r.created_at.format("%Y-%m-%d").to_string(),
            ]
        }),
    )
}

pub fn captures_csv(rows: &[Capture]) -> String {
    csv(
        &[
            "id",
            "trainer_id",
            "pokemon_id",
            "captured_at",
            "level",
            "location",
        ],
        rows.iter().map(|r| {
            vec![
                r.id.to_string(),
                r.trainer_id.to_string(),
                r.pokemon_id.to_string(),
                r.captured_at.format(TIMESTAMP_FORMAT).to_string(),
                r.level.to_string(),
                r.location.to_owned(),
            ]
        }),
    )
}

pub fn battles_csv(rows: &[Battle]) -> String {
    csv(
        &[
            "id",
            "pokemon_a_id",
            "pokemon_b_id",
            "winner_id",
            "fought_at",
            "duration_seconds",
        ],
        rows.iter().map(|r| {
            vec![
                r.id.to_string(),
                r.pokemon_a_id.to_string(),
                r.pokemon_b_id.to_string(),
                r.winner_id.to_string(),
                r.fought_at.format(TIMESTAMP_FORMAT).to_string(),
                r.duration_seconds.to_string(),
            ]
        }),
    )
}

pub fn pokemon_csv(rows: &[PokemonRow]) -> String {
    csv(
        &[
            "id",
            "name",
            "height",
            "weight",
            "base_experience",
            "sprite",
        ],
        rows.iter().map(|r| {
            vec![
                r.id.to_string(),
                r.name.clone(),
                r.height.to_string(),
                r.weight.to_string(),
                r.base_experience.map(|v| v.to_string()).unwrap_or_default(),
                r.sprite.clone().unwrap_or_default(),
            ]
        }),
    )
}

pub fn types_csv(rows: &[TypeRow]) -> String {
    csv(
        &["id", "name"],
        rows.iter().map(|r| vec![r.id.to_string(), r.name.clone()]),
    )
}

pub fn pokemon_types_csv(rows: &[PokemonTypeRow]) -> String {
    csv(
        &["pokemon_id", "type_id", "slot"],
        rows.iter().map(|r| {
            vec![
                r.pokemon_id.to_string(),
                r.type_id.to_string(),
                r.slot.to_string(),
            ]
        }),
    )
}
