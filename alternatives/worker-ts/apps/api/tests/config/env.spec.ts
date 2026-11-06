import { envSchema } from '../../src/config/env.ts';

describe('envSchema', () => {
  it('aplica los defaults', () => {
    expect(envSchema.parse({})).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5441/pokemon',
      REDIS_URL: 'redis://localhost:6411',
      CORS_ALLOW_ORIGINS: true,
    });
  });

  it('convierte PORT a número y separa los orígenes', () => {
    const env = envSchema.parse({
      PORT: '4000',
      CORS_ALLOW_ORIGINS: 'http://localhost:4200, https://pokemon.example',
    });

    expect(env.PORT).toBe(4000);
    expect(env.CORS_ALLOW_ORIGINS).toEqual([
      'http://localhost:4200',
      'https://pokemon.example',
    ]);
  });

  it('rechaza un PORT inválido', () => {
    expect(envSchema.safeParse({ PORT: 'abc' }).success).toBe(false);
  });

  it('rechaza un REDIS_URL que no es redis://', () => {
    expect(envSchema.safeParse({ REDIS_URL: 'localhost:6411' }).success).toBe(
      false,
    );
    expect(envSchema.safeParse({ REDIS_URL: 'http://redis' }).success).toBe(
      false,
    );
  });

  it('rechaza "*" en producción', () => {
    const result = envSchema.safeParse({ NODE_ENV: 'production' });

    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['CORS_ALLOW_ORIGINS']);
  });

  it('acepta orígenes explícitos en producción', () => {
    const result = envSchema.safeParse({
      NODE_ENV: 'production',
      CORS_ALLOW_ORIGINS: 'https://pokemon.example',
    });

    expect(result.success).toBe(true);
  });
});
