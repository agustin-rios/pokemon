//! Controladores de la API con repositorios y cola falsos (sin base de datos).
#![allow(clippy::unwrap_used)]

#[path = "../helpers.rs"]
mod helpers;

mod etl {
    mod etl_controller;
}
mod health {
    mod health_controller;
}
mod items {
    mod items_controller;
}
mod reports {
    mod reports_controller;
}
