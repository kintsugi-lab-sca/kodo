---
phase: 34-fundacion-subcomando-ciclo-de-vida
verified: 2026-05-27T10:38:00Z
status: human_needed
score: 4/4 must-haves verified
overrides_applied: 0
human_verification:
  - test: "TUI-03 — terminal intacta tras q / Ctrl-C / SIGTERM en TTY real"
    expected: "Cursor visible, echo restaurado, scrollback sin corromper en los 3 caminos de salida"
    why_human: "No automatizable sin PTY. La aserción de frame-diff cubre q→exit vía useApp().exit(), pero la restauración real del terminal (raw mode, cursor, echo) en los 3 escenarios requiere un TTY interactivo."
    operator_approval: "El operador respondió 'approved' en Task 3 del Plan 02 (documentado en 34-02-SUMMARY.md, sección 'Task 3 — UAT manual de TUI-03'). Los 4 escenarios (q / Ctrl-C / SIGTERM / non-TTY pipe) pasaron. La evidencia de código subyacente (q→exit(), SIGTERM→unmount, exitOnCtrlC default) se verificó automáticamente."
---

# Phase 34: Fundación — subcomando + ciclo de vida — Informe de Verificación

**Phase Goal:** Esqueleto `kodo dashboard`, guard non-TTY, salida limpia, color-isolation
**Verified:** 2026-05-27T10:38:00Z
**Status:** human_needed
**Re-verification:** No — verificación inicial

---

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                                   | Status     | Evidencia                                                                                                          |
|----|---------------------------------------------------------------------------------------------------------|------------|--------------------------------------------------------------------------------------------------------------------|
| 1  | `kodo dashboard` en TTY monta chrome estático: banner `kodo dashboard`, placeholder `starting…`, footer `q quit` (TUI-01 / D-01) | ✓ VERIFIED | `test/dashboard-render.test.js` pasa (2/2). App.js L52-55: tres `createElement` con los strings exactos incluyendo U+2026. |
| 2  | non-TTY → exit 1 + mensaje canónico D-04 a stderr, sin crash de raw-mode (TUI-02 / D-03)               | ✓ VERIFIED | `test/dashboard-non-tty.test.js` pasa (1/1). `index.js` L42-45: guard `isTTY` ANTES de cualquier `await import('ink')` o `render()`. String `NON_TTY_MSG` exacto en L24-26. |
| 3  | q / Ctrl-C / SIGTERM dejan la terminal intacta; q usa `useApp().exit()` (no `process.exit`); SIGTERM handler explícito vía `app.unmount()`; Ctrl-C cubierto por exitOnCtrlC default de ink (TUI-03 / D-08..D-10) | ? HUMAN    | Cobertura automatizada: frame-diff observable en `dashboard-render.test.js` (q→exit), código de SIGTERM handler en `index.js` L63-72 verificado (`process.once` + `app.unmount()` + `removeListener` tras `waitUntilExit`). UAT manual: aprobado por operador (34-02-SUMMARY Task 3). Esc no manejado confirmado (App.js L43, comentario D-11). |
| 4  | Cero archivos bajo `src/cli/dashboard/` importan `picocolors`; color exclusivamente vía `<Text>` de ink (TUI-04 / D-12) | ✓ VERIFIED | `test/format-isolation.test.js` describe TUI-04 pasa. `grep -r picocolors src/cli/dashboard/` → vacío. App.js solo usa props `bold`/`dimColor` de `<Text>`. |

**Score:** 4/4 truths verificadas (TUI-03 con componente automatizable verificado + UAT manual aprobado)

---

### Required Artifacts

| Artefacto                           | Propósito                                                         | Status     | Detalles                                                                                    |
|-------------------------------------|-------------------------------------------------------------------|------------|---------------------------------------------------------------------------------------------|
| `package.json`                      | ink@^6.8.0 + react@^19.2.0 (prod); ink-testing-library@^4.0.0 (dev); engines.node intacto | ✓ VERIFIED | `ink: "^6.8.0"`, `react: "^19.2.0"`, `ink-testing-library: "^4.0.0"`, `"@types/react": "^19"`, `engines.node: ">=20.0.0"`, sin `scripts.build`. |
| `test/dashboard-non-tty.test.js`    | Verifica TUI-02: exit 1 + string D-04 exacto vía spawnSync piped | ✓ VERIFIED | 61 líneas. Contiene `spawnSync` con `stdio:['pipe','pipe','pipe']`, `status === 1`, match regex y comparación exacta con `CANONICAL`. |
| `test/dashboard-render.test.js`     | Verifica TUI-01/D-01 chrome + q→exit observable (TUI-03 parcial) | ✓ VERIFIED | 79 líneas. Dos `it`: chrome (3 substrings) + q→exit (frame-diff observable contra tecla ignorada). |
| `test/format-isolation.test.js`     | Walker extendido a `src/cli/dashboard/` (TUI-04/D-13)             | ✓ VERIFIED | Describe TUI-04 añadido al final (L199-220). Reutiliza `listJsFiles`/`extractImports`. Aserción original `['src/cli/format.js']` intacta. |
| `src/cli/dashboard/index.js`        | runDashboard: guard non-TTY, baseUrl, render, SIGTERM, exit code  | ✓ VERIFIED | 75 líneas. Exporta `runDashboard`. Guard en L42-45 (antes de ink). SIGTERM en L63-66. `exitCode = 0` en L73. |
| `src/cli/dashboard/App.js`          | Componente root ink: chrome D-01/D-02, q→exit D-08, Esc no D-11  | ✓ VERIFIED | 57 líneas. Default export. `useApp`/`useInput`/`useStdin`. `if (input === 'q') exit()`. Sin rama para `key.escape`. |
| `src/cli.js` (bloque dashboard)     | Registro `kodo dashboard` (D-06/D-07), --url (D-05), sin ensureConfig | ✓ VERIFIED | L300-310. `command('dashboard')`, `.description('Live TUI dashboard...')`, `.option('--url <baseUrl>'...)`, lazy `await import('./cli/dashboard/index.js')`. Sin `ensureConfig` en ese bloque. |

---

### Key Link Verification

| From               | To                                  | Via                                          | Status     | Detalles                                                              |
|--------------------|-------------------------------------|----------------------------------------------|------------|-----------------------------------------------------------------------|
| `src/cli.js`       | `src/cli/dashboard/index.js`        | `await import('./cli/dashboard/index.js')` en `.action` | ✓ WIRED | cli.js L308: lazy import exacto. Patrón D-07 confirmado.             |
| `src/cli/dashboard/index.js` | `src/cli/dashboard/App.js` | `render(createElement(App, { baseUrl }))`    | ✓ WIRED | index.js L55+57: import dinámico de `App.js` y render con `createElement`. |
| `src/cli/dashboard/index.js` | `src/config.js`             | `loadConfig().server.port` para baseUrl      | ✓ WIRED | index.js L48-49: `await import('../../config.js')` + `loadConfig().server.port`. WR-01 aplica (ver Advertencias). |

---

### Data-Flow Trace (Level 4)

`App.js` no renderiza datos dinámicos en esta fase (D-02: placeholder estático `starting…`). `baseUrl` se pasa como prop pero no se consume (IN-01 del review). No aplica trazado de fuente de datos reales — el cuerpo de datos se hereda a Phase 36.

---

### Behavioral Spot-Checks

| Comportamiento                          | Comando                                                                             | Resultado                                      | Status  |
|-----------------------------------------|-------------------------------------------------------------------------------------|------------------------------------------------|---------|
| non-TTY rechazado con exit 1 + D-04     | `node --test test/dashboard-non-tty.test.js`                                        | 1 pass / 0 fail (74ms)                         | ✓ PASS  |
| Chrome D-01 + q→exit observable         | `node --test test/dashboard-render.test.js`                                         | 2 pass / 0 fail (189ms)                        | ✓ PASS  |
| Color-isolation TUI-04                  | `node --test test/format-isolation.test.js`                                         | 11 pass / 0 fail (incluyendo TUI-04)           | ✓ PASS  |
| Registro del subcomando en cli.js       | `grep -n "command('dashboard')" src/cli.js`                                         | L302: presente                                  | ✓ PASS  |
| Sin picocolors bajo src/cli/dashboard/  | `grep -r picocolors src/cli/dashboard/`                                             | vacío                                           | ✓ PASS  |

Los 3 tests targeted de la fase producen **11 pass / 0 fail** en ejecución real.

---

### Probe Execution

No se declararon probes en los planes. La cobertura ejecutable se verifica en los spot-checks anteriores.

---

### Requirements Coverage

| Requirement | Plan(s)     | Descripción                                                                            | Status        | Evidencia                                                                                |
|-------------|-------------|----------------------------------------------------------------------------------------|---------------|------------------------------------------------------------------------------------------|
| TUI-01      | 34-01, 34-02 | Usuario lanza `kodo dashboard` y ve el panel en vivo                                  | ✓ SATISFIED   | chrome D-01 verificado por test (lastFrame contiene los 3 substrings exactos)            |
| TUI-02      | 34-01, 34-02 | non-TTY rechazado con mensaje claro y exit code ≠ 0 (no crash)                        | ✓ SATISFIED   | test/dashboard-non-tty.test.js pasa; guard pre-render verificado en index.js L42-45      |
| TUI-03      | 34-02        | Salida limpia q/Ctrl-C/SIGTERM; terminal intacta (cursor, echo, scrollback)            | ? HUMAN       | Código verificado (q→exit(), SIGTERM→unmount, exitOnCtrlC). UAT manual aprobado (34-02-SUMMARY Task 3). |
| TUI-04      | 34-01, 34-02 | Color del TUI exclusivamente de ink; ningún archivo en `src/cli/dashboard/` usa picocolors | ✓ SATISFIED | walker test/format-isolation.test.js TUI-04 pasa + grep vacío en src/cli/dashboard/      |

Los 4 requirements de esta fase (TUI-01..TUI-04) están cubiertos. Los requirements TUI-05..TUI-16 corresponden a Phases 35-38 y no son responsabilidad de esta fase.

---

### Anti-Patterns Found

| Archivo                            | Línea | Patrón                                                            | Severidad    | Impacto                                                                                                              |
|------------------------------------|-------|-------------------------------------------------------------------|--------------|----------------------------------------------------------------------------------------------------------------------|
| `src/cli/dashboard/index.js`       | 49    | `loadConfig().server.port` sin optional chaining                 | ⚠️ Warning   | WR-01 del review: con un config v1 migrado que carece de la clave `server`, `.server` es `undefined` y `.port` lanza `TypeError`. El mismo patrón ya existe en `src/server.js:335` y `src/session/health.js:73` (riesgo preexistente, no introducido). Crash post-guard antes del render, con stack trace crudo en pantalla. No es bloqueante para la meta de la fase (non-TTY guard funciona), pero sí un fallo de robustez para usuarios con configs v1 migrados. |
| `src/cli/dashboard/index.js`       | 43-44 | Guard escribe a `process.stderr` global e invoca `process.exit` aunque la firma acepta DI | ⚠️ Warning   | WR-02 del review: `deps.stdout/stdin` son inyectables pero en el rechazo se ignoran los globales correspondientes (`stderr`, `exit`). La DI declarada es incompleta — el path más importante no es testeable vía DI. No afecta el comportamiento observable ni el resultado del test de subproceso. |
| `src/cli/dashboard/index.js`       | 73    | `process.exitCode = 0` también en el path SIGTERM                | ⚠️ Warning   | WR-03 del review: SIGTERM → exit 0 es semánticamente incorrecto (convención POSIX: 128+15=143). Rompe supervisores que distingan "salida limpia" de "terminación por señal". No bloquea los requirements TUI-01..04 de esta fase. |
| `test/dashboard-render.test.js`    | 50    | `setTimeout(r, 80)` fijo para esperar el frame de unmount        | ℹ️ Info       | IN-03 del review: valor mágico, potencialmente flaky bajo CI muy cargado. La aserción es válida y no fue debilitada (confirmado en review). |

Ningún marcador de deuda bloqueante (`TBD`/`FIXME`/`XXX`) encontrado en los archivos de la fase.

Los tres warnings (WR-01, WR-02, WR-03) son defectos de robustez y consistencia, no blockers para el goal de la fase. La meta ("esqueleto kodo dashboard, guard non-TTY, salida limpia, color-isolation") está lograda. Los warnings deberían corregirse antes o durante Phase 35 (especialmente WR-01, que puede afectar la resolución de baseUrl cuando Phase 35 añada HTTP real).

---

### Human Verification Required

#### 1. TUI-03 — Terminal intacta tras q / Ctrl-C / SIGTERM en TTY real

**Test:** En una terminal interactiva real (no pipe, no CI):
1. `node bin/kodo dashboard` → ver chrome (banner / `starting…` / `q quit`)
2. Pulsar `q` → volver al prompt; verificar cursor visible, echo funcionando, scrollback sin corrupción.
3. Relanzar + `Ctrl-C` → mismo resultado.
4. Relanzar + `kill <pid>` (SIGTERM desde otra terminal) → terminal intacta, sin raw-mode colgado.

**Expected:** En los 3 caminos de salida: cursor visible + echo + scrollback intacto.

**Why human:** No automatizable sin PTY interactivo. `ink-testing-library@4` no expone `waitUntilExit()` real; la restauración de terminal depende del modo raw del kernel del TTY, no de la lógica de la aplicación.

**Estado actual:** El operador aprobó los 4 escenarios (documentado en 34-02-SUMMARY.md, Task 3). La verificación de código subyacente (q→exit(), SIGTERM→unmount, exitOnCtrlC) está completamente automatizada y pasa.

---

### Gaps Summary

No hay gaps bloqueantes. El goal de la fase está logrado. Los 4 requirements (TUI-01..TUI-04) están satisfechos con evidencia de código real y tests en verde.

El status `human_needed` refleja que TUI-03 (restauración de terminal en TTY real) incluye una dimensión de comportamiento no automatizable. La aprobación del operador está registrada pero la verificación programática del comportamiento de terminal en TTY real no es posible sin PTY — se escala al operador para confirmación formal antes de avanzar a Phase 35.

Los 3 warnings del review (WR-01 optional chaining, WR-02 DI incompleta, WR-03 exit code bajo SIGTERM) no bloquean esta fase pero se recomiendan para Phase 35 o una iteración temprana antes de que el path HTTP añada más superficie sobre `loadConfig().server.port`.

---

_Verified: 2026-05-27T10:38:00Z_
_Verifier: Claude (gsd-verifier)_
