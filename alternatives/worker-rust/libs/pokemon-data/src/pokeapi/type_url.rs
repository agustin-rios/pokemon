use super::error::PokeApiError;

/// Id numérico al final de la ruta de una URL de tipo (`…/type/12/`).
pub fn type_id_from_url(url: &str) -> Result<i32, PokeApiError> {
    let unexpected = || PokeApiError::UnexpectedTypeUrl(url.to_owned());
    let parsed = reqwest::Url::parse(url).map_err(|_| unexpected())?;
    let path = parsed.path();
    let path = path.strip_suffix('/').unwrap_or(path);
    let (before, digits) = path.rsplit_once('/').ok_or_else(unexpected)?;
    if !before.ends_with("/type")
        || digits.is_empty()
        || !digits.bytes().all(|b| b.is_ascii_digit())
    {
        return Err(unexpected());
    }
    digits.parse().map_err(|_| unexpected())
}
