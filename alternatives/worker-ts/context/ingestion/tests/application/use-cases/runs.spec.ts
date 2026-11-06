import {
  RunConflictError,
  RunNotFoundError,
  ValidationError,
} from '../../../src/application/errors.ts';
import { EnqueueEtlRun } from '../../../src/application/use-cases/EnqueueEtlRun.ts';
import { GetEtlRun } from '../../../src/application/use-cases/GetEtlRun.ts';
import { RetryEtlRun } from '../../../src/application/use-cases/RetryEtlRun.ts';
import { runWith, stubRunQueue } from '../../stubs.ts';

const RUN_ID = '3f2b8a0e-5c1d-4e7a-9b6f-0a1b2c3d4e5f';

describe('EnqueueEtlRun', () => {
  it('devuelve la corrida que le da la cola (la nueva o la que ya estaba activa)', async () => {
    const queue = stubRunQueue();
    const run = runWith();
    queue.enqueue.mockResolvedValue(run);

    await expect(new EnqueueEtlRun(queue).execute()).resolves.toBe(run);
  });
});

describe('GetEtlRun', () => {
  it('devuelve la corrida, o null si no existe', async () => {
    const queue = stubRunQueue();
    const run = runWith();
    queue.get.mockResolvedValueOnce(run).mockResolvedValueOnce(null);
    const useCase = new GetEtlRun(queue);

    await expect(useCase.execute(RUN_ID)).resolves.toBe(run);
    await expect(useCase.execute(RUN_ID)).resolves.toBeNull();
    expect(queue.get).toHaveBeenCalledWith(RUN_ID);
  });

  it('un id que no es UUID es ValidationError y no consulta la cola', () => {
    const queue = stubRunQueue();

    expect(() => new GetEtlRun(queue).execute('abc')).toThrow(ValidationError);
    expect(queue.get).not.toHaveBeenCalled();
  });
});

describe('RetryEtlRun', () => {
  it('pide el reintento a la cola y devuelve la corrida', async () => {
    const queue = stubRunQueue();
    const run = runWith();
    queue.retry.mockResolvedValue(run);

    await expect(new RetryEtlRun(queue).execute(RUN_ID)).resolves.toBe(run);
    expect(queue.retry).toHaveBeenCalledWith(RUN_ID);
  });

  it('propaga los errores de la cola (404 y 409)', async () => {
    const queue = stubRunQueue();
    const useCase = new RetryEtlRun(queue);

    queue.retry.mockRejectedValueOnce(new RunNotFoundError(RUN_ID));
    await expect(useCase.execute(RUN_ID)).rejects.toBeInstanceOf(
      RunNotFoundError,
    );
    queue.retry.mockRejectedValueOnce(
      new RunConflictError('Ya hay una corrida en curso'),
    );
    await expect(useCase.execute(RUN_ID)).rejects.toBeInstanceOf(
      RunConflictError,
    );
  });

  it('un id que no es UUID es ValidationError y no llega a la cola', () => {
    const queue = stubRunQueue();

    expect(() => new RetryEtlRun(queue).execute('abc')).toThrow(
      ValidationError,
    );
    expect(queue.retry).not.toHaveBeenCalled();
  });
});
