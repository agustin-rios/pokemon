// PokeAPI de mentira: sirve GET /api/v2/pokemon/{id} con la forma de la API real,
// reconstruida desde pokemon.csv, types.csv y pokemon_types.csv de una carpeta.
import type { IncomingMessage, ServerResponse } from 'node:http';
import { join } from 'node:path';
import { readCsvRows } from './csv.ts';
import { json } from './http-server.ts';

export function pokeApiStub(dir: string) {
  const types = new Map(
    readCsvRows(join(dir, 'types.csv')).map((t) => [t['id']!, t['name']!]),
  );
  const typesByPokemon = new Map<string, { slot: number; type: unknown }[]>();
  for (const pt of readCsvRows(join(dir, 'pokemon_types.csv'))) {
    const list = typesByPokemon.get(pt['pokemon_id']!) ?? [];
    list.push({
      slot: Number(pt['slot']),
      type: {
        name: types.get(pt['type_id']!),
        url: `https://pokeapi.co/api/v2/type/${pt['type_id']}/`,
      },
    });
    typesByPokemon.set(pt['pokemon_id']!, list);
  }
  const pokemon = new Map(
    readCsvRows(join(dir, 'pokemon.csv')).map((p) => [
      p['id']!,
      {
        id: Number(p['id']),
        name: p['name'],
        height: Number(p['height']),
        weight: Number(p['weight']),
        base_experience:
          p['base_experience'] === '' ? null : Number(p['base_experience']),
        sprites: { front_default: p['sprite'] || null },
        // Desordenados a propósito: el scraper debe ordenar por slot.
        types: (typesByPokemon.get(p['id']!) ?? []).sort(
          (a, b) => b.slot - a.slot,
        ),
      },
    ]),
  );

  return (req: IncomingMessage, res: ServerResponse): void => {
    const id = /^\/api\/v2\/pokemon\/(\d+)\/?$/.exec(req.url ?? '')?.[1];
    const body = id && pokemon.get(id);
    if (body) json(res, 200, body);
    else json(res, 404, { detail: 'Not found.' });
  };
}
