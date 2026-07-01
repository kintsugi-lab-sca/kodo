---
phase: 63-editor-de-configuraci-n-en-el-dashboard-fundaci-n-ajustes-co
plan: 03
subsystem: dashboard-tui
tags: [ink, config-editor, di-wiring, persistence, zero-endpoints]
requires:
  - "src/cli/dashboard/App.js: props DI loadConfigFn/onSaveConfig (Plan 02)"
  - "src/config.js: saveConfig atómico + loadConfig never-throws (Plan 01)"
provides:
  - "src/cli/dashboard/index.js: cableado DI real de loadConfigFn/onSaveConfig en createElement(App,...)"
  - "src/cli/dashboard/index.js: wrapper never-throws sobre saveConfig (escritura local directa, sin endpoint ni shell-out)"
affects:
  - "Phase 64 editor de proyectos (reusará el patrón de cableado DI loadConfigFn/onSaveConfig)"
tech-stack:
  added: []
  patterns:
    - "Import directo de saveConfig en el proceso ink (sin shell-out, sin endpoint) — invariante cero-endpoints desde v0.10"
    - "Wrapper never-throws DI (try/catch → {ok,error}) espejo de onAdopt/onDerive"
key-files:
  created: []
  modified:
    - src/cli/dashboard/index.js
decisions:
  - "Import directo de saveConfig (D-09) en lugar de shell-out a `kodo config`: saveConfig es función pura trivial ya atómica (Plan 01), el dashboard ya corre en Node con acceso a src/config.js → más simple y determinista que el patrón shell de la tecla `a` de Phase 62"
  - "saveConfig se añade al MISMO lazy import de loadConfig (línea 100), no a un import nuevo — cambio quirúrgico"
  - "onSaveConfig envuelve saveConfig (síncrono) en try/catch async para never-throws (UX-04/D-12): un fallo de escritura devuelve {ok:false,error} y el panel ink sigue montado"
metrics:
  duration_min: 6
  completed: 2026-06-29
  tasks: 1
  files: 1
status: complete
---

# Phase 63 Plan 03: Cableado real del editor de configuración (DI en index.js) Summary

El último carril del editor de ajustes: `index.js` inyecta `loadConfigFn`/`onSaveConfig` en el `<App>` real (espejo exacto de `onAdopt`/`onDerive`), importando `loadConfig`/`saveConfig` DIRECTO en el proceso ink — sin shell-out y sin endpoint nuevo en `src/server.js` (D-09/PERSIST-02). `onSaveConfig` es un wrapper never-throws sobre el `saveConfig` ya atómico (Plan 01), de modo que el editor escribe `~/.kodo/config.json` de forma local y no-corruptiva mientras el panel ink permanece montado ante cualquier fallo (UX-04/D-12). El invariante "cero endpoints desde v0.10" queda verificado por `git diff --quiet src/server.js`.

## What Was Built

- **`src/cli/dashboard/index.js` (modificado, quirúrgico):**
  - Se añadió `saveConfig` al lazy import existente de `../../config.js` (la misma línea que ya importaba `loadConfig`), con un comentario denso que documenta por qué es import directo y no shell-out (D-09: contraste deliberado con la tecla `a` de Phase 62, que sí shelleó `kodo adopt` por su lógica 0-token compleja; aquí `saveConfig` es función pura trivial ya atómica).
  - En `createElement(App, { ... })` (espejo de `onAdopt`/`onDerive`) se inyectaron dos props nuevas:
    - `loadConfigFn: () => loadConfig()` — App toma el snapshot del config real al pulsar `e` y lo deep-clona internamente (Plan 02).
    - `onSaveConfig: async (cfg) => { try { saveConfig(cfg); return { ok: true }; } catch (e) { return { ok: false, error: String(e?.message ?? e) }; } }` — wrapper never-throws (UX-04/D-12): escritura local directa al filesystem, sin red/server/shell.
  - **CERO cambios en `src/server.js`** (invariante "cero endpoints desde v0.10", verificado por `git diff --quiet src/server.js`).

## How to Verify

```bash
node --test test/dashboard-config.test.js   # 7 pass (contrato DI que index cablea = el que App consume)
git diff --quiet src/server.js && echo OK    # server.js intacto (cero endpoints, PERSIST-02)
npm test                                      # 1601 pass, 0 fail, 1 skip (sin regresión)
```

## Key Decisions

- **Import directo de `saveConfig` (D-09), no shell-out:** el dashboard ya corre en Node con acceso a `src/config.js`; `saveConfig` es una función pura trivial y ya atómica (Plan 01), así que importarla es más simple y determinista que shellear `kodo config`. Esto contrasta a propósito con la tecla `a` de Phase 62, que sí shelleó `kodo adopt` por su lógica 0-token compleja.
- **`saveConfig` añadido al lazy import existente:** se reutilizó el `await import('../../config.js')` de la línea 100 (que ya traía `loadConfig`) en vez de crear un import nuevo — cambio quirúrgico mínimo.
- **`onSaveConfig` never-throws sobre `saveConfig` síncrono:** aunque `saveConfig` no devuelve promesa, el wrapper es `async` para coincidir con el contrato DI que App consume (`Promise<{ok, error?}>`); el try/catch garantiza que ningún throw alcance el árbol React (UX-04/D-12).

## Deviations from Plan

None - plan executed exactly as written.

## Threat Surface

Mitigaciones del `<threat_model>` aplicadas y verificadas:
- **T-63-07** (EoP/Tampering, nuevo endpoint): NO se añadió endpoint — escritura local vía import directo de `saveConfig`; `git diff --quiet src/server.js` exits 0 (PERSIST-02 verificado).
- **T-63-10** (DoS, wrapper onSaveConfig): try/catch never-throws → un fallo de escritura devuelve `{ok:false}` y el panel ink sigue montado (UX-04/D-12; cubierto por el sub-test "UX-04/D-12: escritura fallida deja el panel montado").
- **T-63-03** (Information Disclosure): pendiente de confirmación humana end-to-end en el checkpoint (que ninguna API key sea visible/editable en el flujo real, PERSIST-04).
- **T-63-SC** (Tampering, npm installs): cero dependencias nuevas — sin superficie de cadena de suministro.

Sin superficie de seguridad nueva fuera del threat model.

## Checkpoint Pendiente (Task 2 — human-verify, blocking)

El trabajo de implementación de este plan está completo y verificado por la suite automática. La verificación end-to-end sobre el dashboard REAL (terminal TTY) es manual-only por diseño (63-VALIDATION.md): `ink-testing-library` asierta contenido, no el rendering ANSI del cursor `<Text inverse>`, y el reinicio real del daemon vive fuera del árbol ink. Los 8 pasos de UAT se detallan en el marcador de checkpoint devuelto al orquestador; cubren las dos verificaciones manual-only de 63-VALIDATION.md (render visual del cursor bajo terminal real, UX-02; efectividad del aviso de reinicio, PERSIST-03).

## Self-Check: PASSED

- FOUND (modificado): src/cli/dashboard/index.js (loadConfigFn, onSaveConfig, saveConfig en lazy import)
- FOUND: commit e0dd877 (cableado DI)
- `node --test test/dashboard-config.test.js`: 7 pass; `npm test`: 1601 pass / 0 fail / 1 skip.
- `git diff --quiet src/server.js`: exit 0 (server.js intacto, cero endpoints).
