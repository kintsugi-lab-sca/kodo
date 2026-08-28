// @ts-check
//
// test/dashboard/rows.test.js — KODO-40.
//
// Suite unit del módulo extraído `src/cli/dashboard/rows.js`: el pipeline de derivación de filas
// que corría inline en el cuerpo de `App()`. El orden es LOAD-BEARING (Pitfall 3/D-16) y los flags
// `any*` se derivan del set SIN filtrar (Pitfall 4/5) — ambos se verifican aquí sin montar ink.
//
// El progreso GSD se lee del filesystem: los casos que lo ejercitan usan un STATE.md real en un
// directorio temporal (stubearlo anularía el contrato "never-throws + keep-last-good").

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deriveRows } from '../../src/cli/dashboard/rows.js';

/** @type {string} */
let PROJ;
before(() => {
  PROJ = mkdtempSync(join(tmpdir(), 'kodo-rows-'));
  mkdirSync(join(PROJ, '.planning'), { recursive: true });
  // Frontmatter YAML con el bloque `progress:` que parsea readGsdProgress (keys indentadas).
  writeFileSync(
    join(PROJ, '.planning', 'STATE.md'),
    ['---', 'progress:', '  total_phases: 7', '  completed_phases: 3', '---', '', '# STATE', ''].join('\n'),
    'utf-8',
  );
});
after(() => {
  rmSync(PROJ, { recursive: true, force: true });
});

const base = (over = {}) => ({
  sessions: [],
  query: '',
  selectedTaskId: null,
  prevIndex: 0,
  tasks: {},
  lastGood: new Map(),
  ...over,
});

describe('rows — orden del pipeline y selección', () => {
  it('ordena DESC y resuelve el índice por IDENTIDAD, no por posición', () => {
    const sessions = [
      { task_id: 'a', task_ref: 'K-1', started_at: '2026-01-01T00:00:00Z' },
      { task_id: 'b', task_ref: 'K-2', started_at: '2026-02-01T00:00:00Z' },
    ];
    const r = deriveRows(base({ sessions, selectedTaskId: 'a' }));
    assert.deepEqual(r.filtered.map((x) => x.task_id), ['b', 'a'], 'más reciente primero');
    assert.equal(r.sel.index, 1, 'el cursor sigue a la fila `a` aunque haya cambiado de posición');
    assert.equal(r.sel.taskId, 'a');
  });

  it('el filtro es substring (nunca regex del input) y alimenta counts/hasQuery', () => {
    const sessions = [
      { task_id: 'a', task_ref: 'KODO-1', status: 'running' },
      { task_id: 'b', task_ref: 'SCP-9', status: 'running' },
    ];
    const r = deriveRows(base({ sessions, query: 'kodo' }));
    assert.deepEqual(r.filtered.map((x) => x.task_id), ['a']);
    assert.equal(r.hasQuery, true);
    assert.equal(r.counts.running, 1, 'counts se calcula sobre el set FILTRADO');
  });

  it('una query que lo oculta todo NO borra la identidad del cursor (sel.taskId null, D-16)', () => {
    const sessions = [{ task_id: 'a', task_ref: 'KODO-1' }];
    const r = deriveRows(base({ sessions, query: 'no-casa-con-nada', selectedTaskId: 'a' }));
    assert.deepEqual(r.filtered, []);
    assert.equal(r.sel.index, -1);
    assert.equal(r.sel.taskId, null);
    assert.equal(r.hasQuery, true);
  });

  it('query en blanco no cuenta como filtro activo (distingue los dos estados vacíos, D-12)', () => {
    const r = deriveRows(base({ sessions: [], query: '   ' }));
    assert.equal(r.hasQuery, false);
  });
});

describe('rows — flags estructurales sobre el set SIN filtrar (Pitfall 4/5)', () => {
  it('anyGsd/anyNext NO parpadean cuando la query oculta las filas que los producen', () => {
    // `phase_id` (no el flag `gsd`) es lo que deriveAnyGsd mira — ver select.js.
    const sessions = [
      { task_id: 'a', task_ref: 'KODO-1', phase_id: '35' },
      { task_id: 'b', task_ref: 'SCP-9' },
    ];
    const tasks = { a: { next: 'seguir con el plan' } };
    const sinFiltro = deriveRows(base({ sessions, tasks }));
    assert.equal(sinFiltro.anyGsd, true);
    assert.equal(sinFiltro.anyNext, true);

    const conFiltro = deriveRows(base({ sessions, tasks, query: 'scp' }));
    assert.deepEqual(conFiltro.filtered.map((x) => x.task_id), ['b'], 'la fila GSD queda fuera');
    assert.equal(conFiltro.anyGsd, true, 'el flag se deriva de `enriched`, no de `filtered`');
    assert.equal(conFiltro.anyNext, true);
  });
});

describe('rows — enrich: NEXT:, saneo y progreso', () => {
  it('el NEXT: se toma de tasks[task_id] y se SANEA antes de proyectarse', () => {
    const ESC = '\u001b';
    const sessions = [{ task_id: 'a', task_ref: 'KODO-1' }];
    const tasks = { a: { next: `sigue${ESC}]52;c;YmFk` } };
    const r = deriveRows(base({ sessions, tasks }));
    assert.ok(!r.filtered[0].next.includes(ESC), 'ningún ESC llega a la celda');
    assert.ok(r.filtered[0].next.includes('sigue'), 'el texto legítimo se conserva');
  });

  it('sin task_id o sin entrada en tasks, next colapsa a null (celda vacía)', () => {
    const r = deriveRows(base({ sessions: [{ task_ref: 'K-1' }, { task_id: 'z', task_ref: 'K-2' }] }));
    assert.equal(r.filtered[0].next, null);
    assert.equal(r.filtered[1].next, null);
  });

  it('task_ref y summary del provider pasan por stripControlChars (WR-03/M4)', () => {
    const ESC = '\u001b';
    const sessions = [{ task_id: 'a', task_ref: `K${ESC}[31m-1`, summary: `re${ESC}sumen` }];
    const r = deriveRows(base({ sessions }));
    assert.ok(!r.filtered[0].task_ref.includes(ESC));
    assert.ok(!r.filtered[0].summary.includes(ESC));
  });

  it('sin project_path/session_id usable → progress no-progress (guard anti-traversal)', () => {
    const sessions = [
      { task_id: 'a', task_ref: 'K-1' },
      { task_id: 'b', task_ref: 'K-2', session_id: '../fuga', project_path: PROJ },
    ];
    const r = deriveRows(base({ sessions }));
    assert.equal(r.filtered[0].progress.status, 'no-progress');
    assert.equal(r.filtered[1].progress.status, 'no-progress', 'un session_id con `..` no construye ruta');
  });

  it('sesión ADOPTADA (sin worktree de kodo) lee el STATE.md de project_path (PROG-04 D-2)', () => {
    const sessions = [{ task_id: 'a', task_ref: 'K-1', session_id: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee', project_path: PROJ }];
    const r = deriveRows(base({ sessions }));
    assert.equal(r.filtered[0].progress.status, 'ok');
    assert.equal(r.filtered[0].progress.n, 3);
    assert.equal(r.filtered[0].progress.m, 7);
    assert.equal(r.anyProgress, true);
  });

  it('keep-last-good: el mapa `lastGood` se refresca con cada lectura ok', () => {
    const lastGood = new Map();
    const sid = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
    const sessions = [{ task_id: 'a', task_ref: 'K-1', session_id: sid, project_path: PROJ }];
    deriveRows(base({ sessions, lastGood }));
    assert.deepEqual(lastGood.get(sid), { n: 3, m: 7, completed: false });
  });

  it('never-throws: una lista vacía devuelve la forma completa sin lanzar', () => {
    const r = deriveRows(base());
    assert.deepEqual(r.filtered, []);
    assert.equal(r.anyGsd, false);
    assert.equal(r.anyProgress, false);
    assert.equal(r.anyNext, false);
    assert.equal(r.sel.index, -1);
  });
});
