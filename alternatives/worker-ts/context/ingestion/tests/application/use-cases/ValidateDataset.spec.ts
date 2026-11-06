import { ValidateDataset } from '../../../src/application/use-cases/ValidateDataset.ts';
import { DataValidationError } from '../../../src/domain/errors.ts';
import { referenceRows, validRows } from '../../fixtures.ts';
import { ownedFence, stubLogger, stubStagingStore } from '../../stubs.ts';

const context = () => ({
  signal: new AbortController().signal,
  fence: ownedFence(),
});

describe('ValidateDataset', () => {
  it('cuenta las filas leídas y lista las descartadas, y no escribe nada', async () => {
    const staging = stubStagingStore();
    staging.readAll.mockResolvedValue(referenceRows());
    const logger = stubLogger();

    const output = await new ValidateDataset(staging, logger).execute(
      context(),
    );

    expect(output.counts).toEqual({
      types: 16,
      pokemon: 100,
      pokemon_types: 148,
      trainers: 50,
      captures: 5000,
      battles: 2000,
    });
    expect(output.discarded).toEqual({
      battles: [171, 290, 1278, 1813].map(
        (id) => `battles id ${id}: duration_seconds debe ser >= 0`,
      ),
    });
    expect(staging.replaceScraped).not.toHaveBeenCalled();
    expect(staging.replaceGenerated).not.toHaveBeenCalled();
    // Las 4 filas descartadas quedan en el log.
    expect(logger.warn).toHaveBeenCalledTimes(1 + 4);
    expect(logger.warn).toHaveBeenCalledWith(
      'battles: 4 fila(s) descartada(s)',
    );
  });

  it('sin descartes, discarded queda vacío y no avisa nada', async () => {
    const staging = stubStagingStore();
    staging.readAll.mockResolvedValue(validRows());
    const logger = stubLogger();

    const output = await new ValidateDataset(staging, logger).execute(
      context(),
    );

    expect(output.discarded).toEqual({});
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it('en el log muestra a lo sumo 20 filas descartadas por tabla', async () => {
    const rows = validRows();
    rows.captures = Array.from({ length: 25 }, (_, i) => ({
      ...rows.captures[0]!,
      id: i + 1,
      level: 0,
    }));
    const staging = stubStagingStore();
    staging.readAll.mockResolvedValue(rows);
    const logger = stubLogger();

    const output = await new ValidateDataset(staging, logger).execute(
      context(),
    );

    expect(output.discarded.captures).toHaveLength(25);
    // Título + 20 filas + «… y 5 más».
    expect(logger.warn).toHaveBeenCalledTimes(22);
    expect(logger.warn).toHaveBeenLastCalledWith('  … y 5 más');
  });

  it('datos inválidos: lanza DataValidationError con todos los problemas', async () => {
    const rows = validRows();
    rows.pokemon[0]!['height'] = 0;
    const staging = stubStagingStore();
    staging.readAll.mockResolvedValue(rows);

    await expect(
      new ValidateDataset(staging, stubLogger()).execute(context()),
    ).rejects.toThrow(
      new DataValidationError(['pokemon id 16: height debe ser > 0']),
    );
  });
});
