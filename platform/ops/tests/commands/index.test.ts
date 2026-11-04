import assert from 'node:assert/strict';
import { test } from 'node:test';
import { argSpecOf } from '../../src/commands/command.ts';
import { COMMANDS, findCommand, helpText } from '../../src/commands/index.ts';

test('los comandos tienen nombre "grupo acción" único', () => {
  const names = COMMANDS.map((c) => c.name);
  assert.equal(new Set(names).size, names.length);
  for (const name of names) assert.match(name, /^[a-z]+ [a-z]+$/);
});

test('la ayuda lista cada comando y sus opciones', () => {
  const help = helpText();
  for (const command of COMMANDS) {
    assert.ok(help.includes(command.name), command.name);
    for (const option of command.options ?? []) {
      assert.ok(
        help.includes(`--${option.name}`),
        `${command.name} --${option.name}`,
      );
    }
  }
});

test('las opciones con valor son strings y las sin valor, booleanos', () => {
  const spec = argSpecOf({
    name: 'x y',
    summary: '',
    options: [
      { name: 'out', value: '<dir>', description: '' },
      { name: 'force', description: '' },
    ],
    run: async () => undefined,
  });
  assert.deepEqual(spec, { strings: ['out'], booleans: ['force'] });
});

test('findCommand encuentra por nombre completo', () => {
  assert.equal(findCommand('data scrape')?.name, 'data scrape');
  assert.equal(findCommand('data'), undefined);
});
