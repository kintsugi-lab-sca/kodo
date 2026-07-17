// @ts-check
//
// test/dashboard-select.test.js — Phase 36 Plan 01 Wave 0 (TUI-08, TUI-09, TUI-11, TUI-12).
//
// Tests PUROS (sin React, sin ink) de la capa de derive del cursor/orden/contadores del
// dashboard: `sortSessions`, `resolveSelection`, `countByStatus`. El runner de Node carece
// de `mock.module` y `ink-testing-library@4` no expone `waitUntilExit()`, así que las DOS
// invariantes load-bearing de la fase se expresan como tests PUROS de `resolveSelection`:
//   - TUI-08: la selección sigue a `task_id` al reordenar y clampa al desaparecer la fila.
//   - TUI-12: el cursor se preserva al aplicar y luego limpiar el filtro (mismo task_id).
//
// Estado Wave 0: ROJO hasta el Task 2 (select.js no existe → ERR_MODULE_NOT_FOUND).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  sortSessions,
  resolveSelection,
  applyFilter,
  parseFilter,
  countByStatus,
  grepLogs,
  deriveAnyGsd,
  deriveAnyProgress,
  deriveAnyNext,
} from '../src/cli/dashboard/select.js';

import { deriveRepo } from '../src/cli/dashboard/format.js';

/**
 * Fixture mínima de sesión (solo los campos que la capa de derive lee).
 * @param {object} over — overrides por campo.
 */
function s(over = {}) {
  return {
    task_id: 'tid',
    task_ref: 'KL-1',
    status: 'running',
    started_at: '2026-05-27T10:00:00.000Z',
    alive: true,
    project_name: 'kodo',
    project_path: '/x/kodo',
    summary: 'summary',
    ...over,
  };
}

describe('TUI-08 (D-05/D-06): resolveSelection sigue a task_id + clamp', () => {
  it('sigue la identidad: con la fila seleccionada reordenada, devuelve su nueva posición', () => {
    const after = [s({ task_id: 'a' }), s({ task_id: 'b' }), s({ task_id: 'c' })];
    const sel = resolveSelection(after, 'b', 0);
    assert.equal(sel.taskId, 'b', `taskId debe seguir siendo 'b', fue ${sel.taskId}`);
    assert.equal(sel.index, 1, `index debe ser la nueva pos de 'b' (1), fue ${sel.index}`);
  });

  it('clamp al desaparecer la fila seleccionada — nunca devuelve un task_id ausente', () => {
    // LOAD-BEARING (TUI-08 / D-06): 'b' desaparece del refresh; prevIndex 1.
    const after = [s({ task_id: 'a' }), s({ task_id: 'c' })]; // 'b' eliminado
    const sel = resolveSelection(after, 'b', 1);
    assert.notEqual(sel.taskId, 'b', `no debe apuntar al id ausente 'b', fue ${sel.taskId}`);
    assert.equal(
      after.some((r) => r.task_id === sel.taskId),
      true,
      `el taskId resuelto (${sel.taskId}) debe existir en la lista actual`,
    );
  });

  it('lista vacía → { index: -1, taskId: null }', () => {
    const sel = resolveSelection([], 'b', 3);
    assert.deepEqual(
      sel,
      { index: -1, taskId: null },
      `lista vacía debe dar {index:-1, taskId:null}, fue ${JSON.stringify(sel)}`,
    );
  });

  it('clamp de bounds: prevIndex pasado del final → len-1; negativo → 0', () => {
    const rows = [s({ task_id: 'a' }), s({ task_id: 'b' })];
    const past = resolveSelection(rows, 'gone', 99);
    assert.equal(past.index, 1, `prevIndex 99 debe clampar a len-1 (1), fue ${past.index}`);
    assert.equal(past.taskId, 'b', `debe devolver el task_id de la pos clampada, fue ${past.taskId}`);
    const neg = resolveSelection(rows, 'gone', -5);
    assert.equal(neg.index, 0, `prevIndex -5 debe clampar a 0, fue ${neg.index}`);
    assert.equal(neg.taskId, 'a', `debe devolver el task_id de la pos 0, fue ${neg.taskId}`);
  });
});

describe('TUI-12 (D-16): cursor preservado al aplicar→limpiar filtro', () => {
  it('aplicar un filtro que conserva la sesión seleccionada y luego limpiarlo mantiene el task_id', () => {
    // LOAD-BEARING (TUI-12 / D-16): sort → filtrar a un subconjunto que aún contiene 'b' →
    // resolveSelection lo conserva; al limpiar (lista completa) sigue siendo 'b'.
    const full = sortSessions([
      s({ task_id: 'a', status: 'done', started_at: '2026-05-27T09:00:00.000Z' }),
      s({ task_id: 'b', status: 'running', started_at: '2026-05-27T10:00:00.000Z' }),
      s({ task_id: 'c', status: 'review', started_at: '2026-05-27T11:00:00.000Z' }),
    ]);
    const selected = 'b';

    const parsed = parseFilter('s:running');
    const filtered = applyFilter(full, parsed, deriveRepo);
    const selInFilter = resolveSelection(filtered, selected, 0);
    assert.equal(
      selInFilter.taskId,
      'b',
      `dentro del filtro el cursor debe seguir en 'b', fue ${selInFilter.taskId}`,
    );

    // Limpiar el filtro → lista completa; el cursor vuelve/permanece en 'b'.
    const selCleared = resolveSelection(full, selInFilter.taskId, selInFilter.index);
    assert.equal(
      selCleared.taskId,
      'b',
      `al limpiar el filtro el cursor debe seguir en 'b', fue ${selCleared.taskId}`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 43 Plan 02 (PSTATE-06; D-06/D-07/D-09 anti-ReDoS): prefijo `ps:`.
//   Eje de filtro DEDICADO por `provider_state` (NO extiende `s:`). Match por
//   SUBSTRING case-insensitive vía String.includes (asimetría deliberada con `s:`,
//   que es match EXACTO). Filas con provider_state === null NUNCA casan (D-09).
// ─────────────────────────────────────────────────────────────────────────────

describe('PSTATE-06 (D-06): parseFilter reconoce el prefijo dedicado ps:', () => {
  it("parseFilter('ps:review') → provider_state 'review', repo/status null, text vacío", () => {
    const parsed = parseFilter('ps:review');
    assert.equal(parsed.provider_state, 'review', `provider_state debe ser 'review', fue ${parsed.provider_state}`);
    assert.equal(parsed.repo, null, `repo debe ser null, fue ${parsed.repo}`);
    assert.equal(parsed.status, null, `status debe ser null, fue ${parsed.status}`);
    assert.equal(parsed.text, '', `text debe estar vacío, fue '${parsed.text}'`);
  });

  it("parseFilter('PS:Review') → provider_state 'review' (prefijo y valor case-insensitive)", () => {
    const parsed = parseFilter('PS:Review');
    assert.equal(parsed.provider_state, 'review', `prefijo y valor deben bajarse a minúsculas, fue ${parsed.provider_state}`);
  });

  it("parseFilter('s:running') → status 'running', provider_state null (ps: NO se confunde con s:)", () => {
    const parsed = parseFilter('s:running');
    assert.equal(parsed.status, 'running', `status debe ser 'running', fue ${parsed.status}`);
    assert.equal(parsed.provider_state, null, `provider_state NO debe capturar s:, fue ${parsed.provider_state}`);
  });
});

describe('PSTATE-06 (D-07/D-09): applyFilter rama ps: substring anti-ReDoS', () => {
  it("substring: parsed.provider_state 'rev' casa fila { provider_state: 'in_review' }", () => {
    const rows = [s({ task_id: 'a', provider_state: 'in_review' })];
    const out = applyFilter(rows, parseFilter('ps:rev'), deriveRepo);
    assert.equal(out.length, 1, `'in_review'.includes('rev') debe casar (substring), fue ${out.length}`);
  });

  it("D-09: fila { provider_state: null } NUNCA casa con ps:review (degradada)", () => {
    const rows = [s({ task_id: 'a', provider_state: null })];
    const out = applyFilter(rows, parseFilter('ps:review'), deriveRepo);
    assert.equal(out.length, 0, `provider_state null nunca casa con ps: (D-09), fue ${out.length}`);
  });

  it("D-09: fila sin provider_state (ausente) tampoco casa con ps:done", () => {
    const rows = [s({ task_id: 'a' })]; // sin provider_state
    const out = applyFilter(rows, parseFilter('ps:done'), deriveRepo);
    assert.equal(out.length, 0, `provider_state ausente nunca casa con ps: (D-09), fue ${out.length}`);
  });

  it("exacto-vs-substring: ps:done casa 'done'; ps:done no casa 'in_review'", () => {
    const rows = [
      s({ task_id: 'a', provider_state: 'done' }),
      s({ task_id: 'b', provider_state: 'in_review' }),
    ];
    const out = applyFilter(rows, parseFilter('ps:done'), deriveRepo).map((r) => r.task_id);
    assert.deepEqual(out, ['a'], `solo 'done' casa ps:done, fue ${out}`);
  });

  it('AND con s:: `s:running ps:review` filtra estado local exacto Y provider_state substring', () => {
    const rows = [
      s({ task_id: 'a', status: 'running', provider_state: 'in_review' }), // casa ambos
      s({ task_id: 'b', status: 'running', provider_state: 'done' }),      // casa s: pero no ps:
      s({ task_id: 'c', status: 'done', provider_state: 'in_review' }),    // casa ps: pero no s:
    ];
    const out = applyFilter(rows, parseFilter('s:running ps:review'), deriveRepo).map((r) => r.task_id);
    assert.deepEqual(out, ['a'], `solo la fila que casa AND (s: exacto Y ps: substring), fue ${out}`);
  });

  it('anti-ReDoS: ps:.* se matchea LITERAL como substring, jamás compila RegExp', () => {
    const rows = [
      s({ task_id: 'lit', provider_state: 'in_.*review' }), // contiene el literal ".*"
      s({ task_id: 'rgx', provider_state: 'in_review' }),   // casaría una regex .* pero NO substring
    ];
    const out = applyFilter(rows, parseFilter('ps:.*'), deriveRepo).map((r) => r.task_id);
    // Si compilara regex, 'in_review' casaría (.* = 'review'). Con substring solo casa el literal.
    assert.deepEqual(out, ['lit'], `'.*' debe matchear literal, no como regex, fue ${out}`);
  });
});

describe('TUI-09 (D-04): sortSessions DESC por started_at sobre una COPIA + tiebreak task_id', () => {
  it('no muta el array de entrada', () => {
    const input = [
      s({ task_id: 'a', started_at: '2026-05-27T09:00:00.000Z' }),
      s({ task_id: 'b', started_at: '2026-05-27T11:00:00.000Z' }),
    ];
    const before = input.map((r) => r.task_id);
    sortSessions(input);
    const after = input.map((r) => r.task_id);
    assert.deepEqual(after, before, `sortSessions no debe mutar la entrada, era ${before} ahora ${after}`);
  });

  it('newest started_at primero (DESC)', () => {
    const sorted = sortSessions([
      s({ task_id: 'old', started_at: '2026-05-27T08:00:00.000Z' }),
      s({ task_id: 'new', started_at: '2026-05-27T12:00:00.000Z' }),
      s({ task_id: 'mid', started_at: '2026-05-27T10:00:00.000Z' }),
    ]);
    assert.deepEqual(
      sorted.map((r) => r.task_id),
      ['new', 'mid', 'old'],
      `orden DESC esperado [new, mid, old], fue ${sorted.map((r) => r.task_id)}`,
    );
  });

  it('WR-01: started_at no parseable no rompe el orden — el tiebreak por task_id sigue mandando (determinista)', () => {
    // LOAD-BEARING (WR-01 / D-04): new Date('not-a-date').getTime() === NaN; un comparador que
    // retorna NaN deja el orden INDEFINIDO y anula el tiebreak anti-flicker. El guard normaliza el
    // timestamp inválido a 0 (epoch), así que las filas corruptas caen al tiebreak por task_id y
    // dos polls con el array barajado producen SIEMPRE el mismo orden.
    const first = sortSessions([
      s({ task_id: 'z', started_at: 'not-a-date' }),
      s({ task_id: 'a', started_at: 'not-a-date' }),
      s({ task_id: 'm', started_at: 'garbage' }),
    ]).map((r) => r.task_id);
    const shuffled = sortSessions([
      s({ task_id: 'm', started_at: 'garbage' }),
      s({ task_id: 'a', started_at: 'not-a-date' }),
      s({ task_id: 'z', started_at: 'not-a-date' }),
    ]).map((r) => r.task_id);
    assert.deepEqual(
      first,
      shuffled,
      `started_at no parseable debe ordenar determinista (mismo orden con input barajado); ${first} vs ${shuffled}`,
    );
    assert.deepEqual(first, ['a', 'm', 'z'], `timestamps inválidos → tiebreak lexicográfico por task_id, fue ${first}`);

    // Una fila con started_at válido siempre va ANTES que una con timestamp inválido (tratado como epoch).
    const mixed = sortSessions([
      s({ task_id: 'bad', started_at: 'not-a-date' }),
      s({ task_id: 'good', started_at: '2026-05-27T12:00:00.000Z' }),
    ]).map((r) => r.task_id);
    assert.deepEqual(mixed, ['good', 'bad'], `el timestamp válido (newest) debe ir antes del inválido (epoch), fue ${mixed}`);
  });

  it('timestamps iguales: desempate determinista por task_id; nunca intercambian con input barajado', () => {
    const ts = '2026-05-27T10:00:00.000Z';
    const first = sortSessions([
      s({ task_id: 'z', started_at: ts }),
      s({ task_id: 'a', started_at: ts }),
      s({ task_id: 'm', started_at: ts }),
    ]).map((r) => r.task_id);
    const shuffled = sortSessions([
      s({ task_id: 'm', started_at: ts }),
      s({ task_id: 'z', started_at: ts }),
      s({ task_id: 'a', started_at: ts }),
    ]).map((r) => r.task_id);
    assert.deepEqual(
      first,
      shuffled,
      `igual timestamp debe ordenar determinista por task_id sin importar el input; ${first} vs ${shuffled}`,
    );
    assert.deepEqual(first, ['a', 'm', 'z'], `desempate lexicográfico por task_id, fue ${first}`);
  });
});

describe('TUI-11 (D-11): countByStatus cuenta zombie aparte de running', () => {
  it('una lista con running+alive, zombie, review, done, error', () => {
    const counts = countByStatus([
      s({ task_id: '1', status: 'running', alive: true }),
      s({ task_id: '2', status: 'running', alive: false }), // zombie
      s({ task_id: '3', status: 'review' }),
      s({ task_id: '4', status: 'done' }),
      s({ task_id: '5', status: 'error' }),
    ]);
    assert.deepEqual(
      counts,
      // Phase 38 D-06: countByStatus ahora incluye idle/needs-input/dead (en 0 aquí).
      { running: 1, review: 1, done: 1, error: 1, zombie: 1, idle: 0, 'needs-input': 0, dead: 0 },
      `el zombie debe contarse aparte de running, fue ${JSON.stringify(counts)}`,
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 39 Plan 01 (TUI-16; D-03, T-39-02 anti-ReDoS): grepLogs.
//   Filtra el buffer COMPARTIDO de `GET /logs` (Array<{ts, level, msg}>, sin
//   session_id por línea) por SUBSTRING OR de task_ref/workspace_ref contra
//   entry.msg, vía String.includes — NUNCA new RegExp (espejo de applyFilter /
//   T-36-01). needles vacíos → [] (no inunda el overlay con el buffer entero).
// ─────────────────────────────────────────────────────────────────────────────

/** Fixture mínima de entrada de log (shape src/server.js:21-29). */
function log(msg, over = {}) {
  return { ts: '2026-06-02T00:00:00.000Z', level: 'info', msg, ...over };
}

describe('TUI-16 (D-03): grepLogs substring OR anti-ReDoS', () => {
  it('match por task_ref: solo las líneas cuyo msg contiene el ref', () => {
    const logs = [
      log('session KL-1 started'),
      log('unrelated tick'),
      log('KL-1 dispatched to worker'),
    ];
    const out = grepLogs(logs, { task_ref: 'KL-1' });
    assert.equal(out.length, 2);
    assert.ok(out.every((e) => e.msg.includes('KL-1')));
  });

  it('match por workspace_ref (OR): casa por cualquiera de los dos needles', () => {
    const logs = [
      log('KL-1 started'),
      log('worktree wt-abc created'),
      log('nothing here'),
    ];
    const out = grepLogs(logs, { task_ref: 'KL-1', workspace_ref: 'wt-abc' });
    assert.equal(out.length, 2);
  });

  it('case-insensitive: ref en mayúsculas casa msg en minúsculas', () => {
    const logs = [log('session kl-1 running')];
    const out = grepLogs(logs, { task_ref: 'KL-1' });
    assert.equal(out.length, 1);
  });

  it('needles vacíos (sin task_ref ni workspace_ref) → [] (no inunda)', () => {
    const logs = [log('a'), log('b')];
    assert.deepEqual(grepLogs(logs, {}), []);
    assert.deepEqual(grepLogs(logs, { task_ref: '', workspace_ref: '' }), []);
  });

  it('sin matches → []', () => {
    const logs = [log('KL-9 only'), log('KL-8 only')];
    assert.deepEqual(grepLogs(logs, { task_ref: 'KL-1' }), []);
  });

  it('char regex-especial (.*) se matchea LITERAL como substring (anti-ReDoS)', () => {
    const logs = [
      log('build KL-1.* literal token'), // contiene el literal "KL-1.*"
      log('KL-1abc would match a regex but NOT a substring'),
    ];
    const out = grepLogs(logs, { task_ref: 'KL-1.*' });
    // Si grepLogs compilara una regex, "KL-1abc" casaría (.* = "abc"). Con substring solo casa
    // la línea que contiene literalmente "KL-1.*".
    assert.equal(out.length, 1);
    assert.ok(out[0].msg.includes('KL-1.* literal'));
  });

  it('preserva el orden de entrada de logs (no reordena el buffer newest-first del server)', () => {
    const logs = [
      log('KL-1 third', { ts: 'c' }),
      log('KL-1 first', { ts: 'a' }),
      log('KL-1 second', { ts: 'b' }),
    ];
    const out = grepLogs(logs, { task_ref: 'KL-1' });
    assert.deepEqual(out.map((e) => e.ts), ['c', 'a', 'b']);
  });

  it('never-throws sobre entradas con msg ausente (buffer best-effort)', () => {
    const logs = [{ ts: 't', level: 'info' }, log('KL-1 here')];
    // @ts-ignore — entrada degradada a propósito (msg ausente).
    const out = grepLogs(logs, { task_ref: 'KL-1' });
    assert.equal(out.length, 1);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 44 Plan 02 (TUI-18; D-08): deriveAnyGsd.
//   Flag ESTRUCTURAL de presencia GSD: rows.some(r => r.phase_id != null). PURO,
//   React-free, sin regex ni color. Se computa sobre el set SIN filtrar (`sorted`)
//   en App.js — NO sobre `filtered` (Pitfall 4): la columna phase/mode no debe
//   parpadear cuando una query `/` vacía las filas GSD.
// ─────────────────────────────────────────────────────────────────────────────

describe('TUI-18 (D-08): deriveAnyGsd flag estructural de presencia GSD', () => {
  it('true cuando ALGUNA fila tiene phase_id != null', () => {
    assert.equal(deriveAnyGsd([{ phase_id: '36' }, { phase_id: null }]), true);
  });

  it('false cuando NINGUNA fila tiene phase_id (null o ausente)', () => {
    assert.equal(deriveAnyGsd([{ phase_id: null }, {}]), false);
  });

  it('false sobre lista vacía', () => {
    assert.equal(deriveAnyGsd([]), false);
  });

  it('phase_id === 0 cuenta como GSD (0 != null, solo null/undefined lo excluye)', () => {
    // Guard del operador `!= null`: distingue 0/'' (presentes) de null/undefined (ausentes).
    assert.equal(deriveAnyGsd([{ phase_id: 0 }]), true);
  });

  it('D-08: se deriva sobre el set SIN filtrar — un fixture cuyas filas GSD serían eliminadas por un filtro activo sigue devolviendo true sobre la lista completa', () => {
    // El operador teclea `/ s:dead` (que excluiría a la fila GSD running). Si anyGsd se
    // derivara de `filtered`, la columna phase/mode PARPADEARÍA al desaparecer la fila GSD.
    // Derivado sobre el set SIN filtrar (la lista COMPLETA), sigue siendo true: la columna
    // es estructural, no sensible al filtro (Pitfall 4 / D-08).
    const full = [
      { task_id: 'gsd', phase_id: '36', state: 'running' },
      { task_id: 'plain', phase_id: null, state: 'dead' },
    ];
    const parsed = parseFilter('s:dead');
    const filtered = applyFilter(full, parsed, () => '');
    // El filtro elimina la fila GSD (running) → si derivásemos de `filtered` daría false.
    assert.equal(deriveAnyGsd(filtered), false, 'el filtro elimina la fila GSD del subconjunto filtrado');
    // Pero la derivación CORRECTA (D-08) es sobre la lista COMPLETA → true (columna no parpadea).
    assert.equal(deriveAnyGsd(full), true, 'deriveAnyGsd sobre el set completo NO debe verse afectado por el filtro');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 50 Plan 03 (PROG-03; D-06): deriveAnyProgress.
//   Espejo literal de deriveAnyGsd: rows.some(r => r.progress != null). PURO,
//   React-free, sin regex ni color. Se computa sobre el set SIN filtrar (`sorted`)
//   en App.js — NO sobre `filtered` (Pitfall 5 == Pitfall 4 de Phase 44): la columna
//   prog no debe parpadear cuando una query `/` vacía las filas con progreso.
// ─────────────────────────────────────────────────────────────────────────────

describe('PROG-03 (D-06): deriveAnyProgress flag estructural de presencia de progreso', () => {
  it('Test 1: true cuando ALGUNA fila tiene progress.status === "ok"', () => {
    assert.equal(deriveAnyProgress([{ progress: { status: 'ok', n: 1, m: 3 } }, { progress: null }]), true);
  });

  it('Test 2: false cuando NINGUNA fila tiene progress (null o ausente)', () => {
    assert.equal(deriveAnyProgress([{ progress: null }, {}]), false);
  });

  it('Test 3: progress undefined/null en todas → false', () => {
    assert.equal(deriveAnyProgress([{ progress: undefined }, { progress: null }]), false);
    assert.equal(deriveAnyProgress([]), false);
  });

  it('WR-03: status "no-progress" / "error" NO activan la columna (solo "ok" cuenta)', () => {
    // LOAD-BEARING (WR-03): el enrich de App.js asigna progress NO-null a TODAS las filas
    // (no-GSD → {status:'no-progress'}, fallo sin last-good → {status:'error'}). El predicado
    // debe discriminar por status para que la columna prog SE OCULTE cuando ninguna sesión
    // reporta una lectura real, restaurando el diseño de columna condicional de Phase 50.
    assert.equal(
      deriveAnyProgress([{ progress: { status: 'no-progress' } }, { progress: { status: 'error' } }]),
      false,
      'no-progress + error → ninguna lectura real → columna oculta',
    );
    assert.equal(
      deriveAnyProgress([{ progress: { status: 'no-progress' } }, { progress: { status: 'ok', n: 1, m: 2 } }]),
      true,
      'una sola lectura ok basta para mostrar la columna',
    );
  });

  it('D-06: se deriva sobre el set SIN filtrar — la columna prog no parpadea bajo `/`', () => {
    // Espejo del test de deriveAnyGsd: si se derivara de `filtered`, la columna
    // desaparecería al teclear una query que oculta las filas con progreso.
    const full = [
      { task_id: 'prog', progress: { status: 'ok', n: 2, m: 3 }, state: 'running' },
      { task_id: 'plain', progress: { status: 'no-progress' }, state: 'dead' },
    ];
    const filtered = applyFilter(full, parseFilter('s:dead'), () => '');
    assert.equal(deriveAnyProgress(filtered), false, 'el filtro elimina la fila con progreso del subconjunto');
    assert.equal(deriveAnyProgress(full), true, 'sobre el set completo sigue siendo true (columna estructural)');
  });
});

// Phase 75 Plan 01 (LIVE-05; D-03/RESEARCH Pitfall 4): deriveAnyNext.
// Flag estructural de presencia de NEXT: — espejo LITERAL de deriveAnyProgress.

describe('LIVE-05 (D-03): deriveAnyNext flag estructural de presencia de NEXT:', () => {
  it('Test 1: true cuando ≥1 fila tiene next string no-vacío', () => {
    assert.equal(deriveAnyNext([{ next: 'Escribir el test RED' }, { next: null }]), true);
    assert.equal(deriveAnyNext([{ next: '' }, { next: 'algo' }]), true);
  });

  it('Test 2: false cuando NINGUNA fila tiene next no-vacío', () => {
    assert.equal(deriveAnyNext([{ next: null }, {}]), false);
    assert.equal(deriveAnyNext([{ next: '' }, { next: undefined }]), false);
    assert.equal(deriveAnyNext([]), false);
  });

  it('Test 3: un next no-string (número/objeto) NO cuenta', () => {
    // @ts-expect-error modelamos dato malformado
    assert.equal(deriveAnyNext([{ next: 42 }, { next: {} }]), false);
  });

  it('RESEARCH Pitfall 4: se deriva sobre el set SIN filtrar — la columna next no parpadea bajo `/`', () => {
    // Espejo del test de deriveAnyProgress: si se derivara de `filtered`, la columna
    // desaparecería al teclear una query que oculta las filas con NEXT:.
    const full = [
      { task_id: 'withnext', next: 'siguiente paso', state: 'running' },
      { task_id: 'plain', next: '', state: 'dead' },
    ];
    const filtered = applyFilter(full, parseFilter('s:dead'), () => '');
    assert.equal(deriveAnyNext(filtered), false, 'el filtro elimina la fila con next del subconjunto');
    assert.equal(deriveAnyNext(full), true, 'sobre el set completo sigue siendo true (columna estructural)');
  });
});
