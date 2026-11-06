//! `sqlx::migrate!` embebe los archivos en compilación: sin esto, agregar una
//! migración nueva no recompila el crate.
fn main() {
    println!("cargo:rerun-if-changed=migrations");
}
