import {
  AttemptsExhaustedError,
  HttpStatusError,
  UnexpectedTypeUrlError,
} from '@pokemon/pokemon-data';
import {
  classifyError,
  DataValidationError,
  describeError,
  PermanentError,
  sqlState,
  StepDeadlineError,
} from '../../src/domain/errors.ts';

/** Error de Prisma 7 en una consulta cruda: el SQLSTATE va en originalCode. */
const prismaError = (originalCode: string) =>
  Object.assign(new Error('Raw query failed'), {
    code: 'P2010',
    meta: { driverAdapterError: { cause: { originalCode } } },
  });

/** Error del cliente pg. */
const pgError = (code: string) => Object.assign(new Error('pg'), { code });

describe('DataValidationError', () => {
  it('junta los problemas en el mensaje', () => {
    const error = new DataValidationError(['uno', 'dos']);

    expect(error.message).toBe('2 problema(s) en los datos:\n- uno\n- dos');
    expect(error.errors).toEqual(['uno', 'dos']);
  });

  it('muestra los primeros 50 y cuenta el resto', () => {
    const errors = Array.from({ length: 53 }, (_, i) => `e${i + 1}`);
    const lines = new DataValidationError(errors).message.split('\n');

    expect(lines[0]).toBe('53 problema(s) en los datos:');
    expect(lines[50]).toBe('- e50');
    expect(lines).toHaveLength(52);
    expect(lines[51]).toBe('- … y 3 más');
  });
});

describe('sqlState', () => {
  it('lo saca de Prisma (originalCode) y de pg (code)', () => {
    expect(sqlState(prismaError('23505'))).toBe('23505');
    expect(sqlState(pgError('22P02'))).toBe('22P02');
  });

  it('ignora los errores que no vienen de la base', () => {
    expect(sqlState(new Error('boom'))).toBeUndefined();
    expect(
      sqlState(Object.assign(new Error('x'), { code: 'ECONNREFUSED' })),
    ).toBeUndefined();
    expect(sqlState(null)).toBeUndefined();
    expect(sqlState('23505')).toBeUndefined();
  });
});

describe('classifyError (por tipo, nunca por el texto del mensaje)', () => {
  const url = 'https://x/pokemon/1';

  it.each([
    ['datos inválidos', new DataValidationError(['x']), 'load'],
    ['faltan Pokémon', new PermanentError('faltan Pokémon'), 'generate'],
    ['HTTP 404', new HttpStatusError(url, 404), 'scrape'],
    ['HTTP 301', new HttpStatusError(url, 301), 'scrape'],
    ['tipo inesperado', new UnexpectedTypeUrlError('https://x/y'), 'scrape'],
    ['unicidad (Prisma)', prismaError('23505'), 'load'],
    ['texto inválido (pg)', pgError('22P02'), 'load'],
    ['sintaxis en las vistas', pgError('42601'), 'build_views'],
    [
      'tabla inexistente en las vistas (Prisma)',
      prismaError('42P01'),
      'build_views',
    ],
  ] as const)('permanente: %s', (_name, error, step) => {
    expect(classifyError(error, step)).toBe('permanent');
  });

  it.each([
    ['HTTP 429', new HttpStatusError(url, 429), 'scrape'],
    ['HTTP 503', new HttpStatusError(url, 503), 'scrape'],
    [
      'agotó los intentos',
      new AttemptsExhaustedError(url, 4, new HttpStatusError(url, 503)),
      'scrape',
    ],
    ['plazo vencido', new StepDeadlineError('load', 300_000), 'load'],
    [
      'conexión rechazada',
      Object.assign(new Error('connect'), { code: 'ECONNREFUSED' }),
      'load',
    ],
    ['sin código', new Error('timeout'), 'build_views'],
    ['conexión caída (pg 08006)', pgError('08006'), 'load'],
    ['deadlock (Prisma 40P01)', prismaError('40P01'), 'load'],
    ['disco lleno (53100)', pgError('53100'), 'load'],
    ['apagado del servidor (57P01)', pgError('57P01'), 'load'],
    ['sentencia cancelada por plazo (57014)', pgError('57014'), 'load'],
    ['clase 42 fuera de build_views', pgError('42P01'), 'load'],
    ['algo que no es un Error', 'boom', 'generate'],
  ] as const)('reintentable: %s', (_name, error, step) => {
    expect(classifyError(error, step)).toBe('retryable');
  });

  it('el mensaje no influye: un Error con el texto de un 404 es reintentable', () => {
    expect(
      classifyError(new Error('GET https://x respondió HTTP 404'), 'scrape'),
    ).toBe('retryable');
  });

  it('con los errores reales de la librería', () => {
    expect(classifyError(new HttpStatusError(url, 404), 'scrape')).toBe(
      'permanent',
    );
    expect(
      classifyError(
        new AttemptsExhaustedError(url, 4, new Error('x')),
        'scrape',
      ),
    ).toBe('retryable');
  });
});

describe('describeError', () => {
  it('un error sin causa es su mensaje', () => {
    expect(describeError(new Error('boom'))).toBe('boom');
    expect(describeError('texto')).toBe('texto');
  });

  it('agrega una línea por causa, hasta la raíz', () => {
    const root = Object.assign(new Error('connect ECONNREFUSED 127.0.0.1:80'), {
      code: 'ECONNREFUSED',
    });
    const fetchFailed = new TypeError('fetch failed', { cause: root });
    const error = new AttemptsExhaustedError(
      'https://x/pokemon/1',
      4,
      fetchFailed,
    );

    expect(describeError(error)).toBe(
      'GET https://x/pokemon/1 falló tras 4 intentos\n' +
        'causa: fetch failed\n' +
        'causa: connect ECONNREFUSED 127.0.0.1:80',
    );
  });

  it('colapsa los mensajes de varias líneas (Prisma) en una', () => {
    const error = new Error(
      'Invalid `prisma.$executeRaw()` invocation:\n\n\nRaw query failed. Code: `57014`',
    );

    expect(describeError(error)).toBe(
      'Invalid `prisma.$executeRaw()` invocation: Raw query failed. Code: `57014`',
    );
  });

  it('conserva la lista de DataValidationError', () => {
    expect(describeError(new DataValidationError(['a', 'b']))).toBe(
      '2 problema(s) en los datos:\n- a\n- b',
    );
  });

  it('no se cicla con causas circulares ni se pasa de cinco niveles', () => {
    const a = new Error('a');
    a.cause = a;
    expect(describeError(a)).toBe('a');

    let deep: Error = new Error('n0');
    for (let i = 1; i < 10; i++) deep = new Error(`n${i}`, { cause: deep });
    expect(describeError(deep).split('\n')).toHaveLength(5);
  });
});
