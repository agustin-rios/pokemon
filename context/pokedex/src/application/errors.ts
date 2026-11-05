/** La entrada de un caso de uso no cumple sus reglas (la API la traduce a 400). */
export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}
