---
phase: 38
plan: 38-02
title: Estados idle/needs-input/dead/closed + migración v2→v3 + caller migration
status: complete
wave: 2
tags: [lifecycle, state-migration, schema-v3, compat-shim, tdd]
commits: 4
key_files:
  created:
    - test/state/migration.test.js
    - test/state/migration-backup.test.js
  modified:
    - src/session/manager.js
    - src/session/state.js
    - src/hooks/stop.js
    - src/logger-events.js
    - test/session/mark-status.test.js
    - test/stop.test.js
    - test/stop-state-transition.test.js
    - test/hooks/stop-idempotency.test.js
    - test/logger-events.test.js
requirements: [TUI-18, "SC#2"]
---

## Objective

Introducir los 4 estados nuevos del ciclo de vida (`idle`, `needs-input`,
`dead`, `closed`) en `markSessionStatus` con compat shim `'done' → 'idle'`,
migrar el schema v2→v3 idempotente con backup timestamped, y rewire del caller
real `stop.js:202` para que emita `'idle'`. Cierra TUI-18 / SC#2.

## What shipped

- **`markSessionStatus` compat shim (D-12)** — el input DEPRECATED `'done'` se
  mapea a `'idle'` ANTES del falsy-guard, emitiendo un warn
  `markSessionStatus.deprecated` `{input_status, mapped_to, task_id, session_id,
  reason}`. JSDoc ampliado con los 4 estados nuevos. Contract non-throwing y
  discriminated union `{ok, from, to}` intactos; `to` ahora puede ser `'idle'`
  post-shim.

- **Migración schema v2→v3 (`migrateStateV2toV3`, D-04/D-05/D-11)** — función
  PURA e idempotente que PRESERVA sessions + history (NO el destructive clear de
  v1→v2) y deriva 5 campos aditivos: `state` (vía `statusToStateV3`:
  `done→idle`, `error`/`interrupted`→`dead`, `review`/`running` preservados),
  `process_alive`, `tab_alive` (false default), `needs_input` (false),
  `last_seen_alive` (null), más el booleano agregado `alive`. `@typedef Session`
  ampliado con los campos opcionales.

- **`migrateStateIfNeeded` con backup timestamped (D-05)** — encadena v1→v2→v3,
  escribe `state.json.bak.YYYYMMDDTHHMMSS` ANTES de migrar, idempotente (v3 → no
  backup). Emite `state.migration.v2_to_v3` vía import dinámico (LOG-12: state.js
  NO importa logger.js estáticamente).

- **Caller migration `stop.js:202` (D-12)** — `'done'/'session-stop'` →
  `'idle'/'session-stop:lock-released'`. **Este es el fix raíz del bug que
  originó Phase 38**: ROMAN-151/152 quedaban archivadas como `done` (invisibles
  en el dashboard); ahora quedan `idle` (lock liberado, esperando humano).

- **Logger event `state.migration.v2_to_v3` (D-13)** — helper `stateMigrationV3`
  con whitelist `{from_count, to_sessions, to_history, rescued, sealed}`.
  `rescued`/`sealed` son 0 hasta Plan 04 (rescate cross-host). Taxonomía 19→20.

## TDD Cycle

- **RED** (`4f17079`): migration.test.js (6 fixtures) + mark-status shim tests
  fallan limpio (`migrateStateV2toV3` ausente; shim no existe).
- **GREEN shim** (`c87a64a`): `markSessionStatus` shim + JSDoc.
- **GREEN migration** (`56071d7`): `migrateStateV2toV3` + backup + logger event.
- **GREEN caller** (`ff39864`): stop.js migrado + tests Fase 19 actualizados.

## Verification

| Check | Comando | Resultado |
|---|---|---|
| SC#2 migration | `node --test test/state/migration.test.js` | 6/6 verde |
| Backup I/O | `node --test test/state/migration-backup.test.js` | 2/2 verde |
| markSessionStatus shim | `node --test test/session/mark-status.test.js` | 6/6 verde |
| stop.js caller | `node --test test/stop.test.js` | 22/22 verde (idle) |
| Legacy v1→v2 intacto | `node --test test/migration.test.js` | 16/16 sin regresión |
| Sin `'done'` callers reales | `grep -rnE "markSessionStatus\(.*'done'" src/` | 0 matches |
| Logger event nuevo | `grep STATE_MIGRATION_V3 src/logger-events.js` | match |
| LOG-12 walker | `node --test test/check-isolation.test.js` | 7/7 verde |
| Suite global | `node --test $(find test -name '*.test.js')` | 1000 tests · 999 pass · 0 fail · 1 skip · rc=0 |

## Deviations & decisions

- **Allowlist NO añadida (Regla 2 — simplicidad):** el plan pedía "ampliar
  allowlist de estados con rechazo". `markSessionStatus` nunca tuvo validación
  runtime (acepta cualquier string y delega a `updateSession`); añadir rechazo
  habría sido nueva superficie de fallo no cubierta por tests y habría cambiado
  el contrato non-throwing. El JSDoc documenta los estados válidos; el shim
  `done→idle` es el único cambio de comportamiento necesario.

- **Conflicto Fase 19 CR-02 ↔ Fase 38 D-12 (Tier 3, aprobado por el usuario):**
  el plan revierte una decisión deliberada de Fase 19 (marcar `'done'`/
  `'session-stop'`). Se actualizaron ~7 asserts en 4 archivos de test
  (`stop.test`, `stop-state-transition` ×4, `stop-idempotency`, `mark-status`)
  documentando inline que Fase 38 supera CR-02. El invariante de UBICACIÓN del
  mark (fuera del bloque `if (session.gsd)`) se preserva.

- **2 tests del falsy-guard ajustados:** los escenarios null/undefined de
  `mark-status.test.js` usaban `'done'` como status-cualquiera; cambiados a
  `'idle'` para no disparar el shim warn (su intención es el guard, no el shim).

- **Backup test en archivo separado:** `migration-backup.test.js` requiere
  HOME-isolation con import dinámico POST-HOME; no puede coexistir con el import
  estático de `migrateStateV2toV3` (cachearía KODO_DIR con el HOME real).

## Known minor (documented, not fixed)

- **R-8:** sin flock en la migración (punt al backlog per plan). La idempotencia
  previene corrupción; el backup redundante en arranques paralelos es ruido
  cosmético.
- **Fixtures legacy con `'done'`:** el shim las acepta (observation-only). Se
  eliminarán en v0.10 junto con el shim.

## NOT done (out of scope, deferred)

- Dashboard render multi-estado (badges idle/needs-input) → Plan 03.
- Reconciliación host↔state + rescate desde history → Plan 04 (por eso
  `rescued`/`sealed` = 0 y `tab_alive` = false en la migración pura).

## Self-Check: PASSED

- `src/session/state.js` migrateStateV2toV3 — FOUND
- `src/session/manager.js` shim 'done'→'idle' — FOUND
- `src/hooks/stop.js` 'idle'/'session-stop:lock-released' — FOUND
- `src/logger-events.js` STATE_MIGRATION_V3 — FOUND
- `test/state/migration.test.js` + `migration-backup.test.js` — FOUND
- commit `4f17079` (RED) — FOUND
- commit `c87a64a` (shim) — FOUND
- commit `56071d7` (migration) — FOUND
- commit `ff39864` (caller + tests) — FOUND
- Suite global 1000/999 pass/0 fail/1 skip — VERIFIED
