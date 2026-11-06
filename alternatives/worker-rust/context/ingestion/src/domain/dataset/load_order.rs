/// Tablas en orden de carga (primero las referenciadas por FK).
pub const LOAD_ORDER: [&str; 6] = [
    "types",
    "pokemon",
    "pokemon_types",
    "trainers",
    "captures",
    "battles",
];
