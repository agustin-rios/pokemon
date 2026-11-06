/** La PokeAPI respondió con un estado que no se reintenta (4xx distinto de 429). */
export class HttpStatusError extends Error {
  readonly url: string;
  readonly status: number;

  constructor(url: string, status: number) {
    super(`GET ${url} respondió HTTP ${status}`);
    this.name = 'HttpStatusError';
    this.url = url;
    this.status = status;
  }
}

/** Se agotaron los intentos de un GET; `cause` es el último fallo (red, timeout o HTTP). */
export class AttemptsExhaustedError extends Error {
  readonly url: string;
  readonly attempts: number;

  constructor(url: string, attempts: number, cause: unknown) {
    super(`GET ${url} falló tras ${attempts} intentos`, { cause });
    this.name = 'AttemptsExhaustedError';
    this.url = url;
    this.attempts = attempts;
  }
}

/** Un Pokémon trae un tipo cuya URL no tiene la forma `/type/{id}`. */
export class UnexpectedTypeUrlError extends Error {
  readonly url: string;

  constructor(url: string) {
    super(`URL de tipo inesperada: ${url}`);
    this.name = 'UnexpectedTypeUrlError';
    this.url = url;
  }
}
