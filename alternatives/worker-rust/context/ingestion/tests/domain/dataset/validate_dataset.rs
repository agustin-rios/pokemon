//! Validación de las filas de `staging`: port de los casos semánticos de la validación
//! de CSV del DAG original, ahora sobre filas, más el dataset de referencia.

use crate::support::{reference_dataset, valid_dataset};
use chrono::NaiveDateTime;
use pokemon_context_ingestion::domain::{
    BattleRecord, DataValidationError, PokemonTypeRecord, StagingDataset, ValidationReport,
    validate_dataset,
};

fn errors_for(dataset: &StagingDataset) -> Vec<String> {
    validate_dataset(dataset).unwrap_err().errors
}

fn ok(dataset: &StagingDataset) -> ValidationReport {
    validate_dataset(dataset).unwrap()
}

fn at(text: &str) -> Option<NaiveDateTime> {
    NaiveDateTime::parse_from_str(text, "%Y-%m-%d %H:%M:%S").ok()
}

fn battle(id: i32, a: i32, b: i32, winner: i32, duration: i32) -> BattleRecord {
    BattleRecord {
        id: Some(id),
        pokemon_a_id: Some(a),
        pokemon_b_id: Some(b),
        winner_id: Some(winner),
        fought_at: at("2025-11-03 08:00:00"),
        duration_seconds: Some(duration),
    }
}

#[test]
fn the_minimal_dataset_is_valid() {
    let report = ok(&valid_dataset());

    assert_eq!(report.counts["types"], 2);
    assert_eq!(report.counts["pokemon"], 2);
    assert_eq!(report.counts["pokemon_types"], 3);
    assert_eq!(report.counts["trainers"], 2);
    assert_eq!(report.counts["captures"], 2);
    assert_eq!(report.counts["battles"], 1);
    assert!(report.discarded.is_empty());
    assert!(report.discarded_captures.is_empty() && report.discarded_battles.is_empty());
}

#[test]
fn a_null_base_experience_and_sprite_are_valid() {
    // rattata (segundo Pokémon) los trae NULL.
    let dataset = valid_dataset();
    assert_eq!(dataset.pokemon[1].base_experience, None);
    assert_eq!(dataset.pokemon[1].sprite_url, None);

    assert!(validate_dataset(&dataset).is_ok());
}

// --- Tablas vacías y valores que faltan ------------------------------------------------

#[test]
fn table_without_rows() {
    let mut dataset = valid_dataset();
    dataset.battles.clear();

    assert_eq!(errors_for(&dataset), ["battles: no tiene filas"]);
}

#[test]
fn empty_tables_are_reported_first_in_load_order() {
    let error = validate_dataset(&StagingDataset::default()).unwrap_err();

    assert_eq!(
        error.errors,
        [
            "types: no tiene filas",
            "pokemon: no tiene filas",
            "pokemon_types: no tiene filas",
            "trainers: no tiene filas",
            "captures: no tiene filas",
            "battles: no tiene filas",
        ]
    );
}

#[test]
fn null_or_blank_values_are_reported_per_row_with_the_first_failing_column() {
    let mut dataset = valid_dataset();
    dataset.captures[0].level = None;
    dataset.captures[1].location = Some(" \t\u{a0}\u{3000}".into());
    dataset.trainers[1].created_at = None;
    // Dos columnas fallan: solo se informa la primera, en el orden de la tabla.
    dataset.trainers[0].region = Some(String::new());
    dataset.trainers[0].name = None;

    assert_eq!(
        errors_for(&dataset),
        [
            "trainers id 1: name vacío",
            "trainers id 2: created_at vacío",
            "captures id 1: level vacío",
            "captures id 2: location vacío",
        ]
    );
}

#[test]
fn a_null_key_names_the_row_with_null() {
    let mut dataset = valid_dataset();
    dataset.types[0].id = None;
    dataset.pokemon_types[2].type_id = None;

    assert_eq!(
        errors_for(&dataset),
        [
            "types id NULL: id vacío",
            "pokemon_types (19, NULL): type_id vacío",
            // Las filas sin valores no cuentan como referenciables.
            "pokemon_types (16, 1): type_id 1 no existe en types",
        ]
    );
}

#[test]
fn pokemon_base_experience_and_sprite_may_be_null_but_not_the_rest() {
    let mut dataset = valid_dataset();
    dataset.pokemon[0].height = None;
    dataset.pokemon[1].weight = None;

    assert_eq!(
        errors_for(&dataset),
        [
            "pokemon id 16: height vacío",
            "pokemon id 19: weight vacío",
            "pokemon_types (16, 1): pokemon_id 16 no existe en pokemon",
            "pokemon_types (16, 3): pokemon_id 16 no existe en pokemon",
            "pokemon_types (19, 1): pokemon_id 19 no existe en pokemon",
            "captures id 1: pokemon_id 16 no existe en pokemon",
            "captures id 2: pokemon_id 19 no existe en pokemon",
            "battles id 1: pokemon_a_id 16 no existe en pokemon",
            "battles id 1: pokemon_b_id 19 no existe en pokemon",
            "battles id 1: winner_id 19 no existe en pokemon",
        ]
    );
}

#[test]
fn blank_follows_the_unicode_white_space_property() {
    let mut dataset = valid_dataset();
    dataset.types[0].name = Some("\u{2003}".into()); // espacio EM
    dataset.types[1].name = Some("\u{200b}".into()); // espacio de ancho cero: no es White_Space

    assert_eq!(
        errors_for(&dataset),
        [
            "types id 1: name vacío",
            "pokemon_types (16, 1): type_id 1 no existe en types",
            "pokemon_types (19, 1): type_id 1 no existe en types",
        ]
    );
}

// --- Claves únicas -------------------------------------------------------------------

#[test]
fn repeated_id_or_unique_key() {
    let mut dataset = valid_dataset();
    dataset.captures[1].id = Some(1);
    assert_eq!(errors_for(&dataset), ["captures: id 1 repetido (2 veces)"]);

    let mut dataset = valid_dataset();
    dataset.types[1].name = Some("normal".into());
    assert_eq!(
        errors_for(&dataset),
        ["types: name \"normal\" repetido (2 veces)"]
    );
}

#[test]
fn repeated_text_values_are_written_with_json_escapes() {
    let mut dataset = valid_dataset();
    dataset.types[0].name = Some("a\"b\n".into());
    dataset.types[1].name = Some("a\"b\n".into());

    assert_eq!(
        errors_for(&dataset),
        ["types: name \"a\\\"b\\n\" repetido (2 veces)"]
    );
}

#[test]
fn pokemon_types_repeated_by_pokemon_and_type() {
    let mut dataset = valid_dataset();
    dataset.pokemon_types.push(PokemonTypeRecord {
        pokemon_id: Some(19),
        type_id: Some(1),
        slot: Some(2),
    });

    assert_eq!(
        errors_for(&dataset),
        ["pokemon_types: (pokemon_id, type_id) (19, 1) repetido (2 veces)"]
    );
}

#[test]
fn pokemon_types_repeated_by_pokemon_and_slot() {
    let mut dataset = valid_dataset();
    dataset.pokemon_types.push(PokemonTypeRecord {
        pokemon_id: Some(19),
        type_id: Some(3),
        slot: Some(1),
    });

    assert_eq!(
        errors_for(&dataset),
        ["pokemon_types: (pokemon_id, slot) (19, 1) repetido (2 veces)"]
    );
}

#[test]
fn repeated_values_are_reported_once_each_in_first_appearance_order() {
    let mut dataset = valid_dataset();
    for _ in 0..2 {
        dataset.trainers.push(dataset.trainers[1].clone());
    }
    dataset.trainers.push(dataset.trainers[0].clone());

    assert_eq!(
        errors_for(&dataset),
        [
            "trainers: id 1 repetido (2 veces)",
            "trainers: id 2 repetido (3 veces)",
        ]
    );
}

// --- Referencias -------------------------------------------------------------------

#[test]
fn references_that_do_not_exist() {
    let mut dataset = valid_dataset();
    dataset.captures[0].pokemon_id = Some(999);
    dataset.captures[1].trainer_id = Some(7);
    dataset.pokemon_types[2].type_id = Some(4);

    assert_eq!(
        errors_for(&dataset),
        [
            "pokemon_types (19, 4): type_id 4 no existe en types",
            "captures id 2: trainer_id 7 no existe en trainers",
            "captures id 1: pokemon_id 999 no existe en pokemon",
        ]
    );
}

#[test]
fn a_reference_to_an_empty_table_fails_for_every_row() {
    let mut dataset = valid_dataset();
    dataset.trainers.clear();

    assert_eq!(
        errors_for(&dataset),
        [
            "trainers: no tiene filas",
            "captures id 1: trainer_id 1 no existe en trainers",
            "captures id 2: trainer_id 2 no existe en trainers",
        ]
    );
}

// --- Reglas ---------------------------------------------------------------------------

#[test]
fn broken_rule_in_the_catalog_is_an_error() {
    let mut dataset = valid_dataset();
    dataset.pokemon[0].height = Some(0);
    dataset.pokemon[1].weight = Some(-1);
    dataset.pokemon[1].base_experience = Some(-5);
    dataset.pokemon_types[0].slot = Some(3);

    assert_eq!(
        errors_for(&dataset),
        [
            "pokemon id 16: height debe ser > 0",
            "pokemon id 19: weight debe ser > 0; base_experience debe ser >= 0",
            "pokemon_types (16, 1): slot debe ser 1 o 2",
            "pokemon_types (16, 3): el Pokémon 16 tiene slot 2 sin slot 1",
        ]
    );
}

#[test]
fn slot_2_without_slot_1_is_an_error_and_comes_last() {
    let mut dataset = valid_dataset();
    dataset.pokemon[0].height = Some(0);
    dataset.pokemon_types[2].slot = Some(2); // rattata: slot 2 sin slot 1

    assert_eq!(
        errors_for(&dataset),
        [
            "pokemon id 16: height debe ser > 0",
            "pokemon_types (19, 1): el Pokémon 19 tiene slot 2 sin slot 1",
        ]
    );
}

#[test]
fn broken_rule_in_captures_or_battles_discards_the_row() {
    let mut dataset = valid_dataset();
    dataset.captures[1].level = Some(0);
    dataset.battles.push(battle(2, 16, 19, 16, -20));

    let report = ok(&dataset);

    assert_eq!(report.counts["captures"], 1);
    assert_eq!(report.counts["battles"], 1);
    assert_eq!(report.discarded_captures, [2]);
    assert_eq!(report.discarded_battles, [2]);
    assert_eq!(
        report.discarded["captures"],
        ["captures id 2: level debe estar entre 1 y 100"]
    );
    assert_eq!(
        report.discarded["battles"],
        ["battles id 2: duration_seconds debe ser >= 0"]
    );
    assert_eq!(report.discarded.len(), 2);
}

#[test]
fn broken_rules_of_one_row_are_joined_in_rule_order() {
    let mut dataset = valid_dataset();
    dataset.battles.push(battle(2, 16, 16, 19, -1));

    assert_eq!(
        ok(&dataset).discarded["battles"],
        [
            "battles id 2: pokemon_a_id y pokemon_b_id deben ser distintos; \
             winner_id debe ser pokemon_a_id o pokemon_b_id; duration_seconds debe ser >= 0"
        ]
    );
}

#[test]
fn level_limits_are_inclusive() {
    let mut dataset = valid_dataset();
    dataset.captures[0].level = Some(1);
    dataset.captures[1].level = Some(100);

    assert!(ok(&dataset).discarded.is_empty());
}

// --- Orden y alcance ---------------------------------------------------------------------

#[test]
fn rows_with_missing_values_vanish_from_later_checks() {
    let mut dataset = valid_dataset();
    dataset.captures[0].level = None;
    dataset.captures[0].pokemon_id = Some(999);

    assert_eq!(errors_for(&dataset), ["captures id 1: level vacío"]);
}

#[test]
fn discarded_rows_still_take_part_in_unique_and_foreign_key_checks() {
    let mut dataset = valid_dataset();
    dataset.captures[0].level = Some(0); // descartada
    dataset.captures[1].id = Some(1); // repite el id de la descartada
    dataset.captures[0].trainer_id = Some(9); // y apunta a un entrenador inexistente

    assert_eq!(
        errors_for(&dataset),
        [
            "captures: id 1 repetido (2 veces)",
            "captures id 1: trainer_id 9 no existe en trainers",
        ]
    );
}

#[test]
fn error_order_is_empty_required_unique_references_rules_slots() {
    let mut dataset = valid_dataset();
    dataset.pokemon[0].height = Some(0); // regla (4)
    dataset.pokemon_types[2].slot = Some(2); // slot 2 sin slot 1 (5)
    dataset.pokemon_types[0].type_id = Some(9); // referencia (3)
    dataset.trainers[1].id = Some(1); // clave repetida (2)
    dataset.types[0].name = None; // valor que falta (1)
    dataset.battles.clear(); // tabla vacía (0)

    assert_eq!(
        errors_for(&dataset),
        [
            "battles: no tiene filas",
            "types id 1: name vacío",
            "trainers: id 1 repetido (2 veces)",
            "pokemon_types (16, 9): type_id 9 no existe en types",
            // El tipo 1 se descartó por no tener nombre: sus referencias fallan.
            "pokemon_types (19, 1): type_id 1 no existe en types",
            "captures id 2: trainer_id 2 no existe en trainers",
            "pokemon id 16: height debe ser > 0",
            "pokemon_types (19, 1): el Pokémon 19 tiene slot 2 sin slot 1",
        ]
    );
}

// --- Mensaje -----------------------------------------------------------------------------

#[test]
fn message_shows_the_first_50_problems() {
    let mut dataset = valid_dataset();
    dataset.battles = (0..53)
        .map(|_| BattleRecord {
            id: None,
            ..battle(0, 16, 19, 19, 5)
        })
        .collect();

    let error = validate_dataset(&dataset).unwrap_err();

    assert_eq!(error.errors.len(), 53);
    let message = error.to_string();
    assert!(message.starts_with("53 problema(s) en los datos:\n- battles id NULL: id vacío"));
    assert_eq!(message.lines().count(), 1 + 50 + 1);
    assert!(message.ends_with("\n- … y 3 más"));
}

#[test]
fn small_message_has_no_ellipsis() {
    let error = DataValidationError {
        errors: vec!["a".into(), "b".into()],
    };

    assert_eq!(error.to_string(), "2 problema(s) en los datos:\n- a\n- b");
}

#[test]
fn a_single_problem_message_for_a_height_of_zero() {
    let mut dataset = valid_dataset();
    dataset.pokemon[0].id = Some(3);
    dataset.pokemon[0].height = Some(0);
    dataset.pokemon_types[0].pokemon_id = Some(3);
    dataset.pokemon_types[1].pokemon_id = Some(3);
    dataset.captures[0].pokemon_id = Some(3);
    dataset.battles[0].pokemon_a_id = Some(3);

    assert_eq!(
        validate_dataset(&dataset).unwrap_err().to_string(),
        "1 problema(s) en los datos:\n- pokemon id 3: height debe ser > 0"
    );
}

// --- Dataset real (data-current) ---------------------------------------------------

#[test]
fn reference_dataset_is_valid_and_only_discards_negative_durations() {
    let dataset = reference_dataset();
    let read = [
        dataset.types.len(),
        dataset.pokemon.len(),
        dataset.pokemon_types.len(),
        dataset.trainers.len(),
        dataset.captures.len(),
        dataset.battles.len(),
    ];
    assert_eq!(read, [16, 100, 148, 50, 5000, 2000]);

    let report = ok(&dataset);

    let counts = &report.counts;
    assert_eq!(counts["types"], 16);
    assert_eq!(counts["pokemon"], 100);
    assert_eq!(counts["pokemon_types"], 148);
    assert_eq!(counts["trainers"], 50);
    assert_eq!(counts["captures"], 5000);
    assert_eq!(counts["battles"], 1996);
    assert_eq!(report.discarded.len(), 1);
    assert_eq!(
        report.discarded["battles"]
            .iter()
            .map(|r| r.split(':').next().unwrap())
            .collect::<Vec<_>>(),
        [
            "battles id 171",
            "battles id 290",
            "battles id 1278",
            "battles id 1813"
        ]
    );
    assert!(
        report.discarded["battles"]
            .iter()
            .all(|r| r.ends_with(": duration_seconds debe ser >= 0"))
    );
    assert_eq!(report.discarded_battles, [171, 290, 1278, 1813]);
    assert!(report.discarded_captures.is_empty());
}
