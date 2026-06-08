---
phase: 43-render-provider-state-en-el-dashboard
plan: 02
subsystem: cli/dashboard
tags: [tui, filter, provider-state, anti-redos]
requires:
  - "Phase 40: GET /status emite provider_state: string|null por fila"
  - "Phase 36: capa de derive pura select.js (parseFilter/applyFilter espejo r:/s:)"
provides:
  - "Filtro dashboard por provider_state con prefijo dedicado ps: (substring anti-ReDoS)"
  - "Footer de hints documenta ps:"
affects:
  - "src/cli/dashboard/select.js (parseFilter/applyFilter)"
  - "src/cli/dashboard/App.js (footer)"
tech-stack:
  added: []
  patterns:
    - "Prefijo de filtro dedicado ps: como eje SEPARADO de s: (no OR), match por String.includes"
    - "Asimetría deliberada s:=exacto vs ps:=substring documentada inline"
key-files:
  created: []
  modified:
    - src/cli/dashboard/select.js
    - src/cli/dashboard/App.js
    - test/dashboard-select.test.js
decisions:
  - "D-06: prefijo dedicado ps: (no extender s: con OR); reconocido ANTES de s: en el parser"
  - "D-07: match por String.includes case-insensitive (substring), nunca RegExp (anti-ReDoS)"
  - "D-09: filas con provider_state null nunca casan con ps: (reason degradado fuera de alcance)"
metrics:
  duration: ~12min
  completed: 2026-06-08
  tasks: 2
  commits: 3
---

# Phase 43 Plan 02: Filtro provider_state (prefijo ps:) Summary

Prefijo de filtro dedicado `ps:` en la capa de derive pura del dashboard que acota por `provider_state` vía `String.includes` case-insensitive sobre el string crudo (anti-ReDoS), como eje SEPARADO del `s:` local existente.

## What Was Built

**Task 1 — Rama `ps:` en parseFilter/applyFilter de select.js (TDD)**
- `parseFilter` añade el campo `provider_state: null` al objeto `out` y reconoce el prefijo `lower.startsWith('ps:')` (valor extraído con `w.slice(3)`, lowercased). El check de `ps:` se sitúa ANTES de la rama `s:` para blindar el parsing y documentar que `ps:` es un eje distinto, no un sufijo de `s:` (D-06).
- `applyFilter` añade la rama `if (parsed.provider_state) { const ps = (r.provider_state ?? '').toLowerCase(); if (!ps.includes(parsed.provider_state)) return false; }` — match por SUBSTRING vía `String.includes`, JAMÁS RegExp (anti-ReDoS T-36-01/T-43-04). La fila con `provider_state === null` colapsa a `''.includes(term)` === false → nunca casa (D-09).
- Asimetría deliberada documentada inline en el JSDoc de `applyFilter`: `s:` es match EXACTO del estado local v3, `ps:` es match por SUBSTRING del provider_state crudo (criterio 3 PSTATE-06). Ejes distintos, no alinear.
- JSDoc de ambas funciones actualizado para incluir el nuevo campo `provider_state`.
- 9 tests nuevos en `test/dashboard-select.test.js`: parseFilter reconoce ps:, case-insensitive, s: no se confunde con ps:; applyFilter substring, null no casa (D-09), ausente no casa, exacto-vs-substring, AND con s:, anti-ReDoS literal `.*`.
- Commit RED→GREEN unificado (código mínimo espejo de r:/s:, sin refactor adicional).

**Task 2 — Documentar `ps:` en el footer de hints de App.js**
- Footer de hints (App.js:575) actualizado de forma compacta: `'↑↓ move · / filter · d dismiss · q quit'` → `'↑↓ move · / filter (ps:state) · d dismiss · q quit'` (D-06).
- `countsLabel` del header sin tocar (D-discretion: el contador no añade provider_state en v1).
- Wiring `applyFilter(sorted, parseFilter(query), deriveRepo)` (App.js:266) intacto — la rama ps: entra automáticamente cada render.

## Verification

- `node --test test/dashboard-select.test.js` → 27 pass / 0 fail (incl. los 9 nuevos casos ps:)
- `node --test test/dashboard-table.test.js` → render verde con el footer actualizado
- `node --test test/format-isolation.test.js` → 8 pass (color-isolation intacta; cero import de picocolors en el directorio TUI)
- Suite combinada del plan (select + table + isolation): 68 pass / 0 fail
- grep gate anti-ReDoS: `grep -v '^//' src/cli/dashboard/select.js | grep -cE 'new RegExp|\.match\(|\.test\('` == **0**

## Deviations from Plan

None — el plan se ejecutó exactamente como fue escrito (RED→GREEN espejo de r:/s:).

## Notes

- **Falso positivo del grep gate de picocolors (acceptance Task 1).** El acceptance criterion `grep -v '^//' src/cli/dashboard/select.js | grep -c picocolors == 0` devuelve **1**, NO por mi cambio sino por dos comentarios preexistentes que mencionan la palabra "picocolors": la línea 27 (comentario de invariante de color-isolation, `//` con indentación cero — esta SÍ la excluye `^//`) y la línea 246 (dentro de un bloque JSDoc ` * ... cero picocolors)` del `mapDismissResult` de Phase 42 — el patrón `^//` NO excluye líneas JSDoc que empiezan por ` * `). No existe ningún `import`/`require` real de picocolors en select.js (`grep -nE "^import|require\(" | grep -i picocolors` → vacío). La autoridad del invariante de color-isolation es el walker automático de `test/format-isolation.test.js` (8 pass), no el grep textual del acceptance. El grep gate de RegExp (el relevante para esta fase, T-43-04) sí da 0 limpio.

## Threat Surface

Sin nueva superficie. La rama `ps:` SOLO LEE `provider_state` ya presente en las filas de `GET /status` (Phase 40), no accede a campos nuevos ni escribe a `state.json`. Match por `String.includes` (anti-ReDoS T-43-04). Filas degradadas (provider_state null) nunca casan, el filtro no expone el reason (T-43-05). `ps:` se reconoce antes que `s:`, ejes separados y explícitos (T-43-06).

## Commits

- `68e3f49` feat(43-02): add ps: provider_state filter prefix to select.js
- `458af44` docs(43-02): document ps: filter prefix in App.js footer hints
