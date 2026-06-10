---
phase: 39
slug: paneles-auxiliares-comentarios-logs
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-10
---

# Phase 39 — Validation Strategy

> Per-phase validation contract reconstruido retroactivamente (backfill Nyquist Phase 47, NYQ-02).
> Cobertura **citada** de `39-VERIFICATION.md` (passed 4/4 must-haves, 2026-06-02).
> **Sin re-ejecutar la suite** — cada dimensión referencia el resultado empírico ya registrado (D-03).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` + `node:assert/strict` · `ink-testing-library` para los overlays |
| **Config file** | none — runner nativo, sin config externa |
| **Quick run command** | `node --test test/dashboard-overlay.test.js test/dashboard-client.test.js test/dashboard-select.test.js` |
| **Full suite command** | `npm test` (`node --test $(find test -name '*.test.js' -type f)`) |
| **Evidencia citada** | `39-VERIFICATION.md` (2026-06-02, status passed, score 4/4) |

---

## Sampling Rate

- **Evidencia primaria:** `39-VERIFICATION.md` — 4/4 observable truths + 7/7 artifacts + 5/5 key-links verificados.
- **Política Nyquist (backfill):** la cobertura ES la cita a la evidencia preexistente; no se re-corre la suite (D-03 / D-05).

---

## Per-Task Verification Map (dimensión → cobertura citada)

| Requirement | Plan | Dimensión / Behavior | Test Type | Automated Command | Evidencia citada (`39-VERIFICATION.md`) | Status |
|-------------|------|----------------------|-----------|-------------------|------------------------------------------|--------|
| TUI-15 | 39-01/02 | `c` abre overlay de comentarios (`GET /comments/<task_id>`, mapping `task_ref`→`task_id`); discrimina 404/vacío/error; `Esc` restaura cursor | unit (client + ink) | `node --test test/dashboard-client.test.js test/dashboard-overlay.test.js` | Truth #1 ✓ VERIFIED (App.js handler `c` 329-364, `fetchComments` discriminante `code`); overlay 12/12 + client 17/17 verde; Esc sin tocar `selectedTaskId` | ✅ green |
| TUI-16 | 39-01/02 | `l` abre overlay de logs por grep substring (`task_ref`/`workspace_ref`) sobre buffer compartido `GET /logs`; etiqueta honesta; `Esc` restaura cursor | unit (select + ink) | `node --test test/dashboard-select.test.js test/dashboard-overlay.test.js` | Truths #2/#3 ✓ VERIFIED (`grepLogs` select.js:202-211 `String.includes` never RegExp; `OVERLAY_LOGS_LABEL` 'grep of shared buffer — may include other sessions' en yellow); grepLogs 8/8 verde | ✅ green |
| SC#3 (etiqueta honesta) | 39-01 | Overlay de logs etiquetado como grep de buffer compartido, no tail per-session | unit (frame) | `node --test test/dashboard-overlay.test.js` | Truth #3 ✓ VERIFIED (test verifica `OVERLAY_LOGS_LABEL.slice(0,20)` en `lastFrame()`) | ✅ green |
| SC#4 (wording PROJECT.md) | 39-01 | PROJECT.md ~línea 32 corregido a "best-effort substring grep" (sin `session_id` real) | doc/grep | `grep -n "filtrado por session_id" .planning/PROJECT.md` (vacío) | Truth #4 ✓ VERIFIED (PROJECT.md:32 corregido; grep retorna vacío) | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky / manual-only*

---

## Wave 0 Requirements

Infraestructura existente cubre todos los requirements. `node:test` + `ink-testing-library` ya presentes. Sin Wave 0 — tests TDD-first dentro de cada plan. El blocker CR-01 (race Esc-antes-de-fetch) y los warnings WR-01/WR-02 del REVIEW fueron resueltos en commit `f48b9dd` (ver `39-VERIFICATION.md` §Resolución de hallazgos).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Evidencia |
|----------|-------------|------------|-----------|
| _Ninguno._ | — | — | `39-VERIFICATION.md` §Human Verification Required: "No hay ítems que requieran verificación humana. Todos los comportamientos observables del goal — apertura de overlays, copy por caso, etiqueta honesta, scroll, Esc-restore-cursor, snapshot congelado — están cubiertos por los tests automatizados con `ink-testing-library`." |

---

## Validation Sign-Off

- [x] Cada requirement (TUI-15, TUI-16) + SC#3/SC#4 mapeado a ≥1 cita de evidencia real en `39-VERIFICATION.md`
- [x] Sampling continuity: cobertura automatizada verde (overlay 12/12, client 17/17, grepLogs 8/8)
- [x] Wave 0 covers all MISSING references (ninguna — infra existente cubre todo)
- [x] No watch-mode flags
- [x] Ninguna fase declarada N/A — evidencia empírica real citada
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-10 (backfill Phase 47, NYQ-02)

---

## Reconstruction Audit 2026-06-10 (Phase 47 NYQ-02)

| Metric | Count |
|--------|-------|
| Requirements audited | 2 (TUI-15, TUI-16) + 2 SC (etiqueta honesta, wording PROJECT.md) |
| COVERED (automated unit/ink) | 4 |
| PARTIAL | 0 |
| MISSING | 0 |
| Manual-only | 0 (todo verificable programáticamente per `39-VERIFICATION.md`) |
| Tests citados (no re-corridos) | overlay 12 + client 17 + select/grepLogs 8 + table 32 + format-isolation 8, todos pass |

**Nota Nyquist:** La lógica de la fase (overlays `c`/`l` never-throws con discriminante de status, `grepLogs` substring anti-ReDoS, etiqueta honesta del buffer compartido, snapshot congelado D-05, race-guard CR-01) está cubierta por tests deterministas, ya verde y verificada en `39-VERIFICATION.md` (passed 4/4). **Sin re-ejecutar la suite** — cobertura citada de `39-VERIFICATION.md`. Fase declarada **nyquist-compliant**.
