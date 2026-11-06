use super::battle_record::BattleRecord;
use super::capture_record::CaptureRecord;
use super::pokemon_record::PokemonRecord;
use super::pokemon_type_record::PokemonTypeRecord;
use super::trainer_record::TrainerRecord;
use super::type_record::TypeRecord;

/// Las 6 tablas de `staging`, cada una ordenada por `id` (`pokemon_types` por
/// `pokemon_id, type_id`) con los nulos al final.
#[derive(Debug, Clone, PartialEq, Eq, Default)]
pub struct StagingDataset {
    pub types: Vec<TypeRecord>,
    pub pokemon: Vec<PokemonRecord>,
    pub pokemon_types: Vec<PokemonTypeRecord>,
    pub trainers: Vec<TrainerRecord>,
    pub captures: Vec<CaptureRecord>,
    pub battles: Vec<BattleRecord>,
}
