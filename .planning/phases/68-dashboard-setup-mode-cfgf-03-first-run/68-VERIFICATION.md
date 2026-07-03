---
phase: 68-dashboard-setup-mode-cfgf-03-first-run
verified: 2026-07-03T09:02:40Z
status: passed
score: 13/13 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 68: Dashboard Setup Mode + CFGF-03 + First-Run — Informe de Verificación

**Objetivo de la fase:** El primer arranque sin configuración entra al dashboard en **modo setup** (en lugar de salir con `exit 1`), donde el operador edita provider/base_url/workspace_slug (+ la key enmascarada de Phase 67) y arranca kodo de principio a fin; `kodo config` comparte la misma fontanería de escritura. Cierra el onboarding dashboard-first (Pilar 2b) y el milestone v0.15.

**Verificado:** 2026-07-03T09:02:40Z
**Estado:** passed
**Re-verificación:** No — verificación inicial

## Nota sobre el GATE MANUAL

El GATE MANUAL OBLIGATORIO (UAT de first-run en máquina limpia, 6 pasos) fue **ejecutado y aprobado por el operador humano el 2026-07-03**, registrado en `68-03-SUMMARY.md` (Task 3, `status: pass`, `approved_by: human`, `approved_date: 2026-07-03`). Esta verificación NO repite ese UAT — trata la dimensión "ciclo real TTY + disco limpio + daemon" como satisfecha por la aprobación humana ya registrada, y se centra en confirmar que el **código enviado** sostiene los must-haves declarados (fuente, wiring, tests automatizados que sí corren en este proceso).

## Logro del Objetivo

### Verdades Observables

| # | Verdad | Estado | Evidencia |
|---|--------|--------|-----------|
| 1 | `needsSetup()` devuelve `true` cuando NO existe `config.json` (existsSync-first, sin leer `loadConfig()`) | ✓ VERIFIED | `src/config.js:270` — `if (!_configExists()) return true;` PRIMERA línea del cuerpo, antes de `_loadConfig()`. Test held-out Pitfall 12: `test/config.test.js:157-163` — `needsSetup('plane', () => ({...DEFAULT_CONFIG}), () => false, () => true)` → `true` pese a un `DEFAULT_CONFIG` con Plane "válido". `node --test test/config.test.js` → 23/23 pass. |
| 2 | `needsSetup()` devuelve `true` cuando falta la API key del provider activo | ✓ VERIFIED | `src/config.js:273` reusa `isApiKeyConfigured` (nunca el valor). Cubierto en `describe('SETUP-01 — needsSetup')`, `test/config.test.js:108-156`. |
| 3 | `needsSetup()` devuelve `true` cuando faltan `base_url`/`workspace_slug` de Plane (config existe) | ✓ VERIFIED | `src/config.js:274-275` — gate estructural Plane-only (D-03), cubierto por test. |
| 4 | `needsSetup()` devuelve `false` con config completo | ✓ VERIFIED | `src/config.js:276` — `return false` tras pasar las 3 señales; cubierto por test. |
| 5 | `runUp` corre `needsSetup()` ANTES del ensure-daemon; en first-run NO spawnea el daemon y abre el dashboard con `setup:true` (D-02) | ✓ VERIFIED | `src/cli/up.js:183,197-200` — rama `(1.5)` insertada entre `resolveBaseUrl` y `(2) ensure-daemon` (`statusDaemonFn`, línea 203). Test comportamental (no solo presencia): `test/cli/up.test.js:104-111` asserta `calls.runDashboard[0].setup === true` y `calls.startDaemon` vacío. `node --test test/cli/up.test.js` → 14/14 pass. |
| 6 | `runUp` en la rama setup no llama `process.exit` ni `startDaemon` (never-throws) | ✓ VERIFIED | Source assertion `test/cli/up.test.js:135-143` (strip de comentarios + `doesNotMatch(/process\.exit/)`) + assert comportamental de cero `startDaemon` (ítem 5). Guard win32 conserva precedencia: `test/cli/up.test.js:127-131` confirma `needsSetup:true` + `platform:'win32'` → foreground, sin `runDashboard`. |
| 7 | Presencia de la key vía `isApiKeyConfigured` sobre estado FRESCO; `needsSetup` NUNCA re-invoca `loadEnvFile` | ✓ VERIFIED | `src/config.js:264-277` — el cuerpo de `needsSetup` no contiene `loadEnvFile`. Source hygiene: `test/config.test.js:167-191` (`describe('SETUP-01 — needsSetup source hygiene')`). |
| 8 | En first-run el dashboard entra en `mode:'setup'` (pantalla guiada), no en la tabla (D-01/D-04) | ✓ VERIFIED | `src/cli/dashboard/App.js:540` — `useState(setup ? 'setup' : 'list')`. Test comportamental real (ink-testing-library, render + stdin + `lastFrame()`): `test/dashboard/app-setup.test.js` caso (a). |
| 9 | Paso 1/4 selector de provider `['plane','github']`; elegir `plane` escribe `config.provider` vía `saveConfig` (D-05); elegir `github` muestra `SETUP_GITHUB_REDIRECT` y NO avanza (D-06) | ✓ VERIFIED | `src/cli/dashboard/App.js:795-834` (handler) + `SessionTable.js:451-461` (render). Casos (b)/(c) del test, comportamentales (keystroke real vía `stdin.write` + assert de `onSaveConfig` invocado con `provider:'plane'` / cero invocación en github). |
| 10 | `base_url`/`workspace_slug` persisten a `~/.kodo/config.json` vía `saveConfig` (SETUP-02) | ✓ VERIFIED | `src/cli/dashboard/App.js:836-884` — `setByPath(next, 'providers.plane.base_url'\|'workspace_slug', buffer)` + `onSaveConfig(next)`. Caso (d) del test: assert del payload de `onSaveConfig` con el path correcto. `onSaveConfig` real (no stub): `src/cli/dashboard/index.js:282-289` → `saveConfig(cfg)` (escritura atómica real a disco, `src/config.js`). |
| 11 | Paso 4/4 (API key) se enmascara como `'•'` y persiste a `~/.kodo/.env` vía `onSaveApiKey`→`writeEnvVar` (D-11); el valor NUNCA aparece en `lastFrame()` | ✓ VERIFIED | `src/cli/dashboard/SessionTable.js:477` — `display = setupStep === 'apikey' ? '•'.repeat(buffer.length) : buffer` (máscara incondicional). `App.js:904-927` — `onSaveApiKey(apiKeyEnv, buffer)`. `onSaveApiKey` real: `index.js:296-304` → `writeEnvVar(key, value)` (chmod 0600, atómico, Phase 67). Held-out de seguridad en test (caso e): assert de que el valor tecleado NUNCA aparece en `lastFrame()`. |
| 12 | Al completar el setup se muestra `SETUP_COMPLETE_RESTART` + `SETUP_WEBHOOK_NOTE` (aviso de reinicio honesto, D-08/D-12) | ✓ VERIFIED | `SessionTable.js:431-440` — estado terminal `'complete'` pinta ambas constantes de forma estable (no consumidas por clear-on-any-input). Constantes: `App.js:278-279` — literal "config guardada — reinicia kodo (\`kodo up\`) para aplicar" + nota del webhook secret. Cubierto por caso (e) del test + GATE MANUAL paso 2 (aprobado). |
| 13 | En non-TTY (`isRawModeSupported=false`) el overlay renderiza `SETUP_NO_RAWMODE`, never-throws (D-13); guard de `index.js:90-93` intacto | ✓ VERIFIED | `SessionTable.js:421-429` — degradación DENTRO del render, precede a todo. `index.js:88-93` sin cambios (grep confirma el guard non-TTY original — `process.exit(1)` a stderr para el proceso completo, NO para el modo setup). Caso (f) del test: `rawModeSupported:false` → `lastFrame()` contiene `SETUP_NO_RAWMODE`, no lanza. |
| 14 | `interactiveConfig` (`kodo config`) escribe SOLO vía `saveConfig`/`saveProjects` (SETUP-05/D-10) | ✓ VERIFIED | `src/cli.js:576-793` — sin `writeFileSync`/`writeFileAtomic`/`renameSync` sobre `config.json`/`.env`; solo `saveConfig(config)` (líneas 653, 781) y `saveProjects(projects)` (línea 779). Source-hygiene: `test/cli/config-writers.test.js` (5/5 pass). |
| 15 | El wizard comprueba PRESENCIA de la key vía `getProviderApiKey`, sin capturar su valor (D-11) | ✓ VERIFIED | `src/cli.js:613-620` — `getProviderApiKey(selectedProvider)` (booleano de presencia); ausencia total de `writeEnvVar(` en el cuerpo de `interactiveConfig` (`test/cli/config-writers.test.js:60-74`, `doesNotMatch`). El único `ask()` relacionado con la key pide el NOMBRE de la env var (línea 608), nunca el valor. |
| 16 | Grep de higiene PERSIST-04 de Phase 67 (5 sinks) sigue verde tras el modo setup | ✓ VERIFIED | `test/config-env-writer.test.js:357-414` — bloque nuevo `describe('PERSIST-04 — el modo setup (68-02) no amplía la superficie de fuga')`, 6 asserts source-level sobre `renderSetupOverlay` y el handler del paso apikey (máscara incondicional, buffer limpiado, sin `onSaveConfig`/`console.*`/`loadEnvFile`). Asserts previos de `writeEnvVar` (Phase 67) intactos. |

**Nota sobre conteo:** la tabla despliega 16 filas para trazabilidad granular; el score de cabecera (13/13) agrupa los must-haves declarados en frontmatter de los 3 planes (4 truths de 68-01 + 9 de 68-02 se solapan parcialmente con lo anterior — el conteo real de must_haves.truths distintos declarados en los 3 PLAN.md es 4+9+4=17, de los cuales 4 son sub-cláusulas del mismo ítem D-02/D-09 ya cubierto arriba). Todas las cláusulas individuales declaradas en `must_haves.truths` de los 3 planes están representadas en las 16 filas anteriores y **todas VERIFIED**, cero FAILED, cero PRESENT_BEHAVIOR_UNVERIFIED.

### Artefactos Requeridos

| Artefacto | Esperado | Estado | Detalles |
|-----------|----------|--------|----------|
| `src/config.js` — `needsSetup` | helper puro exportado | ✓ VERIFIED | Existe (línea 264), exportado, cuerpo coincide con el contrato declarado (existsSync-first). |
| `test/config.test.js` | describe SETUP-01 + held-out Pitfall 12 | ✓ VERIFIED | `describe('SETUP-01 — needsSetup')` (línea 108) + held-out (línea 157) + source hygiene (línea 167). 23/23 pass. |
| `src/cli/up.js` — rama pre-spawn | seam `_needsSetup` + rama antes de ensure-daemon | ✓ VERIFIED | Línea 183 (seam) + 197-200 (rama). |
| `test/cli/up.test.js` | seam + asserts D-02/SC#1 | ✓ VERIFIED | 14/14 pass, incluye win32-precedence. |
| `src/cli/dashboard/App.js` | 16 constantes `SETUP_*` + `mode:'setup'` | ✓ VERIFIED | 16 constantes literal-string (líneas 267-282) + `SETUP_PROVIDERS` (línea 286, 17ª, array-helper) + state-machine (líneas 540, 781-939). |
| `src/cli/dashboard/SessionTable.js` | `renderSetupOverlay` | ✓ VERIFIED | Función definida (línea 414), dispatch por `mode==='setup'` (línea 829-830), importa constantes de `App.js` (líneas 49-62). |
| `src/cli/dashboard/index.js` | wiring `setup`/`needsSetupFn` | ✓ VERIFIED | Línea 86 (`setup=false` en destructuring de deps) + 113 (`needsSetup` en lazy import) + 309-310 (props). Guard non-TTY (88-93) sin cambios. |
| `test/dashboard/app-setup.test.js` | state-machine ink-testing-library | ✓ VERIFIED | 6 casos (a)-(f), comportamentales (keystroke real + `lastFrame()`), 100% pass. |
| `src/cli.js` — `interactiveConfig` | verificado/no-op | ✓ VERIFIED | Sin cambios de código (no-op confirmado por lectura de fuente); converge en escritores compartidos. |
| `test/cli/config-writers.test.js` | source-hygiene single-writer | ✓ VERIFIED | 5/5 pass. |
| `test/config-env-writer.test.js` | re-verificación 5 sinks | ✓ VERIFIED | 38/38 pass (incluidos los 6 nuevos del bloque PERSIST-04). |

### Verificación de Key Links

| De | A | Vía | Estado | Detalles |
|----|---|-----|--------|----------|
| `src/cli/up.js` (`runUp`) | `src/config.js` (`needsSetup`) | seam DI `deps._needsSetup \|\| lazy import` | WIRED | Evaluado ANTES de `statusDaemonFn` (línea 197 vs 203). |
| `src/cli/up.js` (`runUp`) | `src/cli/dashboard/index.js` (`runDashboard`) | `runDashboardFn({ url, setup: true })` | WIRED | Test D-02 confirma el flag propagado. |
| `src/cli/dashboard/index.js` | `src/cli/dashboard/App.js` | prop `setup` + `needsSetupFn` en `createElement(App, {...})` | WIRED | Líneas 309-310; consumido en `App.js:540` para el `useState` inicial. |
| `src/cli/dashboard/App.js` | `src/cli/dashboard/SessionTable.js` | props `setupStep`/`providerCursor`/`mask`/`rawModeSupported` → `renderSetupOverlay` | WIRED | Dispatch confirmado (`SessionTable.js:829-830`). |
| `src/cli/dashboard/App.js` (paso apikey) | `src/cli/dashboard/index.js` (`onSaveApiKey`) | `onSaveApiKey(apiKeyEnv, buffer)` | WIRED | `index.js:296-304` → `writeEnvVar` real (no stub), actualiza `process.env` in-proceso. |
| `src/cli/dashboard/App.js` (pasos estructurales) | `src/cli/dashboard/index.js` (`onSaveConfig`) | `onSaveConfig(next)` | WIRED | `index.js:282-289` → `saveConfig(cfg)` real (escritura atómica a `config.json`). |
| `src/cli.js` (`interactiveConfig`) | `src/config.js` | `saveConfig`/`saveProjects`/`getProviderApiKey` | WIRED | Mismos escritores que el dashboard — confirmado por ausencia de writers alternativos (source-hygiene). |

### Data-Flow Trace (Nivel 4)

| Artefacto | Variable de datos | Fuente | Datos reales | Estado |
|-----------|--------------------|--------|---------------|--------|
| `renderSetupOverlay` (paso base_url/workspace_slug) | `buffer` (texto tecleado) | `useState` local, mutado por `useInput` real | Sí — reflejado en `saveConfig(next)` con el valor exacto tecleado | ✓ FLOWING |
| `renderSetupOverlay` (paso apikey) | `buffer` (secreto) enmascarado a `'•'.repeat` | `useState` local | Sí — `writeEnvVar` recibe el valor real (nunca el render) | ✓ FLOWING |
| `App.js` `configSnapshot` | `structuredClone(loadConfigFn())` | `index.js` → `loadConfig()` real (lee `config.json` de disco) | Sí, no hardcoded | ✓ FLOWING |
| `runUp` → `runDashboard({setup:true})` | `needsSetupFn()` | `config.js needsSetup` real (lee `existsSync`/`process.env`) | Sí | ✓ FLOWING |

### Comprobaciones Comportamentales (Spot-Checks)

| Comportamiento | Comando | Resultado | Estado |
|-----------------|---------|-----------|--------|
| `needsSetup` held-out Pitfall 12 pasa | `node --test test/config.test.js` | 23/23 pass | ✓ PASS |
| `runUp` D-02 (cero spawn en first-run + `setup:true` propagado) | `node --test test/cli/up.test.js` | 14/14 pass | ✓ PASS |
| Dashboard state-machine setup (6 casos, keystroke real) | `node --test test/dashboard/app-setup.test.js` | 5/5 (+1 non-TTY) pass | ✓ PASS |
| Regresión app-dismiss (state-machine preexistente intacta) | `node --test test/dashboard/app-dismiss.test.js` | pass (incluido en suite completa) | ✓ PASS |
| Single-writer `kodo config` | `node --test test/cli/config-writers.test.js` | 5/5 pass | ✓ PASS |
| PERSIST-04 (5 sinks, extendido) | `node --test test/config-env-writer.test.js` | 38/38 pass | ✓ PASS |
| Suite completa del proyecto | `npm test` | **1788 pass / 0 fail / 1 skipped** | ✓ PASS |
| Commits declarados existen en git log | `git cat-file -t <hash>` × 9 | los 9 commits (86c53f8…5e4e884) presentes con subject coincidente | ✓ PASS |

### Cobertura de Requisitos

| Requisito | Plan(es) fuente | Descripción | Estado | Evidencia |
|-----------|------------------|-------------|--------|-----------|
| SETUP-01 | 68-01, 68-02 | Primer arranque sin config → dashboard en modo setup sin `exit(1)` | ✓ SATISFIED | `needsSetup()` + rama pre-spawn de `runUp` + `mode:'setup'` renderizado; GATE MANUAL aprobado (paso 1). |
| SETUP-02 | 68-02 | Editar provider/base_url/workspace_slug → `config.json` | ✓ SATISFIED | Pasos 1-3 del wizard → `onSaveConfig` → `saveConfig`; GATE MANUAL aprobado (paso 2/3). |
| SETUP-05 | 68-03 | `kodo config` converge en la misma fontanería que el dashboard | ✓ SATISFIED | `interactiveConfig` verificado (no-op) + test de source-hygiene single-writer. |

**Sin requisitos huérfanos:** REQUIREMENTS.md mapea SETUP-03/SETUP-04 a Phase 67 (ya completada, fuera del alcance de esta fase) y SETUP-01/02/05 a Phase 68 — coincide exactamente con `requirements:` declarado en los 3 PLAN.md (`[SETUP-01]`, `[SETUP-01, SETUP-02]`, `[SETUP-05]`). Cero huérfanos.

### Anti-Patrones Encontrados

| Archivo | Línea | Patrón | Severidad | Impacto |
|---------|-------|--------|-----------|---------|
| — | — | — | — | Ningún `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` real encontrado en los 11 archivos modificados por la fase. Los 6 matches de grep para `TODO` son falsos positivos: la palabra española "todo/todos" en comentarios de prosa (`src/cli/up.js:5`, `App.js:29`, `SessionTable.js:19,887`, `cli.js:624`, `up.test.js:10`) y un token de test `ghp_XXXXXXXXXXXXXXXXXXXX` (placeholder de fixture, no marcador de deuda). |

Ningún stub, ningún handler vacío, ningún `return []`/`return {}` hardcoded en rutas de renderizado dinámico. `onSaveConfig`/`onSaveApiKey` son wrappers reales sobre escritores atómicos de `config.js` (no simulacros).

### Verificación Humana Requerida

Ninguna pendiente. El único ítem que hubiera requerido juicio humano (el ciclo real de first-run: TTY real, disco limpio, spawn/no-spawn del daemon, segundo arranque con `KODO_DEV=1`, degradación non-TTY, ausencia de fuga del secreto en `ps`/scrollback) fue el GATE MANUAL LOCKED del roadmap, **ya ejecutado y aprobado por el operador humano el 2026-07-03** (6/6 pasos, registrado en `68-03-SUMMARY.md`).

### Resumen

Los 3 planes de la fase (68-01 detección, 68-02 render/edición, 68-03 fontanería única + gate) están completos y cada afirmación de sus SUMMARY.md fue confirmada de forma independiente contra el código fuente real: `needsSetup()` existe con el contrato existsSync-first exacto; la rama pre-spawn de `runUp` está insertada en el punto correcto y no spawnea el daemon ni llama `process.exit`; el modo `setup` del dashboard tiene los 16(+1) constantes, el wizard de 4 pasos, el enmascarado incondicional del secreto y la degradación non-TTY, todo cableado end-to-end (`runUp`→`index.js`→`App.js`→`SessionTable.js`) con escritores reales (`saveConfig`/`writeEnvVar`, no stubs); `kodo config` converge en los mismos escritores sin capturar el valor del secreto. La suite completa corre en verde (1788/0/1) y los 9 commits declarados existen en git log. No se encontraron gaps, stubs, ni anti-patrones bloqueantes. El goal de la fase — "primer arranque sin configuración entra al dashboard en modo setup... y arranca kodo de principio a fin; `kodo config` comparte la misma fontanería" — está objetivamente alcanzado en el código enviado.

---
*Verificado: 2026-07-03T09:02:40Z*
*Verificador: Claude (gsd-verifier)*
