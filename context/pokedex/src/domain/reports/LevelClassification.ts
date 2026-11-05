/**
 * Consulta C (clasificación por nivel): por tipo, cuántas capturas tienen nivel
 * 50 o más y qué porcentaje representan sobre las capturas de ese tipo. Una
 * captura de un Pokémon con dos tipos cuenta en ambos.
 * Vista `level_classification_by_type`.
 */
export interface LevelClassification {
  readonly typeId: number;
  readonly typeName: string;
  readonly totalCaptures: number;
  /** Capturas con nivel ≥ 50. */
  readonly highLevelCaptures: number;
  /** % sobre totalCaptures, con 2 decimales. */
  readonly highLevelPercent: number;
}
