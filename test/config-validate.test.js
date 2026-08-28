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
  validateHostName,
  validateNudgeMode,
  MODELS,
  CMUX_COLORS,
  HOST_NAMES,
  NUDGE_MODES,
} from '../src/config-validate.js';
import { DEFAULT_CONFIG, mergeAndValidateConfig } from '../src/config.js';

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

describe('CFG-01 — validateModel (set estricto {fable,opus,sonnet,haiku})', () => {
  it('acepta fable/opus/sonnet/haiku', () => {
    assert.deepEqual(validateModel('fable'), { ok: true, value: 'fable' });
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

  it('devuelve EXACTAMENTE 14 descriptores', () => {
    // KODO-18: 12 → 13. El +1 es `host` (el selector de cliente). Los 4 campos de
    // presentación por estado NO suman: se resuelven contra el host ACTIVO (4 colores
    // de cmux O 4 columnas de Orca, nunca los 8) — el editor no crece por host nuevo.
    // KODO-53: 13 → 14. El +1 es `orchestrator.nudges` (bandeja / teclado / nada). Entra
    // en el registro por la validación al CARGAR —`mergeAndValidateConfig` recorre esta
    // misma lista— para que un valor escrito a mano caiga al default con un warn, en vez
    // de dejar el carril de avisos en un estado que solo se descubriría al cerrar sesión.
    assert.equal(fields.length, 14);
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
      'claude.orchestrator_model',
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

  // KODO-12: `fable` entra al set porque es el default de `claude.orchestrator_model`
  // (alias válido de `claude --model`, verificado contra el binario).
  it('MODELS contiene exactamente fable/opus/sonnet/haiku', () => {
    assert.deepEqual([...MODELS].sort(), ['fable', 'haiku', 'opus', 'sonnet']);
  });
});

describe('KODO-18 — validateHostName (selector de cliente)', () => {
  it('acepta los hosts elegibles', () => {
    assert.deepEqual(validateHostName('cmux'), { ok: true, value: 'cmux' });
    assert.deepEqual(validateHostName('orca'), { ok: true, value: 'orca' });
  });

  it('recorta espacios alrededor del valor', () => {
    assert.deepEqual(validateHostName('  orca '), { ok: true, value: 'orca' });
  });

  it('rechaza `null` — es un host mock-only del contract test, no una elección', () => {
    assert.equal(validateHostName('null').ok, false);
  });

  it('rechaza un host desconocido con un mensaje que lista los válidos', () => {
    const res = validateHostName('tmux');
    assert.equal(res.ok, false);
    assert.match(res.error, /cmux, orca/);
  });

  it('es case-sensitive (se compara por igualdad en getHost)', () => {
    assert.equal(validateHostName('Orca').ok, false);
  });

  it('never-throws ante cualquier tipo', () => {
    for (const raw of [undefined, null, 42, {}, []]) {
      assert.doesNotThrow(() => validateHostName(raw));
      assert.equal(validateHostName(raw).ok, false);
    }
  });

  it('HOST_NAMES es la fuente única: exactamente cmux y orca', () => {
    assert.deepEqual([...HOST_NAMES], ['cmux', 'orca']);
  });
});

describe('KODO-53 — validateNudgeMode (carril de avisos al orquestador)', () => {
  it('acepta los tres modos', () => {
    assert.deepEqual(validateNudgeMode('inbox'), { ok: true, value: 'inbox' });
    assert.deepEqual(validateNudgeMode('keystroke'), { ok: true, value: 'keystroke' });
    assert.deepEqual(validateNudgeMode('off'), { ok: true, value: 'off' });
  });

  it('recorta espacios alrededor del valor', () => {
    assert.deepEqual(validateNudgeMode(' off '), { ok: true, value: 'off' });
  });

  it('rechaza un modo desconocido con un mensaje que lista los válidos', () => {
    const res = validateNudgeMode('todos');
    assert.equal(res.ok, false);
    assert.match(res.error, /inbox, keystroke, off/);
  });

  it('never-throws ante cualquier tipo', () => {
    for (const raw of [undefined, null, 42, {}, []]) {
      assert.doesNotThrow(() => validateNudgeMode(raw));
      assert.equal(validateNudgeMode(raw).ok, false);
    }
  });

  it('NUDGE_MODES es la fuente única: exactamente inbox, keystroke y off', () => {
    assert.deepEqual([...NUDGE_MODES], ['inbox', 'keystroke', 'off']);
  });

  it("DEFAULT_CONFIG.orchestrator.nudges es 'inbox' — el carril nuevo es el default", () => {
    assert.equal(DEFAULT_CONFIG.orchestrator.nudges, 'inbox');
  });

  it('un config SIN la clave la recibe por deep-merge — sin migración, igual que `host` (KODO-18)', () => {
    const merged = mergeAndValidateConfig({ provider: 'plane', providers: { plane: {} } });
    assert.equal(merged.orchestrator.nudges, 'inbox');
  });

  it('un valor escrito a mano e inválido cae al default en vez de dejar el carril indefinido', () => {
    const merged = mergeAndValidateConfig({ orchestrator: { nudges: 'gritos' } });
    assert.equal(merged.orchestrator.nudges, 'inbox');
  });

  it('un `keystroke` explícito SÍ se respeta (es la vuelta atrás opt-in)', () => {
    const merged = mergeAndValidateConfig({ orchestrator: { nudges: 'keystroke' } });
    assert.equal(merged.orchestrator.nudges, 'keystroke');
  });
});

describe('KODO-18 — `host` en el config: default, merge y fallback', () => {
  it("DEFAULT_CONFIG.host es 'cmux' (cero regresión para instalaciones existentes)", () => {
    assert.equal(DEFAULT_CONFIG.host, 'cmux');
  });

  it('un config SIN la clave `host` la recibe por deep-merge — no hace falta migración', () => {
    // Este es el argumento entero de por qué KODO-18 no añade un migrateConfig:
    // loadConfig ya mergea sobre los defaults.
    const merged = mergeAndValidateConfig({ provider: 'plane', providers: { plane: {} } });
    assert.equal(merged.host, 'cmux');
    assert.equal(typeof merged.orca?.binary, 'string');
    assert.equal(merged.orca.statuses.review, 'in-review');
  });

  it('un `host` escrito a mano e inválido cae al default en vez de reventar el daemon', () => {
    // Sin este fallback, getHost() lanzaría `Unknown host` al arrancar el server.
    const merged = mergeAndValidateConfig({ host: 'tmux', providers: { plane: {} } });
    assert.equal(merged.host, 'cmux');
  });

  it("host:'orca' sobrevive al merge y arrastra su bloque", () => {
    const merged = mergeAndValidateConfig({ host: 'orca', providers: { plane: {} } });
    assert.equal(merged.host, 'orca');
    assert.equal(merged.orca.statuses.running, 'in-progress');
  });
});

describe('KODO-18 — getEditableFields resuelve la presentación contra el host ACTIVO', () => {
  it('con host cmux muestra los 4 colores y NINGÚN estado de Orca', () => {
    const paths = getEditableFields({ provider: 'plane', host: 'cmux' }).map((f) => f.path);
    assert.ok(paths.includes('cmux.colors.running'));
    assert.ok(!paths.some((p) => p.startsWith('orca.')), 'un usuario de cmux no ve campos de Orca');
  });

  it('con host orca muestra las 4 columnas y NINGÚN color de cmux', () => {
    const paths = getEditableFields({ provider: 'plane', host: 'orca' }).map((f) => f.path);
    assert.ok(paths.includes('orca.statuses.review'));
    assert.ok(!paths.some((p) => p.startsWith('cmux.')), 'un usuario de Orca no ve colores de cmux');
  });

  it('el total NO crece con el host: 14 en ambos casos', () => {
    assert.equal(getEditableFields({ host: 'cmux' }).length, 14);
    assert.equal(getEditableFields({ host: 'orca' }).length, 14);
  });

  it('KODO-53 — `orchestrator.nudges` es editable y su kind es nudgeMode', () => {
    const field = getEditableFields(DEFAULT_CONFIG).find((f) => f.path === 'orchestrator.nudges');
    assert.ok(field, 'el carril de avisos al orquestador debe ser editable');
    assert.equal(field.kind, 'nudgeMode');
  });

  it('`host` es editable y su kind es hostName', () => {
    const field = getEditableFields(DEFAULT_CONFIG).find((f) => f.path === 'host');
    assert.ok(field, 'el selector de cliente debe ser editable desde el TUI');
    assert.equal(field.kind, 'hostName');
  });

  it('un host desconocido en el snapshot degrada a la vista de cmux (never-throws)', () => {
    const paths = getEditableFields({ host: 'tmux' }).map((f) => f.path);
    assert.ok(paths.includes('cmux.colors.running'));
  });

  it('cada path editable del host orca resuelve en DEFAULT_CONFIG', () => {
    for (const f of getEditableFields({ provider: 'plane', host: 'orca' })) {
      assert.notEqual(getByPath(DEFAULT_CONFIG, f.path), undefined, `path sin valor: ${f.path}`);
    }
  });
});
