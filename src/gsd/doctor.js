// @ts-check
//
// src/gsd/doctor.js — Phase 41 Plan 02 (DOCTOR-01/02/04).
//
// Módulo PURO de saneo de las 4 categorías de basura del ciclo de vida de las
// sesiones kodo: worktrees huérfanos, sesiones zombie (`alive===false`), locks
// per-repo colgados (PID muerto / TTL vencido) y logs NDJSON antiguos. Espejo
// arquitectónico EXACTO de `src/session/reconcile.js`: una mitad PURA de
// detección (`scan`) y una mitad de I/O sanitizadora (`execute`) — ambas DI,
// never-throws, fail-open per item.
//
// scan(deps) → report serializable (NO muta nada, NO hace I/O destructivo).
// execute(deps, opts) → result distinto en shape, re-detecta y RE-CHEQUEA
// liveness IMMEDIATELY antes de cada acción destructiva (D-06/D-14 TOCTOU guard).
//
// Invariantes de seguridad (threat register Phase 41):
//   - NUNCA borrado recursivo forzado ni `rmSync` de directorios. Worktrees →
//     cleanupWorktree (git remove sin --force, dirty→.dirty) o `git worktree prune`.
//   - Detección de worktrees SOLO via `.bg-shell/<sessionId>` cruzado contra
//     state.json — JAMÁS enumerando los worktrees de git (eso surfacearía
//     .claude/worktrees/ y worktrees de orca; T-41-05).
//   - Locks: state machine espejo de `acquireGsdLock` (PID muerto → steal; TTL
//     vencido → steal; PID vivo + TTL ok → keep). El TTL es la red de seguridad
//     contra PID-reuse (D-13).
//   - Logs: `unlinkFile` ENTERO (nunca truncate — preserva followers POSIX, D-12).
//   - execute NUNCA toca un worktree/lock de una sesión viva (D-14).
//
// LOG-12 invariant: este módulo NO importa `logger.js`. El `logger` se inyecta
// via deps; `logger-events.js` (pure transform) sí es importable estáticamente.
// El único acoplamiento estático a node es a `node:fs`/`node:os`/`node:path`/
// `node:child_process` para los defaults lazy de las primitivas DI (espejo de
// gsd-inspect.js:58-65 y del wrapper gitFn de stop.js:122-126).

import { readdirSync, statSync, unlinkSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

import { isPidAlive as realIsPidAlive, readLock as realReadLock, LOCK_FILE, DEFAULT_TTL_HOURS } from './lock.js';
import { loadState as realLoadState, computeWorktreePath, removeSession as realRemoveSession } from '../session/state.js';
import { cleanupWorktree as realCleanupWorktree } from '../hooks/worktree-cleanup.js';
// LOG-12: logger-noop.js es el stub zero-import whitelisted (igual que state.js) —
// NUNCA logger.js. Sirve de default seguro para que cleanupWorktree no crashee
// al emitir eventos cuando el caller (p.ej. el CLI) no inyecta logger.
import { noopLogger } from '../logger-noop.js';
import {
  doctorScan,
  doctorFixWorktree,
  doctorFixLock,
  doctorFixLog,
  doctorFixError,
} from '../logger-events.js';

// Reuso del cutoff de retención — NO hardcodear 7 (D-12). polling-logfile.js es
// la fuente única de DEFAULT_RETENTION_DAYS/MS_PER_DAY (carril FS, sin logger.js).
import { DEFAULT_RETENTION_DAYS, MS_PER_DAY } from '../cli/polling-logfile.js';

const MS_PER_HOUR = 3600_000;

/**
 * @typedef {import('../session/state.js').Session} Session
 * @typedef {import('../session/state.js').State} State
 * @typedef {import('./lock.js').LockContent} LockContent
 *
 * @typedef {{ sessionId: string, path: string, projectPath: string }} WorktreeDir
 * @typedef {{ sessionId: string, path: string, mtimeMs?: number }} LogFile
 * @typedef {{ id: string, path: string, action: string, reason: string }} ReportItem
 *
 * @typedef {{
 *   worktrees: ReportItem[],
 *   zombies: ReportItem[],
 *   locks: ReportItem[],
 *   logs: ReportItem[],
 *   protected: { sessions: ReportItem[], locks: ReportItem[] },
 *   hasGarbage: boolean,
 * }} DoctorReport
 *
 * @typedef {{
 *   loadState?: () => State,
 *   readLock?: (projectPath: string) => LockContent | null,
 *   listLockProjects?: () => string[],
 *   isPidAlive?: (pid: number) => boolean,
 *   listLogFiles?: () => LogFile[],
 *   statFile?: (path: string) => { mtimeMs: number },
 *   listWorktreeDirs?: () => WorktreeDir[],
 *   removeSession?: (taskId: string, logger?: any) => void,
 *   gitFn?: (cwd: string, args: string[]) => Promise<string> | string,
 *   cleanupWorktree?: (args: any) => Promise<{ removed: boolean, moved_to: string|null, branch_deleted: boolean }>,
 *   unlinkFile?: (path: string) => void,
 *   now?: () => number,
 *   logger?: { info: Function, warn: Function, error: Function },
 * }} DoctorDeps
 */

// ── DI default resolution (lazy real impls; espejo gsd-inspect.js:58-65) ──────

/** Enumera `~/.kodo/logs/*.ndjson` → [{ sessionId, path, mtimeMs }]. */
function defaultListLogFiles() {
  const dir = join(homedir(), '.kodo', 'logs');
  let names;
  try {
    names = readdirSync(dir);
  } catch {
    return []; // dir ausente → nada que sanear (fail-open).
  }
  /** @type {LogFile[]} */
  const out = [];
  for (const name of names) {
    if (!name.endsWith('.ndjson')) continue;
    const full = join(dir, name);
    let mtimeMs = 0;
    try {
      mtimeMs = statSync(full).mtimeMs;
    } catch {
      continue; // race / permisos → saltar.
    }
    out.push({ sessionId: name.slice(0, -'.ndjson'.length), path: full, mtimeMs });
  }
  return out;
}

/**
 * Enumera los dirs `.bg-shell/<sessionId>` de los projectPath conocidos por
 * state.json. Cruza con `computeWorktreePath` para garantizar el scoping a
 * `.bg-shell` — JAMÁS enumerando los worktrees de git (T-41-05). Cada projectPath se escanea
 * una sola vez.
 */
function defaultListWorktreeDirs() {
  /** @type {WorktreeDir[]} */
  const out = [];
  let state;
  try {
    state = realLoadState();
  } catch {
    return [];
  }
  // Unificar projectPaths de sesiones activas + history (espejo de
  // collectLockProjects): un `.bg-shell/<id>` huérfano puede sobrevivir a una
  // sesión ya archivada en history — sigue siendo basura a sanear, así que su
  // proyecto debe escanearse aunque no tenga sesiones activas.
  const projects = new Set();
  for (const s of Object.values(state.sessions || {})) {
    if (s && s.project_path) projects.add(s.project_path);
  }
  if (Array.isArray(state.history)) {
    for (const s of state.history) {
      if (s && s.project_path) projects.add(s.project_path);
    }
  }
  for (const projectPath of projects) {
    const bgShell = join(projectPath, '.bg-shell');
    let names;
    try {
      names = readdirSync(bgShell);
    } catch {
      continue; // .bg-shell ausente para este proyecto → nada.
    }
    for (const sessionId of names) {
      // Saltar los artefactos de preservación `<id>.dirty` / `<id>.dirty-<ts>`
      // que cleanupWorktree deja a propósito: son trabajo sin commit reservado
      // para revisión manual, NO worktrees de sesión que doctor deba re-sanear
      // (re-detectarlos provocaría un move-to-.dirty.dirty en el siguiente --fix).
      if (/\.dirty(-\d+)?$/.test(sessionId)) continue;
      out.push({ sessionId, path: computeWorktreePath(projectPath, sessionId), projectPath });
    }
  }
  return out;
}

/** Resuelve los deps con sus defaults reales lazy. */
function resolveDeps(deps = {}) {
  return {
    loadState: deps.loadState || realLoadState,
    readLock: deps.readLock || realReadLock,
    listLockProjects: deps.listLockProjects || null, // resuelto perezosamente en detectHungLocks (necesita state).
    isPidAlive: deps.isPidAlive || realIsPidAlive,
    listLogFiles: deps.listLogFiles || defaultListLogFiles,
    statFile: deps.statFile || ((p) => statSync(p)),
    listWorktreeDirs: deps.listWorktreeDirs || defaultListWorktreeDirs,
    removeSession: deps.removeSession || realRemoveSession,
    // gitFn default real — espejo de stop.js:122-126. Sin esto, execute() pasa
    // gitFn=undefined a cleanupWorktree y la limpieza de worktrees crashea con
    // "gitFn is not a function" en la ruta CLI (deps no inyectados).
    gitFn: deps.gitFn || ((cwd, args) => execFileSync('git', ['-C', cwd, ...args], { encoding: 'utf-8' }).trim()),
    cleanupWorktree: deps.cleanupWorktree || realCleanupWorktree,
    unlinkFile: deps.unlinkFile || ((p) => unlinkSync(p)),
    now: deps.now || (() => Date.now()),
    // logger default seguro: cleanupWorktree/los helpers doctor.* invocan
    // logger.{info,warn,error}; un undefined los rompería. noopLogger es no-op.
    logger: deps.logger || noopLogger,
  };
}

// ── Liveness helpers ─────────────────────────────────────────────────────────

/**
 * ¿Está viva la sesión? Regla principal: `alive===true`. (El pid del proceso
 * Claude no se persiste en Session — la liveness agregada vive en `alive`,
 * escrito únicamente por reconcileTick. El re-check de PID se aplica a locks,
 * que sí llevan pid.)
 * @param {Session|undefined} session
 * @returns {boolean}
 */
function isSessionLive(session) {
  return !!(session && session.alive === true);
}

/**
 * Construye el índice sessionId → Session a partir de SOLO las sesiones activas
 * (state.sessions). history NO cuenta como vivo.
 * @param {State} state
 * @returns {Map<string, Session>}
 */
function indexBySessionId(state) {
  const map = new Map();
  for (const s of Object.values(state.sessions || {})) {
    if (s && s.session_id) map.set(s.session_id, s);
  }
  return map;
}

/**
 * Decide el destino de un lock — espejo EXACTO de `acquireGsdLock` (D-13):
 *   PID muerto → 'steal'; TTL vencido → 'steal'; PID vivo + TTL ok → 'keep'.
 * @param {LockContent} lock
 * @param {(pid: number) => boolean} isPidAlive
 * @param {number} nowMs
 * @returns {{ decision: 'steal'|'keep', reason: string }}
 */
function decideLock(lock, isPidAlive, nowMs) {
  if (!isPidAlive(lock.pid)) {
    return { decision: 'steal', reason: `PID ${lock.pid} dead` };
  }
  const acquiredAt = new Date(lock.acquired_at).getTime();
  const ttlHours = lock.ttl_hours || DEFAULT_TTL_HOURS;
  const ttlMs = ttlHours * MS_PER_HOUR;
  if (Number.isFinite(acquiredAt) && nowMs - acquiredAt > ttlMs) {
    return { decision: 'steal', reason: `TTL ${ttlHours}h exceeded` };
  }
  return { decision: 'keep', reason: 'PID alive, TTL ok' };
}

// ── Detección compartida (DRY entre scan y execute, D-06) ────────────────────

/**
 * Detecta worktrees `.bg-shell/<id>` huérfanos (sin sesión viva) y los vivos
 * (protected). never-throws: un fallo deja la categoría vacía + warn.
 * @returns {{ orphans: ReportItem[], protectedSessions: ReportItem[] }}
 */
function detectOrphanWorktrees(d, liveById) {
  try {
    const dirs = d.listWorktreeDirs();
    /** @type {ReportItem[]} */
    const orphans = [];
    /** @type {ReportItem[]} */
    const protectedSessions = [];
    for (const wt of dirs) {
      const session = liveById.get(wt.sessionId);
      if (isSessionLive(session)) {
        protectedSessions.push({ id: wt.sessionId, path: wt.path, action: 'keep', reason: 'session alive' });
      } else {
        orphans.push({ id: wt.sessionId, path: wt.path, action: 'remove', reason: 'no live session for .bg-shell dir' });
      }
    }
    return { orphans, protectedSessions };
  } catch (err) {
    d.logger?.warn?.('doctor.scan', { category: 'worktree', error: String(/** @type {Error} */ (err).message || err) });
    return { orphans: [], protectedSessions: [] };
  }
}

/**
 * Detecta sesiones zombie (alive===false) en state.sessions.
 * @returns {ReportItem[]}
 */
function detectZombies(d, state) {
  try {
    /** @type {ReportItem[]} */
    const out = [];
    for (const [taskId, s] of Object.entries(state.sessions || {})) {
      if (s && s.alive === false) {
        out.push({ id: taskId, path: s.worktree_path || s.project_path || '', action: 'remove-session', reason: 'alive===false' });
      }
    }
    return out;
  } catch (err) {
    d.logger?.warn?.('doctor.scan', { category: 'zombie', error: String(/** @type {Error} */ (err).message || err) });
    return [];
  }
}

/**
 * Reúne los projectPaths donde puede haber un `.kodo.lock`: el inyectado
 * `listLockProjects` gana; si no, deriva de state.sessions + state.history +
 * `process.cwd()` (el repo donde corre `kodo gsd doctor`). Set para dedup.
 * @returns {Set<string>}
 */
function collectLockProjects(d, state) {
  if (typeof d.listLockProjects === 'function') {
    return new Set(d.listLockProjects());
  }
  const projects = new Set();
  for (const s of Object.values(state.sessions || {})) {
    if (s && s.project_path) projects.add(s.project_path);
  }
  if (Array.isArray(state.history)) {
    for (const s of state.history) {
      if (s && s.project_path) projects.add(s.project_path);
    }
  }
  try {
    projects.add(process.cwd());
  } catch {
    // cwd inaccesible (raro) → ignorar.
  }
  return projects;
}

/**
 * Detecta locks per-repo colgados de los projectPath conocidos. Devuelve los
 * que hay que robar (hung) y los vivos (protected).
 * @returns {{ hung: ReportItem[], protectedLocks: ReportItem[] }}
 */
function detectHungLocks(d, state, nowMs) {
  try {
    const projects = collectLockProjects(d, state);
    /** @type {ReportItem[]} */
    const hung = [];
    /** @type {ReportItem[]} */
    const protectedLocks = [];
    for (const projectPath of projects) {
      const lock = d.readLock(projectPath);
      if (!lock) continue;
      const { decision, reason } = decideLock(lock, d.isPidAlive, nowMs);
      const item = { id: lock.session_id, path: join(projectPath, LOCK_FILE), action: decision, reason };
      if (decision === 'steal') hung.push(item);
      else protectedLocks.push(item);
    }
    return { hung, protectedLocks };
  } catch (err) {
    d.logger?.warn?.('doctor.scan', { category: 'lock', error: String(/** @type {Error} */ (err).message || err) });
    return { hung: [], protectedLocks: [] };
  }
}

/**
 * Detecta logs NDJSON viejos (mtime > cutoff) de sesiones NO vivas. El log de
 * una sesión viva nunca se marca.
 * @returns {ReportItem[]}
 */
function detectOldLogs(d, liveById, nowMs) {
  try {
    const cutoffMs = nowMs - DEFAULT_RETENTION_DAYS * MS_PER_DAY;
    /** @type {ReportItem[]} */
    const out = [];
    for (const f of d.listLogFiles()) {
      if (isSessionLive(liveById.get(f.sessionId))) continue; // log de sesión viva → jamás.
      const mtimeMs = typeof f.mtimeMs === 'number' ? f.mtimeMs : safeMtime(d, f.path);
      if (mtimeMs !== null && mtimeMs < cutoffMs) {
        out.push({ id: f.sessionId, path: f.path, action: 'unlink', reason: `mtime > ${DEFAULT_RETENTION_DAYS}d, non-live session` });
      }
    }
    return out;
  } catch (err) {
    d.logger?.warn?.('doctor.scan', { category: 'log', error: String(/** @type {Error} */ (err).message || err) });
    return [];
  }
}

/** @returns {number|null} */
function safeMtime(d, path) {
  try {
    return d.statFile(path).mtimeMs;
  } catch {
    return null;
  }
}

// ── scan() ───────────────────────────────────────────────────────────────────

/**
 * Detección PURA de las 4 categorías. NO muta nada, NO hace I/O destructivo.
 * never-throws: cualquier fallo de detección deja su categoría vacía + warn.
 *
 * @param {DoctorDeps} [deps]
 * @returns {DoctorReport}
 */
export function scan(deps = {}) {
  const d = resolveDeps(deps);
  let state;
  try {
    state = d.loadState();
  } catch (err) {
    d.logger?.warn?.('doctor.scan', { category: 'state', error: String(/** @type {Error} */ (err).message || err) });
    state = { schema_version: 3, sessions: {}, history: [] };
  }
  const nowMs = d.now();
  const liveById = indexBySessionId(state);

  const { orphans, protectedSessions } = detectOrphanWorktrees(d, liveById);
  const zombies = detectZombies(d, state);
  const { hung, protectedLocks } = detectHungLocks(d, state, nowMs);
  const logs = detectOldLogs(d, liveById, nowMs);

  const hasGarbage = orphans.length > 0 || zombies.length > 0 || hung.length > 0 || logs.length > 0;

  if (d.logger) {
    doctorScan(/** @type {any} */ (d.logger), {
      mode: 'dry-run',
      worktrees: orphans.length,
      locks: hung.length,
      logs: logs.length,
      zombies: zombies.length,
    });
  }

  return {
    worktrees: orphans,
    zombies,
    locks: hung,
    logs,
    protected: { sessions: protectedSessions, locks: protectedLocks },
    hasGarbage,
  };
}

// ── execute() ──────────────────────────────────────────────────────────────

/**
 * @typedef {{
 *   worktrees: { removed: number, moved: number, pruned: number, skipped: number },
 *   zombies: { removed: number },
 *   locks: { stolen: number, kept: number },
 *   logs: { unlinked: number },
 *   errors: Array<{ category: string, target: string, reason: string }>,
 * }} DoctorResult
 */

function emptyResult() {
  return {
    worktrees: { removed: 0, moved: 0, pruned: 0, skipped: 0 },
    zombies: { removed: 0 },
    locks: { stolen: 0, kept: 0 },
    logs: { unlinked: 0 },
    errors: [],
  };
}

/**
 * Sanea las 4 categorías (o UNA sola sesión por `opts.taskId`). RE-detecta vía
 * los helpers compartidos (D-06: NO consume el report de scan como plan) y
 * re-chequea liveness IMMEDIATELY antes de cada acción destructiva: si el target
 * pasó a vivo entre scan y execute, se SALTA (TOCTOU guard, D-14).
 *
 * fail-open per item (D-10): cada acción va en su try/catch → doctorFixError +
 * continuar. never-throws al nivel superior (outer try/catch → result parcial).
 *
 * Cuando `opts.fix` es falsy, no-op (la CLI llama fix=true solo en `--fix`).
 * Cuando `opts.taskId` está set, scope a worktree+lock+state de esa sesión y se
 * EXCLUYE la categoría de logs (logs son retención global, D-05).
 *
 * @param {DoctorDeps} [deps]
 * @param {{ taskId?: string, fix?: boolean }} [opts]
 * @returns {Promise<DoctorResult>}
 */
export async function execute(deps = {}, opts = {}) {
  const result = emptyResult();
  if (!opts.fix) return result; // dry-run path: la CLI usa scan() para mostrar.

  const d = resolveDeps(deps);
  const log = /** @type {any} */ (d.logger);

  try {
    const nowMs = d.now();
    const taskId = opts.taskId;

    // RE-detección fresca (D-06). loadState dentro del try → si falla, outer catch.
    const state = d.loadState();
    const liveById = indexBySessionId(state);

    // ── Worktrees ──────────────────────────────────────────────────────────
    let worktreeDirs = [];
    try {
      worktreeDirs = d.listWorktreeDirs();
    } catch (err) {
      pushError(result, log, 'worktree', '.bg-shell', errMsg(err));
    }
    for (const wt of worktreeDirs) {
      const session = liveById.get(wt.sessionId);
      // Scope por taskId: solo el worktree de esa sesión.
      if (taskId && (!session || session.task_id !== taskId)) continue;
      // Re-check liveness JUST before the destructive action (D-14 / TOCTOU).
      if (isSessionLive(session)) {
        result.worktrees.skipped++;
        continue;
      }
      try {
        const r = await d.cleanupWorktree({
          project: wt.projectPath,
          worktree: wt.path,
          sessionId: wt.sessionId,
          gitFn: d.gitFn,
          logger: log,
        });
        if (r && r.moved_to) {
          result.worktrees.moved++;
          if (log) doctorFixWorktree(log, { session_id: wt.sessionId, worktree_path: wt.path, action: 'moved', moved_to: r.moved_to });
        } else if (r && r.removed) {
          result.worktrees.removed++;
          if (log) doctorFixWorktree(log, { session_id: wt.sessionId, worktree_path: wt.path, action: 'remove', moved_to: null });
        } else {
          // Ni removido ni movido (status read falló dentro del helper): el helper
          // ya corrió un prune oportunista. Lo contamos como prune.
          result.worktrees.pruned++;
          if (log) doctorFixWorktree(log, { session_id: wt.sessionId, worktree_path: wt.path, action: 'prune', moved_to: null });
        }
      } catch (err) {
        pushError(result, log, 'worktree', wt.path, errMsg(err));
      }
    }

    // ── Zombies (state.json entries con alive===false) ──────────────────────
    for (const [tid, s] of Object.entries(state.sessions || {})) {
      if (!s || s.alive !== false) continue;
      if (taskId && tid !== taskId) continue;
      try {
        d.removeSession(tid, log);
        result.zombies.removed++;
      } catch (err) {
        pushError(result, log, 'zombie', tid, errMsg(err));
      }
    }

    // ── Locks ───────────────────────────────────────────────────────────────
    const lockProjects = collectLockProjects(d, state);
    for (const projectPath of lockProjects) {
      let lock;
      try {
        lock = d.readLock(projectPath); // RE-read (D-06) — no snapshot.
      } catch (err) {
        pushError(result, log, 'lock', projectPath, errMsg(err));
        continue;
      }
      if (!lock) continue;
      // Scope por taskId: solo el lock de esa sesión.
      if (taskId && lock.task_id !== taskId) continue;
      const { decision, reason } = decideLock(lock, d.isPidAlive, nowMs);
      if (decision === 'keep') {
        result.locks.kept++;
        if (log) doctorFixLock(log, { project_path: projectPath, decision: 'kept', pid: lock.pid, reason });
        continue;
      }
      try {
        d.unlinkFile(join(projectPath, LOCK_FILE));
        result.locks.stolen++;
        if (log) doctorFixLock(log, { project_path: projectPath, decision: 'stolen', pid: lock.pid, reason });
      } catch (err) {
        pushError(result, log, 'lock', join(projectPath, LOCK_FILE), errMsg(err));
      }
    }

    // ── Logs ──────────────────────────────────────────────────────────────
    // EXCLUIDOS bajo scope por taskId (logs son retención global, D-05).
    if (!taskId) {
      const cutoffMs = nowMs - DEFAULT_RETENTION_DAYS * MS_PER_DAY;
      let logFiles = [];
      try {
        logFiles = d.listLogFiles();
      } catch (err) {
        pushError(result, log, 'log', '~/.kodo/logs', errMsg(err));
      }
      for (const f of logFiles) {
        if (isSessionLive(liveById.get(f.sessionId))) continue; // log de sesión viva → jamás.
        const mtimeMs = typeof f.mtimeMs === 'number' ? f.mtimeMs : safeMtime(d, f.path);
        if (mtimeMs === null || mtimeMs >= cutoffMs) continue;
        try {
          d.unlinkFile(f.path); // unlink ENTERO, nunca truncate (D-12).
          result.logs.unlinked++;
          if (log) doctorFixLog(log, { log_path: f.path, session_id: f.sessionId });
        } catch (err) {
          pushError(result, log, 'log', f.path, errMsg(err));
        }
      }
    }
  } catch (err) {
    // never-throws top-level: retorna result parcial + error registrado.
    pushError(result, log, 'execute', 'top-level', errMsg(err));
  }

  return result;
}

/** @param {unknown} err @returns {string} */
function errMsg(err) {
  return String(/** @type {any} */ (err)?.message || err);
}

/**
 * Registra un fallo en result.errors y emite doctorFixError (fail-open jamás silencioso).
 */
function pushError(result, log, category, target, reason) {
  result.errors.push({ category, target, reason });
  if (log) doctorFixError(log, { category, reason, target });
}
