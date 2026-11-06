import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { HealthController } from '../../../src/modules/health/health.controller.ts';
import { HealthModule } from '../../../src/modules/health/health.module.ts';

describe('HealthController', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [HealthModule],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    await app.listen(0);
  });

  afterAll(async () => {
    await app.close();
  });

  it('devuelve ok', () => {
    expect(app.get(HealthController).check()).toEqual({ status: 'ok' });
  });

  it('responde en GET /health', async () => {
    const res = await fetch(`${await app.getUrl()}/health`);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok' });
  });
});
