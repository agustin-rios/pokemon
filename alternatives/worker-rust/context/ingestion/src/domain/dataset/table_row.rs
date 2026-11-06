//! Contrato de una fila de `staging` y utilidades de claves y mensajes.

/// Valor de una clave única: el texto se compara exacto.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub enum Key {
    Int(i32),
    Text(String),
}

impl Key {
    /// Cómo se muestra en los mensajes: enteros en decimal, texto entre comillas
    /// dobles con escapes de JSON.
    pub fn display(&self) -> String {
        match self {
            Self::Int(n) => n.to_string(),
            Self::Text(s) => json_quote(s),
        }
    }
}

/// Texto entre comillas dobles con escapes de JSON (`"normal"`).
pub fn json_quote(text: &str) -> String {
    serde_json::Value::String(text.to_owned()).to_string()
}

/// Una clave única de una tabla: sus columnas y cómo extraer su valor de una fila
/// (`None` si alguna columna no tiene valor).
pub struct UniqueKey<R> {
    pub columns: &'static [&'static str],
    pub extract: fn(&R) -> Option<Vec<Key>>,
}

/// Fila de una tabla de `staging`.
pub trait TableRow: Sized {
    const TABLE: &'static str;
    /// Romper una regla descarta la fila (captures, battles) en vez de fallar.
    const DISCARDABLE: bool = false;

    /// Valor de la columna `id`; `None` si falta o la tabla no la tiene.
    fn id(&self) -> Option<i32>;

    /// Cómo se nombra la fila en los mensajes: `{tabla} id {id}`.
    fn label(&self) -> String {
        format!("{} id {}", Self::TABLE, show(self.id()))
    }

    /// Primera columna (en el orden de la tabla) que falta o está en blanco.
    fn missing_column(&self) -> Option<&'static str>;

    /// Clave primaria y claves únicas, en ese orden.
    fn unique_keys() -> Vec<UniqueKey<Self>>;

    /// Mensajes de las reglas rotas (los CHECK de la base), en orden de regla.
    fn violations(&self) -> Vec<&'static str> {
        Vec::new()
    }
}

/// Un número en un mensaje; `NULL` si falta.
pub(super) fn show(value: Option<i32>) -> String {
    value.map_or_else(|| "NULL".to_owned(), |n| n.to_string())
}

/// Texto que falta o es solo espacios en blanco (`White_Space` de Unicode).
pub(super) fn blank(value: &Option<String>) -> bool {
    value.as_deref().is_none_or(|text| text.trim().is_empty())
}

pub(super) fn name_key<R>(extract: fn(&R) -> Option<Vec<Key>>) -> UniqueKey<R> {
    UniqueKey {
        columns: &["name"],
        extract,
    }
}

pub(super) fn id_key<R>(extract: fn(&R) -> Option<Vec<Key>>) -> UniqueKey<R> {
    UniqueKey {
        columns: &["id"],
        extract,
    }
}

pub(super) fn int_key(value: Option<i32>) -> Option<Vec<Key>> {
    value.map(|n| vec![Key::Int(n)])
}

pub(super) fn text_key(value: &Option<String>) -> Option<Vec<Key>> {
    value.clone().map(|s| vec![Key::Text(s)])
}
