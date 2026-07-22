---
phase: 76-convergencia-del-conteo-pending
plan: 02
subsystem: api
tags: [pending, convergence, freshness, status-endpoint, kodo-check, dashboard]

# Dependency graph
requires:
  - phase: 76-convergencia-del-conteo-pending
    provides: "src/tasks/pending.js (fetchFreshPending, createPendingResolver, buildPendingStatusFields) — the shared read lane"
  - phase: 40-provider-state
    provides: "createProviderStateResolver wiring pattern mirrored for pendingResolver in startServer()"
provides:
  - "/status (server.js) derives pending/pending_count from the shared resolver — inline cache lane removed (ORCH-05)"
  - "/status exposes pending_stale:boolean + pending_fetched_at:string|null ALWAYS present, both branches (ORCH-06)"
  - "Provider outage past TTL → pending_stale:true instead of serving last-known-good as fresh (ORCH-06)"
  - "kodo check (check.js) routes pending read through fetchFreshPending — byte-identical output (ORCH-05, D-07)"
  - "Dashboard HTML marks «Candidatas» stat when pending_stale (D-06)"
  - "Convergence proven by import graph: check.js reaches src/tasks/pending.js without dragging prohibited deps (D-09/LOG-12)"
affects: []

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Two consumers (server.js /status + check.js) converge on ONE zero-import leaf without graph contamination"
    - "Additive freshness fields on an existing endpoint (pending_stale/pending_fetched_at) — no new routes"
    - "Positive import-graph assertion as convergence proof (complements the prohibition guards)"

key-files:
  created:
    - test/server/status-pending.test.js
  modified:
    - src/server.js
    - src/check.js
    - test/check.test.js
    - test/check-isolation.test.js

key-decisions:
  - "Generic stale warn ('serving last-known-good') in server.js — no payload, no err.message (T-76-01/PERSIST-04)"
  - "check.js consumes fetchFreshPending in RAW mode (not the resolver) so the throw propagates and the red line stays byte-identical (D-07)"
  - "Stale UI marker: dimmed .stat-val + red '?' stale-tag on «Candidatas» (Claude's Discretion, D-06) — TUI ink untouched (does not consume pending)"

patterns-established:
  - "Additive endpoint evolution: freshness discriminated as response fields, not signalled only by console.warn (ORCH-06)"

requirements-completed: [ORCH-05, ORCH-06]

# Metrics
duration: ~16min
completed: 2026-07-17
status: complete
---

# Phase 76 Plan 02: Convergencia del conteo pending — cableado de consumidores Summary

**`/status` (server.js) y `kodo check` (check.js) convergen en el módulo compartido `src/tasks/pending.js`: el carril de lectura inline defectuoso de `/status` desaparece, `pending_stale`/`pending_fetched_at` hacen la frescura observable (fallo etiquetado, nunca servido como fresco), y `check.js` conserva su output byte-idéntico — todo sin endpoints ni dependencias nuevas.**

## Performance

- **Duration:** ~16 min
- **Completed:** 2026-07-17
- **Tasks:** 2 (cada una TDD: RED + GREEN)
- **Files modified:** 5 (1 created, 4 modified)

## Accomplishments
- **ORCH-05 (convergencia de código):** `/status` sustituye su bloque inline (caché module-level `let pendingCache` + catch que devolvía el último dato sin comprobar TTL) por `createPendingResolver({...}).resolve()`; `check.js` rutea por `fetchFreshPending`. Ambos derivan `pending`/`pending_count` del mismo `src/tasks/pending.js`.
- **ORCH-06 (fallo etiquetado, no servido como fresco):** el payload de `/status` gana `pending_stale:boolean` y `pending_fetched_at:string|null`, SIEMPRE presentes en ambas ramas; con el provider caído tras expirar el TTL, `/status` marca `pending_stale:true` en lugar de presentar la caché como fresca. La rama de catch defectuosa desaparece.
- **D-07 (output byte-idéntico):** `check.js` consume el fetch CRUDO (`fetchFreshPending` propaga el throw), así el try/catch y la línea roja `Error checking tasks: <err.message>` quedan intactos; los Tests 1-5 siguen verdes.
- **D-06 (staleness visible):** `dashboardHtml` gana CSS `.stale`/`.stale-tag` y el JS cliente marca la stat «Candidatas» (atenuada + sufijo `?` rojo) cuando `data.pending_stale`.
- **D-09 (convergencia probada):** nueva aserción positiva en `check-isolation.test.js` — el grafo de `check.js` alcanza `src/tasks/pending.js`; las prohibiciones LOG-12 (no logger.js/github/polling) siguen verdes (pending.js es hoja de cero imports).

## Task Commits

Each task was committed atomically (TDD: RED test → GREEN impl):

1. **Task 1 RED** — `7ac035b` (test) — contrato /status + source-guard de convergencia; shaper verde, guards en rojo
2. **Task 1 GREEN** — `f3f9fbd` (feat) — /status cableado al resolver, campos aditivos, marcador HTML; 6/6 verde
3. **Task 2 RED** — `e407606` (test) — guard de convergencia de check.js + regresión red-line; guard en rojo
4. **Task 2 GREEN** — `57cc6b9` (feat) — check.js rutea por fetchFreshPending; 26/26 verde

## Files Created/Modified
- `test/server/status-pending.test.js` — **nuevo**: contrato del seam resolver→payload (ambas ramas, ambos campos presentes, `pending_count === pending.length`) + source-guard de convergencia (D-09).
- `src/server.js` — import del módulo compartido; eliminado `let pendingCache` module-level; `pendingResolver` instanciado en `startServer()` (reusa `PENDING_CACHE_TTL_MS`); handler `/status` cableado; payload expande `buildPendingStatusFields(...)`; CSS `.stale`/`.stale-tag` + marcador «Candidatas».
- `src/check.js` — import de `fetchFreshPending`; `checkPendingTasks` rutea por el fetch compartido en modo crudo.
- `test/check.test.js` — 2 casos añadidos: `/N pending/` byte-idéntico vía `fetchFreshPending` + `err.message` real en la línea roja (D-07).
- `test/check-isolation.test.js` — aserción positiva de convergencia: `walkImports(check.js)` incluye `src/tasks/pending.js`.

## Decisions Made
- **Warn genérico en el fallo de `/status`:** `console.warn('[kodo] listPendingTasks stale — serving last-known-good')` — sin payload del provider ni `err.message` (T-76-01/PERSIST-04). El resolver no expone el error; el caller solo inspecciona `stale`.
- **`check.js` consume el fetch crudo, no el resolver:** `fetchFreshPending` propaga el throw, así el try/catch existente y su línea roja quedan byte-idénticos (D-07/Pitfall 2). El resolver (never-throws) solo lo usa `/status`.
- **Marcador de staleness (D-06, Claude's Discretion):** `.stat-val.stale` atenuado (color gris + opacity) y `.stale-tag` (sufijo `?` rojo pequeño) en «Candidatas». Indicador mínimo; la TUI ink no se toca (no consume pending).

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered
None.

## User Setup Required
None — cero dependencias npm nuevas (verificado: `{commander, ink, picocolors, react}` sin cambios), cero endpoints nuevos (7 rutas `pathname ===` sin cambios).

## Verification
- `node --test test/server/status-pending.test.js test/check.test.js test/check-isolation.test.js` → 32/32 verde.
- `import('./src/server.js')` carga sin lanzar tras el refactor.
- **Gate de fase `npm test`:** 2271 pass, 0 fail, 1 skipped (pre-existente) — suite completa verde.
- Backstops: `package.json` dependencies sin cambios; rutas de server.js sin cambios (7 `pathname ===`).
- Threat model: severidad máxima = medium (T-76-02), mitigada por `pending_stale`/`pending_fetched_at` + contrato `status-pending.test.js` → sin bloqueo (security_block_on=high).

## Next Phase Readiness
- Phase 76 completa: ambos planes cerrados. ORCH-05 y ORCH-06 satisfechos y observables (convergencia probada por grafo, frescura discriminada en el payload).
- Sin blockers. Listo para `/gsd-verify-work`.

## Self-Check: PASSED
