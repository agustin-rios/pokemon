//! Réplica exacta de `random.Random(seed)` de CPython 3.10.
//!
//! El generador sintético debe producir las mismas filas que el script de Python que
//! reemplaza, así que cada método sigue `Lib/random.py` y `Modules/_randommodule.c`
//! (MT19937) llamada por llamada. Las funciones de libm (`ln`, `powf`, `sin`, `cos`,
//! `sqrt`) son las de la plataforma, igual que en CPython (glibc en Linux).

use thiserror::Error;

const N: usize = 624;
const M: usize = 397;
const MATRIX_A: u32 = 0x9908_b0df;
const UPPER_MASK: u32 = 0x8000_0000;
const LOWER_MASK: u32 = 0x7fff_ffff;
const TWO_PI: f64 = 2.0 * std::f64::consts::PI;

/// Errores equivalentes a los `ValueError`/`IndexError` de Python.
#[derive(Debug, Error, PartialEq, Eq)]
pub enum RngError {
    #[error("rango vacío para randint({low}, {high})")]
    EmptyRange { low: i64, high: i64 },
    #[error("no se puede elegir de una secuencia vacía")]
    EmptySequence,
    #[error("la muestra ({k}) es mayor que la población ({n})")]
    SampleTooLarge { k: usize, n: usize },
    #[error("la cantidad de pesos no coincide con la población")]
    WeightsMismatch,
    #[error("la suma de los pesos debe ser finita y mayor que cero")]
    InvalidWeights,
}

/// `random.Random` de CPython 3.10 (Mersenne Twister de 32 bits).
#[derive(Debug, Clone)]
pub struct PythonRandom {
    state: [u32; N],
    index: usize,
    /// Segundo valor de la transformada de Box-Muller que `gauss` deja para la
    /// próxima llamada (compartido entre todas las llamadas, como en Python).
    gauss_next: Option<f64>,
}

impl PythonRandom {
    /// Equivale a `random.Random(seed)` para un entero no negativo: la clave son
    /// las palabras de 32 bits (little-endian) del valor.
    pub fn new(seed: u64) -> Self {
        let low = (seed & 0xffff_ffff) as u32;
        let high = (seed >> 32) as u32;
        let key: &[u32] = if high == 0 { &[low] } else { &[low, high] };
        let mut rng = Self {
            state: [0; N],
            index: N,
            gauss_next: None,
        };
        rng.init_genrand(19_650_218);
        rng.init_by_array(key);
        rng
    }

    fn init_genrand(&mut self, seed: u32) {
        self.state[0] = seed;
        for i in 1..N {
            let prev = self.state[i - 1];
            self.state[i] = 1_812_433_253u32
                .wrapping_mul(prev ^ (prev >> 30))
                .wrapping_add(i as u32);
        }
        self.index = N;
    }

    fn init_by_array(&mut self, key: &[u32]) {
        let mut i = 1;
        let mut j = 0;
        for _ in 0..N.max(key.len()) {
            let prev = self.state[i - 1];
            self.state[i] = (self.state[i] ^ (prev ^ (prev >> 30)).wrapping_mul(1_664_525))
                .wrapping_add(key[j])
                .wrapping_add(j as u32);
            i += 1;
            j += 1;
            if i >= N {
                self.state[0] = self.state[N - 1];
                i = 1;
            }
            if j >= key.len() {
                j = 0;
            }
        }
        for _ in 0..N - 1 {
            let prev = self.state[i - 1];
            self.state[i] = (self.state[i] ^ (prev ^ (prev >> 30)).wrapping_mul(1_566_083_941))
                .wrapping_sub(i as u32);
            i += 1;
            if i >= N {
                self.state[0] = self.state[N - 1];
                i = 1;
            }
        }
        // Bit más significativo fijo, como en CPython.
        self.state[0] = 0x8000_0000;
    }

    fn regenerate(&mut self) {
        for k in 0..N {
            let y = (self.state[k] & UPPER_MASK) | (self.state[(k + 1) % N] & LOWER_MASK);
            let mut next = self.state[(k + M) % N] ^ (y >> 1);
            if y & 1 != 0 {
                next ^= MATRIX_A;
            }
            self.state[k] = next;
        }
        self.index = 0;
    }

    /// `genrand_uint32()`: el siguiente entero de 32 bits ya "templado".
    pub fn next_u32(&mut self) -> u32 {
        if self.index >= N {
            self.regenerate();
        }
        let mut y = self.state[self.index];
        self.index += 1;
        y ^= y >> 11;
        y ^= (y << 7) & 0x9d2c_5680;
        y ^= (y << 15) & 0xefc6_0000;
        y ^ (y >> 18)
    }

    /// `random()`: flotante en `[0, 1)` con 53 bits de precisión.
    pub fn random(&mut self) -> f64 {
        let a = f64::from(self.next_u32() >> 5);
        let b = f64::from(self.next_u32() >> 6);
        (a * 67_108_864.0 + b) * (1.0 / 9_007_199_254_740_992.0)
    }

    /// `getrandbits(k)` para `0 <= k <= 64` (las palabras se arman little-endian).
    pub fn getrandbits(&mut self, k: u32) -> u64 {
        if k <= 32 {
            return if k == 0 {
                0
            } else {
                u64::from(self.next_u32() >> (32 - k))
            };
        }
        let mut result = 0u64;
        let mut remaining = k;
        let mut shift = 0;
        while remaining > 0 {
            let mut word = self.next_u32();
            if remaining < 32 {
                word >>= 32 - remaining;
            }
            result |= u64::from(word) << shift;
            shift += 32;
            remaining = remaining.saturating_sub(32);
        }
        result
    }

    /// `_randbelow_with_getrandbits(n)`: entero en `[0, n)`; `n == 0` devuelve 0 sin
    /// consumir nada. Con `n == 1` sí consume (no hay atajo), igual que Python.
    pub fn randbelow(&mut self, n: u64) -> u64 {
        if n == 0 {
            return 0;
        }
        let k = u64::BITS - n.leading_zeros();
        let mut r = self.getrandbits(k);
        while r >= n {
            r = self.getrandbits(k);
        }
        r
    }

    /// `randint(low, high)`, ambos extremos incluidos.
    pub fn randint(&mut self, low: i64, high: i64) -> Result<i64, RngError> {
        let width = i128::from(high) + 1 - i128::from(low);
        let width = u64::try_from(width)
            .ok()
            .filter(|w| *w > 0)
            .ok_or(RngError::EmptyRange { low, high })?;
        // `width` cabe en u64 y `randbelow(width) < width`, así que la suma no se sale de i64.
        Ok(low.wrapping_add_unsigned(self.randbelow(width)))
    }

    /// `choice(seq)`: índice elegido de una secuencia de `len` elementos.
    pub fn choice_index(&mut self, len: usize) -> Result<usize, RngError> {
        if len == 0 {
            return Err(RngError::EmptySequence);
        }
        Ok(self.randbelow(len as u64) as usize)
    }

    /// `choices(population, weights)[0]` (una sola extracción): índice elegido.
    ///
    /// Acumula los pesos, sortea `random() * total` y busca con `bisect_right` en
    /// `[0, n - 1)`, como CPython.
    pub fn choice_weighted(&mut self, weights: &[f64]) -> Result<usize, RngError> {
        let cum = cumulative(weights)?;
        Ok(self.choice_cumulative(&cum))
    }

    /// Igual que [`Self::choice_weighted`] pero con los pesos ya acumulados (para
    /// reutilizarlos en muchas extracciones, como hace Python con `choices(k=…)`).
    pub fn choice_cumulative(&mut self, cum_weights: &[f64]) -> usize {
        let total = cum_weights.last().copied().unwrap_or(0.0);
        let x = self.random() * total;
        let (mut lo, mut hi) = (0, cum_weights.len().saturating_sub(1));
        while lo < hi {
            let mid = (lo + hi) / 2;
            if x < cum_weights[mid] {
                hi = mid;
            } else {
                lo = mid + 1;
            }
        }
        lo
    }

    /// `sample(population, k)`: devuelve los índices elegidos, en orden de selección.
    pub fn sample_indices(&mut self, n: usize, k: usize) -> Result<Vec<usize>, RngError> {
        if k > n {
            return Err(RngError::SampleTooLarge { k, n });
        }
        let mut setsize: u64 = 21;
        if k > 5 {
            // 4 ** ceil(log(k * 3, 4)); math.log(x, base) = log(x) / log(base).
            let exponent = ((k as f64 * 3.0).ln() / 4f64.ln()).ceil();
            setsize += 4f64.powf(exponent) as u64;
        }
        let mut result = Vec::with_capacity(k);
        if n as u64 <= setsize {
            let mut pool: Vec<usize> = (0..n).collect();
            for i in 0..k {
                let j = self.randbelow((n - i) as u64) as usize;
                result.push(pool[j]);
                pool[j] = pool[n - i - 1];
            }
        } else {
            let mut selected = std::collections::HashSet::with_capacity(k);
            for _ in 0..k {
                let mut j = self.randbelow(n as u64) as usize;
                while selected.contains(&j) {
                    j = self.randbelow(n as u64) as usize;
                }
                selected.insert(j);
                result.push(j);
            }
        }
        Ok(result)
    }

    /// `paretovariate(alpha)`.
    pub fn paretovariate(&mut self, alpha: f64) -> f64 {
        let u = 1.0 - self.random();
        u.powf(-1.0 / alpha)
    }

    /// `expovariate(lambd)`.
    pub fn expovariate(&mut self, lambd: f64) -> f64 {
        -(1.0 - self.random()).ln() / lambd
    }

    /// `gauss(mu, sigma)`, con el valor sobrante (`gauss_next`) compartido entre llamadas.
    pub fn gauss(&mut self, mu: f64, sigma: f64) -> f64 {
        let z = match self.gauss_next.take() {
            Some(z) => z,
            None => {
                let x2pi = self.random() * TWO_PI;
                let g2rad = (-2.0 * (1.0 - self.random()).ln()).sqrt();
                self.gauss_next = Some(x2pi.sin() * g2rad);
                x2pi.cos() * g2rad
            }
        };
        mu + z * sigma
    }
}

/// `itertools.accumulate(weights)` con las validaciones de `random.choices`.
pub fn cumulative(weights: &[f64]) -> Result<Vec<f64>, RngError> {
    let mut total = 0.0;
    let cum: Vec<f64> = weights
        .iter()
        .map(|w| {
            total += w;
            total
        })
        .collect();
    match cum.last() {
        None => Err(RngError::WeightsMismatch),
        Some(t) if !t.is_finite() || *t <= 0.0 => Err(RngError::InvalidWeights),
        Some(_) => Ok(cum),
    }
}
