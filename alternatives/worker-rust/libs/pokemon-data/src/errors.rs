//! Presentación de errores para registros y mensajes al operador.

use std::error::Error;

/// El error y toda su cadena de causas en una línea (`error: causa: causa raíz`).
///
/// Los `Display` de [`PokeApiError`](crate::pokeapi::PokeApiError) guardan la causa solo como
/// `source` (así el texto guardado en la corrida no cambia), pero el operador necesita saber
/// si fue una conexión rechazada, un timeout, un 429 o un campo que falta en el JSON. Una
/// causa que ya cierra el texto anterior (envoltorios `{0}`) no se repite.
pub fn error_chain(error: &dyn Error) -> String {
    let mut text = error.to_string();
    let mut current = error.source();
    while let Some(cause) = current {
        let cause_text = cause.to_string();
        if !text.ends_with(&cause_text) {
            text.push_str(": ");
            text.push_str(&cause_text);
        }
        current = cause.source();
    }
    text
}
