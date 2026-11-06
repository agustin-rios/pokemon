//! Validación de las filas de `staging` antes de cargarlas. Es la misma que hacía el DAG
//! de Airflow del proyecto principal con los CSV, ahora sobre filas.
//!
//! - Error (la corrida falla y las tablas finales no se tocan): una tabla sin filas; un
//!   valor que falta o está en blanco; una clave repetida; una referencia a un id que no
//!   existe; una regla rota en el catálogo.
//! - Fila descartada (se informa y la corrida sigue): una regla rota en captures o
//!   battles. Ninguna tabla las referencia, así que sacar la fila no rompe nada.

use std::collections::{BTreeMap, HashMap, HashSet};

use super::battle_record::BattleRecord;
use super::capture_record::CaptureRecord;
use super::data_validation_error::DataValidationError;
use super::staging_dataset::StagingDataset;
use super::table_row::{Key, TableRow};
use super::validation_report::ValidationReport;

fn check_not_empty<R: TableRow>(rows: &[R], errors: &mut Vec<String>) {
    if rows.is_empty() {
        errors.push(format!("{}: no tiene filas", R::TABLE));
    }
}

/// Valores que faltan o están en blanco. Devuelve las filas completas, que son las que
/// siguen en las demás comprobaciones.
fn check_required<R: TableRow + Clone>(rows: &[R], errors: &mut Vec<String>) -> Vec<R> {
    rows.iter()
        .filter(|row| match row.missing_column() {
            Some(column) => {
                errors.push(format!("{}: {column} vacío", row.label()));
                false
            }
            None => true,
        })
        .cloned()
        .collect()
}

fn format_key(columns: &[&str], values: &[Key]) -> String {
    let shown: Vec<String> = values.iter().map(Key::display).collect();
    match columns {
        [column] => format!("{column} {}", shown[0]),
        _ => format!("({}) ({})", columns.join(", "), shown.join(", ")),
    }
}

fn check_unique<R: TableRow>(rows: &[R], errors: &mut Vec<String>) {
    for key in R::unique_keys() {
        let mut counts: HashMap<Vec<Key>, usize> = HashMap::new();
        let mut first_seen = Vec::new();
        for value in rows.iter().filter_map(|row| (key.extract)(row)) {
            match counts.get_mut(&value) {
                Some(n) => *n += 1,
                None => {
                    counts.insert(value.clone(), 1);
                    first_seen.push(value);
                }
            }
        }
        for value in first_seen {
            let n = counts[&value];
            if n > 1 {
                errors.push(format!(
                    "{}: {} repetido ({n} veces)",
                    R::TABLE,
                    format_key(key.columns, &value)
                ));
            }
        }
    }
}

/// Referencia `table.column → referenced.id`.
fn check_foreign_key<R: TableRow>(
    rows: &[R],
    column: &str,
    referenced: &str,
    referenced_ids: &HashSet<i32>,
    value: fn(&R) -> Option<i32>,
    errors: &mut Vec<String>,
) {
    for row in rows {
        if let Some(v) = value(row)
            && !referenced_ids.contains(&v)
        {
            errors.push(format!(
                "{}: {column} {v} no existe en {referenced}",
                row.label()
            ));
        }
    }
}

/// Reglas por fila: `(id, "{label}: {motivos}")` de cada fila que rompe alguna.
fn check_rules<R: TableRow>(rows: &[R]) -> Vec<(Option<i32>, String)> {
    rows.iter()
        .filter_map(|row| {
            let broken = row.violations();
            (!broken.is_empty())
                .then(|| (row.id(), format!("{}: {}", row.label(), broken.join("; "))))
        })
        .collect()
}

fn ids<R: TableRow>(rows: &[R]) -> HashSet<i32> {
    rows.iter().filter_map(TableRow::id).collect()
}

/// Valida las 6 tablas de `staging`. Falla con todos los problemas encontrados.
///
/// # Errors
///
/// [`DataValidationError`] con cada problema, en el orden: tablas vacías, valores que
/// faltan, claves repetidas, referencias, reglas y orden de slots.
pub fn validate_dataset(dataset: &StagingDataset) -> Result<ValidationReport, DataValidationError> {
    let mut errors = Vec::new();
    check_not_empty(&dataset.types, &mut errors);
    check_not_empty(&dataset.pokemon, &mut errors);
    check_not_empty(&dataset.pokemon_types, &mut errors);
    check_not_empty(&dataset.trainers, &mut errors);
    check_not_empty(&dataset.captures, &mut errors);
    check_not_empty(&dataset.battles, &mut errors);

    let types = check_required(&dataset.types, &mut errors);
    let pokemon = check_required(&dataset.pokemon, &mut errors);
    let pokemon_types = check_required(&dataset.pokemon_types, &mut errors);
    let trainers = check_required(&dataset.trainers, &mut errors);
    let captures = check_required(&dataset.captures, &mut errors);
    let battles = check_required(&dataset.battles, &mut errors);

    check_unique(&types, &mut errors);
    check_unique(&pokemon, &mut errors);
    check_unique(&pokemon_types, &mut errors);
    check_unique(&trainers, &mut errors);
    check_unique(&captures, &mut errors);
    check_unique(&battles, &mut errors);

    let type_ids = ids(&types);
    let pokemon_ids = ids(&pokemon);
    let trainer_ids = ids(&trainers);
    check_foreign_key(
        &pokemon_types,
        "pokemon_id",
        "pokemon",
        &pokemon_ids,
        |r| r.pokemon_id,
        &mut errors,
    );
    check_foreign_key(
        &pokemon_types,
        "type_id",
        "types",
        &type_ids,
        |r| r.type_id,
        &mut errors,
    );
    check_foreign_key(
        &captures,
        "trainer_id",
        "trainers",
        &trainer_ids,
        |r| r.trainer_id,
        &mut errors,
    );
    check_foreign_key(
        &captures,
        "pokemon_id",
        "pokemon",
        &pokemon_ids,
        |r| r.pokemon_id,
        &mut errors,
    );
    check_foreign_key(
        &battles,
        "pokemon_a_id",
        "pokemon",
        &pokemon_ids,
        |r| r.pokemon_a_id,
        &mut errors,
    );
    check_foreign_key(
        &battles,
        "pokemon_b_id",
        "pokemon",
        &pokemon_ids,
        |r| r.pokemon_b_id,
        &mut errors,
    );
    check_foreign_key(
        &battles,
        "winner_id",
        "pokemon",
        &pokemon_ids,
        |r| r.winner_id,
        &mut errors,
    );

    errors.extend(check_rules(&pokemon).into_iter().map(|(_, text)| text));
    errors.extend(
        check_rules(&pokemon_types)
            .into_iter()
            .map(|(_, text)| text),
    );
    let discarded_captures = check_rules(&captures);
    let discarded_battles = check_rules(&battles);

    // El slot 2 exige que el mismo Pokémon tenga slot 1 (constraint trigger en la base).
    let first_slots: HashSet<i32> = pokemon_types
        .iter()
        .filter(|r| r.slot == Some(1))
        .filter_map(|r| r.pokemon_id)
        .collect();
    for row in &pokemon_types {
        if let (Some(pokemon_id), Some(2)) = (row.pokemon_id, row.slot)
            && !first_slots.contains(&pokemon_id)
        {
            errors.push(format!(
                "{}: el Pokémon {pokemon_id} tiene slot 2 sin slot 1",
                row.label()
            ));
        }
    }

    if !errors.is_empty() {
        return Err(DataValidationError { errors });
    }

    let mut report = ValidationReport {
        counts: BTreeMap::from([
            ("types", types.len()),
            ("pokemon", pokemon.len()),
            ("pokemon_types", pokemon_types.len()),
            ("trainers", trainers.len()),
            ("captures", captures.len() - discarded_captures.len()),
            ("battles", battles.len() - discarded_battles.len()),
        ]),
        discarded: BTreeMap::new(),
        discarded_captures: discarded_captures
            .iter()
            .filter_map(|(id, _)| *id)
            .collect(),
        discarded_battles: discarded_battles.iter().filter_map(|(id, _)| *id).collect(),
    };
    for (table, discarded) in [
        (CaptureRecord::TABLE, discarded_captures),
        (BattleRecord::TABLE, discarded_battles),
    ] {
        if !discarded.is_empty() {
            report
                .discarded
                .insert(table, discarded.into_iter().map(|(_, text)| text).collect());
        }
    }
    Ok(report)
}
