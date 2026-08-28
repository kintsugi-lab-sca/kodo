// @ts-check
//
// test/dashboard/config-editor.test.js — KODO-40.
//
// Suite unit del módulo extraído `src/cli/dashboard/ConfigEditor.js`: apertura (`e`), navegación
// de la lista de campos (mode:'config') y el text-input controlado (mode:'config-edit'), incluido
// el renglón APPEND de la API key. Complementa `test/dashboard-config.test.js` y
// `test/dashboard-mask.test.js`, que cubren el mismo contrato end-to-end sobre ink.
//
// Pitfall 11 / PERSIST-04: aquí se asserta también que el valor de la API key NO se precarga en el
// buffer y que NO se enruta a onSaveConfig (config.json) — solo a onSaveApiKey (.env).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  openConfigEditor,
  handleConfigInput,
  handleConfigEditInput,
  DEFAULT_EDITOR_CONFIG,
  CONFIG_SAVED_RESTART,
  CONFIG_SAVE_FAILED,
  API_KEY_INVALID,
  API_KEY_SAVED_RESTART,
  API_KEY_SAVE_FAILED,
} from '../../src/cli/dashboard/ConfigEditor.js';
import { getEditableFields } from '../../src/config-validate.js';
import { makeCtx, KEY, called } from '../helpers/dashboard-ctx.js';

const SNAP = () => structuredClone({
  ...DEFAULT_EDITOR_CONFIG,
  providers: { plane: { ...DEFAULT_EDITOR_CONFIG.providers.plane, api_key_env: 'PLANE_API_KEY' } },
});
const FIELDS = getEditableFields(SNAP());

describe('ConfigEditor — apertura (`e`)', () => {
  it('congela un CLON del config (Pitfall 1: nunca aliasea el objeto de loadConfigFn)', () => {
    const original = SNAP();
    const ctx = makeCtx({ loadConfigFn: () => original, fieldCursor: 5, configEditError: 'previo' });
    openConfigEditor(ctx);
    assert.equal(ctx.mode, 'config');
    assert.equal(ctx.fieldCursor, 0);
    assert.equal(ctx.configEditError, null);
    assert.notEqual(ctx.configSnapshot, original, 'debe ser un clon, no el mismo objeto');
    assert.deepEqual(ctx.configSnapshot, original, 'con el mismo contenido');
    ctx.configSnapshot.claude.max_parallel = 99;
    assert.notEqual(original.claude.max_parallel, 99, 'mutar el clon NO toca el original');
  });
});

describe('ConfigEditor — mode:config (lista navegable)', () => {
  it('Esc vuelve a list SIN tocar el cursor de la tabla (UX-03)', () => {
    const ctx = makeCtx({ configSnapshot: SNAP() });
    handleConfigInput('', KEY.escape, ctx);
    assert.equal(ctx.mode, 'list');
  });

  it('↑ hace clamp en 0; ↓ llega HASTA fields.length (el renglón APPEND de la API key)', () => {
    const ctx = makeCtx({ configSnapshot: SNAP(), fieldCursor: 0 });
    handleConfigInput('', KEY.up, ctx);
    assert.equal(ctx.fieldCursor, 0);
    ctx.fieldCursor = FIELDS.length;
    handleConfigInput('', KEY.down, ctx);
    assert.equal(ctx.fieldCursor, FIELDS.length, 'el clamp superior es length, NO length-1');
  });

  it('Enter sobre un campo normal PRECARGA su valor actual con el cursor al final', () => {
    const idx = FIELDS.findIndex((f) => f.path === 'claude.default_model');
    const ctx = makeCtx({ configSnapshot: SNAP(), fieldCursor: idx });
    handleConfigInput('', KEY.enter, ctx);
    assert.equal(ctx.mode, 'config-edit');
    assert.equal(ctx.maskValue, false);
    assert.equal(ctx.buffer, 'opus', 'precarga el valor ACTUAL del campo');
    assert.equal(ctx.cursor, ctx.buffer.length, 'cursor al final (append natural)');
  });

  it('Enter sobre el renglón de API key entra ENMASCARADO y con el buffer VACÍO (Pitfall 6/11)', () => {
    const ctx = makeCtx({ configSnapshot: SNAP(), fieldCursor: FIELDS.length, buffer: 'residuo' });
    handleConfigInput('', KEY.enter, ctx);
    assert.equal(ctx.mode, 'config-edit');
    assert.equal(ctx.buffer, '', 'JAMÁS se precarga el secreto');
    assert.equal(ctx.cursor, 0);
    assert.equal(ctx.maskValue, true);
  });

  it('cualquier otra tecla se traga mientras navega', () => {
    const ctx = makeCtx({ configSnapshot: SNAP() });
    handleConfigInput('z', KEY.none, ctx);
    assert.deepEqual(ctx.calls, []);
  });
});

describe('ConfigEditor — mode:config-edit (text-input)', () => {
  it('inserta EN la posición del cursor, no append ciego', async () => {
    const ctx = makeCtx({ configSnapshot: SNAP(), fieldCursor: 0, buffer: 'ac', cursor: 1 });
    await handleConfigEditInput('b', KEY.none, ctx);
    assert.equal(ctx.buffer, 'abc');
    assert.equal(ctx.cursor, 2);
  });

  it('backspace borra el char ANTERIOR al cursor; ←/→ hacen clamp', async () => {
    const ctx = makeCtx({ configSnapshot: SNAP(), fieldCursor: 0, buffer: 'abc', cursor: 2 });
    await handleConfigEditInput('', KEY.backspace, ctx);
    assert.equal(ctx.buffer, 'ac');
    assert.equal(ctx.cursor, 1);
    ctx.cursor = 0;
    await handleConfigEditInput('', KEY.left, ctx);
    assert.equal(ctx.cursor, 0, 'clamp inferior');
    ctx.cursor = ctx.buffer.length;
    await handleConfigEditInput('', KEY.right, ctx);
    assert.equal(ctx.cursor, ctx.buffer.length, 'clamp superior');
  });

  it('Enter con valor INVÁLIDO no toca el disco y se queda en config-edit (CFG-05/D-05)', async () => {
    let saves = 0;
    const snap = SNAP();
    const idx = FIELDS.findIndex((f) => f.path === 'claude.max_parallel');
    assert.ok(idx >= 0, 'el fixture debe incluir un campo positiveInt');
    const ctx = makeCtx({
      configSnapshot: snap,
      fieldCursor: idx,
      buffer: 'no-es-un-entero',
      onSaveConfig: async () => {
        saves++;
        return { ok: true };
      },
    });
    await handleConfigEditInput('', KEY.enter, ctx);
    assert.equal(saves, 0, 'un inválido NUNCA alcanza el disco');
    assert.equal(called(ctx, 'setMode').length, 0, 'sigue en config-edit: no cambia de modo');
    assert.ok(ctx.configEditError, 'el error va en el estado DEDICADO');
  });

  it('Enter válido guarda sobre un DEEP-CLONE y avisa del reinicio', async () => {
    const snap = SNAP();
    let saved = null;
    const idx = FIELDS.findIndex((f) => f.path === 'claude.max_parallel');
    const ctx = makeCtx({
      configSnapshot: snap,
      fieldCursor: idx,
      buffer: '7',
      onSaveConfig: async (c) => {
        saved = c;
        return { ok: true };
      },
    });
    await handleConfigEditInput('', KEY.enter, ctx);
    assert.equal(saved.claude.max_parallel, 7);
    assert.equal(snap.claude.max_parallel, 3, 'el snapshot congelado NO se muta in-place');
    assert.equal(ctx.focusError, CONFIG_SAVED_RESTART);
    assert.equal(ctx.footerColor, 'yellow');
    assert.equal(ctx.mode, 'config');
  });

  it('escritura fallida → CONFIG_SAVE_FAILED en configEditError y NO vuelve a config (UX-04/D-12)', async () => {
    const idx = FIELDS.findIndex((f) => f.path === 'claude.max_parallel');
    const ctx = makeCtx({ configSnapshot: SNAP(), fieldCursor: idx, buffer: '7', onSaveConfig: async () => ({ ok: false }) });
    await handleConfigEditInput('', KEY.enter, ctx);
    assert.equal(ctx.configEditError, CONFIG_SAVE_FAILED);
    assert.equal(called(ctx, 'setMode').length, 0, 'no vuelve a config: el operador sigue en el editor');
  });

  it('onSaveConfig que LANZA no rompe el panel (never-throws de respaldo)', async () => {
    const idx = FIELDS.findIndex((f) => f.path === 'claude.max_parallel');
    const ctx = makeCtx({
      configSnapshot: SNAP(),
      fieldCursor: idx,
      buffer: '7',
      onSaveConfig: async () => {
        throw new Error('EIO');
      },
    });
    await handleConfigEditInput('', KEY.enter, ctx);
    assert.equal(ctx.configEditError, CONFIG_SAVE_FAILED);
  });
});

describe('ConfigEditor — renglón de API key (PERSIST-04 / Pitfall 11)', () => {
  const apiCtx = (over = {}) => makeCtx({ configSnapshot: SNAP(), fieldCursor: FIELDS.length, maskValue: true, ...over });

  it('Esc limpia el buffer y la máscara: el secreto tecleado NO queda en memoria (Pitfall 6)', async () => {
    const ctx = apiCtx({ buffer: 'secreto-tecleado' });
    await handleConfigEditInput('', KEY.escape, ctx);
    assert.equal(ctx.buffer, '');
    assert.equal(ctx.maskValue, false);
    assert.equal(ctx.mode, 'config');
  });

  it('buffer vacío → API_KEY_INVALID, sin llamar al escritor', async () => {
    let calls = 0;
    const ctx = apiCtx({ buffer: '', onSaveApiKey: async () => { calls++; return { ok: true }; } });
    await handleConfigEditInput('', KEY.enter, ctx);
    assert.equal(ctx.configEditError, API_KEY_INVALID);
    assert.equal(calls, 0);
  });

  it('el valor va a onSaveApiKey (.env) y JAMÁS a onSaveConfig (config.json)', async () => {
    const seen = [];
    let structural = 0;
    const ctx = apiCtx({
      buffer: 'plane_pat_123',
      onSaveApiKey: async (k, v) => {
        seen.push([k, v]);
        return { ok: true };
      },
      onSaveConfig: async () => {
        structural++;
        return { ok: true };
      },
    });
    await handleConfigEditInput('', KEY.enter, ctx);
    assert.deepEqual(seen, [['PLANE_API_KEY', 'plane_pat_123']]);
    assert.equal(structural, 0, 'el secreto no debe pasar por el escritor estructural');
    assert.equal(ctx.buffer, '', 'tras guardar, el secreto se borra de memoria');
    assert.equal(ctx.maskValue, false);
    assert.equal(ctx.focusError, API_KEY_SAVED_RESTART);
    assert.equal(ctx.mode, 'config');
  });

  it('fallo de escritura → API_KEY_SAVE_FAILED y se sigue en config-edit', async () => {
    const ctx = apiCtx({ buffer: 'x', onSaveApiKey: async () => ({ ok: false }) });
    await handleConfigEditInput('', KEY.enter, ctx);
    assert.equal(ctx.configEditError, API_KEY_SAVE_FAILED);
    assert.equal(called(ctx, 'setMode').length, 0, 'no vuelve a config: el operador sigue en el editor');
  });
});

describe('ConfigEditor — contrato de re-export', () => {
  it('App.js re-exporta los literales CONFIG_*/API_KEY_* sin alterarlos', async () => {
    const App = await import('../../src/cli/dashboard/App.js');
    const Mod = await import('../../src/cli/dashboard/ConfigEditor.js');
    for (const name of Object.keys(Mod).filter((k) => /^(CONFIG_|API_KEY_)/.test(k))) {
      assert.equal(App[name], Mod[name], `App.js debe re-exportar ${name}`);
    }
  });
});
