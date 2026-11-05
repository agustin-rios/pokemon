import { GetLevelClassificationByType } from '../../../src/application/use-cases/GetLevelClassificationByType.ts';
import { GetMonthlyCaptureGrowth } from '../../../src/application/use-cases/GetMonthlyCaptureGrowth.ts';
import { GetTopTrainersByRegion } from '../../../src/application/use-cases/GetTopTrainersByRegion.ts';
import { GetTypeSummary } from '../../../src/application/use-cases/GetTypeSummary.ts';
import { stubReportsRepository } from '../../stubs.ts';

// Los reportes los agrega la base (vistas del DAG): cada caso de uso devuelve
// lo que entrega su método del repositorio, sin recalcular nada.
describe('casos de uso de reportes', () => {
  it('GetTypeSummary → typeSummary', async () => {
    const reports = stubReportsRepository();
    const rows = [
      {
        typeId: 10,
        typeName: 'fire',
        pokemonCount: 12,
        averageBaseExperience: 145.08,
      },
    ];
    reports.typeSummary.mockResolvedValue(rows);
    await expect(new GetTypeSummary(reports).execute()).resolves.toBe(rows);
  });

  it('GetMonthlyCaptureGrowth (A) → monthlyCaptureGrowth', async () => {
    const reports = stubReportsRepository();
    const rows = [
      { month: '2025-11', captures: 233, changePercent: null },
      { month: '2025-12', captures: 244, changePercent: 4.72 },
    ];
    reports.monthlyCaptureGrowth.mockResolvedValue(rows);
    await expect(new GetMonthlyCaptureGrowth(reports).execute()).resolves.toBe(
      rows,
    );
  });

  it('GetTopTrainersByRegion (B) → topTrainersByRegion', async () => {
    const reports = stubReportsRepository();
    const rows = [
      {
        region: 'Kanto',
        rank: 1,
        trainerId: 12,
        trainerName: 'Ash Ketchum',
        captures: 1270,
      },
    ];
    reports.topTrainersByRegion.mockResolvedValue(rows);
    await expect(new GetTopTrainersByRegion(reports).execute()).resolves.toBe(
      rows,
    );
  });

  it('GetLevelClassificationByType (C) → levelClassificationByType', async () => {
    const reports = stubReportsRepository();
    const rows = [
      {
        typeId: 12,
        typeName: 'grass',
        totalCaptures: 400,
        highLevelCaptures: 52,
        highLevelPercent: 13,
      },
    ];
    reports.levelClassificationByType.mockResolvedValue(rows);
    await expect(
      new GetLevelClassificationByType(reports).execute(),
    ).resolves.toBe(rows);
  });
});
