// @ts-check
//
// test/dashboard-format.test.js — Phase 36 Plan 01 Wave 0 (TUI-07, TUI-10; D-03/D-08/D-09).
//
// Tests PUROS (sin React, sin ink) del mapeo de campos D-03 y de la decisión de color
// semántico (D-08/D-09) de la tabla viva. `statusColor` devuelve NOMBRES de color ink
// (strings planos) — JAMÁS ANSI/escape bytes — para preservar color-isolation: ink convierte
// el nombre a ANSI internamente vía su propio chalk, no picocolors.
//
// Estado Wave 0: ROJO hasta el Task 2 (format.js no existe → ERR_MODULE_NOT_FOUND).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  deriveRepo,
  formatAge,
  phaseMode,
  statusColor,
  statusLabel,
  rowCells,
  STATE_BADGES,
} from '../src/cli/dashboard/format.js';

describe('TUI-07 (D-03): deriveRepo — project_name | basename(project_path) | —', () => {
  it('project_name presente gana', () => {
    const r = deriveRepo({ project_name: 'kodo', project_path: '/x/otro' });
    assert.equal(r, 'kodo', `debe preferir project_name, fue ${r}`);
  });
  it('sin project_name → basename(project_path)', () => {
    const r = deriveRepo({ project_path: '/x/foo' });
    assert.equal(r, 'foo', `debe derivar basename, fue ${r}`);
  });
  it('ambos ausentes → —', () => {
    const r = deriveRepo({});
    assert.equal(r, '—', `sin datos debe ser '—', fue ${r}`);
  });
});

describe('TUI-07 (D-03): formatAge humaniza elapsed_min', () => {
  it('5 → 5m; 63 → 1h3m; 120 → 2h', () => {
    assert.equal(formatAge(5), '5m', `5 debe ser '5m', fue ${formatAge(5)}`);
    assert.equal(formatAge(63), '1h3m', `63 debe ser '1h3m', fue ${formatAge(63)}`);
    assert.equal(formatAge(120), '2h', `120 debe ser '2h', fue ${formatAge(120)}`);
  });
  it('null → —; negativo → —', () => {
    assert.equal(formatAge(null), '—', `null debe ser '—', fue ${formatAge(null)}`);
    assert.equal(formatAge(-1), '—', `-1 debe ser '—', fue ${formatAge(-1)}`);
  });
});

describe('TUI-07 (D-03): phaseMode une phase_id + gsd_mode con /', () => {
  it('phase_id + gsd_mode → 36/full y 12/quick', () => {
    assert.equal(
      phaseMode({ phase_id: '36', gsd_mode: 'full' }),
      '36/full',
      `esperado '36/full', fue ${phaseMode({ phase_id: '36', gsd_mode: 'full' })}`,
    );
    assert.equal(
      phaseMode({ phase_id: '12', gsd_mode: 'quick' }),
      '12/quick',
      `esperado '12/quick', fue ${phaseMode({ phase_id: '12', gsd_mode: 'quick' })}`,
    );
  });
  it('ninguno → —; solo phase_id → 36', () => {
    assert.equal(phaseMode({}), '—', `sin GSD debe ser '—', fue ${phaseMode({})}`);
    assert.equal(phaseMode({ phase_id: '36' }), '36', `solo phase_id → '36', fue ${phaseMode({ phase_id: '36' })}`);
  });
});

describe('TUI-10 (D-08): statusColor devuelve nombres de color ink (nunca ANSI)', () => {
  it('running+alive→green; running+!alive→red (zombie); review→cyan; error→magenta; done→dim', () => {
    assert.deepEqual(statusColor('running', true), { color: 'green' }, 'running+alive → green');
    assert.deepEqual(statusColor('running', false), { color: 'red' }, 'running+!alive → red (zombie)');
    assert.deepEqual(statusColor('review', true), { color: 'cyan' }, 'review → cyan');
    assert.deepEqual(statusColor('error', true), { color: 'magenta' }, 'error → magenta');
    assert.deepEqual(statusColor('done', true), { dim: true }, 'done → dim');
  });
  it('los valores son objetos planos con nombres string, sin bytes de escape ANSI', () => {
    const all = [
      statusColor('running', true),
      statusColor('running', false),
      statusColor('review', true),
      statusColor('error', true),
      statusColor('done', true),
    ];
    for (const v of all) {
      assert.equal(typeof v, 'object', `cada retorno debe ser objeto, fue ${typeof v}`);
      const serialized = JSON.stringify(v);
      //  es el byte ESC que iniciaría una secuencia ANSI.
      assert.equal(
        serialized.includes(''),
        false,
        `el retorno no debe contener bytes ANSI, fue ${serialized}`,
      );
    }
  });
});

describe('TUI-10 (39.1-03): statusColor v3-aware — deriva del estado v3 reusando STATE_BADGES', () => {
  it('status v2 null + state v3 colorea la celda status (idle→yellow, needs-input→cyan, dead→red)', () => {
    assert.deepEqual(
      statusColor(null, true, 'idle'),
      { color: STATE_BADGES.idle.color },
      `idle v3 → ${STATE_BADGES.idle.color} (reusa STATE_BADGES.idle.color)`,
    );
    assert.deepEqual(
      statusColor(null, true, 'needs-input'),
      { color: STATE_BADGES['needs-input'].color },
      `needs-input v3 → ${STATE_BADGES['needs-input'].color} (reusa STATE_BADGES)`,
    );
    assert.deepEqual(
      statusColor(null, false, 'dead'),
      { color: STATE_BADGES.dead.color },
      `dead v3 → ${STATE_BADGES.dead.color} (reusa STATE_BADGES.dead.color)`,
    );
  });
  it('la paleta v3 derivada coincide exactamente con STATE_BADGES (sin literales nuevos)', () => {
    assert.equal(statusColor(null, true, 'idle').color, 'yellow', 'idle es yellow en la paleta LOCKED');
    assert.equal(statusColor(null, true, 'needs-input').color, 'cyan', 'needs-input es cyan en la paleta LOCKED');
    assert.equal(statusColor(null, false, 'dead').color, 'red', 'dead es red en la paleta LOCKED');
  });
  it('status v2 conserva precedencia cuando matchea una rama v2 (sin regresión)', () => {
    assert.deepEqual(
      statusColor('running', true, 'idle'),
      { color: 'green' },
      'running v2 GANA sobre state v3 idle',
    );
    assert.deepEqual(
      statusColor('running', false, 'idle'),
      { color: 'red' },
      'zombie (running+!alive) GANA sobre state v3',
    );
    assert.deepEqual(
      statusColor('done', true, 'needs-input'),
      { dim: true },
      'done v2 GANA sobre state v3',
    );
  });
  it('sin status v2 ni state v3 reconocido → {} (celda vacía sin romper render)', () => {
    assert.deepEqual(statusColor(null, true, undefined), {}, 'null + undefined → {}');
    assert.deepEqual(statusColor(null, true, 'closed'), {}, 'state sin badge (closed) → {}');
    assert.deepEqual(statusColor(null, true), {}, 'sin tercer argumento → {} (compat retro)');
  });
  it('los retornos v3 siguen siendo objetos planos sin bytes ANSI (color-isolation)', () => {
    const all = [
      statusColor(null, true, 'idle'),
      statusColor(null, true, 'needs-input'),
      statusColor(null, false, 'dead'),
    ];
    for (const v of all) {
      assert.equal(typeof v, 'object', `cada retorno debe ser objeto, fue ${typeof v}`);
      assert.equal(
        JSON.stringify(v).includes(''),
        false,
        `el retorno v3 no debe contener bytes ANSI, fue ${JSON.stringify(v)}`,
      );
    }
  });
});

describe('TUI-10 (D-09): statusLabel marca textual del zombie', () => {
  it('running+!alive → running (zombie); running+alive → running; review → review', () => {
    assert.equal(statusLabel('running', false), 'running (zombie)', 'zombie lleva marca textual');
    assert.equal(statusLabel('running', true), 'running', 'running sano sin marca');
    assert.equal(statusLabel('review', true), 'review', 'review intacto');
  });
});

describe('TUI-07 (D-03): rowCells proyecta una sesión a celdas de columna', () => {
  it('un zombie rinde una celda status que contiene (zombie)', () => {
    const cells = rowCells({
      task_ref: 'KL-42',
      project_name: 'kodo',
      phase_id: '36',
      gsd_mode: 'full',
      status: 'running',
      alive: false,
      elapsed_min: 63,
    });
    assert.equal(cells.task_ref, 'KL-42', `task_ref directo, fue ${cells.task_ref}`);
    assert.equal(cells.repo, 'kodo', `repo derivado, fue ${cells.repo}`);
    assert.equal(cells.phasemode, '36/full', `phasemode, fue ${cells.phasemode}`);
    assert.equal(cells.status, 'running (zombie)', `status usa statusLabel, fue ${cells.status}`);
    assert.equal(cells.age, '1h3m', `age humanizado, fue ${cells.age}`);
    assert.equal(
      cells.status.includes('(zombie)'),
      true,
      `la celda status del zombie debe contener '(zombie)', fue ${cells.status}`,
    );
  });
});
