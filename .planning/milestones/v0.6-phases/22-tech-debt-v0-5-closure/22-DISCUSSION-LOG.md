# Phase 22: Tech Debt v0.5 Closure - Discussion Log

> **Audit trail only.** Auto-mode single-pass — all decisions auto-selected with recommended option.

**Date:** 2026-05-13
**Phase:** 22-tech-debt-v0-5-closure
**Mode:** --auto (single pass, no AskUserQuestion prompts)
**Areas discussed:** Granularidad de plans, Estrategia de tests, SECURITY.md, Orden de fixes, ANSI removal

---

## Granularidad de plans

| Option | Description | Selected |
|--------|-------------|----------|
| 3 plans por surface (Phase 14/15/16) | Atomic por origen, parallel-safe en worktrees, scope ~5 tasks each. | ✓ |
| 1 plan monolítico (13+ tasks) | Rompe budget de scope (Phase precedent 2-5 tasks). | |
| 6 plans, uno por DEBT-XX | Demasiado granular; overhead de scaffolding. | |

**Auto-selected:** 3 plans agrupados.

---

## Estrategia de tests

| Option | Description | Selected |
|--------|-------------|----------|
| Tests defensivos donde aplique | WR-01 timeout, IN-02 FORCE_COLOR='', IN-01 regex, WR-04 from, WR-05 order, IN-02 payload. Refactors puros sin test nuevo. | ✓ |
| Solo grep cross-repo (no tests) | Insuficiente para regresión behavior change. | |
| Tests para TODOS los fixes | Overhead innecesario para refactors puros (WR-01 stop.js doble logger). | |

**Auto-selected:** Tests defensivos donde aplique.

---

## SECURITY.md DEBT-01

| Option | Description | Selected |
|--------|-------------|----------|
| Reutilizar plantilla Phase 19 + threats_open: 0 | Consistencia con precedent, threat surface ya cero (CLI output only). | ✓ |
| Crear plantilla nueva specific to Phase 14 | Sobre-diseño; Phase 19 ya estableció el patrón. | |
| Defer a v0.7+ | DEBT-01 explícito en REQUIREMENTS.md; no diferible. | |

**Auto-selected:** Reutilizar Phase 19 plantilla.

---

## Orden de fixes dentro de waves

| Option | Description | Selected |
|--------|-------------|----------|
| Fixes paralelos (sin dependencias cruzadas) | Cada plan agrupa fixes que comparten surface; worktree isolation maneja el resto. | ✓ |
| Orden estricto por severity | Innecesario; los fixes son independientes. | |
| Single-threaded sequential | Pierde paralelismo de worktree isolation. | |

**Auto-selected:** Fixes paralelos.

---

## DEBT-04 ANSI removal

| Option | Description | Selected |
|--------|-------------|----------|
| Grep + delete + test guard | 0 consumers en src/ (verificado); test/logger-exports.test.js se ajusta o elimina. | ✓ |
| Deprecation warn + delete en v0.7 | Sobre-diseño para repo sin usuarios externos. | |
| Mantener exports y solo añadir guard | No cierra DEBT-04 (REQUIREMENTS exige retirarlos). | |

**Auto-selected:** Grep + delete + test guard.

---

## Claude's Discretion

- Bytes exactos del SECURITY.md prosa (plantilla Phase 19).
- Reordering de tasks dentro de cada plan.
- Mover ANSI_GRAY/CYAN/YELLOW/RED a scope local si solo COLOR_BY_LEVEL los consume.
- Borrar o ajustar test/logger-exports.test.js.
- Refactor inline vs comentario para IN-01 Phase 16.
- Comentario exacto en src/cli/format.js:101 post-DEBT-04.

## Deferred Ideas

- 5 IN restantes Phase 15 (no en scope DEBT-04).
- Refactor mayor `runStopHook` (riesgo breaking changes).
- WR-04/05/06 follow-up Phase 21 (advisory).
- Migración symlink con `kodo doctor` (resuelto en Phase 21 inline).
- Tests E2E reales contra Plane (sintéticos suficientes).
- Audit retrospectivo SECURITY Phase 15-21.
