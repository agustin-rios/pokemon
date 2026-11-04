import { makeStore } from '../../../src/app/store.ts';
import {
  fetchHealth,
  selectHealthStatus,
} from '../../../src/features/health/healthSlice.ts';

describe('health', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parte en idle', () => {
    expect(selectHealthStatus(makeStore().getState())).toBe('idle');
  });

  it('queda en ok cuando la API responde', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ status: 'ok' }));
    vi.stubGlobal('fetch', fetchMock);
    const store = makeStore();

    await store.dispatch(fetchHealth());

    expect(selectHealthStatus(store.getState())).toBe('ok');
    expect(fetchMock).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('queda en error si la API responde con un error HTTP', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(null, { status: 503 })),
    );
    const store = makeStore();

    await store.dispatch(fetchHealth());

    expect(selectHealthStatus(store.getState())).toBe('error');
  });

  it('queda en error si no hay conexión', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('Failed to fetch')),
    );
    const store = makeStore();

    await store.dispatch(fetchHealth());

    expect(selectHealthStatus(store.getState())).toBe('error');
  });

  it('una petición cancelada no cuenta como error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => new Promise<Response>(() => undefined)),
    );
    const store = makeStore();

    const request = store.dispatch(fetchHealth());
    request.abort();
    await request;

    expect(selectHealthStatus(store.getState())).toBe('loading');
  });
});
