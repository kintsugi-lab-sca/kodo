---
phase: 62-adopci-n-inteligente-desde-el-dashboard
plan: 03
subsystem: cli/dashboard
tags: [orch-02, derive-then-confirm, ink, deriving, fail-open, never-throws, wiring]

# Dependency graph
requires:
  - phase: 62-adopci-n-inteligente-desde-el-dashboard
    provides: "deriveAdoptionMeta (src/cli/dashboard/enrich.js) — derivador LLM one-shot never-throws (Plan 01)"
  - phase: 62-adopci-n-inteligente-desde-el-dashboard
    provides: "runAdopt con par --description literal (src/cli/dashboard/adopt.js) (Plan 02)"
  - phase: 56-adopcion-ad-hoc-desde-el-dashboard
    provides: "flujo adopt `a` (picker overlay + double-confirm armado por sessionId)"
provides:
  - "estado mode==='deriving' en App.js (spinner DERIVE_PROGRESS) entre el armado y el confirm"
  - "await onDerive con token de generación (overlayReqRef) + fusión {title,description} en armedSurface (fail-open)"
  - "confirm con propuesta derivada (título:/desc:) o degradado (ADOPT_DERIVED_CONFIRM_FALLBACK)"
  - "wiring index.js onDerive=deriveAdoptionMeta (execImpl spawnFn + fs DI) + onAdopt pasa description"
affects:
  - "ORCH-02 cerrado end-to-end: derive-then-confirm en vivo + carril shell kodo adopt --title --description"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "derive-then-confirm: armado → mode 'deriving' (spinner) → await onDerive → fusión → confirm"
    - "token de generación reusado (overlayReqRef): Esc en deriving invalida el resultado tardío (T5)"
    - "fail-open a {} en el await (try/catch defensa en profundidad sobre never-throws)"
    - "copy derivado por presencia de title: ADOPT_DERIVED_CONFIRM vs ADOPT_DERIVED_CONFIRM_FALLBACK"
    - "spawnFn DI = execImpl (execFile-shaped, claude por PATH, NO config.cmux.binary — Pitfall 3)"

key-files:
  created:
    - test/dashboard/app-derive.test.js
  modified:
    - src/cli/dashboard/App.js
    - src/cli/dashboard/SessionTable.js
    - src/cli/dashboard/index.js
    - test/dashboard/app-adopt.test.js

key-decisions:
  - "D-08: derive-then-confirm — el estado 'deriving' se interpone entre el armado (1ª `a` en picker) y el confirm; el spinner DERIVE_PROGRESS (dimColor) ocupa el slot de footer mientras onDerive corre."
  - "D-09: v1 no-editable — Esc en deriving cancela e invalida vía overlayReqRef (token de generación reusado, espejo del CR-01 de c/l); el resultado tardío se descarta tras el await sin reabrir el confirm."
  - "D-11: suelo 0-token intacto — el LLM vive SOLO en onDerive (deriveAdoptionMeta); adoptSession/createTask no cambian. El timeout ~25s vive dentro de spawnDerive (Plan 01), no en App.js ni en el wiring."
  - "El copy del confirm de adopt cambió de ADOPT_CONFIRM (Phase 56) a ADOPT_DERIVED_CONFIRM/_FALLBACK (Phase 62): incluso sin derivación, surface.title alimenta la propuesta como fallback (T4)."

patterns-established:
  - "El footer del confirm ahora es multi-línea (flexDirection column) cuando hay propuesta: `título: …` (bold) + `desc: …` (dimColor) + el prompt (cyan). truncateEllipsis (… un char) colapsa whitespace y cap el largo."

requirements-completed: [ORCH-02]

# Metrics
duration: ~10min
completed: 2026-06-25
---

# Phase 62 Plan 03: derive-then-confirm en el dashboard ink Summary

**El estado `mode==='deriving'` se interpone entre el armado de la tecla `a` y el confirm: arma la surface, espera `onDerive` (deriveAdoptionMeta, Plan 01) fail-open a `{}`, fusiona `{title, description}` en `armedSurface`, muestra la propuesta en el confirm (`título:/desc:` o degradado), y cablea `onDerive`/`onAdopt(description)` en index.js — cierra ORCH-02 end-to-end (UX derive-then-confirm + carril shell `kodo adopt --title --description`).**

## Performance

- **Duration:** ~10 min
- **Started:** 2026-06-25T09:18:25Z
- **Completed:** 2026-06-25T09:28:47Z
- **Tasks:** 3 (Task 1+2 TDD RED+GREEN, Task 3 wiring)
- **Files:** 1 creado + 4 modificados

## Accomplishments

- **App.js — estado `deriving`:** añadido `'deriving'` a la unión de `mode`; el handler del picker (overlay → `a`) ahora, tras resolver projectId OK, entra en `setMode('deriving')`, toma un `reqId = ++overlayReqRef.current`, hace `await onDerive?.({cwd,sessionId}) ?? {}` (try/catch fail-open a `{}`), descarta el resultado obsoleto (`if (overlayReqRef.current !== reqId) return`, T5), fusiona `{title: derived.title ?? surface.title, description: derived.description}` en `armedSurface`, y `setMode('confirm')`.
- **App.js — keybindings del sub-modo `deriving`:** `Esc` invalida la derivación en vuelo (`overlayReqRef.current++`) + limpia el armado + vuelve a list; cualquier otra tecla (incl. `a`) se traga (no encola un segundo onDerive).
- **App.js — constantes copy español:** `DERIVE_PROGRESS = 'derivando título…'`, `ADOPT_DERIVED_CONFIRM(ref)`, `ADOPT_DERIVED_CONFIRM_FALLBACK(ref)` (ellipsis `…` un char). Prop `onDerive` añadido + `armedSurfaceTitle`/`armedSurfaceDescription` pasados a SessionTable.
- **SessionTable.js — render:** `derivingLine` (spinner dimColor NEUTRAL, no cyan) precede toda la cadena de precedencia del footer (`derivingLine ?? confirmLine ?? errorLine ?? filterLine`, en las 3 ramas del return). El `confirmLine` de adopt ahora es multi-línea: con título derivado → `título: <trunc…>` (bold) + `desc: <trunc…>` (dimColor) + `ADOPT_DERIVED_CONFIRM(ref)` (cyan); sin título (fail-open T4) → solo `ADOPT_DERIVED_CONFIRM_FALLBACK(ref)`, sin líneas título:/desc:, NO rojo. Helper `truncateEllipsis` (… un char, colapsa whitespace).
- **index.js — wiring:** import `deriveAdoptionMeta` de `./enrich.js` + `readFileSync`/`existsSync` de `node:fs`; prop `onDerive` = `deriveAdoptionMeta({ spawnFn: execImpl, readFileFn: readFileSync, existsSyncFn: existsSync, cwd, sessionId })` (execImpl como spawnFn — execFile-shaped, `claude` por PATH, NO config.cmux.binary, Pitfall 3); `onAdopt` extendido para destructurar y pasar `description` a `runAdopt`.
- **Tests:** `test/dashboard/app-derive.test.js` nuevo (7 tests, los 8 comportamientos de VALIDATION.md App.js); suite global verde 1539 pass / 1 skip (pre-existente).

## How to Verify

```bash
node --test test/dashboard/app-derive.test.js   # 7/7 pass (deriving/propuesta, fail-open, fusión, Esc-T5, traga-a, never-throws, no-project)
node --test test/format-isolation.test.js       # 8/8 pass (color-isolation D-12 intacta)
npm test                                          # 1539 pass / 0 fail / 1 skip (pre-existente)
```

## TDD Gate Compliance

- **RED gate:** `test(62-03)` commit `93908ca` — app-derive.test.js falla por ausencia de `DERIVE_PROGRESS`/`ADOPT_DERIVED_CONFIRM`/`ADOPT_DERIVED_CONFIRM_FALLBACK` en App.js (import error).
- **GREEN gate:** `feat(62-03)` commit `30d521f` — estado deriving + constantes + render; los 7 tests verdes, suite global sin regresión.
- **Wiring (Task 3):** `feat(62-03)` commit `94984d7` — index.js cablea onDerive/onAdopt; suite global verde.
- REFACTOR: no necesario (código limpio sobre los moldes existentes de Phase 56/CR-01).

## Task Commits

1. **Task 1: app-derive.test.js (RED)** — `93908ca` (test)
2. **Task 2: App.js deriving + SessionTable render (GREEN)** — `30d521f` (feat)
3. **Task 3: index.js wiring** — `94984d7` (feat)

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 — Test update] Actualizado el copy del confirm en app-adopt.test.js (regresión esperada de la nueva UX)**
- **Found during:** Task 2 (GREEN) — `npm test` mostró 5 fallos en `test/dashboard/app-adopt.test.js`.
- **Issue:** Los tests de Phase 56 assertan `ADOPT_CONFIRM('ws-X')` (copy viejo `adopt ${ref}? press a again · Esc cancel`) inmediatamente tras armar. Esta plan CAMBIA deliberadamente el copy del confirm de adopt: tras armar, el flujo pasa por `deriving` y el confirm muestra la copy DERIVADA (`ADOPT_DERIVED_CONFIRM`/`ADOPT_DERIVED_CONFIRM_FALLBACK`). Los 5 fallos eran assertions encodando el comportamiento SUPERSEDIDO, no un bug.
- **Fix:** En `app-adopt.test.js` se aliasó `const ADOPT_CONFIRM = ADOPT_DERIVED_CONFIRM_FALLBACK` (los casos sin title caen al fallback) + se importó `ADOPT_DERIVED_CONFIRM` y se actualizó el caso `(d3)` (surface CON title `KODO DEV` → confirm con `título: KODO DEV` + `ADOPT_DERIVED_CONFIRM`, no el fallback). El comportamiento del double-confirm (2ª `a` shellea una vez; otra tecla cancela) es IDÉNTICO — solo cambió el texto.
- **Files modified:** `test/dashboard/app-adopt.test.js`
- **Commit:** `30d521f`

**2. [Rule 1 — Test timing] Controlled onDerive en el test (1) del flujo deriving**
- **Found during:** Task 2 (GREEN).
- **Issue:** El test (1) original capturaba el frame transitorio `deriving` con `setImmediate` y un onDerive que resolvía en un microtask — el frame ya estaba en `confirm` cuando se assertaba, así que el spinner DERIVE_PROGRESS nunca era visible.
- **Fix:** Se hizo `onDerive` CONTROLADO (resuelve sólo al llamar `releaseDerive()`), patrón idéntico al test T5 — el frame `deriving` queda observable antes de liberar la derivación. Cero cambio en el código de producción.
- **Files modified:** `test/dashboard/app-derive.test.js`
- **Commit:** `30d521f`

### Nota sobre el acceptance grep `grep -cF '...'` (no es desviación)

El criterio `grep -cF '...' src/cli/dashboard/App.js` retorna 10, NO 0 — pero esos 10 son spread operators preexistentes (`...(anyGsd ? [...]`) y JSDoc, NO mis constantes nuevas. El intent del criterio (que las constantes copy nuevas usen `…` de un char, no `...`) se cumple: `DERIVE_PROGRESS`/`ADOPT_DERIVED_CONFIRM`/`_FALLBACK` usan el carácter `…`. Verificado con `grep -nF "..." ... | grep -i "derivando\|adoptar"` → NONE.

## Threat Surface Scan

Sin superficie de seguridad nueva fuera del `<threat_model>` del plan:
- **T-62-09 (DoS):** mitigado — onDerive never-throws (try/catch fail-open a `{}`), timeout ~25s en spawnDerive (Plan 01), el spinner ocupa solo el slot de footer (no overlay bloqueante), el poll de /status sigue corriendo bajo `deriving`, Esc cancela (T5).
- **T-62-10 (Tampering — derivación obsoleta):** mitigado — token de generación `overlayReqRef` reusado; `if (overlayReqRef.current !== reqId) return` tras el await descarta el resultado tardío. Cubierto por el test T5.
- **T-62-11 (Info Disclosure):** el `{title, description}` viaja vía onAdopt→runAdopt→`kodo adopt --title/--description`→adoptSession, donde `sanitizeAdoptionData` (BIDIR-08) redacta home/rutas downstream. El dashboard no re-sanea (backstop estructural).
- **T-62-12 (Tampering — shell injection):** onAdopt/onDerive usan `execImpl` (execFile) con argv literal sin shell; metacaracteres inertes (D-13). cwd/sessionId viajan como datos a deriveAdoptionMeta.
- **T-62-SC (npm installs):** N/A — cero dependencias npm nuevas (solo `node:fs` builtin + imports internos + el CLI `claude` preexistente).

## Known Stubs

None. El flujo derive-then-confirm queda funcional end-to-end: `onDerive` cableado a `deriveAdoptionMeta` (Plan 01) con execFile + fs DI, `onAdopt` pasa `description` (derivada) a `runAdopt` → `kodo adopt --description` (Plan 02, ya enhebrado a `createTask`). La calidad del título/descripción derivados por Haiku y la UX en vivo son no-deterministas → requieren HUMAN-UAT (ver `<verification>` del plan: VALIDATION.md §Manual-Only), pero eso es validación, no un stub colgante.

## Next Phase Readiness

- ORCH-02 SC#1 (derive-then-confirm) y SC#4 (carril shell `kodo adopt --title --description`) cerrados end-to-end.
- Pendiente: HUMAN-UAT contra una sesión ad-hoc real (reproducir ROMAN-194 / scp-cmri: el título DEBE reflejar el proyecto, NO `basename(cwd)`; confirmar que el timeout ~25s no dispara fallback en derivaciones normales).

## Self-Check: PASSED

- FOUND: test/dashboard/app-derive.test.js
- FOUND: src/cli/dashboard/App.js
- FOUND: src/cli/dashboard/SessionTable.js
- FOUND: src/cli/dashboard/index.js
- FOUND: 62-03-SUMMARY.md
- FOUND commit: 93908ca (RED test)
- FOUND commit: 30d521f (GREEN feat)
- FOUND commit: 94984d7 (wiring feat)

---
*Phase: 62-adopci-n-inteligente-desde-el-dashboard*
*Completed: 2026-06-25*
