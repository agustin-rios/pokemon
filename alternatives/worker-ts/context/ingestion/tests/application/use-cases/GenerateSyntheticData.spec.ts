import { generateSyntheticData } from '@pokemon/pokemon-data';
import { GenerateSyntheticData } from '../../../src/application/use-cases/GenerateSyntheticData.ts';
import { PermanentError } from '../../../src/domain/errors.ts';
import { referenceRows } from '../../fixtures.ts';
import { ownedFence, stubStagingStore } from '../../stubs.ts';

const context = () => ({
  signal: new AbortController().signal,
  fence: ownedFence(),
});

describe('GenerateSyntheticData', () => {
  it('genera los datos de referencia a partir de los ids de staging.pokemon', async () => {
    const staging = stubStagingStore();
    staging.findPokemonIds.mockResolvedValue(
      referenceRows().pokemon.map((row) => row['id'] as number),
    );
    const ctx = context();

    const output = await new GenerateSyntheticData(staging).execute(ctx);

    expect(output).toEqual({ trainers: 50, captures: 5000, battles: 2000 });
    const [data, passed] = staging.replaceGenerated.mock.calls[0]!;
    expect(passed).toBe(ctx);
    // Los ids de referencia son 1..100: el resultado es el del generador de Python.
    expect(data).toEqual(
      generateSyntheticData(Array.from({ length: 100 }, (_, i) => i + 1)),
    );
    expect(data.battles.map((b) => b.id).slice(0, 3)).toEqual([1, 2, 3]);
  });

  it('usa los ids tal como los entrega staging (ya únicos y ordenados)', async () => {
    const staging = stubStagingStore();
    staging.findPokemonIds.mockResolvedValue([3, 5, 7]);

    await new GenerateSyntheticData(staging).execute(context());

    expect(staging.replaceGenerated.mock.calls[0]![0]).toEqual(
      generateSyntheticData([3, 5, 7]),
    );
  });

  it.each([[[]], [[4]]])(
    'con %j hay menos de 2 Pokémon: error permanente y no escribe',
    async (ids) => {
      const staging = stubStagingStore();
      staging.findPokemonIds.mockResolvedValue(ids);

      const error = await new GenerateSyntheticData(staging)
        .execute(context())
        .catch((e: unknown) => e);

      expect(error).toBeInstanceOf(PermanentError);
      expect((error as Error).message).toBe(
        'se necesitan al menos 2 Pokémon en staging.pokemon',
      );
      expect(staging.replaceGenerated).not.toHaveBeenCalled();
    },
  );

  it('con la señal abortada no escribe', async () => {
    const staging = stubStagingStore();
    staging.findPokemonIds.mockResolvedValue([1, 2, 3]);
    const controller = new AbortController();
    controller.abort(new Error('plazo'));

    await expect(
      new GenerateSyntheticData(staging).execute({
        signal: controller.signal,
        fence: ownedFence(),
      }),
    ).rejects.toThrow('plazo');
    expect(staging.replaceGenerated).not.toHaveBeenCalled();
  });
});
