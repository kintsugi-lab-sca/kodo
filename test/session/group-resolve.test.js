// @ts-check
//
// test/session/group-resolve.test.js — Phase 77 Plan 02 Task 1 (GRP-01/02/03/04).
//
// Las 3 funciones puras de la agrupación de workspaces en cmux, ejercidas sin FS,
// sin HOME y sin cmux real (todo con fixtures/DI):
//
//   1. deriveExpectedGroupName(task, entry, resolvedPath) → nombre esperado (D-01/D-02/D-08)
//   2. resolveWorkspaceGroup(groupsJson, expectedName)    → ref | null      (D-03/D-07)
//   3. newWorkspaceWithGroupFallback(fn, base, group, log) → workspaceRef    (D-10/D-11)
//
// El fixture `fixtureLive` reproduce el shape REAL capturado el 2026-07-16 del binario
// cmux 0.64.19 (`workspace-group list --json`) — los 3 grupos del operador: Kodo /
// SCRIBBA / SCP-CMRi (RESEARCH §Pattern 2). PROHIBIDO tocar la app cmux real: todo aquí
// es datos inertes y stubs.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  deriveExpectedGroupName,
  resolveWorkspaceGroup,
  newWorkspaceWithGroupFallback,
} from '../../src/session/manager.js';

/**
 * Shape live de `cmux workspace-group list --json` (0.64.19, 2026-07-16).
 * Los refs son los reales: Kodo→1, SCRIBBA→2, SCP-CMRi→4 (member_group:3 no existe).
 */
const fixtureLive = {
  groups: [
    {
      anchor_workspace_ref: 'workspace:11',
      custom_color: null,
      icon_symbol: null,
      is_collapsed: false,
      is_pinned: false,
      member_count: 3,
      member_workspace_refs: ['workspace:11', 'workspace:2', 'workspace:13'],
      name: 'Kodo',
      ref: 'workspace_group:1',
    },
    {
      name: 'SCRIBBA',
      ref: 'workspace_group:2',
      member_workspace_refs: ['workspace:14', 'workspace:4', 'workspace:15'],
    },
    {
      name: 'SCP-CMRi',
      ref: 'workspace_group:4',
      member_workspace_refs: ['workspace:19', 'workspace:20'],
    },
  ],
  window_ref: 'window:1',
};

/** TaskItem mínima con los campos que leen las funciones puras. */
function makeTask(overrides = {}) {
  return {
    id: 'uuid-task',
    ref: 'KODO-9',
    title: 'Fix login bug',
    groups: [],
    projectId: 'proj-uuid',
    ...overrides,
  };
}

describe('deriveExpectedGroupName (D-01/D-02/D-08 · GRP-02)', () => {
  it('entry flat string + ref Plane → identifier a secas (proyecto flat)', () => {
    const task = makeTask({ ref: 'KODO-9' });
    assert.equal(deriveExpectedGroupName(task, '/klab/kodo', '/klab/kodo'), 'KODO');
  });

  it('entry objeto, resolvedPath === entry.default, CON módulo → identifier a secas (colapsa, caso F0..F6 SCP)', () => {
    const task = makeTask({ ref: 'SCP-3', groups: ['F0'] });
    const entry = { default: '/roman/scp-cmri', modules: { FVF: '/roman/fvf' } };
    // El módulo F0 cayó al default (path resuelto == default) → NO compuesto.
    assert.equal(deriveExpectedGroupName(task, entry, '/roman/scp-cmri'), 'SCP');
  });

  it('entry objeto, módulo con path propio distinto del default → IDENTIFIER/Módulo', () => {
    const task = makeTask({ ref: 'ROMAN-3', groups: ['FVF'] });
    const entry = { default: '/roman', modules: { FVF: '/roman/fvf' } };
    assert.equal(deriveExpectedGroupName(task, entry, '/roman/fvf'), 'ROMAN/FVF');
  });

  it('módulo presente pero cayó al default (resolvedPath === entry.default) → identifier a secas (robustez GRP-02)', () => {
    const task = makeTask({ ref: 'ROMAN-3', groups: ['FVF'] });
    const entry = { default: '/roman', modules: { FVF: '/roman/fvf' } };
    // El módulo existe en task.groups PERO el path resuelto es el default →
    // no se separa; identifier a secas.
    assert.equal(deriveExpectedGroupName(task, entry, '/roman'), 'ROMAN');
  });

  it('identifier Plane: strip trailing -<dígitos> sin cortar de más (A2)', () => {
    assert.equal(deriveExpectedGroupName(makeTask({ ref: 'SCP-42' }), '/x', '/x'), 'SCP');
  });

  it('identifier GitHub: owner/repo#n → basename antes de # (A1)', () => {
    assert.equal(deriveExpectedGroupName(makeTask({ ref: 'acme/x#7' }), '/x', '/x'), 'x');
  });

  describe('task.ref degenerado → null directo, sin lanzar y sin nombre bogus (edge GRP-02)', () => {
    for (const [label, ref] of [
      ['string vacío', ''],
      ['solo whitespace', '   '],
      ['undefined', undefined],
      ['no-string (número)', 42],
      ['no-string (objeto)', {}],
    ]) {
      it(`ref = ${label} → null`, () => {
        const task = makeTask({ ref });
        let out;
        assert.doesNotThrow(() => {
          out = deriveExpectedGroupName(task, '/x', '/x');
        });
        assert.equal(out, null);
        // Nunca un nombre bogus tipo 'undefined' o ''.
        assert.notEqual(out, 'undefined');
        assert.notEqual(out, '');
      });
    }

    it('null piped end-to-end: resolveWorkspaceGroup(fixtureLive, deriveExpectedGroupName(refVacío)) → null (fail-open del contrato)', () => {
      const derived = deriveExpectedGroupName(makeTask({ ref: '' }), '/x', '/x');
      assert.equal(derived, null);
      assert.equal(resolveWorkspaceGroup(fixtureLive, derived), null);
    });
  });

  describe('identifier derivado colapsa a vacío → null (WR-01: nunca matchear grupo whitespace-only)', () => {
    it("ref = '#7' → null (basename antes de # es '')", () => {
      // '#7'.split('#')[0] === '' → identifier vacío, NO un nombre bogus que
      // aterrice la tarea en un grupo arbitrario whitespace-only.
      assert.equal(deriveExpectedGroupName(makeTask({ ref: '#7' }), '/x', '/x'), null);
    });

    it("ref = '-9' → null (strip trailing -dígitos deja '')", () => {
      // '-9'.replace(/-\d+$/,'') === '' → identifier vacío → fail-open null.
      assert.equal(deriveExpectedGroupName(makeTask({ ref: '-9' }), '/x', '/x'), null);
    });
  });

  describe('trim del ref antes de derivar (IN-01: whitespace de borde no pierde el grupo)', () => {
    it("ref = 'KODO-9 ' (trailing space) → 'KODO' (el trim del ref evita que el espacio de borde rompa el strip de -dígitos)", () => {
      assert.equal(
        deriveExpectedGroupName(makeTask({ ref: 'KODO-9 ' }), '/klab/kodo', '/klab/kodo'),
        'KODO',
      );
    });

    it("ref = 'KODO-9' (limpio) → 'KODO' (no-regresión del caso base)", () => {
      assert.equal(
        deriveExpectedGroupName(makeTask({ ref: 'KODO-9' }), '/klab/kodo', '/klab/kodo'),
        'KODO',
      );
    });
  });
});

describe('resolveWorkspaceGroup (D-03/D-07 · GRP-01/GRP-03 capa 1)', () => {
  it("match 'KODO' → workspace_group:1 (case-insensitive+trim contra 'Kodo')", () => {
    assert.equal(resolveWorkspaceGroup(fixtureLive, 'KODO'), 'workspace_group:1');
  });

  it("match 'SCRIBBA' → workspace_group:2", () => {
    assert.equal(resolveWorkspaceGroup(fixtureLive, 'SCRIBBA'), 'workspace_group:2');
  });

  it("'SCP' → null (Pitfall 1: scp ≠ scp-cmri; fail-open correcto)", () => {
    assert.equal(resolveWorkspaceGroup(fixtureLive, 'SCP'), null);
  });

  it('empate: dos grupos que normalizan al mismo nombre → ref del PRIMERO (D-03 estable)', () => {
    const dup = {
      groups: [
        { name: ' Dev ', ref: 'workspace_group:10' },
        { name: 'DEV', ref: 'workspace_group:11' },
      ],
    };
    assert.equal(resolveWorkspaceGroup(dup, 'dev'), 'workspace_group:10');
  });

  it('norm = NFC+lowercase+trim: name que difiere solo en caso/espacios matchea igual', () => {
    const g = { groups: [{ name: ' kodo ', ref: 'workspace_group:1' }] };
    assert.equal(resolveWorkspaceGroup(g, 'KODO'), 'workspace_group:1');
  });

  describe('never-throws → null ante shapes inesperados (D-07 · edge GRP-01 empty/GRP-03 capa 1)', () => {
    for (const [label, input] of [
      ['null', null],
      ['undefined', undefined],
      ['{}', {}],
      ['groups no-array (string)', { groups: 'no-array' }],
      ['groups con name no-string', { groups: [{ name: 5, ref: 'workspace_group:9' }] }],
      ['groups con ref no-string', { groups: [{ name: 'KODO', ref: 99 }] }],
      ['groups vacío', { groups: [] }],
    ]) {
      it(`${label} → null sin lanzar`, () => {
        let out;
        assert.doesNotThrow(() => {
          out = resolveWorkspaceGroup(input, 'KODO');
        });
        assert.equal(out, null);
      });
    }

    it('expectedName null → null (contrato de entrada malformada, no matchea ningún name)', () => {
      assert.equal(resolveWorkspaceGroup(fixtureLive, null), null);
    });
  });

  describe('IN-02: g.ref debe cumplir /^workspace_group:\\d+$/ (defensa contra forja de líneas de log)', () => {
    it("ref con shape anómalo ('grupo-malo') → null aunque el name matchee", () => {
      const g = { groups: [{ name: 'K', ref: 'grupo-malo' }] };
      assert.equal(resolveWorkspaceGroup(g, 'K'), null);
    });

    it("ref con '\\n' embebido ('workspace_group:5\\ninject') → null (rechazo de inyección de log)", () => {
      const g = { groups: [{ name: 'K', ref: 'workspace_group:5\ninject' }] };
      assert.equal(resolveWorkspaceGroup(g, 'K'), null);
    });

    it("ref válido ('workspace_group:9') con name que matchea → devuelve el ref (no-regresión del shape correcto)", () => {
      const g = { groups: [{ name: 'K', ref: 'workspace_group:9' }] };
      assert.equal(resolveWorkspaceGroup(g, 'K'), 'workspace_group:9');
    });
  });

  describe('WR-02: invariante Unicode NFC — name en NFD matchea expectedName en NFC (red de regresión)', () => {
    it("name 'Trac\\u0327a' (NFD: c + cedilla combinante) vs expectedName 'Traça' (NFC) → devuelve el ref", () => {
      // Diente WR-02: borrar `.normalize('NFC')` de manager.js (resolveWorkspaceGroup) pone
      // este test ROJO — el name en NFD dejaría de normalizar al mismo target que el NFC.
      const nameNFD = 'Trac' + '\u0327' + 'a'; // c + U+0327 (cedilla combinante) => forma NFD
      const expectedNFC = 'Tra' + '\u00e7' + 'a'; // c-cedilla precompuesta (U+00E7) => forma NFC
      assert.notEqual(nameNFD, expectedNFC); // distintos byte-a-byte antes de normalizar
      const g = { groups: [{ name: nameNFD, ref: 'workspace_group:7' }] };
      assert.equal(resolveWorkspaceGroup(g, expectedNFC), 'workspace_group:7');
    });
  });
});

describe('newWorkspaceWithGroupFallback (D-10/D-11 · GRP-03 capa 2)', () => {
  it('group null → llama fn UNA vez con baseOpts, sin group (como hoy)', async () => {
    const calls = [];
    const fn = async (opts) => {
      calls.push(opts);
      return 'workspace:99';
    };
    const ref = await newWorkspaceWithGroupFallback(fn, { name: 'n', cwd: '/c' }, null);
    assert.equal(ref, 'workspace:99');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { name: 'n', cwd: '/c' });
    assert.equal('group' in calls[0], false);
  });

  it('group presente + fn resuelve → llama fn UNA vez con { ...base, group } y devuelve su valor', async () => {
    const calls = [];
    const fn = async (opts) => {
      calls.push(opts);
      return 'workspace:100';
    };
    const ref = await newWorkspaceWithGroupFallback(fn, { name: 'n', cwd: '/c' }, 'workspace_group:1');
    assert.equal(ref, 'workspace:100');
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], { name: 'n', cwd: '/c', group: 'workspace_group:1' });
  });

  it('fn RECHAZA al 1er intento → 2º intento SIN group + EXACTAMENTE 1 log line (D-10 capa 2 + D-11)', async () => {
    const calls = [];
    let first = true;
    const fn = async (opts) => {
      calls.push(opts);
      if (first) {
        first = false;
        throw new Error('ref inválido (grupo borrado / TOCTOU)');
      }
      return 'workspace:101';
    };
    const logs = [];
    const log = (msg) => logs.push(msg);

    const ref = await newWorkspaceWithGroupFallback(
      fn,
      { name: 'Secreto del usuario', cwd: '/c' },
      'workspace_group:1',
      log,
    );

    assert.equal(ref, 'workspace:101');
    // fn se invoca exactamente 2 veces: 1ª con group, 2ª sin group (retry único).
    assert.equal(calls.length, 2);
    assert.equal(calls[0].group, 'workspace_group:1');
    assert.equal('group' in calls[1], false);
    // Exactamente UNA línea de log.
    assert.equal(logs.length, 1);
    assert.match(logs[0], /group_skipped/);
    assert.match(logs[0], /workspace_group:1/);
    // D-11: el log NO contiene contenido de usuario (el título de la tarea).
    assert.doesNotMatch(logs[0], /Secreto del usuario/);
  });

  it('si el 2º intento (sin group) también rechaza → propaga el error (no lo captura)', async () => {
    const fn = async () => {
      throw new Error('boom');
    };
    await assert.rejects(
      () => newWorkspaceWithGroupFallback(fn, { name: 'n', cwd: '/c' }, 'workspace_group:1', () => {}),
      /boom/,
    );
  });
});
