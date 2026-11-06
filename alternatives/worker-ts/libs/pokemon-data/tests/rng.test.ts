import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PythonRandom } from '../src/rng.ts';

// Salida de random.Random(42) de CPython 3.10 (cada clave parte de una instancia nueva).
const ref = JSON.parse(
  readFileSync(
    new URL('./fixtures/rng_reference.json', import.meta.url),
    'utf8',
  ),
) as Record<string, any>;

const fresh = () => new PythonRandom(42);
const times = <T>(n: number, fn: () => T): T[] => Array.from({ length: n }, fn);
const range = (n: number) => Array.from({ length: n }, (_, i) => i);

/** Los flotantes que pasan por libm (log, pow, sin, cos) pueden diferir 1-2 ulp de glibc. */
function expectClose(actual: number, expected: string): void {
  const e = Number(expected);
  expect(Math.abs(actual - e) / Math.abs(e)).toBeLessThanOrEqual(4e-16);
}

describe('PythonRandom vs random.Random(42) de CPython 3.10', () => {
  it('getrandbits(32)', () => {
    const r = fresh();
    expect(times(12, () => r.getrandbits(32))).toEqual(ref.getrandbits32);
  });

  it('random()', () => {
    const r = fresh();
    expect(times(12, () => r.random())).toEqual(ref.random.map(Number));
  });

  it('getrandbits(k)', () => {
    const r = fresh();
    const got = (ref.getrandbits_k as [number, number][]).map(([k]) => [
      k,
      r.getrandbits(k),
    ]);
    expect(got).toEqual(ref.getrandbits_k);
  });

  it.each([
    ['randint_0_27', 0, 27],
    ['randint_0_400', 0, 400],
    ['randint_0_31103999', 0, 31103999],
  ])('%s', (key, a, b) => {
    const r = fresh();
    expect(times(ref[key].length, () => r.randint(a, b))).toEqual(ref[key]);
  });

  it('choice', () => {
    const r = fresh();
    expect(times(30, () => r.choice(range(26)))).toEqual(ref.choice_26);
  });

  it('choiceWeighted con pesos enteros y flotantes', () => {
    let r = fresh();
    expect(
      times(30, () => r.choiceWeighted(range(6), [5, 4, 3, 3, 2, 1])),
    ).toEqual(ref.choices_weights_int);

    r = fresh();
    const weights = range(12).map((i) => 1 + i * 0.12);
    expect(times(30, () => r.choiceWeighted(range(12), weights))).toEqual(
      ref.choices_weights_float,
    );
  });

  it('sample: rama de set (100 elementos) y de pool (10 elementos)', () => {
    let r = fresh();
    const ids100 = range(100).map((i) => i + 1);
    expect(times(15, () => r.sample(ids100, 2))).toEqual(ref.sample_100_2);

    r = fresh();
    const ids10 = range(10).map((i) => i + 1);
    expect(times(15, () => r.sample(ids10, 2))).toEqual(ref.sample_10_2);
  });

  it('paretovariate', () => {
    const r = fresh();
    (ref.paretovariate_1_5 as string[]).forEach((e) =>
      expectClose(r.paretovariate(1.5), e),
    );
  });

  it('expovariate', () => {
    const r = fresh();
    (ref.expovariate_0_04 as string[]).forEach((e) =>
      expectClose(r.expovariate(1 / 25), e),
    );
  });

  it('gauss', () => {
    const r = fresh();
    (ref.gauss_180_60 as string[]).forEach((e) =>
      expectClose(r.gauss(180, 60), e),
    );
  });

  it('random() intercalado con gauss conserva el gauss_next', () => {
    const r = fresh();
    for (const [kind, expected] of ref.mixed_random_gauss as [
      string,
      string,
    ][]) {
      if (kind === 'random') expect(r.random()).toBe(Number(expected));
      else expectClose(r.gauss(180, 60), expected);
    }
  });

  it('randint con rango de un solo valor consume números igual que Python', () => {
    // randbelow(1) saca getrandbits(1) hasta obtener 0: aquí descarta el 1.º número
    // (bit alto en 1), acepta el 2.º y el siguiente getrandbits(32) es el 3.º.
    const r = fresh();
    expect(r.randint(5, 5)).toBe(5);
    expect(r.getrandbits(32)).toBe(ref.getrandbits32[2]);
  });

  it('rechaza argumentos inválidos', () => {
    const r = fresh();
    expect(() => r.getrandbits(0)).toThrow(RangeError);
    expect(() => r.randint(3, 2)).toThrow(RangeError);
    expect(() => r.choice([])).toThrow(RangeError);
    expect(() => r.sample([1], 2)).toThrow(RangeError);
    expect(() => r.choiceWeighted([1, 2], [1])).toThrow(RangeError);
    expect(() => new PythonRandom(1.5)).toThrow(RangeError);
  });
});
