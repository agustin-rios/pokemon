import { makeStore } from '../../../src/app/store.ts';
import {
  fetchHealth,
  selectHealthStatus,
} from '../../../src/features/health/healthSlice.ts';
import { fakeApi } from '../../support/fakeApi.ts';

describe('health', () => {
  it('parte en idle', () => {
    const store = makeStore({ api: fakeApi() });
    expect(selectHealthStatus(store.getState())).toBe('idle');
  });

  it('queda en ok cuando la API responde', async () => {
    const api = fakeApi();
    const store = makeStore({ api });

    await store.dispatch(fetchHealth());

    expect(selectHealthStatus(store.getState())).toBe('ok');
    expect(api.health).toHaveBeenCalledWith(expect.any(AbortSignal));
  });

  it('queda en error si la API falla', async () => {
    const api = fakeApi();
    api.health.mockRejectedValue(new TypeError('Failed to fetch'));
    const store = makeStore({ api });

    await store.dispatch(fetchHealth());

    expect(selectHealthStatus(store.getState())).toBe('error');
  });

  it('una petición cancelada no cuenta como error', async () => {
    const api = fakeApi();
    api.health.mockReturnValue(new Promise(() => undefined));
    const store = makeStore({ api });

    const request = store.dispatch(fetchHealth());
    request.abort();
    await request;

    expect(selectHealthStatus(store.getState())).toBe('loading');
  });
});
