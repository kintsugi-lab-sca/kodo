#!/usr/bin/env node
// @ts-check
//
// Claude Code TaskCreated/TaskCompleted hook for kodo (Phase 50, PROG-02).
//
// Hook SEPARADO (NO append a session-start.js — preserva golden-bytes HOOK-02).
// En cada disparo recuenta AUTORITATIVAMENTE el tasks-dir plano de Claude Code
// (~/.claude/tasks/<session_id>/), deriva N=count(status==="completed")/M=total
// (self-healing, sobrevive eventos perdidos — D-04), correlaciona session_id→task_id
// (UUID kodo) vía findSession (D-05), y escribe el snapshot a
// ~/.kodo/progress/<task_id>.json.
//
// never-throws fire-and-forget: ENOENT/JSON corrupto/sesión no rastreada/payload
// basura NUNCA crashean Claude Code. Cuerpo mínimo (modo síncrono validado por el
// gate A2: ~35ms/evento, imperceptible — no se requiere async). findSession se
// importa LAZY dentro de runProgressHook para no encarecer el cold-start.
//
// TODO el acoplamiento a internals de Claude Code vive EXCLUSIVAMENTE aquí (1 archivo):
// el dashboard nunca lee ~/.claude/, solo el artefacto kodo.

import { readdirSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const STDIN_TIMEOUT = 3000; // copia literal de session-start.js:15

/**
 * Recuento AUTORITATIVO del tasks-dir (D-04). Puro/never-throws-friendly:
 * el readdir va en try/catch (ENOENT/EACCES → null = cohorte sin tasks-dir
 * tolerada); cada N.json se parsea en su PROPIO try/catch (JSON a medio escribir
 * → no cuenta como completed, self-heal el próximo evento — Pitfall 6).
 *
 * Filtra `.lock`/`.highwatermark` (Pitfall 3): solo cuentan `*.json` que NO
 * empiezan por `.`. NUNCA toma el `.lock` (es de Claude Code). Status estricto
 * `=== 'completed'` (Pitfall 4): cancelled/blocked/in_progress NO inflan N.
 *
 * @param {string} tasksDir  ruta absoluta a ~/.claude/tasks/<session_id>/
 * @param {{ readdirFn?: (p: string) => string[], readFileFn?: (p: string) => string }} [deps]
 * @returns {{ n: number, m: number } | null}  null si el tasks-dir no es legible.
 */
export function deriveProgress(tasksDir, deps = {}) {
  const readdirFn = deps.readdirFn || readdirSync;
  const readFileFn = deps.readFileFn || ((p) => readFileSync(p, 'utf-8'));

  let entries;
  try {
    entries = readdirFn(tasksDir);
  } catch {
    return null; // ENOENT/EACCES → silencioso (sin tasks-dir, no escribimos)
  }

  let n = 0;
  let m = 0;
  for (const f of entries) {
    // Filtrado (Pitfall 3): ignora `.lock`/`.highwatermark` y cualquier no-json.
    if (!f.endsWith('.json') || f.startsWith('.')) continue;
    m++;
    try {
      const t = JSON.parse(readFileFn(join(tasksDir, f)));
      if (t && t.status === 'completed') n++; // igualdad ESTRICTA (Pitfall 4)
    } catch {
      // JSON a medio escribir → no cuenta como completed (self-heal próximo evento).
    }
  }
  return { n, m };
}

/**
 * Núcleo del hook, testeable con DI (sin spawn). never-throws.
 *
 * @param {any} input  payload del hook ya parseado (puede ser basura).
 * @param {{
 *   readdirFn?: (p: string) => string[],
 *   readFileFn?: (p: string) => string,
 *   writeFileFn?: (p: string, c: string) => void,
 *   mkdirFn?: (p: string) => void,
 *   findSessionFn?: (q: { sessionId: string }) => any,
 *   homedirFn?: () => string,
 * }} [deps]
 *   DI para HOME-isolation en tests (mold readLightPlan plan.js:65-69).
 *   `findSessionFn` sin default — el guard de invocación directa lo inyecta
 *   vía import dinámico lazy de ../session/state.js.
 * @returns {Promise<void>}
 */
export async function runProgressHook(input, deps = {}) {
  try {
    const sessionId = input && typeof input === 'object' ? input.session_id : undefined;
    if (!sessionId) return; // never-throws: payload basura / sin session_id → silencioso

    const homedirFn = deps.homedirFn || homedir;

    // 1. Recuento AUTORITATIVO del tasks-dir (D-04, NO acumular eventos — Pitfall 2).
    const tasksDir = join(homedirFn(), '.claude', 'tasks', sessionId);
    const counts = deriveProgress(tasksDir, deps);
    if (!counts) return; // sin tasks-dir legible → no-op

    // 2. Correlación session_id → task_id (UUID kodo). findSession LAZY si no se inyecta.
    const findSessionFn =
      deps.findSessionFn || (await import('../session/state.js')).findSession;
    const found = findSessionFn({ sessionId });
    if (!found) return; // sesión no rastreada por kodo → no-op silencioso

    // USAR found.session.task_id (UUID kodo) — NUNCA input.task_id (índice "1" de
    // Claude Code, namespace distinto — Open Question 2 del research).
    const taskId = found.session && found.session.task_id;

    // 3. Anti-traversal ANTES de construir la ruta (mold plan.js:120-121,
    //    String.includes NO regex — anti-ReDoS D-13). Los TRES checks `/` `\` `..`.
    if (
      !taskId ||
      taskId.includes('/') ||
      taskId.includes('\\') ||
      taskId.includes('..')
    ) {
      return;
    }

    // 4. Escritura write-owner kodo. Ruta byte-idéntica al consumidor (Plan 03):
    //    join(homedir(), '.kodo', 'progress', `${taskId}.json`).
    const mkdirFn = deps.mkdirFn || ((p) => mkdirSync(p, { recursive: true }));
    const writeFileFn = deps.writeFileFn || writeFileSync;
    const progDir = join(homedirFn(), '.kodo', 'progress');
    try {
      mkdirFn(progDir);
    } catch {
      // best-effort: si ya existe o no se puede crear, intentamos escribir igual.
    }
    const snapshot = {
      n: counts.n,
      m: counts.m,
      completed: counts.m > 0 && counts.n === counts.m,
      updated_at: new Date().toISOString(),
    };
    writeFileFn(join(progDir, `${taskId}.json`), JSON.stringify(snapshot) + '\n');
  } catch {
    // never-throws: jamás crashea Claude Code.
  }
}

async function readStdin() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('{}'), STDIN_TIMEOUT);
    const chunks = [];
    process.stdin.on('data', (chunk) => chunks.push(chunk));
    process.stdin.on('end', () => {
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString());
    });
  });
}

async function main() {
  try {
    const input = JSON.parse(await readStdin());
    await runProgressHook(input);
  } catch {
    // never-throws: payload no-JSON / cualquier fallo → silencioso.
  }
}

// Only run main() when invoked directly as a script, not when imported.
if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
