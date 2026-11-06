//! Los tipos TypeScript de la web (`apps/pokemon/src/api/generated`) deben ser
//! exactamente lo que generan los tipos de Rust.
#![allow(clippy::unwrap_used)]

use std::fs;
use std::path::{Path, PathBuf};

fn read_dir(dir: &Path) -> Vec<(String, String)> {
    let mut files: Vec<(String, String)> = fs::read_dir(dir)
        .unwrap()
        .map(|entry| {
            let path = entry.unwrap().path();
            (
                path.file_name().unwrap().to_string_lossy().into_owned(),
                fs::read_to_string(&path).unwrap(),
            )
        })
        .collect();
    files.sort();
    files
}

#[test]
fn los_tipos_generados_estan_al_dia() {
    let tmp = tempfile::tempdir().unwrap();
    pokemon_api::types::export_all(tmp.path()).unwrap();
    let committed = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../pokemon/src/api/generated");

    assert!(
        read_dir(tmp.path()) == read_dir(&committed),
        "tipos desactualizados: ejecuta pnpm gen:types"
    );
}
