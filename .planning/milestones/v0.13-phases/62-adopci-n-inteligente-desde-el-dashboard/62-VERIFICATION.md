---
phase: 62-adopci-n-inteligente-desde-el-dashboard
verified: 2026-06-25T11:50:00Z
status: passed
score: 5/5 must-haves verified
overrides_applied: 0
human_uat_resolved: 2026-06-25 — validado en vivo (62-HUMAN-UAT.md passed 4/4). Dos fixes post-verificación: 9a7bea0 (título a nivel tarea, no alcance de proyecto — corrige la expectativa del ítem 2 de abajo) + b236cb9 (cierra stdin → elimina timeout intermitente).
human_verification:
  - test: "Pulsa `a` sobre una sesión ad-hoc real en el dashboard ink y observa el estado 'derivando título…' seguido de la propuesta título:/desc: en el confirm"
    expected: "El footer muestra 'derivando título…' (dimColor) durante ~2-25s, después cambia a la propuesta multi-línea (título: X bold + desc: Y dimColor + 'adoptar <ref>? pulsa a de nuevo · Esc cancela' cyan). Segunda `a` ejecuta `kodo adopt --title '...' --description '...'` y la fila aparece en la tabla."
    why_human: "La calidad del título/descripción derivados por Haiku es no-determinista y depende de la memoria del proyecto real (PROJECT.md/ROADMAP.md) y el primer prompt del transcript. No verificable con grep ni con tests automáticos."
  - test: "Con una sesión ad-hoc de un proyecto GSD real (ej. ROMAN-194 / scp-cmri), verifica que el título propuesto refleja el ALCANCE del proyecto, NO el nombre del directorio ni el último commit"
    expected: "El título propuesto captura el propósito del proyecto (p.ej. 'kodo bidireccional v0.13' o similar), NO un string del estilo 'agent-xyz' o 'scp-cmri' (basename(cwd))."
    why_human: "Validación semántica de la calidad de la derivación LLM. Es el caso de origen del UAT fallido de ORCH-01 (ROMAN-194) que motivó esta fase."
  - test: "Pulsa Esc durante el estado 'derivando título…' y verifica que el confirm NO se abre aunque la derivación complete después"
    expected: "El dashboard vuelve a 'list' inmediatamente al presionar Esc. Si el proceso claude -p termina después, el confirm NO se reabre (token de generación T5 funciona en vivo)."
    why_human: "El test automatizado (app-derive.test.js T5) usa una promesa controlada. La validación en vivo con latencia real del subproceso claude requiere TTY."
  - test: "Verifica que el timeout ~25s no dispara fallback en derivaciones normales de Haiku"
    expected: "Con una sesión GSD real cuya memoria (PROJECT.md + ROADMAP.md + STATE.md) es de tamaño típico (<7000 chars total), la derivación completa en menos de 25s y produce título+descripción. El fallback a basename(cwd) solo se ve cuando claude no está en PATH o el proceso falla."
    why_human: "Las latencias de Haiku en producción son variables (8.7-21.9s según RESEARCH.md Pitfall 1). Requiere medir con una sesión real, no simulable con fakes."
---

# Phase 62: Adopción Inteligente desde el Dashboard — Verification Report

**Phase Goal:** Al pulsar `a` sobre un surface ad-hoc en el dashboard, ejecutar un paso de derivación LLM one-shot (`claude -p --model claude-haiku-4-5`, headless, fail-open/never-throws) que lee la memoria del proyecto (GSD: PROJECT.md/ROADMAP/STATE) + el primer prompt del transcript + git log, y propone `{title, description}` ANTES de crear. El operador confirma (segunda `a`) → shellea `kodo adopt --title '…' --description '…'`. Invariantes: suelo determinista intacto (fallback a `basename(cwd)`, adopt nunca bloquea); el LLM vive SOLO en el paso de derivación; el `{title, description}` pasa por `sanitizeAdoptionData` (BIDIR-08); `execFile` argv → inyección shell inerte.

**Verified:** 2026-06-25T11:50:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|---------|
| 1 | `enrich.js` exporta `deriveAdoptionMeta`, spawnea `claude -p --model claude-haiku-4-5` con `--json-schema`, never-throws (fail-open a `{}`), y lee memoria GSD o git log + primer prompt del transcript | VERIFIED | `src/cli/dashboard/enrich.js` existe, 243 LOC, exporta `deriveAdoptionMeta`/`spawnDerive`/`firstUserPrompt`/`SCHEMA`. Spawn usa argv `['-p','--model','claude-haiku-4-5','--output-format','json','--json-schema',SCHEMA,prompt]` (línea 67-76). 4 caminos `resolve({})` para fail-open. Imports `resolveTranscriptPath` + `isGsdProject`. Timeout `25_000` (línea 43). |
| 2 | `adopt.js` inserta el par `--description` en el argv espejo de `--title`, vía `execFile` (injection-inerte) | VERIFIED | `src/cli/dashboard/adopt.js` línea 141: `...(typeof description === 'string' && description.length > 0 ? ['--description', description] : [])`. Insertado tras `--title` y antes de `'--json'`. `runAdopt` usa `exec(execPath, argv, ...)` sin shell. Test injection-inerte en `test/dashboard/adopt.test.js` (suite 17/17 pass). |
| 3 | `App.js` tiene `mode==='deriving'` entre armado y confirm, awaita `onDerive`, fusiona `{title,description}` fail-open preservando `surface.title`, y muestra la propuesta en el confirm | VERIFIED | `App.js` línea 366: unión `'list'\|'filter'\|'overlay'\|'confirm'\|'deriving'`. Línea 580: `setMode('deriving')`. Línea 587: `derived = (await onDerive?.({...})) ?? {}` con try/catch fail-open. Línea 593: check token de generación `overlayReqRef`. Línea 601: `title: derived.title ?? surface.title` (T4 fail-open). Constantes exportadas `DERIVE_PROGRESS`/`ADOPT_DERIVED_CONFIRM`/`ADOPT_DERIVED_CONFIRM_FALLBACK` (líneas 212-217). |
| 4 | `index.js` cablea `onDerive=deriveAdoptionMeta` (con `execFile` real + fs DI) y `onAdopt` pasa `description` a `runAdopt` | VERIFIED | `index.js` líneas 127-128: imports lazy de `deriveAdoptionMeta` y `{readFileSync,existsSync}`. Línea 188-189: `onDerive: async ({cwd,sessionId}) => deriveAdoptionMeta({spawnFn:execImpl,readFileFn:readFileSync,existsSyncFn:existsSync,cwd,sessionId})`. Línea 194-195: `onAdopt` destructura y pasa `description` a `runAdopt`. |
| 5 | Suelo determinista intacto: fallo de Haiku → fallback a `basename(cwd)` vía `surface.title`; adopt nunca bloquea; sanitizeAdoptionData (BIDIR-08) aplica aguas abajo | VERIFIED | Fallback: fusión `derived.title ?? surface.title` (App.js:601) + `surface.title` proviene de `AgentSurface.title` (cmux, fallback a basename(cwd)). Never-throws: deriving handler tiene try/catch y `?? {}`. BIDIR-08: `adoptSession` en `src/adopt.js:230` llama `sanitizeAdoptionData({cwd,title,description})` antes del POST — el `description` de `--description` llega ahí vía `cli/adopt.js → adoptSession`. |

**Score:** 5/5 truths verified

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cli/dashboard/enrich.js` | Derivador LLM never-throws (DI, no child_process inline) | VERIFIED | 243 líneas. Cero `import node:child_process`. `spawnFn` inyectado por DI con leak guard TypeError. |
| `test/dashboard/enrich.test.js` | Suite unit con fakes (18 tests) | VERIFIED | 18/18 pass. No invoca `claude` real. |
| `test/dashboard/fixtures/transcript-variable-line.jsonl` | Fixture transcript primer user en línea variable | VERIFIED | Existe en `test/dashboard/fixtures/`. |
| `test/dashboard/fixtures/transcript-tool-result-only.jsonl` | Fixture transcript tool_result-only saltado | VERIFIED | Existe en `test/dashboard/fixtures/`. |
| `src/cli/dashboard/adopt.js` | `runAdopt` con `--description` par literal espejo de `--title` | VERIFIED | Línea 141 contiene el spread condicional. Firma línea 98 incluye `description`. |
| `test/dashboard/adopt.test.js` | 5 tests nuevos de `--description` | VERIFIED | 17/17 pass (5 nuevos + 12 pre-existentes). |
| `src/cli/dashboard/App.js` | Estado `deriving` + constantes copy español + `onDerive` prop | VERIFIED | `deriving` en unión mode (línea 366). 3 constantes exportadas (líneas 212-217). `onDerive` en props JSDoc y destrucción. |
| `src/cli/dashboard/SessionTable.js` | `derivingLine` + confirm multi-línea + precedencia footer | VERIFIED | `derivingLine` definido (línea 380) y presente en las 3 ramas del return (líneas 427, 436, 527). |
| `src/cli/dashboard/index.js` | Wiring `onDerive`+`onAdopt` con description | VERIFIED | `deriveAdoptionMeta` importado (línea 127). `onDerive` (línea 188). `onAdopt` con description (línea 194). |
| `test/dashboard/app-derive.test.js` | 7 tests del flujo derive-then-confirm | VERIFIED | 7/7 pass. Cubre: deriving frame, fail-open T4, fusión, Esc T5, traga-`a`, never-throws, no-project T2. |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `enrich.js` | `src/logger-events.js (resolveTranscriptPath)` | `import { resolveTranscriptPath }` | WIRED | Línea 28. Usada en `firstUserPrompt` (línea 160). |
| `enrich.js` | `src/adopt.js (isGsdProject)` | `import { isGsdProject }` | WIRED | Línea 29. Usada en `deriveAdoptionMeta` (línea 226). |
| `index.js (onDerive)` | `enrich.js (deriveAdoptionMeta)` | import + prop `onDerive` | WIRED | Líneas 127, 188-189. `execImpl` (execFile real) como `spawnFn`. |
| `App.js (handler 'a' overlay)` | `onDerive prop` | `await onDerive?.({cwd,sessionId})` | WIRED | Línea 587. Entre `setMode('deriving')` y `setMode('confirm')`. |
| `index.js (onAdopt)` | `adopt.js (runAdopt description)` | `description` en destructuring + arg | WIRED | Línea 194-195. `description` destructurado y pasado a `runAdopt`. |
| `adopt.js (--description)` | `kodo adopt --description (cli.js:257 → adoptSession)` | argv literal `['--description', description]` | WIRED | Línea 141 adopt.js. Cadena downstream verificada en RESEARCH A1 (no modificada). |
| `adoptSession` | `sanitizeAdoptionData (BIDIR-08)` | llamada directa (adopt.js:230) | WIRED | `sanitizeAdoptionData({cwd,title,description})` con `description` incluido (adopt.js línea 230). |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|--------------|--------|-------------------|--------|
| `enrich.js::spawnDerive` | `derived {title,description}` | `claude -p --json-schema` spawn (DI) | Yes — parse doble capa del envelope real; 4 fail-open paths a `{}` | FLOWING (when claude available) / FAIL-OPEN (when not) |
| `enrich.js::deriveAdoptionMeta` (GSD branch) | `contextBody` | `readFileFn(PROJECT.md/ROADMAP.md/STATE.md)` | Yes — caps 3000/2000/2000 chars; never-throws returns `''` | FLOWING |
| `enrich.js::deriveAdoptionMeta` (non-GSD branch) | `contextBody` | `gitLog + firstUserPrompt` | Yes — git log via spawnFn + transcript JSONL | FLOWING |
| `App.js::armedSurface.title` | `title` | `derived.title ?? surface.title` | Yes — fail-open: surface.title es el floor determinista | FLOWING |
| `adopt.js::runAdopt` | `argv['--description']` | `description` param from armedSurface | Yes — condicional: omitido si undefined/vacío | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| enrich.js 18 unit tests | `node --test test/dashboard/enrich.test.js` | 18 pass, 0 fail | PASS |
| adopt.js 17 unit tests (incl. 5 --description) | `node --test test/dashboard/adopt.test.js` | 17 pass, 0 fail | PASS |
| app-derive.test.js 7 integration tests | `node --test test/dashboard/app-derive.test.js` | 7 pass, 0 fail | PASS |
| color-isolation (no picocolors/ANSI in dashboard) | `node --test test/format-isolation.test.js` | 8 pass, 0 fail | PASS |
| Full test suite (no regression) | `npm test` | 1539 pass, 0 fail, 1 skip (pre-existing) | PASS |

### Probe Execution

No probes declared or found (`scripts/*/tests/probe-*.sh` — none exist for this phase). Step 7c: SKIPPED.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|---------|
| ORCH-02 SC#1 | 62-03-PLAN | derive-then-confirm: pick → "derivando…" → propuesta → segunda `a` confirma; propuesta ANTES de crear | SATISFIED | `mode='deriving'` state machine verified in App.js. `app-derive.test.js` (7/7). |
| ORCH-02 SC#2 | 62-01-PLAN | Fuentes de memoria GSD/non-GSD correctas (PROJECT.md+ROADMAP+STATE vs git log+transcript) | SATISFIED | `deriveAdoptionMeta` GSD branch: `gsdContext` reads 3 files. non-GSD branch: `gitLog` + `firstUserPrompt`. Verified in enrich.test.js. |
| ORCH-02 SC#3 | 62-01-PLAN | fail-open: timeout/parse-error/claude ausente → `{}`; never-throws | SATISFIED | `spawnDerive` has 4 `resolve({})` paths. `deriveAdoptionMeta` has outer try/catch → `{}`. App.js handler has additional try/catch fail-open. All paths tested in enrich.test.js. |
| ORCH-02 SC#4 | 62-02-PLAN + 62-03-PLAN | Al confirmar, shellea `kodo adopt --title '…' --description '…'`; argv literal injection-inerte; LLM solo en derivación | SATISFIED | `runAdopt` inserts `['--description', description]` literal (adopt.js:141). `execFile` without shell. injection-inerte test passing. index.js `onAdopt` passes description. |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `src/cli/dashboard/SessionTable.js` | 40 | `ADOPT_CONFIRM` imported but never used in render (replaced by `ADOPT_DERIVED_CONFIRM`/`_FALLBACK`) | Info | Dead import — no functional impact, but creates noise. Identified in REVIEW.md IN-01. |
| `src/cli/dashboard/App.js` | 1033 | `armedSurface?.title ?? null` — `??` doesn't exclude `''`; empty-string title would show "título: " blank in confirm instead of fallback | Warning | Edge case: only triggers if `surface.title === ''`. No crash, only incorrect display. Identified in REVIEW.md WR-01. |
| `src/cli/dashboard/enrich.js` | 160 | Missing path-traversal guard on `sessionId` before `resolveTranscriptPath` (inconsistency with App.js:453-457 guard) | Warning | Local trust boundary (cmux is a local process). Worst case: reads wrong file, `firstUserPrompt` returns `''` (never-throws). No code execution risk. Identified in REVIEW.md WR-02. |
| `test/dashboard/app-derive.test.js` | header | Comment declares 8 behaviors but only 7 `it()` exist (behavior 8 merged into test 1) | Info | Documentation drift only — the assert for `deriveCalls===1` exists inside test (1). No coverage gap. |
| `src/cli/dashboard/SessionTable.js` | 293, 295 | JSDoc params reference obsolete `ADOPT_CONFIRM` (Phase 56 copy) instead of `ADOPT_DERIVED_CONFIRM`/`_FALLBACK` | Info | Documentation drift only — no functional impact. |

No `TBD`, `FIXME`, or `XXX` markers found in any phase-modified files.

### Human Verification Required

The automated checks are all passing (5/5 truths, 1539/1540 suite). The following items require live human testing and are non-automatable:

#### 1. Calidad de la derivación con una sesión GSD real

**Test:** Lanzar el dashboard (`kodo dashboard`), pulsar `a` sobre una sesión ad-hoc de un proyecto GSD real que tenga `.planning/PROJECT.md` + `ROADMAP.md` + `STATE.md`. Observar la propuesta título:/desc:.
**Expected:** El título propuesto refleja el ALCANCE del proyecto (p.ej. "kodo bidireccional adopción inteligente"), NO el nombre del directorio (basename(cwd)) NI el último commit. La descripción es un párrafo coherente sobre el proyecto.
**Why human:** La calidad de la derivación LLM es no-determinista. Este es el caso de origen del UAT fallido de ORCH-01 (ROMAN-194). Solo validable con Haiku real y sesión real.

#### 2. Flujo UX completo derive-then-confirm en vivo

**Test:** Repetir el flujo completo: `a` → "derivando título…" visible → propuesta título:/desc: → segunda `a` → tarea creada en el gestor con el título y descripción derivados.
**Expected:** (a) El spinner "derivando título…" es visible durante la derivación. (b) La propuesta aparece antes de crear. (c) La segunda `a` ejecuta `kodo adopt --title '...' --description '...'` y la tarea aparece en Plane/GitHub con los valores derivados. (d) El footer verde "adopted <ref>…" confirma el éxito.
**Why human:** El flujo end-to-end involucra el TTY real, el proceso ink, el subproceso `claude -p`, y la llamada POST al gestor de tareas. No simulable sin servidor real.

#### 3. Esc durante derivación en vivo (T5)

**Test:** Pulsar `a` para iniciar la derivación, y antes de que termine (~10-25s), pulsar `Esc`. Verificar que el dashboard vuelve a `list` y que el confirm NO se abre cuando la derivación completa después.
**Expected:** Esc cancela inmediatamente (modo `list`), el resultado tardío de Haiku se descarta silenciosamente.
**Why human:** El test automatizado usa una promesa controlada. La validación con latencia real del proceso `claude` requiere TTY.

#### 4. Timeout y fallback con claude ausente en PATH

**Test:** Temporalmente renombrar/quitar `claude` del PATH y pulsar `a`. Verificar que el confirm muestra el fallback "adoptar <ref> (título por defecto)? ..." sin error rojo.
**Expected:** Con claude ausente, `spawnDerive` recibe ENOENT → `{}` → `ADOPT_DERIVED_CONFIRM_FALLBACK` → la segunda `a` adopta con `basename(cwd)` como título. Sin crash del panel ink.
**Why human:** Requiere modificar el entorno del PATH en un TTY real.

### Gaps Summary

No functional gaps found. All 5 must-have truths are VERIFIED. All artifacts exist, are substantive (not stubs), and are wired.

The two WARNINGS from REVIEW.md (WR-01 empty-string title edge case, WR-02 missing path-traversal guard on sessionId) are non-blocking: they do not prevent the phase goal from being achieved under normal operating conditions, and both have mitigating context (local trust boundary, fail-open behavior). They are cosmetic/defensive improvements, not gaps in the stated phase goal.

Status is `human_needed` because live UX testing with a real Haiku derivation against a real session is required to close the phase — this was explicitly documented in the PLAN verification sections as "Manual/UAT obligatorio (VALIDATION.md §Manual-Only)".

---

_Verified: 2026-06-25T11:50:00Z_
_Verifier: Claude (gsd-verifier)_
