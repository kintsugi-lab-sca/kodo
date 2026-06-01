#!/usr/bin/env node
// @ts-check
//
// scripts/dev-dashboard-fixture-p38.mjs — dev-only fixture server para el UAT
// VISUAL de la Phase 38 (badges multi-estado + filtros s:<state> + footer host-error).
//
// Sirve un `/status` curado con los 5 estados del ciclo de vida v3 (campo `state`)
// sin tocar `~/.kodo/state.json`, sin cmux y sin sesiones kodo vivas. Ejercita el
// pipeline VISUAL real (fetchStatus → usePoll → SessionTable → badges/filtros).
//
// ⚠ ALCANCE (honesto): este fixture valida SOLO la capa de RENDER (Plan 03):
// que los badges, filtros y counts se vean correctos. NO valida la
// RECONCILIACIÓN (Plan 04) ni el FOCUS real — esos viven en el server + cmux y
// están cubiertos por los tests automatizados (reconciliation.test.js 8/8,
// app-focus parity 5/5). El UAT end-to-end con cmux real queda pendiente para un
// entorno con sesiones vivas.
//
// USO:
//   node scripts/dev-dashboard-fixture-p38.mjs           # default port 9998
//   node scripts/dev-dashboard-fixture-p38.mjs 7777      # port override
//   HOST_ERROR=1 node scripts/dev-dashboard-fixture-p38.mjs   # simula /status 500 (footer host-error)
//
//   # En otra terminal (TTY interactivo):
//   kodo dashboard --url http://localhost:9998
//
//   Ctrl-C para parar.
//
// SCRIPT DE UAT VISUAL (Phase 38):
//
//   1. Badges multi-estado (SC#3 / D-06) — confirmar las 5 filas y sus badges:
//        KL-100  running      → ▶ running     (verde)
//        KL-101  idle         → ⏸ idle        (amarillo)   ← NUEVO Phase 38
//        KL-102  needs-input  → 🔔 needs-input (cyan)       ← NUEVO Phase 38
//        KL-103  dead         → ✗ dead        (rojo)        ← NUEVO Phase 38
//        KL-104  running+GSD  → ▶ running     (verde, phase/mode = 38/full)
//      - Confirmar la columna `state` a la izquierda de `task_ref`.
//      - Confirmar counts en el header: `3 running · 1 idle · 1 needs-input · 1 dead`
//        (KL-100 + KL-104 running, KL-101 idle, KL-102 needs-input, KL-103 dead;
//         nota: el 3er running es de la fila de relleno KL-105 más abajo).
//
//   2. Filtros s:<state> (SC#3 / D-06):
//      - `/` abre la línea de filtro.
//      - `s:idle`        → solo KL-101
//      - `s:needs-input` → solo KL-102
//      - `s:dead`        → solo KL-103
//      - `s:active`      → KL-100, KL-101, KL-102, KL-104, KL-105 (excluye KL-103 dead)
//      - `s:running`     → KL-100, KL-104, KL-105 (retrocompat Phase 36)
//      - `Esc` cancela.
//
//   3. Footer host-error (D-06) — relanzar con `HOST_ERROR=1`:
//      - El dashboard NO puede hacer fetch (server responde 500) → tras unos
//        ticks muestra el estado degradado `waiting for server` / `server caído`.
//      - NOTA: el footer rojo `[!] host unavailable…` (HOST_ERR_UNAVAILABLE) lo
//        dispara el RECONCILIADOR del server vía setHostError, que este fixture
//        NO ejecuta. Aquí solo se valida la degradación del cliente ante /status
//        caído (precedencia D-12 de Phase 36). El footer host-error real requiere
//        el server con cmux caído (UAT live).
//
//   4. closed NO se renderiza (D-04/D-06):
//      - La fila KL-106 tiene state:'closed' en el payload → su celda de badge
//        queda VACÍA (stateBadge('closed') → {}); la fila sigue visible pero sin
//        glyph de estado. En producción `closed` vive en history, no en sessions;
//        esta fila es defensiva para verificar que no rompe el render.

import http from 'node:http';

const PORT = Number(process.argv[2] ?? 9998);
const HOST_ERROR = process.env.HOST_ERROR === '1';
const NOW = Date.now();
const MIN = 60_000;

/**
 * @typedef {{
 *   task_ref: string, task_id: string,
 *   status: 'running'|'idle'|'needs-input'|'dead'|'closed'|'review'|'error',
 *   state: 'running'|'idle'|'needs-input'|'dead'|'closed',
 *   alive: boolean, needs_input?: boolean, process_alive?: boolean, tab_alive?: boolean,
 *   elapsed_min: number, workspace_ref: string, started_at: string,
 *   project_path: string, project_name?: string, provider: string, project_id: string,
 *   session_id: string, summary: string, gsd?: boolean, gsd_mode?: 'full'|'quick', phase_id?: string
 * }} FixtureSession
 */

/** Helper para reducir ruido en cada fila. */
function row(task_ref, state, overrides = {}) {
  const id = task_ref.toLowerCase();
  return {
    task_ref,
    task_id: `t-${id}`,
    state,
    // `status` legacy ≈ state para compat con consumers que aún lo lean.
    status: state,
    alive: state !== 'dead' && state !== 'closed',
    process_alive: state === 'running',
    tab_alive: state !== 'dead' && state !== 'closed',
    needs_input: state === 'needs-input',
    elapsed_min: 5,
    workspace_ref: `workspace:${id}`,
    started_at: new Date(NOW - 5 * MIN).toISOString(),
    project_path: '/Users/dev/kintsugi-lab',
    project_name: 'kintsugi-lab',
    provider: 'plane',
    project_id: 'p-kl',
    session_id: `s-${id}`,
    summary: `fixture ${state}`,
    ...overrides,
  };
}

/** @type {FixtureSession[]} */
const sessions = [
  row('KL-100', 'running'),
  row('KL-101', 'idle'),
  row('KL-102', 'needs-input'),
  row('KL-103', 'dead'),
  row('KL-104', 'running', { gsd: true, gsd_mode: 'full', phase_id: '38', summary: 'GSD session' }),
  row('KL-105', 'running', { summary: 'relleno para s:active' }),
  // Defensivo: closed NO debe renderizar badge (celda vacía), fila sigue visible.
  row('KL-106', 'closed', { alive: false, summary: 'closed — badge vacío (defensivo)' }),
];

const PAYLOAD = JSON.stringify({
  sessions,
  count: sessions.length,
  pending: [],
  pending_count: 0,
  history: [],
  metrics: { total_closed: 0, closed_24h: 0, closed_7d: 0, avg_duration_min: 0, total_duration_min: 0 },
  uptime: 0,
});

const server = http.createServer((req, res) => {
  if (req.method === 'GET' && req.url === '/status') {
    if (HOST_ERROR) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'simulated host failure' }));
      return;
    }
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
  process.stdout.write(`◆ kodo dashboard fixture P38 → http://localhost:${PORT}${HOST_ERROR ? '  [HOST_ERROR mode]' : ''}\n`);
  process.stdout.write(`  ${sessions.length} sessions: running(3), idle(1), needs-input(1), dead(1), closed(1)\n\n`);
  process.stdout.write(`  Run in another terminal:\n    kodo dashboard --url http://localhost:${PORT}\n\n`);
  process.stdout.write(`  UAT visual script: see header comment of this file.\n`);
  process.stdout.write(`  Ctrl-C to stop.\n`);
});

const onExit = () => { server.close(() => process.exit(0)); };
process.once('SIGINT', onExit);
process.once('SIGTERM', onExit);
