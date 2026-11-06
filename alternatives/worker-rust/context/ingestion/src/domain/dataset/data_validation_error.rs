use thiserror::Error;

/// Cantidad máxima de problemas que se muestran en el mensaje.
pub const MAX_ERRORS_IN_MESSAGE: usize = 50;

/// Los datos de `staging` no cumplen: no se debe cargar nada.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
#[error("{}", Self::render(.errors))]
pub struct DataValidationError {
    pub errors: Vec<String>,
}

impl DataValidationError {
    fn render(errors: &[String]) -> String {
        let shown = &errors[..errors.len().min(MAX_ERRORS_IN_MESSAGE)];
        let more = if errors.len() > shown.len() {
            format!("\n- … y {} más", errors.len() - shown.len())
        } else {
            String::new()
        };
        format!(
            "{} problema(s) en los datos:\n- {}{more}",
            errors.len(),
            shown.join("\n- ")
        )
    }
}
