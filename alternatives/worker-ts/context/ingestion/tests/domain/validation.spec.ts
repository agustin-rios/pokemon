import { DataValidationError } from '../../src/domain/errors.ts';
import {
  LOAD_ORDER,
  TABLES,
  type StagingRows,
} from '../../src/domain/dataset/tables.ts';
import { validateStaging } from '../../src/domain/dataset/validation.ts';
import { referenceRows, validRows } from '../fixtures.ts';

/** Los errores con los que falla la validación. */
function errorsFor(rows: StagingRows): readonly string[] {
  try {
    validateStaging(rows);
  } catch (error) {
    if (error instanceof DataValidationError) return error.errors;
    throw error;
  }
  throw new Error('la validación debía fallar');
}

describe('validateStaging', () => {
  it('un dataset válido: cuenta las filas y no descarta nada', () => {
    const result = validateStaging(validRows());

    expect(result.counts).toEqual({
      types: 2,
      pokemon: 2,
      pokemon_types: 3,
      trainers: 2,
      captures: 2,
      battles: 1,
    });
    expect(result.discarded).toEqual({});
    expect(result.discardedIds).toEqual({ captures: [], battles: [] });
  });

  it('las tablas cubren las columnas de staging, en el orden de la migración', () => {
    expect(Object.keys(TABLES)).toEqual([...LOAD_ORDER]);
    expect(TABLES.pokemon.map(({ name }) => name)).toEqual([
      'id',
      'name',
      'height',
      'weight',
      'base_experience',
      'sprite_url',
    ]);
  });

  describe('tablas vacías', () => {
    it('una tabla sin filas es un error', () => {
      const rows = { ...validRows(), battles: [] };

      expect(errorsFor(rows)).toEqual(['battles: no tiene filas']);
    });

    it('se revisan primero, por tabla en el orden de carga', () => {
      const rows = {
        ...validRows(),
        types: [],
        captures: [],
      };

      expect(errorsFor(rows).slice(0, 2)).toEqual([
        'types: no tiene filas',
        'captures: no tiene filas',
      ]);
    });
  });

  describe('valores requeridos', () => {
    it('un NULL en una columna requerida: una fila, un error', () => {
      const rows = validRows();
      rows.captures[0]!['level'] = null;
      rows.captures[1]!['location'] = '';
      rows.trainers[1]!['created_at'] = null;

      expect(errorsFor(rows)).toEqual([
        'trainers id 2: created_at vacío',
        'captures id 1: level vacío',
        'captures id 2: location vacío',
      ]);
    });

    it('una fila con dos columnas malas reporta solo la primera (en el orden de la tabla)', () => {
      const rows = validRows();
      rows.trainers[0]!['region'] = ' ';
      rows.trainers[0]!['name'] = null;

      // La fila sale de las demás comprobaciones, así que la captura de ese entrenador queda sin destino.
      expect(errorsFor(rows)).toEqual([
        'trainers id 1: name vacío',
        'captures id 1: trainer_id 1 no existe en trainers',
      ]);
    });

    it('un id NULL se rotula como NULL', () => {
      const rows = validRows();
      rows.types[0]!['id'] = null;

      expect(errorsFor(rows)[0]).toBe('types id NULL: id vacío');
    });

    it('en pokemon_types el rótulo lleva los dos ids', () => {
      const rows = validRows();
      rows.pokemon_types[2]!['pokemon_id'] = null;
      rows.pokemon_types[0]!['slot'] = null;

      expect(errorsFor(rows)).toEqual([
        'pokemon_types (16, 1): slot vacío',
        'pokemon_types (NULL, 1): pokemon_id vacío',
        'pokemon_types (16, 3): el Pokémon 16 tiene slot 2 sin slot 1',
      ]);
    });

    it('base_experience y sprite_url pueden ser NULL', () => {
      const rows = validRows();
      rows.pokemon[0]!['base_experience'] = null;
      rows.pokemon[0]!['sprite_url'] = null;

      expect(() => validateStaging(rows)).not.toThrow();
    });

    it.each([[''], [' '], ['\t\v\f'], [' '], [' '], ['　'], ['\u0085']])(
      'el texto %j es vacío (White_Space de Unicode)',
      (raw) => {
        for (const [table, column] of [
          ['types', 'name'],
          ['pokemon', 'name'],
          ['trainers', 'name'],
          ['trainers', 'region'],
          ['captures', 'location'],
        ] as const) {
          const rows = validRows();
          rows[table][0]![column] = raw;

          expect(errorsFor(rows)[0]).toMatch(
            new RegExp(`^${table} id \\d+: ${column} vacío$`),
          );
        }
      },
    );

    it.each([['﻿'], ['\u001f'], ['​'], ['0']])(
      'el texto %j no cuenta como vacío',
      (raw) => {
        const rows = validRows();
        rows.types[0]!['name'] = raw;

        expect(() => validateStaging(rows)).not.toThrow();
      },
    );

    it('los espacios dentro de un texto no lo hacen vacío ni se recortan', () => {
      const rows = validRows();
      rows.types[0]!['name'] = ' normal ';

      expect(() => validateStaging(rows)).not.toThrow();
    });

    it('la fila con error sale de las demás comprobaciones: sus referencias ya no tienen destino', () => {
      const rows = validRows();
      rows.pokemon[1]!['height'] = null; // rattata

      expect(errorsFor(rows)).toEqual([
        'pokemon id 19: height vacío',
        'pokemon_types (19, 1): pokemon_id 19 no existe en pokemon',
        'captures id 2: pokemon_id 19 no existe en pokemon',
        'battles id 1: pokemon_b_id 19 no existe en pokemon',
        'battles id 1: winner_id 19 no existe en pokemon',
      ]);
    });
  });

  describe('claves únicas', () => {
    it('un texto único repetido', () => {
      const rows = validRows();
      rows.types[1]!['name'] = 'normal';

      expect(errorsFor(rows)).toEqual([
        'types: name "normal" repetido (2 veces)',
      ]);
    });

    it('un id repetido: el error de unicidad va antes que los que arrastra', () => {
      const rows = validRows();
      rows.types[1]!['id'] = 1;

      expect(errorsFor(rows)).toEqual([
        'types: id 1 repetido (2 veces)',
        'pokemon_types (16, 3): type_id 3 no existe en types',
      ]);
    });

    it('un valor repetido tres veces es un solo error', () => {
      const rows = validRows();
      rows.captures.push(
        { ...rows.captures[0]!, level: 20 },
        { ...rows.captures[0]!, level: 30 },
      );

      expect(errorsFor(rows)).toEqual(['captures: id 1 repetido (3 veces)']);
    });

    it('los repetidos salen en el orden de la primera aparición', () => {
      const rows = validRows();
      rows.captures = [5, 5, 2, 2, 9].map((id) => ({
        ...validRows().captures[0]!,
        id,
      }));

      expect(errorsFor(rows)).toEqual([
        'captures: id 5 repetido (2 veces)',
        'captures: id 2 repetido (2 veces)',
      ]);
    });

    it('pokemon_types repetido por pokemon y tipo', () => {
      const rows = validRows();
      rows.pokemon_types.push({ pokemon_id: 19, type_id: 1, slot: 2 });

      expect(errorsFor(rows)).toEqual([
        'pokemon_types: (pokemon_id, type_id) (19, 1) repetido (2 veces)',
      ]);
    });

    it('pokemon_types repetido por pokemon y slot', () => {
      const rows = validRows();
      rows.pokemon_types.push({ pokemon_id: 19, type_id: 3, slot: 1 });

      expect(errorsFor(rows)).toEqual([
        'pokemon_types: (pokemon_id, slot) (19, 1) repetido (2 veces)',
      ]);
    });

    it('el texto se compara exacto y se escribe con comillas y escapes de JSON', () => {
      const rows = validRows();
      rows.types[1]!['name'] = 'Normal';
      expect(() => validateStaging(rows)).not.toThrow();

      rows.types[0]!['name'] = 'say "hi"';
      rows.types[1]!['name'] = 'say "hi"';
      expect(errorsFor(rows)).toEqual([
        'types: name "say \\"hi\\"" repetido (2 veces)',
      ]);
    });

    it('las tablas se revisan en el orden de carga y las claves en el de UNIQUE', () => {
      const rows = validRows();
      rows.pokemon_types.push({ pokemon_id: 19, type_id: 1, slot: 1 });
      rows.types.push({ id: 1, name: 'normal' });

      expect(errorsFor(rows)).toEqual([
        'types: id 1 repetido (2 veces)',
        'types: name "normal" repetido (2 veces)',
        'pokemon_types: (pokemon_id, type_id) (19, 1) repetido (2 veces)',
        'pokemon_types: (pokemon_id, slot) (19, 1) repetido (2 veces)',
      ]);
    });
  });

  describe('referencias', () => {
    it('referencias que no existen, en el orden de las claves foráneas', () => {
      const rows = validRows();
      rows.captures[0]!['pokemon_id'] = 999;
      rows.captures[1]!['trainer_id'] = 7;
      rows.pokemon_types[2]!['type_id'] = 4;

      expect(errorsFor(rows)).toEqual([
        'pokemon_types (19, 4): type_id 4 no existe en types',
        'captures id 2: trainer_id 7 no existe en trainers',
        'captures id 1: pokemon_id 999 no existe en pokemon',
      ]);
    });

    it('batallas: cada columna que apunta a un Pokémon se revisa', () => {
      const rows = validRows();
      Object.assign(rows.battles[0]!, {
        pokemon_a_id: 1,
        pokemon_b_id: 2,
        winner_id: 3,
      });

      expect(errorsFor(rows)).toEqual([
        'battles id 1: pokemon_a_id 1 no existe en pokemon',
        'battles id 1: pokemon_b_id 2 no existe en pokemon',
        'battles id 1: winner_id 3 no existe en pokemon',
      ]);
    });

    it('las filas que se descartarían siguen contando para las claves únicas y las referencias', () => {
      const rows = validRows();
      rows.captures[1]!['level'] = 0; // se descartaría...
      rows.captures[1]!['id'] = 1; // ...pero repite el id
      rows.captures[0]!['pokemon_id'] = 999;

      expect(errorsFor(rows)).toEqual([
        'captures: id 1 repetido (2 veces)',
        'captures id 1: pokemon_id 999 no existe en pokemon',
      ]);
    });
  });

  describe('reglas', () => {
    it('una regla rota en el catálogo es error; el slot 2 sin slot 1 va al final', () => {
      const rows = validRows();
      rows.pokemon[0]!['height'] = 0;
      rows.pokemon_types[2]!['slot'] = 2; // rattata: slot 2 sin slot 1

      expect(errorsFor(rows)).toEqual([
        'pokemon id 16: height debe ser > 0',
        'pokemon_types (19, 1): el Pokémon 19 tiene slot 2 sin slot 1',
      ]);
    });

    it('junta con «; » las reglas rotas de una fila, en el orden de las reglas', () => {
      const rows = validRows();
      Object.assign(rows.pokemon[0]!, {
        height: -1,
        weight: 0,
        base_experience: -5,
      });

      expect(errorsFor(rows)).toEqual([
        'pokemon id 16: height debe ser > 0; weight debe ser > 0; base_experience debe ser >= 0',
      ]);
    });

    it('base_experience NULL cuenta como 0 y es válido', () => {
      expect(() => validateStaging(validRows())).not.toThrow();
    });

    it('slot fuera de 1 o 2', () => {
      const rows = validRows();
      rows.pokemon_types[2]!['slot'] = 3;

      expect(errorsFor(rows)).toEqual([
        'pokemon_types (19, 1): slot debe ser 1 o 2',
      ]);
    });

    it.each([
      [0, false],
      [1, true],
      [100, true],
      [101, false],
    ])('captura de nivel %i ⇒ válida: %s', (level, valid) => {
      const rows = validRows();
      rows.captures[0]!['level'] = level;

      const result = validateStaging(rows);
      expect(result.discardedIds.captures).toEqual(valid ? [] : [1]);
    });

    it('una regla rota en captures o battles descarta la fila y la informa', () => {
      const rows = validRows();
      rows.captures[1]!['level'] = 0;
      rows.battles.push({
        id: 2,
        pokemon_a_id: 16,
        pokemon_b_id: 19,
        winner_id: 16,
        fought_at: '2025-11-03 08:00:00',
        duration_seconds: -20,
      });

      const result = validateStaging(rows);

      expect(result.counts).toMatchObject({ captures: 2, battles: 2 });
      expect(result.discarded).toEqual({
        captures: ['captures id 2: level debe estar entre 1 y 100'],
        battles: ['battles id 2: duration_seconds debe ser >= 0'],
      });
      expect(result.discardedIds).toEqual({ captures: [2], battles: [2] });
    });

    it('una batalla con Pokémon repetido o ganador ajeno se descarta con todos sus motivos', () => {
      const rows = validRows();
      Object.assign(rows.battles[0]!, {
        pokemon_b_id: 16,
        winner_id: 19,
        duration_seconds: -1,
      });

      expect(validateStaging(rows).discarded.battles).toEqual([
        'battles id 1: pokemon_a_id y pokemon_b_id deben ser distintos; ' +
          'winner_id debe ser pokemon_a_id o pokemon_b_id; duration_seconds debe ser >= 0',
      ]);
    });

    it('los errores van por etapas: requeridos, únicas, referencias, reglas y slot', () => {
      const rows = validRows();
      rows.pokemon_types[2]!['slot'] = 2;
      rows.pokemon_types[0]!['slot'] = 9;
      rows.pokemon[0]!['weight'] = 0;

      expect(errorsFor(rows)).toEqual([
        'pokemon id 16: weight debe ser > 0',
        'pokemon_types (16, 1): slot debe ser 1 o 2',
        'pokemon_types (16, 3): el Pokémon 16 tiene slot 2 sin slot 1',
        'pokemon_types (19, 1): el Pokémon 19 tiene slot 2 sin slot 1',
      ]);
    });
  });

  describe('mensaje agregado', () => {
    it('junta todos los problemas', () => {
      const rows = { ...validRows(), battles: [] };
      rows.captures[0]!['id'] = 2;

      let message = '';
      try {
        validateStaging(rows);
      } catch (error) {
        message = (error as Error).message;
      }

      expect(message).toBe(
        '2 problema(s) en los datos:\n' +
          '- battles: no tiene filas\n' +
          '- captures: id 2 repetido (2 veces)',
      );
    });

    it('con más de 50 problemas muestra 50 y cuenta el resto', () => {
      const rows = validRows();
      rows.types = Array.from({ length: 60 }, (_, i) => ({
        id: i + 1,
        name: ' ',
      }));

      let message = '';
      try {
        validateStaging(rows);
      } catch (error) {
        message = (error as Error).message;
      }

      // 60 nombres vacíos + 3 referencias de pokemon_types a tipos que ya no existen.
      const lines = message.split('\n');
      expect(lines[0]).toBe('63 problema(s) en los datos:');
      expect(lines).toHaveLength(52);
      expect(lines.at(-1)).toBe('- … y 13 más');
    });
  });

  describe('data de referencia', () => {
    it('las filas de la corrida de referencia son válidas y se descartan 4 batallas', () => {
      const result = validateStaging(referenceRows());

      expect(result.counts).toEqual({
        types: 16,
        pokemon: 100,
        pokemon_types: 148,
        trainers: 50,
        captures: 5000,
        battles: 2000,
      });
      expect(result.discarded).toEqual({
        battles: [171, 290, 1278, 1813].map(
          (id) => `battles id ${id}: duration_seconds debe ser >= 0`,
        ),
      });
      expect(result.discardedIds).toEqual({
        captures: [],
        battles: [171, 290, 1278, 1813],
      });
    });
  });
});
