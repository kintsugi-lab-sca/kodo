// @ts-check
//
// test/hooks/bb-session-rebind.test.js — KODO-31.
//
// El fallback por `BB_THREAD_ID` de `hooks/session-start.js` y su REBIND.
//
// POR QUÉ EXISTE ESTE CARRIL. El lookup del hook es por identidad estricta desde KODO-27
// (`session_id`, sin fallback por cwd), y esa premisa se sostenía en que kodo controla el
// `--session-id` que le pasa a Claude Code. Con el host bb NO lo controla: BB arranca
// Claude por el Agent SDK y genera el suyo. Sin este fallback, TODA sesión de bb saldría
// del hook en silencio y arrancaría sin saber en qué tarea trabaja.
//
// El puente es el ref: el id del thread, que BB exporta como `BB_THREAD_ID` en el entorno
// del hijo y que kodo persistió como `workspace_ref`. No es una heurística —un thread
// pertenece a una sola sesión— a diferencia del match por cwd que KODO-27 eliminó.
//
// Se prueba EJECUTANDO el hook como proceso (es donde vive `main()`, que no se exporta):
// stdin JSON, `$HOME` en un tmpdir, y se observan las dos salidas que importan — el
// contexto por stdout y el `session_id` reescrito en state.json.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const HOOK = join(__dirname, '..', '..', 'src', 'hooks', 'session-start.js');

const THREAD_ID = 'thr_alpha0000';
/** El session_id que kodo generó al lanzar — el que BB va a ignorar. */
const KODO_SESSION_ID = '11111111-1111-4111-8111-111111111111';
/** El session_id REAL del proceso claude que BB arrancó. */
const BB_SESSION_ID = '22222222-2222-4222-8222-222222222222';

let home;

function bbSession(overrides = {}) {
  return {
    workspace_ref: THREAD_ID,
    session_id: KODO_SESSION_ID,
    task_id: 'task-uuid-1',
    task_ref: 'KODO-31',
    provider: 'plane',
    project_id: 'proj-1',
    summary: 'Host bb: tercer WorkspaceHost',
    status: 'running',
    started_at: '2026-08-29T10:00:00.000Z',
    project_path: '/dev/kodo',
    host: 'bb',
    ...overrides,
  };
}

/** Escribe un state.json v3 con las sesiones dadas en el HOME del test. */
function writeState(sessions, history = []) {
  writeFileSync(
    join(home, '.kodo', 'state.json'),
    JSON.stringify({ schema_version: 3, sessions, history }, null, 2),
  );
}

function readState() {
  return JSON.parse(readFileSync(join(home, '.kodo', 'state.json'), 'utf-8'));
}

/**
 * Ejecuta el hook con el input dado. `env` se MEZCLA sobre un entorno limpio de las
 * variables de BB, para que el entorno real del que corre la suite (que podría estar
 * DENTRO de un thread de BB) no contamine el resultado.
 */
function runHook(input, env = {}) {
  const clean = { ...process.env, HOME: home };
  delete clean.BB_THREAD_ID;
  delete clean.BB_ENVIRONMENT_ID;
  return spawnSync(process.execPath, [HOOK], {
    input: JSON.stringify(input),
    encoding: 'utf-8',
    env: { ...clean, ...env },
  });
}

describe('KODO-31 — fallback por BB_THREAD_ID en session-start', () => {
  before(() => {
    home = mkdtempSync(join(tmpdir(), 'kodo-bb-rebind-'));
    mkdirSync(join(home, '.kodo'), { recursive: true });
  });

  after(() => {
    rmSync(home, { recursive: true, force: true });
  });

  it('inyecta el contexto de la tarea cuando el session_id NO casa pero BB_THREAD_ID sí', () => {
    writeState({ 'task-uuid-1': bbSession() });
    const res = runHook(
      { session_id: BB_SESSION_ID, cwd: '/dev/kodo' },
      { BB_THREAD_ID: THREAD_ID },
    );
    assert.equal(res.status, 0, res.stderr);
    const out = JSON.parse(res.stdout);
    assert.equal(out.hookSpecificOutput.hookEventName, 'SessionStart');
    assert.match(out.hookSpecificOutput.additionalContext, /KODO-31/);
    assert.match(out.hookSpecificOutput.additionalContext, /Host bb: tercer WorkspaceHost/);
  });

  it('REBIND: state.json acaba con el session_id REAL del proceso de BB', () => {
    // La mitad que hace que la sesión se pueda CERRAR: a partir de aquí `stop.js` y
    // `session-end.js` matchean por session_id sin cambio alguno, y el
    // `pgrep -f "session-id <sid>"` del reconcile encuentra el proceso que BB lanzó.
    writeState({ 'task-uuid-1': bbSession() });
    const res = runHook({ session_id: BB_SESSION_ID }, { BB_THREAD_ID: THREAD_ID });
    assert.equal(res.status, 0, res.stderr);
    assert.equal(readState().sessions['task-uuid-1'].session_id, BB_SESSION_ID);
    // Y el resto de la sesión queda intacto: el rebind toca UNA clave.
    assert.equal(readState().sessions['task-uuid-1'].workspace_ref, THREAD_ID);
    assert.equal(readState().sessions['task-uuid-1'].task_ref, 'KODO-31');
  });

  it('el contexto inyectado lleva ya el session_id NUEVO, no el que kodo generó', () => {
    writeState({ 'task-uuid-1': bbSession() });
    const res = runHook({ session_id: BB_SESSION_ID }, { BB_THREAD_ID: THREAD_ID });
    const ctx = JSON.parse(res.stdout).hookSpecificOutput.additionalContext;
    assert.ok(ctx.includes(BB_SESSION_ID), 'el contexto debe llevar el session_id real');
    assert.ok(!ctx.includes(KODO_SESSION_ID), 'no debe filtrarse el session_id obsoleto');
  });

  it('SIN BB_THREAD_ID el hook sale en silencio (el fallback no se activa solo)', () => {
    // Esta es la guarda que impide que el fallback degrade a un match por presencia: una
    // sesión ad-hoc no adoptada, que corre en el mismo repo, no debe robar el contexto.
    writeState({ 'task-uuid-1': bbSession() });
    const res = runHook({ session_id: BB_SESSION_ID, cwd: '/dev/kodo' });
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), '', 'sin la variable, silencio');
    assert.equal(readState().sessions['task-uuid-1'].session_id, KODO_SESSION_ID, 'nada se reescribe');
  });

  it('NO reescribe una sesión de OTRO host aunque el ref coincida', () => {
    // Cierre estructural: hoy los refs de cmux (`workspace:N`), orca (`<uuid>::<path>`) y
    // bb (`thr_…`) no pueden colisionar, pero el rebind es una escritura de identidad y no
    // debe depender de que dos formatos sigan siendo distintos mañana.
    writeState({ 'task-uuid-1': bbSession({ host: 'cmux' }) });
    const res = runHook({ session_id: BB_SESSION_ID }, { BB_THREAD_ID: THREAD_ID });
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), '');
    assert.equal(readState().sessions['task-uuid-1'].session_id, KODO_SESSION_ID);
  });

  it('NO revive una entry de HISTORY aunque su ref case con BB_THREAD_ID', () => {
    // history son sesiones ya cerradas. Reabrir una por el ref sería resucitar trabajo
    // terminado y devolver la tarea a un ciclo que ya se cerró.
    writeState({}, [{ ...bbSession(), state: 'closed', ended_at: '2026-08-29T11:00:00.000Z' }]);
    const res = runHook({ session_id: BB_SESSION_ID }, { BB_THREAD_ID: THREAD_ID });
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), '');
  });

  it('el lookup por session_id sigue GANANDO: con match directo no se toca el ref', () => {
    // Cero regresión para cmux/orca: el fallback solo corre si el lookup por identidad ya
    // falló. Aquí el session_id casa, así que el rebind ni se plantea.
    writeState({ 'task-uuid-1': bbSession({ session_id: BB_SESSION_ID }) });
    const res = runHook(
      { session_id: BB_SESSION_ID },
      { BB_THREAD_ID: 'thr_otro_distinto' },
    );
    assert.equal(res.status, 0, res.stderr);
    assert.match(JSON.parse(res.stdout).hookSpecificOutput.additionalContext, /KODO-31/);
    assert.equal(readState().sessions['task-uuid-1'].workspace_ref, THREAD_ID, 'el ref no se toca');
  });

  it('un BB_THREAD_ID que no casa con ninguna sesión sale en silencio', () => {
    writeState({ 'task-uuid-1': bbSession() });
    const res = runHook({ session_id: BB_SESSION_ID }, { BB_THREAD_ID: 'thr_inexistente' });
    assert.equal(res.status, 0);
    assert.equal(res.stdout.trim(), '');
  });

  it('un state.json ilegible no rompe el arranque de Claude Code (never-throws)', () => {
    writeFileSync(join(home, '.kodo', 'state.json'), '{ esto no es json');
    const res = runHook({ session_id: BB_SESSION_ID }, { BB_THREAD_ID: THREAD_ID });
    assert.equal(res.status, 0, 'el hook nunca debe salir con error');
    assert.equal(res.stdout.trim(), '');
  });
});
