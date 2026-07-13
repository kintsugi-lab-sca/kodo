---
phase: 72-higiene-dx-y-verdad-documental
plan: 05
subsystem: docs
tags: [readme, documentation, hyg-08, delta-pass]
requires:
  - 72-01 (HYG-01/HYG-04: gate KODO_ORCHESTRATOR + efectos de cierre movidos a SessionEnd)
  - 72-02 (HYG-02/HYG-03: borrado de `up --url` y `startHealthLoop`)
provides:
  - README.md con los claims de cierre reconciliados contra el estado POST-72
affects: []
tech-stack:
  added: []
  patterns: []
key-files:
  created: []
  modified:
    - README.md
decisions:
  - "Pasada DELTA (D-04): solo se tocaron los 4 claims falsos; el resto del README (auditado 2026-07-10, cb98a6d) quedó intacto — diff 8+/5−"
  - "`src/daemon/` y `src/triggers/` ya tenían filas propias en la tabla de arquitectura — no se añadió nada (no inventar)"
metrics:
  duration: ~10min
  completed: 2026-07-13
status: complete
---

# Phase 72 Plan 05: Pasada DELTA de verdad documental (HYG-08) Summary

**Pasada DELTA del README contra el estado POST-72: los claims de cierre ahora atribuyen «In Review» al backstop mecánico de `SessionEnd` y el auto-commit queda documentado como gated (`KODO_ORCHESTRATOR` + pathspec de la skill); solo cambiaron las líneas falsas.**

## Reconciliación claim por claim (HYG-08)

| Claim | Ubicación | Resultado | Detalle |
|-------|-----------|-----------|---------|
| Diagrama de flujo «stop hook → Plane → In Review» | ~:26-28 | **Corregido** | La caja pasa a `SessionEnd ←…` y `backstop → In Review` — el cierre real (`/exit`) dispara `SessionEnd`, que ejecuta el backstop mecánico (DELIV-04) y los efectos (color/notify/nudge, HYG-04) |
| «Al cerrar — el stop hook postea comentario y mueve a In Review» | ~:265 | **Corregido** | Ahora: al cierre real, el hook `SessionEnd` ejecuta el backstop — si la tarea sigue en curso la mueve a "In Review" y comenta «cierre automático»; no es efecto per-turn del stop hook |
| Tabla de arquitectura, fila `src/hooks/` | ~:279 | **Corregido** | Menciona `Stop` (estado ligero per-turn: idle + lock liberado) y `SessionEnd` (backstop "In Review" + cleanup terminal + color/notify/nudge al cierre real) |
| Auto-commit del orquestador «el stop hook auto-commitea los cambios» | ~:258 | **Corregido** | Aclara el gate `KODO_ORCHESTRATOR` (solo sesión orquestadora) y el pathspec `.claude/skills/kodo-orchestrate/` en add y commit (HYG-01) |
| Promesa de `kodo up --url` | — | **Ya verdadero (sin cambio)** | No aparece en el README — nada que quitar |
| Promesa de «health check cada 60s» / `startHealthLoop` | — | **Ya verdadero (sin cambio)** | No aparece en el README — nada que quitar |

**Filas `src/daemon/` / `src/triggers/`:** ya existían en la tabla de arquitectura (añadidas en la reescritura del 2026-07-10) — no se inventó nada nuevo.

## Verificación

- `node -e` de la Task 1 (sin `up --url` ni health-loop 60s): **exit 0** ✓
- Checkpoint humano Task 2: **approved** (orquestador en auto-mode, sanity-check del diff HEAD~1: delta puro 8+/5−) ✓
- Gate de cierre de fase `npm test`: **2018 tests, 2017 pass, 0 fail, 1 skip** ✓

## Deviations from Plan

None - plan executed exactly as written.

## Known Stubs

Ninguno — este plan solo toca documentación.

## Threat Flags

Ninguno — sin superficie de ejecución nueva (T-72-14 mitigado: el README ya no describe un comportamiento de cierre que no existe).

## Commits

| Task | Commit | Descripción |
|------|--------|-------------|
| 1 | `01588bd` | docs(72-05): reconciliar claims de cierre del README con el estado POST-72 |
| 2 | — | Checkpoint human-verify: approved (sin cambios de código) |

## Self-Check: PASSED

- README.md existe y contiene los deltas ✓
- Commit `01588bd` presente en HEAD ✓
- Verify automatizado exit 0 ✓
