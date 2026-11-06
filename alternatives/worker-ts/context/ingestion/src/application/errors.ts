/** La entrada de un caso de uso no cumple sus reglas (la API la traduce a 400). */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

/** No existe la corrida (la API la traduce a 404). */
export class RunNotFoundError extends Error {
  constructor(runId: string) {
    super(`No existe la corrida ${runId}`);
    this.name = 'RunNotFoundError';
  }
}

/** La operación choca con el estado actual de las corridas (la API la traduce a 409). */
export class RunConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RunConflictError';
  }
}

/** No se pudo encolar la corrida tras varios intentos (la API responde 500). */
export class EnqueueFailedError extends Error {
  constructor() {
    super('No se pudo encolar la corrida');
    this.name = 'EnqueueFailedError';
  }
}
