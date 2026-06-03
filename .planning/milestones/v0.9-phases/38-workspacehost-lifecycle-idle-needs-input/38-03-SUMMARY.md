---
phase: 38
plan: 38-03
title: Dashboard render multi-estado — badges + filtros s:<state> + footer-error host
status: complete
wave: 3
tags: [dashboard, ink, badges, filters, host-error, phase-37-parity, tdd]
commits: 2
key_files:
  modified:
    - src/cli/dashboard/format.js
    - src/cli/dashboard/SessionTable.js
    - src/cli/dashboard/select.js
    - src/cli/dashboard/App.js
    - test/dashboard-table.test.js
    - test/dashboard-select.test.js
    - test/dashboard/app-focus.test.js
requirements: [TUI-19, "SC#3", "SC#6 (parcial)"]
---

## Objective

Render multi-estado del dashboard: badges literal-estables, filtros `s:<state>`
con alias `s:active`, constantes de error del host absorbidas por el footer
Phase 36/37, y re-validación programática Phase 37 parity sobre
`CmuxHost.selectWorkspace`. Cierra TUI-19 / SC#3 + SC#6 parcial. Sin
reconciliación host↔state (Plan 04).

## What shipped

- **Badges literal-stable (`STATE_BADGES` + `stateBadge`, D-06)** en `format.js`:
  `▶ running` (green) / `⏸ idle` (yellow) / `🔔 needs-input` (cyan) / `✗ dead`
  (red). `closed`/`review`/legacy/vacío → `{}` (celda vacía, no rompe render).
  Color SOLO string-name ink (cero picocolors — D-12 preservado).

- **Columna `state` (width 14)** en `SessionTable.js` entre gutter y task_ref;
  fallback a `session.status` para sesiones legacy v2 sin migrar.

- **Filtros multi-estado** en `select.js`: `s:idle`/`s:needs-input`/`s:dead` +
  `s:active` (alias OR → `['running','idle','needs-input']`, excluye dead/closed)
  + `s:running` retrocompat. `applyFilter` matchea contra `r.state` (v3) con
  fallback `r.status` (legacy). Anti-ReDoS `String.includes` preservado.

- **`countByStatus` + `countsLabel` extendidos** con idle/needs-input/dead
  (orden: legacy primero, nuevos al final — no altera el orden pre-existente).

- **Footer-error del host** (`HOST_ERR_UNAVAILABLE` / `HOST_ERR_TIMEOUT`,
  literal-stable) en `App.js`: estado `hostError` + limpieza vía el mismo
  `clear-on-any-input` Phase 37 D-04. `SessionTable` lo renderiza con
  `footerError = focusError ?? hostError` (focusError tiene precedencia).

- **Phase 37 parity programático (SC#6 parcial)** en `app-focus.test.js`: 2
  tests que ejercitan `CmuxHost.selectWorkspace` enchufado como `onFocus` —
  focus ok ({ok:true}, exec con args verbatim Phase 37) + zombie reject (guard
  cortocircuita, exec NO invocado, clear-on-any-input preservado).

## Decisions (deviations)

- **Opción A del parser (plan Task 3):** `parseFilter` retorna `status` como
  `string | string[] | null` — array solo para `s:active`. `applyFilter` acepta
  ambas formas. Elegida sobre la Opción B (preprocesar en App.js) por **menor
  diff y retro-compatibilidad**: los filtros legacy escalares (`s:running`) no
  cambian de shape; solo el alias produce array.

- **`countsLabel` movido a `format.js`** (estaba inline en SessionTable.js): es
  presentación pura, testeable sin ink. SessionTable lo re-importa. Coherente con
  `stateBadge`/`statusLabel` que ya viven en format.js.

- **`countByStatus` extendido** aunque el plan no lo listaba explícitamente en
  Task 3: sin esto el header no contaría los nuevos estados y `countsLabel` no
  tendría datos que mostrar. Match por `state` v3 con fallback `status`.

- **Regex de gutter en tests Phase 36** (`/›\s+KL-N/` → `/›.*KL-N/`): la nueva
  columna `state` se interpone entre el gutter `› ` y `task_ref`. El render es
  correcto; solo el patrón posicional del assert necesitaba reflejar el layout.
  `.*` (sin flag `s`) no cruza líneas → `doesNotMatch` sigue siendo fiable.

## Verification

| Check | Comando | Resultado |
|---|---|---|
| SC#3 badges + filtros + counts | `node --test test/dashboard-table.test.js` | 32/32 verde |
| countByStatus extendido | `node --test test/dashboard-select.test.js` | 10/10 verde |
| SC#6 parity programática | `node --test test/dashboard/app-focus.test.js` | 5/5 verde (3 P37 + 2 host) |
| color-isolation D-12 | `node --test test/format-isolation.test.js` | 8/8 sin regresión |
| Phase 37 literals byte-identical | `grep FOCUS_ERR_ src/cli/dashboard/App.js` | 3 matches intactos |
| HOST_ERR_* literal-stable | `grep HOST_ERR_ src/cli/dashboard/App.js` | 2 matches |
| Alt-screen intacto | `grep 1049h/1049l src/cli/dashboard/index.js` | matches preservados |
| Suite global | `node --test $(find test -name '*.test.js')` | 1019 tests · 1018 pass · 0 fail · 1 skip · rc=0 · 21.8s |

## NOT done (out of scope, deferred to Plan 04)

- **Wire de `setHostError`**: Plan 03 declara la constante + state + limpieza; el
  callback de reconciliación que invoca `setHostError` cuando el host falla vive
  en Plan 04 (comentario inline marca el punto).
- **Reconciliación host↔state + rescate desde history** → Plan 04.
- **UAT humano** (4 escenarios reales: 2 retest Phase 37 + 2 nuevos idle/
  needs-input) → Plan 04 (`38-HUMAN-UAT.md`). Plan 03 cubre solo la verificación
  programática que garantiza que el wiring del host no rompió Phase 37.

## Self-Check: PASSED

- `src/cli/dashboard/format.js` STATE_BADGES + stateBadge + countsLabel — FOUND
- `src/cli/dashboard/SessionTable.js` COLS.state + badge cell + hostError — FOUND
- `src/cli/dashboard/select.js` s:active OR + state match — FOUND
- `src/cli/dashboard/App.js` HOST_ERR_* + hostError state — FOUND
- commit `5ebf1ec` (RED) — FOUND
- commit `beca31c` (GREEN tasks 2-4) — FOUND
- Suite global 1019/1018 pass/0 fail/1 skip — VERIFIED
