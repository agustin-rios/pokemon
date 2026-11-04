import assert from 'node:assert/strict';
import { test } from 'node:test';
import { toCsv } from '../../src/lib/csv.ts';

test('toCsv respeta el orden de columnas y deja vacíos los null', () => {
  const rows = [
    { id: 1, name: 'bulbasaur', exp: 64 },
    { id: 2, name: 'ivysaur', exp: null },
  ];
  assert.equal(
    toCsv(['id', 'name', 'exp'], rows),
    'id,name,exp\n1,bulbasaur,64\n2,ivysaur,\n',
  );
});

test('toCsv escapa comas, comillas y saltos de línea', () => {
  const rows = [{ v: 'a,b' }, { v: 'dice "hola"' }, { v: 'línea\nnueva' }];
  assert.equal(
    toCsv(['v'], rows),
    'v\n"a,b"\n"dice ""hola"""\n"línea\nnueva"\n',
  );
});
