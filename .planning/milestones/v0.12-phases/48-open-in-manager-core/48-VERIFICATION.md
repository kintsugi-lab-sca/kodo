---
phase: 48-open-in-manager-core
verified: 2026-06-12T06:00:00Z
status: passed
score: 5/5 must-haves verified
human_verification_result: passed (5/5 via 48-03-SUMMARY.md, 2026-06-12) — operador confirmó los 5 checks (happy path browser launch, alt-screen survival, legacy no-op, never-throws con binario real, adversarial refusal, split-deploy URL) contra el binario `open` real en macOS; Phase 48 cierra por HUMAN-UAT como estaba presupuestado (mirror de Phase 37)
overrides_applied: 0
re_verification: false
human_verification:
  - test: "SC#1 — Happy path browser launch"
    expected: "Pulsar `o` sobre una fila con task_url abre una pestaña en el navegador del sistema; el footer muestra `opening KL-99…` en verde; el panel ink permanece montado sin flicker ni toggle de alt-screen."
    why_human: "Efecto de lado del sistema: execFile('open', [url]) invoca el binario real de macOS. No verificable con grep ni con el runner de tests (los tests usan exec fake)."
  - test: "SC#1 — Alt-screen survival post-launch"
    expected: "Tras la apertura, presionar cualquier tecla (ej. flecha) limpia el footer y restaura la línea de hints. Al salir con `q`, el scrollback anterior queda intacto."
    why_human: "Comportamiento del terminal (alt-screen ANSI) observable solo en un TTY real."
  - test: "SC#2 — Legacy no-op con footer bare"
    expected: "Sobre una fila sin task_url, `o` no abre nada; footer muestra `no task URL for this session` (sin `[!]`, sin `— press any key`). Confirmado como approved en 48-03-SUMMARY.md."
    why_human: "Aprobado manualmente en HUMAN-UAT (48-03). Registrado aquí por completitud de trazabilidad."
  - test: "SC#3 — Never-throws con launcher real"
    expected: "Forzar fallo (ENOENT o exit≠0) con el binario `open` real muestra el footer de error y no crashea React."
    why_human: "Verificado con fakes en tests automáticos; el comportamiento con el binario real solo es confirmable por el operador."
  - test: "SC#4 — Adversarial refusal con binario real"
    expected: "Una fila con task_url no-http(s) (ej. `file:///etc/passwd`) muestra `[!] refused non-http(s) URL — press any key` y NO abre pestaña ni app."
    why_human: "La allowlist es verificable en código, pero la ausencia de efecto lateral (no abrir Calculator, no abrir archivo) solo la confirma el operador en macOS real."
  - test: "SC#5 — Split-deploy Plane URL con web_url configurado"
    expected: "Con `providers.plane.web_url` distinto de `base_url`, el tab abierto usa el host web, no el API host. Una fila UNKNOWN-… muestra el footer no-URL."
    why_human: "Requiere deploy Plane con topología separada o configuración temporal del operador. Confirmado como approved en 48-03-SUMMARY.md."
---

# Phase 48: Open-in-manager core — Verification Report

**Phase Goal:** El operador salta de una fila del dashboard a la tarea en su gestor (Plane/GitHub) con una sola tecla, sin salir de la TUI. Ships incondicionalmente. Tecla `o` abre la tarea (Plane/GitHub) en el navegador vía execFile never-throws + fix del bug latente de URL de Plane.
**Verified:** 2026-06-12T06:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

> Nota: El checkpoint HUMAN-UAT (Plan 48-03) fue aprobado por el operador en macOS real. Los 5 ítems de verificación humana que siguen están incluidos porque el navegador y el terminal son efectos de lado no verificables por grep. El cuerpo del informe documenta qué evidencia de código respalda cada SC.

---

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| SC#1 | `o` sobre fila con task_url abre la tarea en el navegador; panel ink permanece montado | VERIFIED (code) + HUMAN UAT | `input === 'o'` handler en App.js:555; `onOpen` wiring en index.js:143; `runOpen` en open.js:74; HUMAN-UAT aprobado en 48-03-SUMMARY.md |
| SC#2 | Fila legacy sin task_url: no-op con footer bare `no task URL for this session` | VERIFIED | Guard `if (!row.task_url)` en App.js:570-573; `OPEN_ERR_NO_URL = 'no task URL for this session'` (App.js:156, LOCKED sin `[!]`); test (b) en app-open.test.js afirma openCalls===0 y ausencia de `[!]` |
| SC#3 | Fallos del launcher (ENOENT/exit≠0/throw) van al footer; nunca crashea React | VERIFIED | Discriminante `{ok,code,detail}` en open.js:74-129; mapeo ENOENT→OPEN_ERR_ENOENT, BAD_PROTOCOL→OPEN_ERR_BAD_PROTOCOL, else→openErrFailed en App.js:581-591; open.test.js escenarios ENOENT, NON_ZERO_EXIT, SPAWN_ERROR, leak-guard |
| SC#4 | URLs no-http(s) rechazadas antes de execFile; URL pasa como argv literal | VERIFIED | Allowlist `new URL(url)` + `parsed.protocol !== 'http:'` en open.js:89-99; `exec(binary, [url], ...)` en open.js:104; test adversarial open.test.js:139-167 confirma execCalls===0 para 5 vectores |
| SC#5 | Split-deploy Plane: link usa web_url; UNKNOWN-seq trata como sin URL | VERIFIED | `webUrl: plane.web_url ?? plane.base_url` en registry.js:41; `webUrl: config.webUrl` en provider.js:173,275; `browseHost = context.webUrl ?? context.baseUrl` en normalize.js:78; UNKNOWN guard en normalize.js:72-73; 3 tests en normalize.test.js (unified/split/UNKNOWN) |

**Score: 5/5 truths verified** (en código; SC#1, SC#3, SC#4, SC#5 adicionalmente confirmados en HUMAN-UAT aprobado).

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/cli/dashboard/open.js` | Never-throws launcher con allowlist http(s), clon de focus.js | VERIFIED | 129 líneas; `runOpen` exportado; BAD_PROTOCOL guard en líneas 89-99; args `[url]` en línea 104; sin picocolors/format.js (grep count=0) |
| `src/cli/dashboard/App.js` | Handler `if (input === 'o')`, OPEN_* constants, hint `o open` | VERIFIED | Handler en línea 555; OPEN_OK/OPEN_ERR_NO_URL/OPEN_ERR_ENOENT/OPEN_ERR_BAD_PROTOCOL/openErrFailed exportados (líneas 155-160); hint en línea 687 |
| `src/cli/dashboard/index.js` | onOpen prop wiring reusando execImpl | VERIFIED | `runOpen` lazy import en línea 114; prop `onOpen: async (url) => runOpen({ exec: execImpl, url })` en línea 143; import('node:child_process') count=1 (no duplicado) |
| `src/providers/plane/normalize.js` | browse-URL via context.webUrl; UNKNOWN suprime url | VERIFIED | `browseHost = context.webUrl ?? context.baseUrl` en línea 78; `identifierUnresolved` guard en líneas 72-73; url field en línea 89-91 |
| `src/providers/registry.js` | webUrl threaded desde plane.web_url ?? plane.base_url | VERIFIED | `webUrl: plane.web_url ?? plane.base_url` en línea 41 |
| `src/providers/plane/provider.js` | webUrl en PlaneProviderConfig typedef; en ambos context builders | VERIFIED | typedef línea 9; `webUrl: config.webUrl` en líneas 173 y 275 (count=2 verificado) |
| `src/config.js` | migrateConfig lleva web_url; DEFAULT_CONFIG sin web_url | VERIFIED | `web_url: planeOld.base_url` en línea 95; única ocurrencia de `web_url` en todo el archivo |
| `test/dashboard/open.test.js` | 6+ escenarios (ok, ENOENT, NON_ZERO_EXIT, SPAWN_ERROR, leak-guard, adversarial) | VERIFIED | 8 escenarios (incluye binary-default y http:// allowed); adversarial matriz en líneas 139-167 |
| `test/dashboard/app-open.test.js` | 4 escenarios (a-d) | VERIFIED | Escenarios a/b/c/d presentes; assertions de call-count, footer literal, clear-on-any-input |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `src/providers/registry.js` | `src/providers/plane/provider.js` | `createPlaneProvider({ webUrl: plane.web_url ?? plane.base_url })` | WIRED | registry.js:41 |
| `src/providers/plane/provider.js` | `src/providers/plane/normalize.js` | `NormalizeContext.webUrl` en ambos context builders | WIRED | provider.js:173, 275 (`grep -c` = 2) |
| `normalize.js url field` | `context.webUrl` | `context.webUrl ?? context.baseUrl` | WIRED | normalize.js:78 |
| `App.js o handler` | `onOpen prop` | `await onOpen?.(row.task_url)` | WIRED | App.js:575 |
| `index.js` | `open.js` | `runOpen({ exec: execImpl, url })` | WIRED | index.js:114,143 |
| `open.js` | `node:child_process execFile (inyectado)` | `exec(binary, [url], ...)` | WIRED | open.js:104 |

---

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `normalize.js` url field | `browseHost` / `context.webUrl` | `plane.web_url ?? plane.base_url` desde config en registry.js | Sí — usa configuración real del operador vía resolve-on-read | FLOWING |
| `App.js` o handler | `row.task_url` | `SessionRecord.task_url` persistido al lanzar la sesión, servido por GET /status | Sí — campo persistido, no hardcoded | FLOWING |
| `open.js` runOpen | `url` arg | `row.task_url` pasado desde App.js vía `onOpen?.(row.task_url)` | Sí — fluye desde el registro real | FLOWING |

---

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| runOpen exec args literales `[url]` | `node --test test/dashboard/open.test.js` | 8/8 pass | PASS |
| App.js handler `o` + footer constants | `node --test test/dashboard/app-open.test.js` | 4/4 pass | PASS |
| normalize.js split-deploy / UNKNOWN | `node --test test/normalize.test.js` | 35/35 pass (suite completa) | PASS |
| Color isolation open.js | `grep -c "picocolors\|format.js" src/cli/dashboard/open.js` | 0 | PASS |
| format-isolation walker | `node --test test/format-isolation.test.js` | 8/8 pass | PASS |
| onOpen wired en index.js | `grep -n "onOpen: async (url) => runOpen" src/cli/dashboard/index.js` | Línea 143 | PASS |
| webUrl count en provider.js | `grep -c "webUrl: config.webUrl" src/providers/plane/provider.js` | 2 | PASS |
| web_url única ocurrencia en config.js | `grep -n "web_url" src/config.js` | Línea 95 (solo en migrateConfig) | PASS |

---

### Probe Execution

Step 7c: No se declararon probes en los PLANs. El gate de pre-UAT fue `npm test` ejecutado en Plan 48-03 (Task 1), con resultado 1279 pass / 1 skip / 0 fail, documentado en 48-03-SUMMARY.md.

---

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| OPEN-01 | 48-02, 48-03 | Tecla `o` abre task_url vía execFile fire-and-forget | SATISFIED | Handler en App.js:555; runOpen en open.js; onOpen wiring en index.js; HUMAN-UAT aprobado |
| OPEN-02 | 48-02, 48-03 | Never-throws end-to-end; no-op con feedback cuando falta task_url | SATISFIED | Discriminante {ok} en open.js:74-129; guard no-URL en App.js:570-573; test suite (a-d) en app-open.test.js |
| OPEN-03 | 48-02, 48-03 | Allowlist http(s); URL como argv literal sin shell | SATISFIED | Guard en open.js:89-99; `exec(binary, [url], ...)` en open.js:104; test adversarial: execCalls=0 para 5 vectores |
| OPEN-04 | 48-01, 48-03 | web_url para split-deploy Plane; UNKNOWN-seq emite no URL | SATISFIED | webUrl threading completo (config→registry→provider→normalize); browseHost en normalize.js:78; UNKNOWN guard en normalize.js:72-73; 3 tests en normalize.test.js |

Todos los requirement IDs declarados en los PLAN frontmatter (OPEN-01 a OPEN-04) están cubiertos. No hay IDs huérfanos en REQUIREMENTS.md para Phase 48.

---

### Anti-Patterns Found

Ninguno. Búsqueda de TBD/FIXME/XXX en los 7 archivos modificados por la fase retornó 0 coincidencias.

---

### Commits verificados en git history

| Commit | Descripción |
|--------|-------------|
| `3be36c3` | feat(48-01): add web_url config support |
| `531a217` | feat(48-01): thread webUrl end-to-end |
| `79c2c58` | feat(48-01): route browse-URL through webUrl + suppress UNKNOWN |
| `1fad5b7` | test(48-02): failing test for runOpen |
| `c21c1de` | feat(48-02): implement runOpen |
| `e56e057` | test(48-02): failing integration test for o handler |
| `6aaff40` | feat(48-02): add o keypress handler + OPEN_* constants + hint |
| `5bb4b5b` | feat(48-02): wire onOpen DI |

Todos presentes en `git log --oneline`.

---

### Human Verification Required

Las siguientes pruebas requieren ejecución humana en macOS real con `kodo dashboard`. El operador ya proporcionó un veredicto APPROVED en el checkpoint Plan 48-03. Se documentan aquí para trazabilidad completa del ciclo de verificación.

#### 1. SC#1 — Happy path browser launch

**Test:** Pulsar `o` sobre una fila con task_url (Plane o GitHub).
**Expected:** Tab abierto en el navegador del sistema sobre la tarea viva; footer verde `opening PROJ-123…`; panel ink sin flicker, cursor preservado.
**Why human:** execFile('open', [url]) invoca el binario real de macOS. Los tests de la suite usan exec fake.

#### 2. SC#1 — Alt-screen survival

**Test:** Tras la apertura, presionar una tecla de movimiento y luego `q`.
**Expected:** Footer limpiado; hints restaurados; scrollback intacto al salir.
**Why human:** Comportamiento del terminal (alt-screen ANSI) observable solo en un TTY real.

#### 3. SC#3 — Never-throws con launcher real

**Test:** Inducir ENOENT (renombrar `open` temporalmente) y pulsar `o`.
**Expected:** Footer de error `[!] open not found in PATH — press any key`; dashboard no crashea.
**Why human:** La suite de tests cubre este caso con fake-exec; la resiliencia con el binario real requiere confirmación del operador.

#### 4. SC#4 — Adversarial refusal con binario real

**Test:** Forzar una fila con `task_url = 'file:///etc/passwd'` y pulsar `o`.
**Expected:** `[!] refused non-http(s) URL — press any key`; ninguna app ni archivo se abre.
**Why human:** La ausencia de efecto lateral (no abrir Finder, no interpretar el path) solo es confirmable en macOS real.

#### 5. SC#5 — Split-deploy Plane URL

**Test:** Configurar `providers.plane.web_url` distinto de `base_url`; pulsar `o` sobre fila Plane.
**Expected:** Tab usa el host web, no el API host. Fila UNKNOWN-… muestra footer no-URL.
**Why human:** Requiere configuración de deploy separado o setup temporal. El operador lo confirmó en el HUMAN-UAT (48-03-SUMMARY.md).

---

### Gaps Summary

No se encontraron gaps. Los 5 Success Criteria del ROADMAP están satisfechos en código. El status es `human_needed` porque los efectos de lado de browser/terminal (SC#1, SC#3, SC#4, SC#5 parcial) son estructuralmente no verificables con grep — no porque haya deficiencias detectadas. El HUMAN-UAT (Plan 48-03) fue aprobado por el operador, cubriendo los 5 checks del plan.

---

_Verified: 2026-06-12T06:00:00Z_
_Verifier: Claude (gsd-verifier)_
