import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readdir, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, test } from 'node:test';
import { dataGenerate, dataPrepare } from '../../src/commands/data.ts';
import { UsageError } from '../../src/lib/args.ts';

const tempDir = () => mkdtemp(join(tmpdir(), 'ops-generate-'));
const argsFor = (out: string) => ({ positionals: [], flags: { out } });

const pythonBefore = process.env['PYTHON'];
const fetchBefore = globalThis.fetch;
afterEach(() => {
  if (pythonBefore === undefined) delete process.env['PYTHON'];
  else process.env['PYTHON'] = pythonBefore;
  globalThis.fetch = fetchBefore;
});

/** PokeAPI simulada: /pokemon/{id} responde un Pokémon de tipo normal (o el status dado). */
function fakePokeApi(status = 200): void {
  globalThis.fetch = (async (input: string | URL | Request) => {
    const url = input instanceof Request ? input.url : String(input);
    const id = Number(/\/pokemon\/(\d+)$/.exec(url)?.[1]);
    if (status !== 200) return new Response('{}', { status });
    return Response.json({
      id,
      name: `p${id}`,
      base_experience: 10,
      height: 1,
      weight: 1,
      sprites: { front_default: null },
      types: [
        {
          slot: 1,
          type: { name: 'normal', url: 'https://pokeapi.co/api/v2/type/1/' },
        },
      ],
    });
  }) as typeof fetch;
}

/** pokemon.csv con ids 1..100, como el que deja `data scrape`. */
async function withPokemonCsv(dir: string): Promise<void> {
  const rows = Array.from({ length: 100 }, (_, i) => `${i + 1},p${i + 1}`);
  await writeFile(join(dir, 'pokemon.csv'), ['id,name', ...rows].join('\n'));
}

test('sin pokemon.csv pide correr antes el scrape', async () => {
  const out = await tempDir();
  await assert.rejects(
    dataGenerate.run(argsFor(out)),
    (err: unknown) =>
      err instanceof UsageError && /pnpm ops data scrape/.test(err.message),
  );
});

test('si el generador falla, out/ queda intacto y sin temporales', async () => {
  const out = await tempDir();
  await withPokemonCsv(out);
  await writeFile(join(out, 'trainers.csv'), 'previo');
  process.env['PYTHON'] = 'false'; // termina con código 1 sin hacer nada

  await assert.rejects(dataGenerate.run(argsFor(out)));

  assert.equal(await readFile(join(out, 'trainers.csv'), 'utf8'), 'previo');
  assert.deepEqual((await readdir(out)).sort(), [
    'pokemon.csv',
    'trainers.csv',
  ]);
});

const hasPython =
  spawnSync(process.env['PYTHON'] ?? 'python3', ['--version']).status === 0;

test(
  'con Python: escribe los tres CSV con los tamaños del desafío',
  { skip: !hasPython && 'python3 no disponible' },
  async () => {
    const out = await tempDir();
    await withPokemonCsv(out);

    await dataGenerate.run(argsFor(out));

    const lines = async (name: string) =>
      (await readFile(join(out, name), 'utf8')).trim().split(/\r?\n/).length;
    assert.equal(await lines('trainers.csv'), 51);
    assert.equal(await lines('captures.csv'), 5001);
    assert.equal(await lines('battles.csv'), 2001);
    assert.deepEqual((await readdir(out)).sort(), [
      'battles.csv',
      'captures.csv',
      'pokemon.csv',
      'trainers.csv',
    ]);
  },
);

const prepareArgs = (out: string) => ({
  positionals: [],
  flags: { out, limit: '3' },
});

test('prepare: si la API falla, out/ no cambia', async () => {
  const out = await tempDir();
  await writeFile(join(out, 'pokemon.csv'), 'previo');
  fakePokeApi(404);

  await assert.rejects(dataPrepare.run(prepareArgs(out)));

  assert.equal(await readFile(join(out, 'pokemon.csv'), 'utf8'), 'previo');
  assert.deepEqual(await readdir(out), ['pokemon.csv']);
});

test('prepare: si el generador falla, tampoco se escribe lo scrapeado', async () => {
  const out = await tempDir();
  await writeFile(join(out, 'pokemon.csv'), 'previo');
  fakePokeApi();
  process.env['PYTHON'] = 'false';

  await assert.rejects(dataPrepare.run(prepareArgs(out)));

  assert.equal(await readFile(join(out, 'pokemon.csv'), 'utf8'), 'previo');
  assert.deepEqual(await readdir(out), ['pokemon.csv']);
});

test(
  'prepare con Python: escribe los 6 CSV juntos',
  { skip: !hasPython && 'python3 no disponible' },
  async () => {
    const out = await tempDir();
    fakePokeApi();

    await dataPrepare.run(prepareArgs(out));

    assert.deepEqual((await readdir(out)).sort(), [
      'battles.csv',
      'captures.csv',
      'pokemon.csv',
      'pokemon_types.csv',
      'trainers.csv',
      'types.csv',
    ]);
    const pokemonRows = (await readFile(join(out, 'pokemon.csv'), 'utf8'))
      .trim()
      .split('\n')
      .slice(1)
      .map((line) => line.split(',')[0]);
    assert.deepEqual(pokemonRows, ['1', '2', '3']);
  },
);
