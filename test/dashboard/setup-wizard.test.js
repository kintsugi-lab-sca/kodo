// @ts-check
//
// test/dashboard/setup-wizard.test.js — KODO-40.
//
// Suite unit del módulo extraído `src/cli/dashboard/SetupWizard.js`: los 4 pasos lineales del
// guiado first-run. Complementa `test/dashboard/app-setup.test.js` (end-to-end sobre ink) y el
// bloque PERSIST-04 de `test/config-env-writer.test.js` (grep source-level de los 5 sinks).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  handleSetupInput,
  SETUP_PROVIDERS,
  SETUP_GITHUB_REDIRECT,
  SETUP_INVALID,
  SETUP_SAVE_FAILED,
} from '../../src/cli/dashboard/SetupWizard.js';
import { API_KEY_INVALID } from '../../src/cli/dashboard/ConfigEditor.js';
import { makeCtx, KEY, called } from '../helpers/dashboard-ctx.js';

const SNAP = () => ({ provider: 'plane', providers: { plane: { api_key_env: 'PLANE_API_KEY' } } });

describe('SetupWizard — salida y paso 1/4 (provider)', () => {
  it('Esc cierra a list SIN escribir nada', async () => {
    let saves = 0;
    const ctx = makeCtx({ configSnapshot: SNAP(), setupStep: 'provider', onSaveConfig: async () => { saves++; return { ok: true }; } });
    await handleSetupInput('', KEY.escape, ctx);
    assert.equal(ctx.mode, 'list');
    assert.equal(saves, 0);
  });

  it('Esc en el paso apikey limpia el buffer y la máscara (Pitfall 6: el secreto no persiste)', async () => {
    const ctx = makeCtx({ configSnapshot: SNAP(), setupStep: 'apikey', buffer: 'secreto', maskValue: true });
    await handleSetupInput('', KEY.escape, ctx);
    assert.equal(ctx.buffer, '');
    assert.equal(ctx.maskValue, false);
    assert.equal(ctx.mode, 'list');
  });

  it('↑/↓ mueven el cursor de provider con clamp sin wrap', async () => {
    const ctx = makeCtx({ configSnapshot: SNAP(), setupStep: 'provider', providerCursor: 0 });
    await handleSetupInput('', KEY.up, ctx);
    assert.equal(ctx.providerCursor, 0);
    await handleSetupInput('', KEY.down, ctx);
    assert.equal(ctx.providerCursor, 1);
    await handleSetupInput('', KEY.down, ctx);
    assert.equal(ctx.providerCursor, SETUP_PROVIDERS.length - 1, 'clamp superior');
  });

  it('elegir github NO continúa el guiado ni escribe: aviso ámbar y se queda en provider (D-06)', async () => {
    let saves = 0;
    const ctx = makeCtx({
      configSnapshot: SNAP(),
      setupStep: 'provider',
      providerCursor: SETUP_PROVIDERS.indexOf('github'),
      onSaveConfig: async () => { saves++; return { ok: true }; },
    });
    await handleSetupInput('', KEY.enter, ctx);
    assert.equal(ctx.focusError, SETUP_GITHUB_REDIRECT);
    assert.equal(ctx.footerColor, 'yellow');
    assert.equal(saves, 0);
    assert.equal(called(ctx, 'setSetupStep').length, 0, 'no avanza de paso');
  });

  it('elegir plane guarda provider sobre un CLON y avanza a base_url', async () => {
    const snap = SNAP();
    let saved = null;
    const ctx = makeCtx({
      configSnapshot: snap,
      setupStep: 'provider',
      providerCursor: SETUP_PROVIDERS.indexOf('plane'),
      buffer: 'residuo',
      onSaveConfig: async (c) => { saved = c; return { ok: true }; },
    });
    await handleSetupInput('', KEY.enter, ctx);
    assert.equal(saved.provider, 'plane');
    assert.notEqual(saved, snap, 'deep-clone antes de mutar (Pitfall 1)');
    assert.equal(ctx.setupStep, 'base_url');
    assert.equal(ctx.buffer, '', 'el text-input arranca limpio en el paso siguiente');
    assert.equal(ctx.cursor, 0);
  });
});

describe('SetupWizard — pasos 2/4 y 3/4 (base_url / workspace_slug)', () => {
  it('valor vacío o con espacios/#/= → SETUP_INVALID y NO escribe', async () => {
    for (const bad of ['', 'con espacio', 'a#b', 'a=b']) {
      let saves = 0;
      const ctx = makeCtx({
        configSnapshot: SNAP(),
        setupStep: 'base_url',
        buffer: bad,
        onSaveConfig: async () => { saves++; return { ok: true }; },
      });
      await handleSetupInput('', KEY.enter, ctx);
      assert.equal(ctx.configEditError, SETUP_INVALID, `"${bad}" debe rechazarse`);
      assert.equal(saves, 0);
    }
  });

  it('base_url válido escribe providers.plane.base_url y avanza a workspace_slug', async () => {
    let saved = null;
    const ctx = makeCtx({
      configSnapshot: SNAP(),
      setupStep: 'base_url',
      buffer: 'https://tasks.example.com',
      onSaveConfig: async (c) => { saved = c; return { ok: true }; },
    });
    await handleSetupInput('', KEY.enter, ctx);
    assert.equal(saved.providers.plane.base_url, 'https://tasks.example.com');
    assert.equal(ctx.setupStep, 'workspace_slug');
    assert.equal(ctx.maskValue, undefined, 'aún no se enmascara: eso es el paso 4/4');
  });

  it('workspace_slug válido avanza a apikey ACTIVANDO la máscara (D-11)', async () => {
    const ctx = makeCtx({ configSnapshot: SNAP(), setupStep: 'workspace_slug', buffer: 'k-lab' });
    await handleSetupInput('', KEY.enter, ctx);
    assert.equal(ctx.setupStep, 'apikey');
    assert.equal(ctx.maskValue, true);
  });

  it('fallo de escritura → SETUP_SAVE_FAILED y NO avanza de paso', async () => {
    const ctx = makeCtx({ configSnapshot: SNAP(), setupStep: 'base_url', buffer: 'https://x', onSaveConfig: async () => ({ ok: false }) });
    await handleSetupInput('', KEY.enter, ctx);
    assert.equal(ctx.configEditError, SETUP_SAVE_FAILED);
    assert.equal(called(ctx, 'setSetupStep').length, 0);
  });

  it('el text-input inserta en el cursor y borra el char anterior', async () => {
    const ctx = makeCtx({ configSnapshot: SNAP(), setupStep: 'base_url', buffer: 'ac', cursor: 1 });
    await handleSetupInput('b', KEY.none, ctx);
    assert.equal(ctx.buffer, 'abc');
    await handleSetupInput('', KEY.backspace, ctx);
    assert.equal(ctx.buffer, 'ac');
  });
});

describe('SetupWizard — paso 4/4 (API key) y estado terminal', () => {
  it('buffer vacío → API_KEY_INVALID sin llamar al escritor', async () => {
    let calls = 0;
    const ctx = makeCtx({ configSnapshot: SNAP(), setupStep: 'apikey', buffer: '', onSaveApiKey: async () => { calls++; return { ok: true }; } });
    await handleSetupInput('', KEY.enter, ctx);
    assert.equal(ctx.configEditError, API_KEY_INVALID);
    assert.equal(calls, 0);
  });

  it('el valor va SOLO a onSaveApiKey (.env), nunca a onSaveConfig (config.json)', async () => {
    const seen = [];
    let structural = 0;
    const ctx = makeCtx({
      configSnapshot: SNAP(),
      setupStep: 'apikey',
      buffer: 'plane_pat_xyz',
      maskValue: true,
      onSaveApiKey: async (k, v) => { seen.push([k, v]); return { ok: true }; },
      onSaveConfig: async () => { structural++; return { ok: true }; },
    });
    await handleSetupInput('', KEY.enter, ctx);
    assert.deepEqual(seen, [['PLANE_API_KEY', 'plane_pat_xyz']]);
    assert.equal(structural, 0);
    assert.equal(ctx.buffer, '', 'tras guardar, el secreto sale de memoria (Pitfall 6)');
    assert.equal(ctx.maskValue, false);
    assert.equal(ctx.setupStep, 'complete');
  });

  it('en `complete`, cualquier tecla cierra el guiado a list (D-08)', async () => {
    const ctx = makeCtx({ configSnapshot: SNAP(), setupStep: 'complete' });
    await handleSetupInput('x', KEY.none, ctx);
    assert.equal(ctx.mode, 'list');
  });
});

describe('SetupWizard — robustez', () => {
  it('sin configSnapshot (timing del efecto de montaje) clona uno fresco y sigue', async () => {
    let saved = null;
    const ctx = makeCtx({
      configSnapshot: null,
      setupStep: 'provider',
      providerCursor: 0,
      loadConfigFn: () => SNAP(),
      onSaveConfig: async (c) => { saved = c; return { ok: true }; },
    });
    await handleSetupInput('', KEY.enter, ctx);
    assert.equal(saved.provider, 'plane', 'fail-open: nunca lanza por un snapshot ausente');
  });

  it('App.js re-exporta los literales SETUP_* sin alterarlos', async () => {
    const App = await import('../../src/cli/dashboard/App.js');
    const Mod = await import('../../src/cli/dashboard/SetupWizard.js');
    for (const name of Object.keys(Mod).filter((k) => k.startsWith('SETUP_'))) {
      assert.deepEqual(App[name], Mod[name], `App.js debe re-exportar ${name}`);
    }
  });
});
