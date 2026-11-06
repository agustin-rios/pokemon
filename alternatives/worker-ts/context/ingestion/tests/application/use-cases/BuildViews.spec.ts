import { BuildViews } from '../../../src/application/use-cases/BuildViews.ts';
import { ownedFence } from '../../stubs.ts';

describe('BuildViews', () => {
  it('construye las vistas con la señal del paso y no devuelve output', async () => {
    const builder = { build: vi.fn().mockResolvedValue(undefined) };
    const signal = new AbortController().signal;

    await expect(
      new BuildViews(builder).execute({ signal, fence: ownedFence() }),
    ).resolves.toBeNull();
    expect(builder.build).toHaveBeenCalledWith(signal);
  });

  it('propaga el error del builder', async () => {
    const builder = { build: vi.fn().mockRejectedValue(new Error('sintaxis')) };

    await expect(
      new BuildViews(builder).execute({
        signal: new AbortController().signal,
        fence: ownedFence(),
      }),
    ).rejects.toThrow('sintaxis');
  });
});
