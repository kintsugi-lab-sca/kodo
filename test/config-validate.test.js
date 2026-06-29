// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  validatePositiveInt,
  validateModel,
  validateNonEmpty,
  validateCmuxColor,
  validateField,
  getByPath,
  setByPath,
  getEditableFields,
  MODELS,
  CMUX_COLORS,
} from '../src/config-validate.js';
import { DEFAULT_CONFIG } from '../src/config.js';

describe('CFG-01/CFG-03 — validatePositiveInt (entero positivo, never-throws)', () => {
  it('acepta un entero positivo en string', () => {
    assert.deepEqual(validatePositiveInt('5'), { ok: true, value: 5 });
  });

  it('recorta espacios alrededor del número', () => {
    assert.deepEqual(validatePositiveInt(' 7 '), { ok: true, value: 7 });
  });

  it('rechaza 0 (no positivo)', () => {
    assert.equal(validatePositiveInt('0').ok, false);
  });

  it('rechaza negativos', () => {
    assert.equal(validatePositiveInt('-1').ok, false);
  });

  it('rechaza decimales', () => {
    assert.equal(validatePositiveInt('3.5').ok, false);
  });

  it('rechaza no-numérico', () => {
    assert.equal(validatePositiveInt('abc').ok, false);
  });

  it('rechaza el string vacío', () => {
    assert.equal(validatePositiveInt('').ok, false);
  });

  it('devuelve un error en español cuando rechaza', () => {
    const res = validatePositiveInt('0');
    assert.equal(res.ok, false);
    if (!res.ok) assert.match(res.error, /entero|positivo/i);
  });

  it('never-throws ante input arbitrario (null/undefined/objeto/number)', () => {
    for (const v of [null, undefined, {}, [], 42, NaN, true]) {
      assert.doesNotThrow(() => validatePositiveInt(/** @type {any} */ (v)));
    }
  });
});

describe('CFG-01 — validateModel (set estricto {opus,sonnet,haiku})', () => {
  it('acepta opus/sonnet/haiku', () => {
    assert.deepEqual(validateModel('opus'), { ok: true, value: 'opus' });
    assert.deepEqual(validateModel('sonnet'), { ok: true, value: 'sonnet' });
    assert.deepEqual(validateModel('haiku'), { ok: true, value: 'haiku' });
  });

  it('recorta espacios', () => {
    assert.deepEqual(validateModel('  opus  '), { ok: true, value: 'opus' });
  });

  it('rechaza un proveedor distinto (gpt)', () => {
    assert.equal(validateModel('gpt').ok, false);
  });

  it('rechaza un id completo claude-* (límite del set estricto, Pitfall 6)', () => {
    assert.equal(validateModel('claude-opus-4').ok, false);
  });

  it('rechaza el string vacío', () => {
    assert.equal(validateModel('').ok, false);
  });

  it('never-throws ante input arbitrario', () => {
    for (const v of [null, undefined, {}, 42]) {
      assert.doesNotThrow(() => validateModel(/** @type {any} */ (v)));
    }
  });
});

describe('CFG-02 — validateNonEmpty (string no-vacío, trim)', () => {
  it('acepta un valor con contenido', () => {
    assert.deepEqual(validateNonEmpty('In Progress'), { ok: true, value: 'In Progress' });
  });

  it('recorta espacios alrededor', () => {
    assert.deepEqual(validateNonEmpty('  Done  '), { ok: true, value: 'Done' });
  });

  it('rechaza el string vacío', () => {
    assert.equal(validateNonEmpty('').ok, false);
  });

  it('rechaza solo-espacios', () => {
    assert.equal(validateNonEmpty('   ').ok, false);
  });

  it('never-throws ante input arbitrario', () => {
    for (const v of [null, undefined, {}, 42]) {
      assert.doesNotThrow(() => validateNonEmpty(/** @type {any} */ (v)));
    }
  });
});

describe('CFG-04 — validateCmuxColor (solo los 16 colores nombrados)', () => {
  it('acepta un color nombrado válido', () => {
    assert.deepEqual(validateCmuxColor('Amber'), { ok: true, value: 'Amber' });
    assert.deepEqual(validateCmuxColor('Crimson'), { ok: true, value: 'Crimson' });
  });

  it('recorta espacios', () => {
    assert.deepEqual(validateCmuxColor('  Blue  '), { ok: true, value: 'Blue' });
  });

  it('rechaza el mismo color en minúscula (case-sensitive)', () => {
    assert.equal(validateCmuxColor('amber').ok, false);
  });

  it('rechaza hex (v1 solo nombrados)', () => {
    assert.equal(validateCmuxColor('#FF0000').ok, false);
  });

  it('rechaza un color desconocido', () => {
    assert.equal(validateCmuxColor('Banana').ok, false);
  });

  it('CMUX_COLORS contiene exactamente los 16 nombrados', () => {
    assert.equal(CMUX_COLORS.size, 16);
  });

  it('never-throws ante input arbitrario', () => {
    for (const v of [null, undefined, {}, 42]) {
      assert.doesNotThrow(() => validateCmuxColor(/** @type {any} */ (v)));
    }
  });
});

describe('validateField — dispatcher por field.kind', () => {
  it('despacha a positiveInt', () => {
    assert.deepEqual(validateField({ path: 'x', label: 'x', kind: 'positiveInt' }, '4'), { ok: true, value: 4 });
  });

  it('despacha a model', () => {
    assert.deepEqual(validateField({ path: 'x', label: 'x', kind: 'model' }, 'sonnet'), { ok: true, value: 'sonnet' });
  });

  it('despacha a nonEmpty', () => {
    assert.deepEqual(validateField({ path: 'x', label: 'x', kind: 'nonEmpty' }, 'Hola'), { ok: true, value: 'Hola' });
  });

  it('despacha a cmuxColor', () => {
    assert.deepEqual(validateField({ path: 'x', label: 'x', kind: 'cmuxColor' }, 'Green'), { ok: true, value: 'Green' });
  });

  it('rechaza un kind desconocido sin lanzar', () => {
    const res = validateField(/** @type {any} */ ({ path: 'x', label: 'x', kind: 'wat' }), 'algo');
    assert.equal(res.ok, false);
  });

  it('never-throws ante field/raw arbitrarios', () => {
    assert.doesNotThrow(() => validateField(/** @type {any} */ (null), null));
    assert.doesNotThrow(() => validateField(/** @type {any} */ ({}), undefined));
  });
});

describe('getByPath / setByPath — dot-walk puro', () => {
  it('getByPath lee un valor anidado', () => {
    const o = { a: { b: { c: 7 } } };
    assert.equal(getByPath(o, 'a.b.c'), 7);
  });

  it('setByPath escribe un valor anidado sobre el objeto recibido', () => {
    const o = { a: { b: { c: 1 } } };
    setByPath(o, 'a.b.c', 9);
    assert.equal(o.a.b.c, 9);
  });

  it('setByPath sobre un clon NO muta una segunda referencia (Pitfall 1)', () => {
    const original = structuredClone(DEFAULT_CONFIG);
    const clon = structuredClone(original);
    setByPath(clon, 'claude.default_model', 'haiku');
    assert.equal(clon.claude.default_model, 'haiku');
    assert.equal(original.claude.default_model, 'opus', 'el original no debe verse afectado');
  });

  it('never-throws en getByPath ante path inexistente', () => {
    assert.doesNotThrow(() => getByPath({}, 'a.b.c'));
  });
});

describe('PERSIST-04/D-11 — getEditableFields restringido (sin secretos)', () => {
  const fields = getEditableFields(DEFAULT_CONFIG);

  it('devuelve EXACTAMENTE 11 descriptores', () => {
    assert.equal(fields.length, 11);
  });

  it('cada descriptor tiene {path,label,kind}', () => {
    for (const f of fields) {
      assert.equal(typeof f.path, 'string');
      assert.equal(typeof f.label, 'string');
      assert.equal(typeof f.kind, 'string');
    }
  });

  it('NINGÚN path incluye api_key_env / base_url / workspace_slug / provider (blindaje PERSIST-04)', () => {
    for (const f of fields) {
      assert.doesNotMatch(f.path, /api_key_env|base_url|workspace_slug/);
      assert.notEqual(f.path, 'provider');
    }
  });

  it('los paths de states se resuelven contra el provider activo', () => {
    const paths = fields.map((f) => f.path);
    assert.ok(paths.includes('providers.plane.states.trigger'));
    assert.ok(paths.includes('providers.plane.states.review'));
    assert.ok(paths.includes('providers.plane.states.done'));
  });

  it('incluye los campos esperados de claude/server/cmux', () => {
    const paths = fields.map((f) => f.path);
    for (const expected of [
      'claude.default_model',
      'claude.max_parallel',
      'server.idle_threshold_min',
      'server.stuck_threshold_min',
      'cmux.colors.running',
      'cmux.colors.done',
      'cmux.colors.error',
      'cmux.colors.review',
    ]) {
      assert.ok(paths.includes(expected), `falta el path ${expected}`);
    }
  });

  it('cada path editable resuelve a un valor existente en DEFAULT_CONFIG vía getByPath', () => {
    for (const f of fields) {
      assert.notEqual(getByPath(DEFAULT_CONFIG, f.path), undefined, `path sin valor: ${f.path}`);
    }
  });

  it('MODELS contiene exactamente opus/sonnet/haiku', () => {
    assert.deepEqual([...MODELS].sort(), ['haiku', 'opus', 'sonnet']);
  });
});
