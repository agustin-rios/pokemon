/** Crea las vistas de las consultas (db/main/sql/views.sql). */
export interface ViewsBuilder {
  /** `signal` corta la conexión y la consulta en curso. */
  build(signal: AbortSignal): Promise<void>;
}
