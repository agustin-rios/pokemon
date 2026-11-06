/** Error HTTP de la API, con su código para que la UI distinga 404, 503, etc. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
  }
}

/** Mensaje del cuerpo de error de Nest ({ message: string | string[] }). */
async function errorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { message?: unknown };
    if (Array.isArray(body.message)) return body.message.join(', ');
    if (typeof body.message === 'string') return body.message;
  } catch {
    // Cuerpo vacío o no JSON: se usa el texto del status.
  }
  return res.statusText || `HTTP ${res.status}`;
}

/** Llama a la API (prefijo /api, que Vite redirige en dev) y devuelve el JSON. */
export async function request<T>(
  path: string,
  init: { method?: 'GET' | 'POST'; signal?: AbortSignal } = {},
): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    headers: { Accept: 'application/json' },
    signal: init.signal,
  });
  if (!res.ok) throw new ApiError(res.status, await errorMessage(res));
  return (await res.json()) as T;
}
