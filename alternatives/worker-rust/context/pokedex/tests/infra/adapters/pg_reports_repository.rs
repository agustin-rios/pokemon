//! Test de contrato entre las vistas y el adapter. Aplica, en una base propia,
//! las migraciones y el mismo `db/main/sql/views.sql` que ejecuta `build_views`;
//! carga unos pocos datos y verifica lo que devuelve `PgReportsRepository`.
//! Si alguien cambia una vista (nombre, columna, tipo, regla) sin el adapter, o
//! al revés, falla. Necesita `TEST_DATABASE_URL`: cualquier base de Postgres,
//! solo crea y borra su propia base.

use crate::support::TestDb;
use pokemon_context_pokedex::application::RepositoryError;
use pokemon_context_pokedex::application::ports::ReportsRepository;
use pokemon_context_pokedex::domain::{
    LevelClassification, MonthlyCaptureGrowth, TopTrainer, TypeSummary,
};
use pokemon_context_pokedex::infra::adapters::PgReportsRepository;
use pokemon_db::VIEWS_SQL;

// Pensado para ejercitar cada regla: un Pokémon con un tipo y dos con dos tipos;
// Kanto con 4 entrenadores (corte del top 3 y empate resuelto por id); meses con
// subida y bajada; niveles justo en el borde de 50.
const FIXTURE: &str = "
  INSERT INTO types (id, name) VALUES (1, 'normal'), (3, 'flying'), (10, 'fire');
  INSERT INTO pokemon (id, name, height, weight, base_experience, sprite_url) VALUES
    (1, 'p1', 1, 1, 100, NULL), (2, 'p2', 1, 1, 51, NULL), (3, 'p3', 1, 1, 60, NULL);
  INSERT INTO pokemon_types (pokemon_id, type_id, slot) VALUES
    (1, 1, 1), (2, 10, 1), (2, 3, 2), (3, 1, 1), (3, 3, 2);
  INSERT INTO trainers (id, name, region, created_at) VALUES
    (1, 'Ana', 'Kanto', '2025-01-01'), (2, 'Beto', 'Kanto', '2025-01-01'),
    (3, 'Caro', 'Kanto', '2025-01-01'), (4, 'Dani', 'Kanto', '2025-01-01'),
    (5, 'Eli', 'Johto', '2025-01-01');
  INSERT INTO captures (id, trainer_id, pokemon_id, captured_at, level, location) VALUES
    (1, 1, 1, '2026-01-05 10:00:00', 10, 'Route 1'),
    (2, 1, 2, '2026-01-20 10:00:00', 60, 'Route 1'),
    (3, 2, 3, '2026-02-01 00:00:00', 50, 'Route 1'),
    (4, 3, 1, '2026-02-14 10:00:00', 49, 'Route 1'),
    (5, 4, 2, '2026-02-28 23:59:59', 5, 'Route 1'),
    (6, 5, 3, '2026-03-10 10:00:00', 99, 'Route 1');
";

/// Base con datos y vistas; el test devuelve el repositorio y la base para
/// borrarlo antes de comparar.
async fn setup() -> Option<(TestDb, PgReportsRepository)> {
    let schema = TestDb::create().await?;
    schema.exec(FIXTURE).await;
    schema.exec(VIEWS_SQL).await;
    let reports = PgReportsRepository::new(schema.pool.clone());
    Some((schema, reports))
}

#[tokio::test]
async fn type_summary_counts_a_two_type_pokemon_in_both() {
    let Some((schema, reports)) = setup().await else {
        return;
    };
    let result = reports.type_summary().await.unwrap();
    schema.drop().await;

    let row = |type_id, type_name: &str, pokemon_count, average_base_experience| TypeSummary {
        type_id,
        type_name: type_name.into(),
        pokemon_count,
        average_base_experience,
    };
    assert_eq!(
        result,
        vec![
            row(10, "fire", 1, 51.0),
            row(3, "flying", 2, 55.5),
            row(1, "normal", 2, 80.0),
        ]
    );
}

#[tokio::test]
async fn monthly_capture_growth_a_is_percent_vs_previous_month_null_in_first() {
    let Some((schema, reports)) = setup().await else {
        return;
    };
    let result = reports.monthly_capture_growth().await.unwrap();
    schema.drop().await;

    let row = |month: &str, captures, change_percent| MonthlyCaptureGrowth {
        month: month.into(),
        captures,
        change_percent,
    };
    assert_eq!(
        result,
        vec![
            row("2026-01", 2, None),
            row("2026-02", 3, Some(50.0)),
            row("2026-03", 1, Some(-66.67)),
        ]
    );
}

#[tokio::test]
async fn top_trainers_by_region_b_keeps_three_per_region_ties_by_id() {
    let Some((schema, reports)) = setup().await else {
        return;
    };
    let result = reports.top_trainers_by_region().await.unwrap();
    schema.drop().await;

    let row = |region: &str, rank, trainer_id, trainer_name: &str, captures| TopTrainer {
        region: region.into(),
        rank,
        trainer_id,
        trainer_name: trainer_name.into(),
        captures,
    };
    assert_eq!(
        result,
        vec![
            row("Johto", 1, 5, "Eli", 1),
            row("Kanto", 1, 1, "Ana", 2),
            row("Kanto", 2, 2, "Beto", 1),
            row("Kanto", 3, 3, "Caro", 1),
        ]
    );
}

#[tokio::test]
async fn level_classification_by_type_c_counts_level_50_and_up_in_each_type() {
    let Some((schema, reports)) = setup().await else {
        return;
    };
    let result = reports.level_classification_by_type().await.unwrap();
    schema.drop().await;

    let row = |type_id, type_name: &str, total, high, percent| LevelClassification {
        type_id,
        type_name: type_name.into(),
        total_captures: total,
        high_level_captures: high,
        high_level_percent: percent,
    };
    assert_eq!(
        result,
        vec![
            row(10, "fire", 2, 1, 50.0),
            row(3, "flying", 4, 3, 75.0),
            row(1, "normal", 4, 2, 50.0),
        ]
    );
}

#[tokio::test]
async fn missing_views_are_reported_as_data_not_loaded() {
    let Some(schema) = TestDb::create().await else {
        return;
    };
    let reports = PgReportsRepository::new(schema.pool.clone());
    let result = reports.type_summary().await;
    schema.drop().await;

    assert!(matches!(result, Err(RepositoryError::DataNotLoaded)));
}
