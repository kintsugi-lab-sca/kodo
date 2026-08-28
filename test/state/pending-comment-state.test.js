// @ts-check
//
// test/state/pending-comment-state.test.js — KODO-36 (backstop de comentarios).
//
// Prueba de persistencia del writer de la clave aditiva top-level `state.pending_comments`:
// el comentario de cierre que el provider rechazó y que el barrido reintentará.
//
// El AISLAMIENTO DE HOME es obligatorio y tiene una trampa concreta, verbatim de
// handoff-state.test.js:12-17: `config.js:11` evalúa `join(homedir(), '.kodo')` en
// MODULE-LOAD y `state.js:14` deriva STATE_PATH de ahí. Un import ESTÁTICO de state.js —o
// de cualquier módulo que lo arrastre, `pending-comment.js` incluido— haría que estos tests
// escribieran en el `~/.kodo` REAL del operador. De ahí: `process.env.HOME = tmpHome` ANTES
// de un `await import(...)` dinámico dentro de `before()`. NUNCA un import estático.
//
// El seed v3 es igual de obligatorio (RESEARCH §Pitfall 5): sin state.json en disco,
// `loadState()` devuelve el shape **v2**, withStateLock mutaría ese v2, saveState
// persistiría un fichero v2 CON la clave nueva, y el siguiente loadState dispararía
// `migrateStateV2toV3`, cuyo rebuild exhaustivo DESCARTA toda clave desconocida —
// `pending_comments` incluida. Seed v3 siempre.
//
// La mitad PURA de la fase (el lector `listPendingComments` y el barrido
// `runPendingCommentSweep`) vive en test/session/pending-comment.test.js: no toca FS, así
// que no necesita —ni debe usar— esta maquinaria.

import { describe, it, before, after, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

let tmpHome;
let origHome;
let loadState;
let addSession;
let removeSession;
let markPendingComment;
let deferPendingComment;
let clearPendingComment;

const STATE_REL = ['.kodo', 'state.json'];
const T0 = Date.parse('2026-08-28T10:00:00.000Z');

/** Seed v3 vacío (canónico — espejo de handoff-state.test.js:44). */
function writeSeed(extra = {}) {
  writeFileSync(
    join(tmpHome, ...STATE_REL),
    JSON.stringify({ schema_version: 3, sessions: {}, history: [], ...extra }, null, 2) + '\n',
  );
}

/** Logger que colecciona eventos sin importar logger.js. */
function spyLogger() {
  const calls = { info: [], warn: [], error: [] };
  return {
    calls,
    debug() {},
    info: (event, meta) => calls.info.push({ event, meta }),
    warn: (event, meta) => calls.warn.push({ event, meta }),
    error: (event, meta) => calls.error.push({ event, meta }),
    child() {
      return this;
    },
  };
}

/** Sesión mínima con los campos que `addSession` persiste. */
function makeSession(taskId, ref) {
  return {
    workspace_ref: 'workspace:9',
    session_id: `sess-${taskId}`,
    task_id: taskId,
    task_ref: ref,
    provider: 'plane',
    project_id: 'proj-1',
    summary: 'resumen',
    status: 'running',
    started_at: new Date(T0).toISOString(),
    project_path: '/tmp/repo',
  };
}

describe('KODO-36 — writer de state.pending_comments', () => {
  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-pending-state-'));
    process.env.HOME = tmpHome;
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    // Import dinámico POST-HOME: el STATE_PATH cacheado del módulo resuelve al tmpdir.
    const stateMod = await import('../../src/session/state.js');
    loadState = stateMod.loadState;
    addSession = stateMod.addSession;
    removeSession = stateMod.removeSession;
    const mod = await import('../../src/session/pending-comment.js');
    markPendingComment = mod.markPendingComment;
    deferPendingComment = mod.deferPendingComment;
    clearPendingComment = mod.clearPendingComment;
  });

  after(() => {
    if (origHome === undefined) delete process.env.HOME;
    else process.env.HOME = origHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  beforeEach(() => writeSeed());
  afterEach(() => writeSeed());

  it('persiste el marcador completo bajo la clave aditiva, sin bump de schema_version', () => {
    const logger = spyLogger();
    const r = markPendingComment(
      {
        task_id: 'task-a',
        project_id: 'proj-a',
        task_url: 'https://plane.example/A-1',
        task_ref: 'A-1',
        session_id: 'sess-a',
        text: 'comentario que el provider rechazó',
        created_at: '2026-08-28T10:00:00.000Z',
      },
      logger,
    );

    assert.equal(r.ok, true);
    const onDisk = JSON.parse(readFileSync(join(tmpHome, ...STATE_REL), 'utf-8'));
    assert.deepEqual(onDisk.pending_comments['task-a'], {
      task_id: 'task-a',
      project_id: 'proj-a',
      task_url: 'https://plane.example/A-1',
      task_ref: 'A-1',
      session_id: 'sess-a',
      text: 'comentario que el provider rechazó',
      created_at: '2026-08-28T10:00:00.000Z',
      attempts: 0,
      attempt_at: null,
    });
    assert.equal(onDisk.schema_version, 3, 'la clave es ADITIVA — nada de bump');
    // Telemetría: solo {task_id}. El TEXTO (contenido derivado del LLM) nunca se loguea.
    const marked = logger.calls.info.find((c) => c.event === 'state.pending_comment.marked');
    assert.deepEqual(marked.meta, { task_id: 'task-a' });
  });

  it('los campos opcionales ausentes se normalizan a null (GitHub no trae project_id)', () => {
    markPendingComment({ task_id: 'task-gh', text: 'texto' });
    const entry = loadState().pending_comments['task-gh'];
    assert.equal(entry.project_id, null);
    assert.equal(entry.task_url, null);
    assert.equal(entry.session_id, null);
    assert.equal(typeof entry.created_at, 'string', 'created_at se genera si falta');
  });

  it('EL PUNTO DE LA FASE: el marcador sobrevive al removeSession del mismo cierre', () => {
    // Es la razón entera de que la clave sea top-level y no la fila de la sesión: el hook
    // que marca llama después a performTerminalCleanup → removeSession.
    addSession('task-b', makeSession('task-b', 'B-1'));
    markPendingComment({ task_id: 'task-b', text: 'texto b' });
    removeSession('task-b');

    const after = loadState();
    assert.equal(after.sessions['task-b'], undefined, 'la sesión sí desaparece');
    assert.equal(after.pending_comments['task-b'].text, 'texto b', 'el marcador se queda');
  });

  it('un marcador nuevo de la misma tarea REPONE los intentos (cierre nuevo, comentario nuevo)', () => {
    markPendingComment({ task_id: 'task-c', text: 'primer texto' });
    deferPendingComment('task-c', T0);
    deferPendingComment('task-c', T0 + 1000);
    assert.equal(loadState().pending_comments['task-c'].attempts, 2);

    markPendingComment({ task_id: 'task-c', text: 'segundo texto' });
    const entry = loadState().pending_comments['task-c'];
    assert.equal(entry.text, 'segundo texto');
    assert.equal(entry.attempts, 0, 'arrastrar los intentos lo abandonaría antes de tiempo');
    assert.equal(entry.attempt_at, null);
  });

  it('deferPendingComment incrementa attempts y sella attempt_at', () => {
    markPendingComment({ task_id: 'task-d', text: 'texto d' });

    const d1 = deferPendingComment('task-d', T0);
    assert.equal(d1.ok, true);
    assert.equal(d1.value.attempts, 1);

    const d2 = deferPendingComment('task-d', T0 + 60_000);
    assert.equal(d2.value.attempts, 2);
    assert.equal(
      loadState().pending_comments['task-d'].attempt_at,
      new Date(T0 + 60_000).toISOString(),
    );
  });

  it('clearPendingComment borra el marcador y es idempotente', () => {
    markPendingComment({ task_id: 'task-e', text: 'texto e' });
    assert.equal(clearPendingComment('task-e').ok, true);
    assert.equal(loadState().pending_comments['task-e'], undefined);
    assert.equal(clearPendingComment('task-e').ok, true, 'borrar dos veces no rompe');
  });

  it('defer/clear sobre una tarea inexistente son no-ops (no crean la clave)', () => {
    assert.equal(deferPendingComment('fantasma', T0).ok, true);
    assert.equal(clearPendingComment('fantasma').ok, true);
    const state = loadState();
    assert.equal(state.pending_comments === undefined || state.pending_comments.fantasma === undefined, true);
  });

  it('rechaza entradas sin task_id o sin texto con reason "invalid" y no escribe nada', () => {
    const logger = spyLogger();
    assert.deepEqual(markPendingComment({ text: 'sin id' }, logger), {
      ok: false,
      reason: 'invalid',
    });
    assert.deepEqual(markPendingComment({ task_id: 'task-f', text: '' }, logger), {
      ok: false,
      reason: 'invalid',
    });
    const state = loadState();
    assert.equal(state.pending_comments === undefined || state.pending_comments['task-f'] === undefined, true);
    assert.equal(logger.calls.warn.length, 2);
  });

  it('convive con las otras claves aditivas sin pisarlas (tasks / integration_queue)', () => {
    writeSeed({
      tasks: { t1: { plan_path: '/p/t1.md', next: 'seguir', updated_at: '2026-08-28T09:00:00.000Z' } },
      integration_queue: [{ task_ref: 'X-1', branch: 'feat/x', status: 'pending' }],
    });
    markPendingComment({ task_id: 'task-g', text: 'texto g' });

    const state = loadState();
    assert.equal(state.tasks.t1.next, 'seguir');
    assert.equal(state.integration_queue.length, 1);
    assert.equal(state.pending_comments['task-g'].text, 'texto g');
  });
});
