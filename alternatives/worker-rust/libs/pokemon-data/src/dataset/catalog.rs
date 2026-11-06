use std::collections::BTreeMap;

use super::api::ApiPokemon;
use super::rows::{PokemonRow, PokemonTypeRow, TypeRow};
use crate::pokeapi::{PokeApiError, type_id_from_url};

/// Las tres tablas del catálogo, ya ordenadas y sin duplicados.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct Dataset {
    pub pokemon: Vec<PokemonRow>,
    pub types: Vec<TypeRow>,
    pub pokemon_types: Vec<PokemonTypeRow>,
}

impl Dataset {
    /// Convierte las respuestas de la API: Pokémon por id, tipos deduplicados por el id
    /// de su URL y relaciones por `(pokemon_id, slot)`, sin importar el orden de llegada.
    pub fn from_api(api_pokemon: &[ApiPokemon]) -> Result<Self, PokeApiError> {
        let mut pokemon = BTreeMap::new();
        let mut types = BTreeMap::new();
        let mut pokemon_types = Vec::new();

        for p in api_pokemon {
            pokemon.insert(
                p.id,
                PokemonRow {
                    id: p.id,
                    name: p.name.clone(),
                    height: p.height,
                    weight: p.weight,
                    base_experience: p.base_experience,
                    sprite: p.sprites.front_default.clone(),
                },
            );
            for slot in &p.types {
                let type_id = type_id_from_url(&slot.kind.url)?;
                types.insert(
                    type_id,
                    TypeRow {
                        id: type_id,
                        name: slot.kind.name.clone(),
                    },
                );
                pokemon_types.push(PokemonTypeRow {
                    pokemon_id: p.id,
                    type_id,
                    slot: slot.slot,
                });
            }
        }
        pokemon_types.sort_by_key(|r| (r.pokemon_id, r.slot));

        Ok(Self {
            pokemon: pokemon.into_values().collect(),
            types: types.into_values().collect(),
            pokemon_types,
        })
    }
}
