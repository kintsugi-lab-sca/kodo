// @ts-check
//
// test/dashboard/adopt-picker.test.js — KODO-40.
//
// Suite unit del módulo extraído `src/cli/dashboard/AdoptPicker.js`: apertura del picker (`a` en
// list), navegación/armado dentro del picker, el estado transitorio `deriving` y la rama ADOPT del
// double-confirm. Complementa `test/dashboard/app-adopt.test.js` y `app-derive.test.js`, que
// siguen cubriendo el mismo contrato end-to-end sobre ink.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  openAdoptPicker,
  handleAdoptPickerInput,
  handleDerivingInput,
  handleAdoptConfirmInput,
  ADOPT_NONE,
  ADOPT_OK,
  ADOPT_ALREADY,
  ADOPT_NO_PROJECT,
  ADOPT_ERR_ENOENT,
  adoptErrFailed,
} from '../../src/cli/dashboard/AdoptPicker.js';
import { makeCtx, KEY } from '../helpers/dashboard-ctx.js';

// `kind: 'claude'` es LOAD-BEARING: computeAdoptable descarta cualquier otro tipo de surface.
const SURFACE = { workspaceRef: 'workspace:9', cwd: '/repo/kodo', sessionId: 's-ad-hoc', kind: 'claude', title: 'cmux title' };

describe('AdoptPicker — apertura (`a` en mode:list)', () => {
  it('sin adoptables → footer ADOPT_NONE ámbar y NO abre el picker (D-02/D-03)', async () => {
    const ctx = makeCtx({ onAdoptDiscover: async () => [] });
    await openAdoptPicker(ctx);
    assert.equal(ctx.focusError, ADOPT_NONE);
    assert.equal(ctx.footerColor, 'yellow');
    assert.equal(ctx.mode, 'list', 'no debe abrir overlay');
    assert.equal(ctx.overlaySnapshot, null);
  });

  it('host sin soporte (onAdoptDiscover ausente) → fail-open a [] → ADOPT_NONE, never-throws', async () => {
    const ctx = makeCtx({ onAdoptDiscover: undefined });
    await openAdoptPicker(ctx);
    assert.equal(ctx.focusError, ADOPT_NONE);
    assert.equal(ctx.mode, 'list');
  });

  it('con adoptables → snapshot congelado kind:adopt, cursor a 0 y mode:overlay', async () => {
    const ctx = makeCtx({ onAdoptDiscover: async () => [SURFACE], sessions: [], adoptCursor: 7 });
    await openAdoptPicker(ctx);
    assert.equal(ctx.mode, 'overlay');
    assert.equal(ctx.overlayKind, 'adopt');
    assert.equal(ctx.adoptCursor, 0, 'el picker siempre abre en la primera fila');
    assert.deepEqual(ctx.overlaySnapshot.adoptable, [SURFACE]);
  });

  it('diffea contra el snapshot vivo de /status: una surface YA adoptada no es adoptable', async () => {
    const ctx = makeCtx({
      onAdoptDiscover: async () => [SURFACE],
      sessions: [{ session_id: 's-ad-hoc', task_id: 't1' }],
    });
    await openAdoptPicker(ctx);
    assert.equal(ctx.focusError, ADOPT_NONE);
    assert.equal(ctx.mode, 'list');
  });

  it('CR-01: si el token avanza durante el descubrimiento, la apertura se DESCARTA', async () => {
    const ctx = makeCtx({
      onAdoptDiscover: async () => {
        ctx.overlayReqRef.current += 3;
        return [SURFACE];
      },
    });
    await openAdoptPicker(ctx);
    assert.equal(ctx.mode, 'list');
    assert.equal(ctx.overlaySnapshot, null);
  });
});

describe('AdoptPicker — navegación y armado dentro del picker', () => {
  const snapshot = { kind: 'adopt', taskRef: '', status: 'ok', lines: [], adoptable: [SURFACE, { ...SURFACE, sessionId: 's2' }] };

  it('↑/↓ mueven el cursor con clamp [0, len-1] SIN wrap', async () => {
    const ctx = makeCtx({ overlaySnapshot: snapshot, adoptCursor: 0 });
    await handleAdoptPickerInput('', KEY.up, ctx);
    assert.equal(ctx.adoptCursor, 0, 'clamp inferior');
    await handleAdoptPickerInput('', KEY.down, ctx);
    assert.equal(ctx.adoptCursor, 1);
    await handleAdoptPickerInput('', KEY.down, ctx);
    assert.equal(ctx.adoptCursor, 1, 'clamp superior, sin wrap');
  });

  it('`a` con reverse-lookup ambiguo/ausente → ADOPT_NO_PROJECT rojo, cierra el picker y NO arma (D-05)', async () => {
    const ctx = makeCtx({ overlaySnapshot: snapshot, adoptCursor: 0, projects: {} });
    await handleAdoptPickerInput('a', KEY.none, ctx);
    assert.equal(ctx.focusError, ADOPT_NO_PROJECT('/repo/kodo'));
    assert.equal(ctx.footerColor, 'red');
    assert.equal(ctx.mode, 'list');
    assert.equal(ctx.armedSessionId, undefined, 'nunca arma el confirm');
  });

  it('`a` con match único → arma por sessionId, pasa por deriving y aterriza en confirm', async () => {
    const seen = [];
    const ctx = makeCtx({
      overlaySnapshot: snapshot,
      adoptCursor: 0,
      projects: { 'proj-1': '/repo/kodo' },
      onDerive: async (args) => {
        seen.push(args);
        return { title: 'título derivado', description: 'desc derivada' };
      },
    });
    await handleAdoptPickerInput('a', KEY.none, ctx);
    assert.equal(ctx.armedSessionId, 's-ad-hoc');
    assert.equal(ctx.mode, 'confirm');
    assert.deepEqual(seen, [{ cwd: '/repo/kodo', sessionId: 's-ad-hoc' }]);
    assert.equal(ctx.armedSurface.title, 'título derivado');
    assert.equal(ctx.armedSurface.description, 'desc derivada');
    assert.equal(ctx.armedSurface.projectId, 'proj-1');
    const modes = ctx.calls.filter((c) => c[0] === 'setMode').map((c) => c[1]);
    assert.deepEqual(modes, ['deriving', 'confirm'], 'el transitorio deriving va ENTRE armado y confirm');
  });

  it('T4 fail-open: si onDerive lanza, se conserva el title de la surface y NO se rompe el flujo', async () => {
    const ctx = makeCtx({
      overlaySnapshot: snapshot,
      adoptCursor: 0,
      projects: { 'proj-1': '/repo/kodo' },
      onDerive: async () => {
        throw new Error('boom');
      },
    });
    await handleAdoptPickerInput('a', KEY.none, ctx);
    assert.equal(ctx.mode, 'confirm');
    assert.equal(ctx.armedSurface.title, 'cmux title');
    assert.equal(ctx.armedSurface.description, undefined);
  });

  it('T5 staleness: si el token avanza durante onDerive, NO se abre el confirm', async () => {
    const ctx = makeCtx({
      overlaySnapshot: snapshot,
      adoptCursor: 0,
      projects: { 'proj-1': '/repo/kodo' },
      onDerive: async () => {
        ctx.overlayReqRef.current += 4; // Esc en deriving
        return { title: 'tardío' };
      },
    });
    await handleAdoptPickerInput('a', KEY.none, ctx);
    assert.equal(ctx.mode, 'deriving', 'se queda donde lo dejó el Esc simulado, sin reabrir confirm');
  });

  it('cualquier otra tecla se traga mientras se elige', async () => {
    const ctx = makeCtx({ overlaySnapshot: snapshot, adoptCursor: 0 });
    await handleAdoptPickerInput('z', KEY.none, ctx);
    assert.deepEqual(ctx.calls, []);
  });
});

describe('AdoptPicker — mode:deriving', () => {
  it('Esc invalida la derivación en vuelo, limpia el armado y vuelve a list', () => {
    const ctx = makeCtx({ armedSessionId: 's1', armedSurface: { workspaceRef: 'w' }, mode: 'deriving' });
    handleDerivingInput(KEY.escape, ctx);
    assert.equal(ctx.overlayReqRef.current, 1);
    assert.equal(ctx.armedSessionId, null);
    assert.equal(ctx.armedSurface, null);
    assert.equal(ctx.mode, 'list');
  });

  it('una segunda `a` se TRAGA: no encola un segundo onDerive', () => {
    const ctx = makeCtx({ mode: 'deriving' });
    handleDerivingInput(KEY.none, ctx);
    assert.deepEqual(ctx.calls, []);
    assert.equal(ctx.mode, 'deriving');
  });
});

describe('AdoptPicker — rama ADOPT del confirm', () => {
  const armed = { workspaceRef: 'workspace:9', cwd: '/repo/kodo', sessionId: 's1', projectId: 'p1' };

  it('segunda `a` con éxito → footer verde ADOPT_OK y limpia el armado', async () => {
    const ctx = makeCtx({ armedSurface: armed, onAdopt: async () => ({ ok: true }) });
    await handleAdoptConfirmInput('a', ctx);
    assert.equal(ctx.focusError, ADOPT_OK('workspace:9'));
    assert.equal(ctx.footerColor, 'green');
    assert.equal(ctx.armedSessionId, null);
    assert.equal(ctx.mode, 'list');
  });

  it('ALREADY_ADOPTED gana sobre el éxito genérico → ámbar, no verde engañoso (56-03)', async () => {
    const ctx = makeCtx({ armedSurface: armed, onAdopt: async () => ({ ok: true, code: 'ALREADY_ADOPTED' }) });
    await handleAdoptConfirmInput('a', ctx);
    assert.equal(ctx.focusError, ADOPT_ALREADY('workspace:9'));
    assert.equal(ctx.footerColor, 'yellow');
  });

  it('ENOENT y NON_ZERO_EXIT mapean a sus literales rojos', async () => {
    const a = makeCtx({ armedSurface: armed, onAdopt: async () => ({ ok: false, code: 'ENOENT' }) });
    await handleAdoptConfirmInput('a', a);
    assert.equal(a.focusError, ADOPT_ERR_ENOENT);

    const b = makeCtx({ armedSurface: armed, onAdopt: async () => ({ ok: false, code: 'NON_ZERO_EXIT', detail: 2 }) });
    await handleAdoptConfirmInput('a', b);
    assert.equal(b.focusError, adoptErrFailed(2));
    assert.equal(b.footerColor, 'red');
  });

  it('`d` y cualquier otra tecla CANCELAN el adopt sin invocar onAdopt (Pitfall 2)', async () => {
    let invoked = 0;
    const ctx = makeCtx({
      armedSurface: armed,
      onAdopt: async () => {
        invoked++;
        return { ok: true };
      },
    });
    await handleAdoptConfirmInput('d', ctx);
    assert.equal(invoked, 0, 'una `d` JAMÁS dispara un adopt');
    assert.equal(ctx.armedSessionId, null);
    assert.equal(ctx.mode, 'list');
    assert.equal(ctx.focusError, undefined, 'cancelar es silencioso (D-04)');
  });

  it('WR guard: armedSurface null aborta silenciosamente', async () => {
    const ctx = makeCtx({ armedSurface: null, onAdopt: async () => ({ ok: true }) });
    await handleAdoptConfirmInput('a', ctx);
    assert.equal(ctx.mode, 'list');
    assert.equal(ctx.focusError, undefined);
  });
});

describe('AdoptPicker — contrato de re-export', () => {
  it('App.js re-exporta los literales ADOPT_*/DERIVE_* sin alterarlos', async () => {
    const App = await import('../../src/cli/dashboard/App.js');
    const Mod = await import('../../src/cli/dashboard/AdoptPicker.js');
    for (const name of Object.keys(Mod).filter((k) => /^(ADOPT_|DERIVE_|adoptErr)/.test(k))) {
      assert.equal(App[name], Mod[name], `App.js debe re-exportar ${name}`);
    }
  });
});
