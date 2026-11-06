//! Datos fijos del generador: regiones, lugares y nombres.

pub(super) const REGIONS: [&str; 6] = ["Kanto", "Johto", "Hoenn", "Sinnoh", "Unova", "Kalos"];
/// Kanto domina.
pub(super) const REGION_WEIGHTS: [f64; 6] = [5.0, 4.0, 3.0, 3.0, 2.0, 1.0];
pub(super) const LOCATIONS: [&str; 14] = [
    "Viridian Forest",
    "Mt. Moon",
    "Cerulean Cave",
    "Safari Zone",
    "Route 1",
    "Route 10",
    "Lavender Town",
    "Seafoam Islands",
    "Victory Road",
    "Pallet Town",
    "Ilex Forest",
    "Petalburg Woods",
    "Eterna Forest",
    "Pinwheel Forest",
];
pub(super) const FIRST_NAMES: [&str; 26] = [
    "Ash", "Misty", "Brock", "Gary", "May", "Dawn", "Serena", "Clemont", "Iris", "Cilan", "Red",
    "Blue", "Leaf", "Ethan", "Lyra", "Brendan", "Lucas", "Hilda", "Nate", "Rosa", "Calem", "Elio",
    "Selene", "Gloria", "Victor", "Juliana",
];
pub(super) const LAST_NAMES: [&str; 15] = [
    "Ketchum",
    "Oak",
    "Waterflower",
    "Stone",
    "Berlitz",
    "Rowan",
    "Elm",
    "Birch",
    "Sycamore",
    "Kukui",
    "Magnolia",
    "Sada",
    "Turo",
    "Harrison",
    "Platt",
];
