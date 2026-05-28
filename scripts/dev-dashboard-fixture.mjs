#!/usr/bin/env node
// @ts-check
//
// scripts/dev-dashboard-fixture.mjs — dev-only fixture server para UAT del dashboard.
//
// Sirve un `/status` curado que cubre TODOS los estados visuales de la Phase 36 + variedad
// suficiente para ejercitar la nav y los filtros. Exercita el pipeline real (fetchStatus →
// usePoll → SessionTable) sin tocar `~/.kodo/state.json` ni necesitar sesiones kodo vivas.
//
// USO:
//   node scripts/dev-dashboard-fixture.mjs          # default port 9999
//   node scripts/dev-dashboard-fixture.mjs 7777     # port override
//
//   # En otra terminal:
//   kodo dashboard --url http://localhost:9999
//
//   # Ctrl-C en este proceso para parar el server.
//
// SCRIPT DE UAT (Phase 36 — 36-HUMAN-UAT.md):
//
//   1. Sweep visual de colores (TUI-10):
//      - Confirmar 6 filas con sus colores:
//          VAMP-7  running+alive   → green
//          VAMP-12 running+alive   → green   (GSD: phase/mode = 12/full)
//          KL-42   ZOMBIE          → red + marca textual `(zombie)`  ← load-bearing
//          KL-99   review          → cyan
//          ORCA-3  error           → magenta (DISTINTO del rojo del zombie)
//          KL-7    done            → dim/gris (defensivo: en producción done va a history)
//      - Confirmar contadores en header: `2 running · 1 zombie · 1 review · 1 error · 1 done`
//
//   2. Navegación + selección (TUI-08):
//      - ↑/↓ mueven el gutter `› ` por las filas
//      - Bold (no inverse — UAT-pulido post-Phase 36) en la fila activa
//      - El cursor sigue a la sesión por `task_id` aunque haya reordenamiento
//
//   3. Filtro modal (TUI-12):
//      - `/` abre la línea de filtro al pie (`/ <query>▏`)
//      - Teclear `kint` → solo KL-42, KL-99, KL-7
//      - Teclear `r:vamp` (limpiando primero con backspace) → solo VAMP-7, VAMP-12
//      - Teclear `s:review` → solo KL-99
//      - `Esc` cancela el filtro y vuelve al modo lista
//      - En modo lista, `Esc` NO hace nada (reservado a Phase 38)
//
//   4. CR-01 regression (el bug que reventó el code review):
//      - Selecciona KL-99 con ↓↓↓ (la fila de review)
//      - `/` + teclear `noexiste` → estado `no sessions match` (lista vacía bajo filtro)
//      - `Esc` para cancelar
//      - **El cursor DEBE volver a KL-99**, NO saltar a VAMP-7 (la primera fila).
//      - Si salta, el fix de `8edb871` no está aplicado — algo está mal.
//
//   5. Resize artifact regression (el otro hot-patch):
//      - Cambia el ancho de la ventana del terminal varias veces
//      - **NO debe haber cabeceras `kodo dashboard` apiladas en el scrollback**.
//      - Al salir con `q`, el scrollback original debe restaurarse limpio.
//      - Si ves frames apilados, el alt-screen del fix `116cb1e` no está activo.

import http from 'node:http';

const PORT = Number(process.argv[2] ?? 9999);
const NOW = Date.now();
const MIN = 60_000;

/** @typedef {{ task_ref: string, task_id: string, status: 'running'|'done'|'error'|'review',
 *   alive: boolean, elapsed_min: number, workspace_ref: string, started_at: string,
 *   project_path: string, project_name?: string, provider: string, project_id: string,
 *   session_id: string, summary: string, gsd?: boolean, gsd_mode?: 'full'|'quick',
 *   phase_id?: string }} FixtureSession
 */

/** @type {FixtureSession[]} */
const sessions = [
  // 1. running + alive — GREEN, sin marca
  {
    task_ref: 'VAMP-7',  task_id: 't-vamp-7',  status: 'running', alive: true,
    elapsed_min: 0,  workspace_ref: 'workspace:vamp-7',
    started_at: new Date(NOW - 0 * MIN).toISOString(),
    project_path: '/Users/dev/vampire', project_name: 'VAMPIRE',
    provider: 'plane', project_id: 'p-vamp', session_id: 's-vamp-7',
    summary: 'add raycast extension',
  },
  // 2. running + alive + GSD — phase/mode populado (no `—`)
  {
    task_ref: 'VAMP-12', task_id: 't-vamp-12', status: 'running', alive: true,
    elapsed_min: 5,  workspace_ref: 'workspace:vamp-12',
    started_at: new Date(NOW - 5 * MIN).toISOString(),
    project_path: '/Users/dev/vampire', project_name: 'VAMPIRE',
    provider: 'plane', project_id: 'p-vamp', session_id: 's-vamp-12',
    summary: 'fix login race', gsd: true, gsd_mode: 'full', phase_id: '12',
  },
  // 3. ZOMBIE — running + !alive — RED + `(zombie)` (load-bearing TUI-10/D-09)
  {
    task_ref: 'KL-42',   task_id: 't-kl-42',   status: 'running', alive: false,
    elapsed_min: 23, workspace_ref: 'workspace:kl-42',
    started_at: new Date(NOW - 23 * MIN).toISOString(),
    project_path: '/Users/dev/kintsugi-lab', project_name: 'kintsugi-lab',
    provider: 'plane', project_id: 'p-kl', session_id: 's-kl-42',
    summary: 'cmux pane died but state.sessions still has it',
    gsd: true, gsd_mode: 'quick',
  },
  // 4. REVIEW — CYAN
  {
    task_ref: 'KL-99',   task_id: 't-kl-99',   status: 'review',  alive: true,
    elapsed_min: 8,  workspace_ref: 'workspace:kl-99',
    started_at: new Date(NOW - 8 * MIN).toISOString(),
    project_path: '/Users/dev/kintsugi-lab', project_name: 'kintsugi-lab',
    provider: 'plane', project_id: 'p-kl', session_id: 's-kl-99',
    summary: 'awaiting kodo gsd verify', gsd: true, gsd_mode: 'full', phase_id: '36',
  },
  // 5. ERROR — MAGENTA (distinto del red del zombie)
  {
    task_ref: 'ORCA-3',  task_id: 't-orca-3',  status: 'error',   alive: false,
    elapsed_min: 62, workspace_ref: 'workspace:orca-3',
    started_at: new Date(NOW - 62 * MIN).toISOString(),
    project_path: '/Users/dev/orca', project_name: 'orca',
    provider: 'github', project_id: 'p-orca', session_id: 's-orca-3',
    summary: 'build failed: missing entitlement',
  },
  // 6. DONE — DIM (defensivo: en prod va a history; aquí verificamos el code path)
  {
    task_ref: 'KL-7',    task_id: 't-kl-7',    status: 'done',    alive: false,
    elapsed_min: 145, workspace_ref: 'workspace:kl-7',
    started_at: new Date(NOW - 145 * MIN).toISOString(),
    project_path: '/Users/dev/kintsugi-lab', project_name: 'kintsugi-lab',
    provider: 'plane', project_id: 'p-kl', session_id: 's-kl-7',
    summary: 'shipped',
  },
];

const PAYLOAD = JSON.stringify({
  sessions,
  count: sessions.length,
  pending: [],
  pending_count: 0,
  history: [],
  metrics: {
    total_closed: 0, closed_24h: 0, closed_7d: 0,
    avg_duration_min: 0, total_duration_min: 0,
  },
  uptime: 0,
});

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/status') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(PAYLOAD);
    return;
  }
  if (req.method === 'GET' && req.url === '/health') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ status: 'ok' }));
    return;
  }
  res.writeHead(404, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ error: 'not found' }));
});

server.listen(PORT, () => {
  process.stdout.write(`◆ kodo dashboard fixture server → http://localhost:${PORT}\n`);
  process.stdout.write(`  ${sessions.length} sessions: running+alive(2), zombie(1), review(1), error(1), done(1)\n\n`);
  process.stdout.write(`  Run in another terminal:\n    kodo dashboard --url http://localhost:${PORT}\n\n`);
  process.stdout.write(`  UAT script (Phase 36 HUMAN-UAT): see header comment of this file.\n`);
  process.stdout.write(`  Ctrl-C to stop.\n`);
});

const onExit = () => {
  server.close(() => process.exit(0));
};
process.once('SIGINT', onExit);
process.once('SIGTERM', onExit);
