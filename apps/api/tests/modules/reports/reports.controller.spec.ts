import type { INestApplication } from '@nestjs/common';
import {
  GetLevelClassificationByType,
  GetMonthlyCaptureGrowth,
  GetTopTrainersByRegion,
} from '@pokemon/context-pokedex';
import { ReportsController } from '../../../src/modules/reports/reports.controller.ts';
import { missingViewError, startApp } from '../../helpers.ts';

describe('ReportsController', () => {
  const monthly = { execute: vi.fn() };
  const top = { execute: vi.fn() };
  const level = { execute: vi.fn() };
  let app: INestApplication;
  let url: (path: string) => string;

  beforeAll(async () => {
    ({ app, url } = await startApp(ReportsController, [
      { provide: GetMonthlyCaptureGrowth, useValue: monthly },
      { provide: GetTopTrainersByRegion, useValue: top },
      { provide: GetLevelClassificationByType, useValue: level },
    ]));
  });

  afterAll(() => app.close());
  beforeEach(() => vi.resetAllMocks());

  it.each([
    [
      '/reports/monthly-growth',
      monthly,
      [{ month: '2025-11', captures: 233, changePercent: null }],
    ],
    [
      '/reports/top-trainers',
      top,
      [
        {
          region: 'Hoenn',
          rank: 1,
          trainerId: 32,
          trainerName: 'Ethan Platt',
          captures: 224,
        },
      ],
    ],
    [
      '/reports/level-classification',
      level,
      [
        {
          typeId: 7,
          typeName: 'bug',
          totalCaptures: 1044,
          highLevelCaptures: 140,
          highLevelPercent: 13.41,
        },
      ],
    ],
  ])(
    'GET %s devuelve lo que entrega su caso de uso',
    async (path, useCase, rows) => {
      useCase.execute.mockResolvedValue(rows);

      const res = await fetch(url(path));

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(rows);
    },
  );

  it('sin la vista en la base → 503', async () => {
    top.execute.mockRejectedValue(missingViewError());

    const res = await fetch(url('/reports/top-trainers'));

    expect(res.status).toBe(503);
  });
});
