import { envSchema } from '../../src/config/env.ts';

describe('envSchema', () => {
  it('aplica los defaults', () => {
    expect(envSchema.parse({})).toEqual({
      NODE_ENV: 'development',
      PORT: 3000,
      DATABASE_URL: 'postgresql://postgres:postgres@localhost:5434/pokemon',
      AIRFLOW_URL: 'http://localhost:8080',
      AIRFLOW_USERNAME: 'airflow',
      AIRFLOW_PASSWORD: 'airflow',
      CORS_ALLOW_ORIGINS: true,
    });
  });

  it('quita la / final de AIRFLOW_URL y exige http(s)', () => {
    expect(
      envSchema.parse({ AIRFLOW_URL: 'http://airflow:8080/' }).AIRFLOW_URL,
    ).toBe('http://airflow:8080');
    expect(envSchema.safeParse({ AIRFLOW_URL: 'airflow:8080' }).success).toBe(
      false,
    );
    expect(envSchema.safeParse({ AIRFLOW_URL: 'ftp://airflow' }).success).toBe(
      false,
    );
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
