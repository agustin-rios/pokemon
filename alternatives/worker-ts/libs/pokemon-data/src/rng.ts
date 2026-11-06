// Port de random.Random de CPython 3.10: con la misma semilla produce la misma
// secuencia que Python, de modo que el generador sintético deja los mismos datos
// que scripts/generate_pokemon_data.py. Los métodos siguen random.py línea a línea
// y el núcleo es el MT19937 de Modules/_randommodule.c.

const N = 624;
const M = 397;
const TWO_POW_32 = 2 ** 32;

export class PythonRandom {
  private readonly mt = new Uint32Array(N);
  private index = N;
  // gauss genera dos valores por vez; el segundo queda guardado para la próxima llamada.
  private gaussNext: number | null = null;

  constructor(seed: number) {
    if (!Number.isSafeInteger(seed)) {
      throw new RangeError('La semilla debe ser un entero seguro');
    }
    this.initByArray(seedKey(Math.abs(seed)));
  }

  private initGenrand(seed: number): void {
    const mt = this.mt;
    mt[0] = seed;
    for (let i = 1; i < N; i++) {
      const prev = mt[i - 1]!;
      mt[i] = Math.imul(1812433253, prev ^ (prev >>> 30)) + i;
    }
    this.index = N;
  }

  private initByArray(key: readonly number[]): void {
    const mt = this.mt;
    this.initGenrand(19650218);
    let i = 1;
    let j = 0;
    for (let k = Math.max(N, key.length); k > 0; k--) {
      const prev = mt[i - 1]!;
      mt[i] = (mt[i]! ^ Math.imul(prev ^ (prev >>> 30), 1664525)) + key[j]! + j;
      i++;
      j++;
      if (i >= N) {
        mt[0] = mt[N - 1]!;
        i = 1;
      }
      if (j >= key.length) j = 0;
    }
    for (let k = N - 1; k > 0; k--) {
      const prev = mt[i - 1]!;
      mt[i] = (mt[i]! ^ Math.imul(prev ^ (prev >>> 30), 1566083941)) - i;
      i++;
      if (i >= N) {
        mt[0] = mt[N - 1]!;
        i = 1;
      }
    }
    mt[0] = 0x80000000;
  }

  private nextUint32(): number {
    const mt = this.mt;
    if (this.index >= N) {
      for (let k = 0; k < N; k++) {
        const y = (mt[k]! & 0x80000000) | (mt[(k + 1) % N]! & 0x7fffffff);
        mt[k] = mt[(k + M) % N]! ^ (y >>> 1) ^ (y & 1 ? 0x9908b0df : 0);
      }
      this.index = 0;
    }
    let y = mt[this.index++]!;
    y ^= y >>> 11;
    y ^= (y << 7) & 0x9d2c5680;
    y ^= (y << 15) & 0xefc60000;
    y ^= y >>> 18;
    return y >>> 0;
  }

  /** Float en [0, 1) con 53 bits, como random.random(). */
  random(): number {
    const a = this.nextUint32() >>> 5;
    const b = this.nextUint32() >>> 6;
    return (a * 67108864 + b) * (1 / 9007199254740992);
  }

  /** Entero de k bits (1..32), como random.getrandbits(k). */
  getrandbits(k: number): number {
    if (!Number.isInteger(k) || k < 1 || k > 32) {
      throw new RangeError('k debe ser un entero entre 1 y 32');
    }
    return this.nextUint32() >>> (32 - k);
  }

  /** Entero en [0, n). Con n = 0 devuelve 0 sin consumir números (n = 1 sí consume). */
  private randbelow(n: number): number {
    if (n === 0) return 0;
    const k = 32 - Math.clz32(n);
    let r = this.getrandbits(k);
    while (r >= n) r = this.getrandbits(k);
    return r;
  }

  /** Entero en [a, b], ambos incluidos. */
  randint(a: number, b: number): number {
    const width = b + 1 - a;
    if (width <= 0) throw new RangeError('rango vacío para randint()');
    return a + this.randbelow(width);
  }

  choice<T>(items: readonly T[]): T {
    if (items.length === 0) {
      throw new RangeError('no se puede elegir de una secuencia vacía');
    }
    return items[this.randbelow(items.length)]!;
  }

  /** random.choices(items, weights=weights)[0]: un elemento con probabilidad según su peso. */
  choiceWeighted<T>(items: readonly T[], weights: readonly number[]): T {
    const n = items.length;
    if (n === 0 || weights.length !== n) {
      throw new RangeError('items y weights deben tener el mismo largo (> 0)');
    }
    let total = 0;
    const cumulative = weights.map((w) => (total += w));
    if (!(total > 0) || !Number.isFinite(total)) {
      throw new RangeError('La suma de los pesos debe ser positiva y finita');
    }
    // bisect_right(cum_weights, x, 0, n - 1): el último índice nunca se compara.
    const x = this.random() * total;
    let lo = 0;
    let hi = n - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (x < cumulative[mid]!) hi = mid;
      else lo = mid + 1;
    }
    return items[lo]!;
  }

  /** k elementos distintos, en orden de selección, como random.sample(items, k). */
  sample<T>(items: readonly T[], k: number): T[] {
    const n = items.length;
    if (!Number.isInteger(k) || k < 0 || k > n) {
      throw new RangeError('La muestra es mayor que la población o negativa');
    }
    const result: T[] = [];
    let setSize = 21;
    if (k > 5) setSize += 4 ** Math.ceil(Math.log(k * 3) / Math.log(4));
    if (n <= setSize) {
      // Pool: los no seleccionados quedan en pool[0 .. n-i).
      const pool = [...items];
      for (let i = 0; i < k; i++) {
        const j = this.randbelow(n - i);
        result.push(pool[j]!);
        pool[j] = pool[n - i - 1]!;
      }
    } else {
      const selected = new Set<number>();
      for (let i = 0; i < k; i++) {
        let j = this.randbelow(n);
        while (selected.has(j)) j = this.randbelow(n);
        selected.add(j);
        result.push(items[j]!);
      }
    }
    return result;
  }

  paretovariate(alpha: number): number {
    const u = 1 - this.random();
    return Math.pow(u, -1 / alpha);
  }

  expovariate(lambda: number): number {
    return -Math.log(1 - this.random()) / lambda;
  }

  gauss(mu: number, sigma: number): number {
    let z = this.gaussNext;
    this.gaussNext = null;
    if (z === null) {
      const x2pi = this.random() * (2 * Math.PI);
      const g2rad = Math.sqrt(-2 * Math.log(1 - this.random()));
      z = Math.cos(x2pi) * g2rad;
      this.gaussNext = Math.sin(x2pi) * g2rad;
    }
    return mu + z * sigma;
  }
}

/** Palabras de 32 bits (little-endian) de la semilla, como la clave de init_by_array. */
function seedKey(seed: number): number[] {
  const key: number[] = [];
  for (let rest = seed; rest > 0; rest = Math.floor(rest / TWO_POW_32)) {
    key.push(rest % TWO_POW_32);
  }
  return key.length > 0 ? key : [0];
}
