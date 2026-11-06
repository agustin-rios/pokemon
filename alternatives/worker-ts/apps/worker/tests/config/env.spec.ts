import { envSchema } from '../../src/config/env.ts';

describe('envSchema', () => {
  it('aplica los defaults', () => {
    expect(envSchema.parse({})).toEqual({
      NODE_ENV: 'development',
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5441/pokemon',
      REDIS_URL: 'redis://localhost:6411',
      POKEAPI_URL: 'https://pokeapi.co/api/v2',
      POKEMON_LIMIT: 100,
      LOCK_DURATION_MS: 30_000,
    });
  });

  it('convierte los números y respeta los valores dados', () => {
    expect(
      envSchema.parse({
        POKEMON_LIMIT: '151',
        LOCK_DURATION_MS: '2000',
        REDIS_URL: 'redis://redis:6379',
      }),
    ).toMatchObject({
      POKEMON_LIMIT: 151,
      LOCK_DURATION_MS: 2000,
      REDIS_URL: 'redis://redis:6379',
    });
  });

  it('quita la / final de POKEAPI_URL y exige http(s)', () => {
    expect(
      envSchema.parse({ POKEAPI_URL: 'http://stub:8099/api/v2/' }).POKEAPI_URL,
    ).toBe('http://stub:8099/api/v2');
    expect(envSchema.safeParse({ POKEAPI_URL: 'stub:8099' }).success).toBe(
      false,
    );
    expect(envSchema.safeParse({ POKEAPI_URL: 'ftp://stub' }).success).toBe(
      false,
    );
  });

  it.each([
    { POKEMON_LIMIT: '1' },
    { POKEMON_LIMIT: '1026' },
    { POKEMON_LIMIT: '10.5' },
    { POKEMON_LIMIT: 'abc' },
    { LOCK_DURATION_MS: '0' },
    { LOCK_DURATION_MS: 'abc' },
    { REDIS_URL: 'localhost:6411' },
    { REDIS_URL: 'http://redis' },
    { DATABASE_URL: '' },
  ])('rechaza %j', (env) => {
    expect(envSchema.safeParse(env).success).toBe(false);
  });
});
