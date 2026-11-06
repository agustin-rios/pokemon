import type { Dataset, SyntheticData } from '@pokemon/pokemon-data';
import type { StepContext } from '../../src/application/ports/StepContext.ts';
import { FenceLostError } from '../../src/index.ts';
import type { PrismaStagingStore } from '../../src/infra/adapters/PrismaStagingStore.ts';
import { referenceRows } from '../fixtures.ts';
import { ownedFence } from '../stubs.ts';

/** Contexto de un paso: señal sin abortar y cerco propio. */
export const liveContext = (): StepContext => ({
  signal: new AbortController().signal,
  fence: ownedFence(),
});

/** Contexto de una ejecución que perdió la corrida (venció su lock). */
export const lostFenceContext = (): StepContext => ({
  signal: new AbortController().signal,
  fence: { assertOwned: () => Promise.reject(new FenceLostError()) },
});

/** Deja en staging las 6 tablas de la corrida de referencia. */
export async function stageReference(store: PrismaStagingStore): Promise<void> {
  const rows = referenceRows();
  await store.replaceScraped(
    {
      types: rows.types,
      pokemon: rows.pokemon,
      pokemonTypes: rows.pokemon_types,
    } as unknown as Dataset,
    liveContext(),
  );
  await store.replaceGenerated(
    {
      trainers: rows.trainers,
      captures: rows.captures,
      battles: rows.battles,
    } as unknown as SyntheticData,
    liveContext(),
  );
}

/** Huella de las tablas finales: filas y md5 de cada una (los mismos valores que el pipeline original). */
export const CHECKSUM = `
  SELECT string_agg(t || '=' || n || ':' || left(h, 8), ' ' ORDER BY o) AS checksum FROM (
    SELECT 1 o,'types' t,count(*) n,md5(coalesce(string_agg(x::text,'|' ORDER BY x.id),'')) h FROM types x UNION ALL
    SELECT 2,'pokemon',count(*),md5(coalesce(string_agg(x::text,'|' ORDER BY x.id),'')) FROM pokemon x UNION ALL
    SELECT 3,'pokemon_types',count(*),md5(coalesce(string_agg(x::text,'|' ORDER BY x.pokemon_id,x.type_id),'')) FROM pokemon_types x UNION ALL
    SELECT 4,'trainers',count(*),md5(coalesce(string_agg(x::text,'|' ORDER BY x.id),'')) FROM trainers x UNION ALL
    SELECT 5,'captures',count(*),md5(coalesce(string_agg(x::text,'|' ORDER BY x.id),'')) FROM captures x UNION ALL
    SELECT 6,'battles',count(*),md5(coalesce(string_agg(x::text,'|' ORDER BY x.id),'')) FROM battles x) s`;
