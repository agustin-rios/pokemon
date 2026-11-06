import {
  isRunId,
  remainingSteps,
  STEPS,
  withAllSteps,
} from '../../src/domain/run/EtlRun.ts';
import { step } from '../stubs.ts';

describe('modelo de la corrida', () => {
  it('los pasos van siempre en este orden', () => {
    expect(STEPS).toEqual([
      'scrape',
      'generate',
      'validate',
      'load',
      'build_views',
    ]);
  });

  it('una corrida nueva ejecuta todos los pasos', () => {
    const steps = STEPS.map((name) => ({ name, state: 'pending' as const }));
    expect(remainingSteps(steps)).toEqual([...STEPS]);
  });

  it('al retomar se saltan los pasos exitosos y se repite todo lo demás, en orden', () => {
    const state = [
      'succeeded',
      'succeeded',
      'failed',
      'pending',
      'pending',
    ] as const;
    expect(
      remainingSteps(STEPS.map((name, i) => ({ name, state: state[i] }))),
    ).toEqual(['validate', 'load', 'build_views']);
  });

  it('un paso que quedó running por una ejecución caída se ejecuta de nuevo', () => {
    const state = [
      'succeeded',
      'running',
      'pending',
      'pending',
      'pending',
    ] as const;
    expect(
      remainingSteps(STEPS.map((name, i) => ({ name, state: state[i] })))[0],
    ).toBe('generate');
  });

  it('una corrida con todos los pasos exitosos no tiene nada pendiente', () => {
    const steps = STEPS.map((name) => ({ name, state: 'succeeded' as const }));
    expect(remainingSteps(steps)).toEqual([]);
  });

  it('withAllSteps completa con pendientes y ordena los pasos', () => {
    const steps = withAllSteps([
      step('generate', 'succeeded'),
      step('scrape', 'succeeded'),
    ]);

    expect(steps.map((s) => [s.name, s.state])).toEqual([
      ['scrape', 'succeeded'],
      ['generate', 'succeeded'],
      ['validate', 'pending'],
      ['load', 'pending'],
      ['build_views', 'pending'],
    ]);
    expect(withAllSteps().every((s) => s.state === 'pending')).toBe(true);
  });

  it('reconoce UUID', () => {
    expect(isRunId('3f2b8a0e-5c1d-4e7a-9b6f-0a1b2c3d4e5f')).toBe(true);
    expect(isRunId('3F2B8A0E-5C1D-4E7A-9B6F-0A1B2C3D4E5F')).toBe(true);
    expect(isRunId('no-es-uuid')).toBe(false);
    expect(isRunId('3f2b8a0e5c1d4e7a9b6f0a1b2c3d4e5f')).toBe(false);
  });
});
