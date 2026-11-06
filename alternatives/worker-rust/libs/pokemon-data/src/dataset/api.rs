use serde::Deserialize;

/// Lo mínimo de `GET /pokemon/{id}` que usa el pipeline.
#[derive(Debug, Clone, Deserialize)]
pub struct ApiPokemon {
    pub id: i32,
    pub name: String,
    pub height: i32,
    pub weight: i32,
    pub base_experience: Option<i32>,
    pub sprites: ApiSprites,
    pub types: Vec<ApiTypeSlot>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApiSprites {
    pub front_default: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApiTypeSlot {
    pub slot: i32,
    #[serde(rename = "type")]
    pub kind: ApiNamedResource,
}

#[derive(Debug, Clone, Deserialize)]
pub struct ApiNamedResource {
    pub name: String,
    pub url: String,
}
