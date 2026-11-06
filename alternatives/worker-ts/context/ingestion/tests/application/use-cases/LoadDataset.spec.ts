import { LoadDataset } from '../../../src/application/use-cases/LoadDataset.ts';
import { DataValidationError } from '../../../src/domain/errors.ts';
import { referenceRows, validRows } from '../../fixtures.ts';
import { ownedFence, stubStagingStore } from '../../stubs.ts';

const counts = {
  types: 16,
  pokemon: 100,
  pokemon_types: 148,
  trainers: 50,
  captures: 5000,
  battles: 1996,
};

const context = () => ({
  signal: new AbortController().signal,
  fence: ownedFence(),
});

describe('LoadDataset', () => {
  it('relee y revalida staging, y carga sin las filas descartadas', async () => {
    const staging = stubStagingStore();
    staging.readAll.mockResolvedValue(referenceRows());
    const loader = { load: vi.fn().mockResolvedValue(counts) };
    const ctx = context();

    const output = await new LoadDataset(staging, loader).execute(ctx);

    expect(staging.readAll).toHaveBeenCalledOnce();
    expect(loader.load).toHaveBeenCalledWith(
      { captures: [], battles: [171, 290, 1278, 1813] },
      ctx,
    );
    expect(output).toEqual({ counts });
  });

  it('si staging cambió y ya no es válido, no carga nada', async () => {
    const rows = validRows();
    rows.pokemon[0]!['height'] = 0;
    const staging = stubStagingStore();
    staging.readAll.mockResolvedValue(rows);
    const loader = { load: vi.fn() };

    await expect(
      new LoadDataset(staging, loader).execute(context()),
    ).rejects.toBeInstanceOf(DataValidationError);
    expect(loader.load).not.toHaveBeenCalled();
  });

  it('con la señal abortada no llega al cargador', async () => {
    const staging = stubStagingStore();
    staging.readAll.mockResolvedValue(validRows());
    const loader = { load: vi.fn() };
    const controller = new AbortController();
    controller.abort(new Error('apagado'));

    await expect(
      new LoadDataset(staging, loader).execute({
        signal: controller.signal,
        fence: ownedFence(),
      }),
    ).rejects.toThrow('apagado');
    expect(loader.load).not.toHaveBeenCalled();
  });
});
