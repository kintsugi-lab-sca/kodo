# Phase 68: Dashboard Setup Mode + CFGF-03 + First-Run - Research

**Researched:** 2026-07-02
**Domain:** TUI onboarding (ink state-machine) + first-run detection + fontanería de escritura de config/secretos (brownfield sobre kodo)
**Confidence:** HIGH (todo el código base verificado en sesión; cero deps externas nuevas)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Detección de first-run (SETUP-01):**
- **D-01:** La detección vive LOCAL en el dashboard (presence-check con `loadConfig` + `getProviderApiKey` + campos estructurales del provider activo). El dashboard decide render setup vs tabla en el arranque. Coherente con que el dashboard ya lee config local (Phase 63/64/67) y con el invariante cero endpoints nuevos.
- **D-02:** `kodo up` detecta config incompleta ANTES del spawn y NO arranca el daemon en first-run (evita enganchar el dashboard a un server muerto: hoy el daemon hace `teardown(1)` tras `KODO_SETUP_REQUIRED`). El dashboard se abre igualmente y entra en modo setup.
- **D-03:** Criterio de "config incompleta": no existe `config.json` O falta la API key del provider activo. Se extiende a "faltan campos estructurales del provider" (base_url/workspace_slug para Plane) para que el guiado sepa qué pedir. NO se usa el criterio laxo "solo no-config.json".

**UX de la pantalla de setup (SETUP-02):**
- **D-04:** Pantalla guiada dedicada (nuevo modo `setup` del dashboard), lineal step-by-step: `provider` → `base_url` → `workspace_slug` → API key enmascarada. Reusa text-input controlado (Phase 63) + masked field + `onSaveApiKey`→`writeEnvVar` (Phase 67). NO se reusa el overlay config-edit como checklist.
- **D-05:** Selector de `provider` activo en la pantalla guiada (plane/github) → escrito a `config.provider` vía `saveConfig`. Campo nuevo pequeño.
- **D-06:** La pantalla guiada cubre solo Plane. Si el operador elige GitHub, se le remite a `kodo config` headless (que ya maneja `repos[]`/`poll_interval`).
- **D-07:** El setup guiado aparece solo auto en first-run. Una vez configurado, los cambios usan el editor de config existente (overlay Phase 63/64) + campo enmascarado (Phase 67).

**Transición setup→running (SETUP-02 SC#4, Pitfall 15):**
- **D-08:** Aviso de reinicio honesto, sin auto-restart: al completar el setup el dashboard muestra "config guardada — reinicia kodo (`kodo up`) para aplicar". El operador re-ejecuta `kodo up`, que ahora encuentra config completa y arranca normal.
- **D-09 (Pitfall 15 — LOAD-BEARING):** Cualquier confirmación de "configurado"/completitud tras escribir debe leer el valor recién escrito DIRECTO del archivo, NO vía `loadEnvFile`/`process.env` cacheado (el parser hace load no-override → el valor viejo/ausente en memoria enmascararía el nuevo). Aplica al presence-check de la key y al render del estado de completitud.

**Alcance del rewire de `kodo config` (SETUP-05):**
- **D-10:** Rewire mínimo/quirúrgico: `saveConfig`/`saveProjects`/`writeEnvVar` como únicos escritores compartidos por ambos caminos. El wizard readline NO captura el valor de la key (evita eco del secreto — Pitfall 11); sigue comprobando presencia como hoy. CFGF-02 (rediseño no-lineal del wizard) queda diferido.
- **D-11:** La entrada del valor de la key es exclusiva del campo enmascarado del dashboard (Phase 67). Los dos caminos no divergen en el escritor (writeEnvVar), solo en si capturan o no el valor.

### Claude's Discretion (durante research/planning)
- Cómo se materializa el "modo setup" en `App.js` (nuevo estado de modo vs rama de render en el arranque) — respetando D-01/D-04. → **Resuelto en §Architecture Patterns: nuevo modo `setup` en la state-machine.**
- Mecánica exacta del selector de provider (lista simple 2-opciones estilo `cli.js:588-595`). → **Resuelto: sub-modo `setup` con cursor sobre `['plane','github']`.**
- Manejo non-TTY del setup en el attach de `kodo up`: degradar con aviso a `kodo config` — never-throws, reusando `isRawModeSupported`. → **Resuelto en §Common Pitfalls (Pitfall 16) + Open Question 2.**
- Punto exacto del presence-check pre-spawn en `runUp` (D-02) sin duplicar la lógica del dashboard (helper puro compartido). → **Resuelto: helper `needsSetup()` exportado de `config.js`, consumido por `runUp` e `index.js`.**
- Detalle de la lectura directa del archivo para D-09 (re-leer `.env`/`config.json` vs helper específico). → **Resuelto en §Common Pitfalls (Pitfall 15).**

### Deferred Ideas (OUT OF SCOPE)
- Cobertura de GitHub en la pantalla guiada (`repos[]`/`poll_interval`) — se deja a `kodo config` headless (D-06).
- Invocación manual del setup guiado post-first-run (tecla que relanza el wizard) — los cambios posteriores usan el editor de config existente (D-07).
- Captura del valor de la key en el wizard readline — la key entra solo por el dashboard enmascarado (D-10/D-11).
- Auto-restart del daemon tras el setup — converge con hot-reload (CFGF-01) en un futuro milestone.
- Hot-reload de config (CFGF-01) y rediseño no-lineal de `kodo config` (CFGF-02) → futuros milestones.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SETUP-01 | Primer arranque sin config (`config.json` ausente O API key ausente) → `kodo up` sirve el dashboard en modo setup, sin `exit(1)` | §Architecture Pattern 1 (helper `needsSetup`), Pattern 2 (rama pre-spawn en `runUp`), Pattern 3 (modo `setup` en App). El managed mode de Phase 65 (server.js:463 throw, no `process.exit`) ya es precondición. |
| SETUP-02 | El operador edita `provider` activo + `base_url` + `workspace_slug` desde el dashboard → `~/.kodo/config.json`; aviso de reinicio honesto | §Architecture Pattern 3 (modo `setup` lineal), Pattern 4 (selector de provider → `config.provider`), reuso de `saveConfig` + masked field (Phase 63/67). Aviso: `CONFIG_SAVED_RESTART` ya existe. |
| SETUP-05 | El wizard `kodo config` escribe por la MISMA fontanería que el dashboard (`saveConfig`/`saveProjects`/`writeEnvVar` únicos escritores) | §Architecture Pattern 5 (rewire mínimo de `interactiveConfig`, cli.js:576-680). El wizard ya usa `saveConfig`/`saveProjects`; falta cerrar que NO capture el valor de la key (ya no lo hace: cli.js:613-620 solo comprueba presencia). |
</phase_requirements>

## Summary

Phase 68 es una fase **brownfield de state-machine TUI** sobre kodo: cierra el onboarding dashboard-first sin introducir dependencias externas ni endpoints nuevos. La superficie técnica es acotada y muy bien delimitada por las tres fases previas del milestone: Phase 65 quitó el `process.exit(1)` del server bajo managed (ahora lanza `KODO_SETUP_REQUIRED`), Phase 66 construyó `runUp` (el orquestador donde se inserta el presence-check pre-spawn de D-02), y Phase 67 entregó `writeEnvVar` (escritor 0600 atómico), el campo enmascarado y `isApiKeyConfigured`. Phase 68 los **compone**: (1) un helper puro de detección de first-run exportado de `config.js`, consumido tanto por `runUp` (pre-spawn) como por `App.js` (render setup-vs-tabla); (2) un nuevo modo `setup` en la state-machine de `App.js` que reusa el text-input controlado + masked field ya enviados; (3) un rewire mínimo de `interactiveConfig` para garantizar el escritor común.

El patrón arquitectónico dominante ya está establecido y probado cinco veces en `App.js` (`filter`, `overlay`, `confirm`, `config`/`config-edit`, `projects`/`projects-edit`/`projects-modules`): cada modo es una rama `if (mode === 'X')` en el `useInput` mode-gated + una rama de render en `SessionTable.js`, con copy literal-estable exportada. El modo `setup` sigue exactamente ese molde. El selector de provider es una lista de 2 opciones estilo el wizard readline (`cli.js:588-595`).

**Hallazgo crítico (bloqueante para el literal "arranca de principio a fin"):** el `KODO_SETUP_REQUIRED` que mata al daemon se lanza por **webhook secret ausente** (`KODO_WEBHOOK_SECRET_PLANE`/`PLANE_WEBHOOK_SECRET`, server.js:451-464), NO por la API key. El criterio de first-run de D-03 (config.json + API key + campos estructurales) NO incluye el webhook secret. Consecuencia: tras completar el setup guiado (que solo escribe provider/base_url/slug/API key), el 2º `kodo up` verá config "completa", spawneará el daemon, y el daemon **seguirá muriendo** con `teardown(1)` por el webhook secret ausente en una máquina limpia. Esto amenaza directamente el GATE MANUAL de UAT en máquina limpia. Ver Open Question 1 — debe resolverse en discuss/plan antes de ejecutar.

**Segundo hallazgo (Pitfall 12, load-bearing para la detección):** `loadConfig()` devuelve `{...DEFAULT_CONFIG}` cuando NO existe `config.json`, y `DEFAULT_CONFIG` ya trae un `provider: 'plane'` con `base_url`/`workspace_slug` válidos (config.js:32-67). Por tanto un check de "campos estructurales presentes" pasa **incluso en una máquina limpia**. La detección de first-run DEBE apoyarse en `existsSync(CONFIG_PATH)` directo (no en los valores que devuelve `loadConfig`) + presencia de API key. Los campos estructurales solo son señal útil cuando `config.json` SÍ existe pero es parcial.

**Primary recommendation:** Añadir un helper puro `needsSetup()` (o `isConfigComplete()`) exportado de `src/config.js` que combine `existsSync(CONFIG_PATH)` + `isApiKeyConfigured(provider)` + (si el config existe) validez de campos estructurales del provider activo, leyendo el estado de la key **directo del archivo** (D-09). Consumirlo desde `runUp` (rama pre-spawn D-02) y desde `index.js`/`App.js` (render setup D-01). Materializar el modo `setup` como una rama más de la state-machine de `App.js`, molde exacto de `config`/`projects`. Rewire quirúrgico de `interactiveConfig` para el escritor común. Resolver Open Question 1 (webhook secret) ANTES de planificar la ruta feliz de la transición.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Detección de first-run (config incompleta) | Config layer (`config.js` helper puro) | CLI (`runUp`) + TUI (`App.js`) lo consumen | La verdad de "config completa" es una función pura de `~/.kodo/` local; ambos consumidores comparten el MISMO helper (D-01/D-02, no duplicar) |
| Decidir spawn-vs-no-spawn del daemon | CLI (`runUp`, pre-spawn) | — | `kodo up` es el único que decide arrancar el daemon; el check va ANTES del `startDaemon` (D-02) |
| Render setup-vs-tabla en el arranque | TUI (`App.js` state-machine) | Config layer (helper) | El dashboard ya es la superficie de config local (Phase 63/64/67); cero endpoints nuevos (D-01) |
| Escritura de provider/base_url/slug | Config layer (`saveConfig`) | TUI (dispara el save) | `saveConfig` es el escritor único atómico ya enviado (SETUP-05) |
| Escritura de la API key (secreto) | Config layer (`writeEnvVar`, 0600) | TUI (masked field) | Boundary PERSIST-04: el valor solo cruza en-proceso a `writeEnvVar`, jamás shell-out (Pitfall 11) |
| Selección del provider activo | TUI (selector) → `config.provider` | Config layer (`saveConfig`) | Capacidad NUEVA: hoy el dashboard solo edita DENTRO de un provider, no cuál está activo (D-05) |
| Wizard headless `kodo config` | CLI (`interactiveConfig`, readline) | Config layer (escritores compartidos) | SETUP-05: el camino headless y el TUI convergen en los MISMOS escritores (D-10) |

## Standard Stack

**Sin dependencias externas nuevas — invariante LOCKED del milestone.** Toda la fase se construye sobre primitivos ya enviados. No hay tabla de paquetes que verificar contra un registro: cero `npm install`.

### Core (ya presentes en el repo — reuso, no instalación)
| Módulo/API | Versión | Propósito | Por qué es el estándar aquí |
|---------|---------|---------|--------------|
| `ink` | ya instalado | render TUI del dashboard | Base de todo el dashboard desde Phase 34; el modo setup es una rama más [VERIFIED: package.json + código] |
| `react` | ya instalado | state-machine de `App.js` (`useState`/`useInput`) | Motor de los modos existentes (config/projects); el modo setup reusa el patrón [VERIFIED: código App.js] |
| `ink-testing-library` | ya instalado (devDep) | render hermético de `App` en tests (stdin.write/lastFrame) | Patrón de test ya usado en `test/dashboard/app-*.test.js` [VERIFIED: test/dashboard/app-dismiss.test.js:24] |
| `node:readline` (built-in) | Node 22.22.3 | wizard `interactiveConfig` (`kodo config`) | Ya usado (cli.js:577); el rewire es quirúrgico, no cambia de librería [VERIFIED: código cli.js] |
| `node:fs`/`node:path`/`node:os` (built-in) | Node 22.22.3 | `existsSync(CONFIG_PATH)`, escritura atómica, `writeEnvVar` | Fontanería ya enviada en `config.js` [VERIFIED: código config.js] |
| `node:test` (built-in) | Node 22.22.3 | runner de tests (`node --test`) | Runner del proyecto (package.json `scripts.test`) [VERIFIED: package.json] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Nuevo modo `setup` en la state-machine | Reusar overlay `config-edit` como checklist | RECHAZADO por D-04 (literal "pantalla guiada" dedicada, lineal); el overlay config-edit no es lineal ni onboarding-first |
| Helper puro compartido `needsSetup()` | Duplicar el check en `runUp` y en `App.js` | RECHAZADO: viola DI puro / DRY; los dos consumidores DEBEN compartir la misma verdad (D-01/D-02) |
| `existsSync(CONFIG_PATH)` para first-run | Inspeccionar valores de `loadConfig()` | RECHAZADO (Pitfall 12): `loadConfig` inyecta DEFAULT_CONFIG con un plane válido → indistinguible de config real |

## Package Legitimacy Audit

**No aplica.** Esta fase NO instala ningún paquete externo (invariante LOCKED "cero nuevas dependencias npm"). Toda la funcionalidad se construye sobre built-ins de Node y código ya enviado en Phases 63/65/66/67.

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                        kodo up  (CLI entry — runUp, up.js:151)
                             │
                  ┌──────────┴───────────┐
                  │ (0) loadConfig +      │
                  │     needsSetup()      │◄─── HELPER PURO COMPARTIDO (config.js)
                  │  [D-02 pre-spawn]     │     existsSync(CONFIG_PATH)
                  └──────────┬───────────┘      + isApiKeyConfigured(provider)  ← lee .env directo (D-09)
                             │                   + campos estructurales (si config existe)
             needsSetup? ────┤
                YES │        │ NO (config completa)
                    │        │
     SKIP startDaemon        ├─► ensure-daemon (statusDaemon + probePort)
     (NO spawn — D-02)       │      └─► startDaemon detached → runDaemon (run.js)
                    │        │             └─► startServer({managed})
                    │        │                   └─► ⚠ throw KODO_SETUP_REQUIRED
                    │        │                        si falta WEBHOOK SECRET (server.js:463)
                    │        │                        → teardown(1)  ← ¡Open Question 1!
                    │        │
                    └────────┴─► waitForHealth (never-throws, fail-open)
                             │
                             ▼
                   runDashboard(index.js) ── attach visor HTTP
                             │
                   ┌─────────┴──────────┐
                   │ non-TTY guard       │─── pipe/CI → mensaje + exit (Pitfall 16, Open Q 2)
                   └─────────┬──────────┘
                             ▼
                   render <App baseUrl needsSetupFn ...>
                             │
              needsSetup? ───┤ (D-01 render decision, LOCAL)
                 YES │       │ NO
                     ▼       ▼
        ┌────────────────┐  modo 'list' (tabla de sesiones — flujo normal)
        │ modo 'setup'   │
        │ (state-machine)│  provider selector → base_url → workspace_slug → API key (masked)
        │  LINEAL D-04   │        │                                            │
        └───────┬────────┘  saveConfig(config.provider/base_url/slug)   writeEnvVar (0600)
                │                  │                                     + process.env[key]=value
                ▼                  └──────────────┬──────────────────────────┘
      aviso reinicio honesto (D-08) ◄────────────┘
      "config guardada — reinicia kodo (kodo up)"


        kodo config  (CLI headless — interactiveConfig, cli.js:576)
                             │
              MISMOS escritores (SETUP-05 / D-10):
              saveConfig · saveProjects · (NO captura valor de key — D-11)
```

### Component Responsibilities

| Componente | Archivo | Responsabilidad en Phase 68 |
|-----------|---------|------------------------------|
| Helper `needsSetup()` (NUEVO) | `src/config.js` | Función pura exportada: `existsSync(CONFIG_PATH)` + presencia de API key (lectura directa, D-09) + campos estructurales. DI-zable para tests (mismo patrón que `isReportToProviderEnabled(_loadConfig)`) |
| `runUp` (rama pre-spawn) | `src/cli/up.js:187-202` | Insertar el check `needsSetup()` entre `loadConfig` y el `ensure-daemon`; si true → NO spawn, pasar a attach con flag setup |
| `App` state-machine (modo `setup`) | `src/cli/dashboard/App.js` | Nuevo `mode:'setup'` (+ sub-estados de paso lineal) en el `useInput` mode-gated; reusa buffer/cursor + maskValue |
| `SessionTable` (render setup) | `src/cli/dashboard/SessionTable.js` | Nueva rama `if (mode === 'setup') return renderSetupOverlay(...)`, molde de `renderConfigOverlay` |
| `runDashboard` (wiring) | `src/cli/dashboard/index.js` | Pasar `needsSetupFn` (o el flag ya computado en `runUp`) + reusar `onSaveConfig`/`onSaveApiKey` ya cableados (Phase 63/67) |
| `interactiveConfig` (rewire) | `src/cli.js:576-680` | Garantizar `saveConfig`/`saveProjects`/`writeEnvVar` como únicos escritores; NO capturar valor de key (ya cumple, cli.js:613-620) |

### Recommended Project Structure
```
src/
├── config.js                      # + needsSetup() / isConfigComplete() exportado (helper puro)
├── cli.js                         # interactiveConfig rewire quirúrgico (SETUP-05)
├── cli/
│   └── up.js                      # runUp: rama pre-spawn needsSetup (D-02)
└── cli/dashboard/
    ├── App.js                     # + modo 'setup' en la state-machine (D-04/D-05)
    ├── SessionTable.js            # + renderSetupOverlay (molde renderConfigOverlay)
    └── index.js                   # wiring: needsSetupFn + reuso onSaveConfig/onSaveApiKey
test/
├── config.test.js  / config-env-writer.test.js   # + tests de needsSetup (unit puro)
├── cli/up.test.js                                 # + test de la rama pre-spawn (DI)
└── dashboard/app-setup.test.js  (NUEVO)           # state-machine del modo setup (ink-testing-library)
```

### Pattern 1: Helper puro de detección de first-run (D-01/D-02/D-03, Pitfall 12)
**What:** Una función pura en `config.js` que responde "¿falta configuración?" sin I/O oculto ni caché mentirosa.
**When to use:** Consumida por `runUp` (pre-spawn) y por el wiring del dashboard (render setup).
**Example:**
```javascript
// Source: patrón derivado de config.js:227 (isApiKeyConfigured) + Pitfall 12
// CLAVE (Pitfall 12): existsSync(CONFIG_PATH) directo — NO loadConfig(), que
// devuelve DEFAULT_CONFIG (plane válido) y enmascara la máquina limpia.
export function needsSetup(providerName) {
  if (!existsSync(CONFIG_PATH)) return true;         // no config.json → first-run
  const config = loadConfig();
  const name = providerName || config.provider;
  // D-09: presencia de la key leída del estado actual (process.env que loadEnvFile
  // pobló + writeEnvVar in-proceso actualiza). Ver Pitfall 15 para el matiz cross-proceso.
  if (!isApiKeyConfigured(name)) return true;        // falta API key → setup
  // campos estructurales SOLO relevantes si config existe (D-03 extendido)
  const p = config.providers?.[name];
  if (name === 'plane' && (!p?.base_url || !p?.workspace_slug)) return true;
  return false;
}
```
**Nota:** El nombre exacto (`needsSetup` vs `isConfigComplete`) y la firma DI son discreción del planner; el molde DI es `isReportToProviderEnabled(_loadConfig = loadConfig)` (config.js:254).

### Pattern 2: Rama pre-spawn en `runUp` (D-02)
**What:** Insertar el check ANTES del `ensure-daemon` para no spawnear en first-run.
**When to use:** Punto exacto: entre `const cfg = loadConfigFn()` (up.js:187) y el bloque `ensure-daemon` (up.js:191-202).
**Example:**
```javascript
// Source: up.js:187-215 (insertion point)
const cfg = loadConfigFn();
const port = cfg?.server?.port ?? 9090;
const baseUrl = resolveBaseUrlFn({ loadConfig: loadConfigFn });

// (D-02) NUEVO: first-run → NO spawn del daemon (moriría con teardown(1)).
const setupNeeded = needsSetupFn();          // seam DI, default needsSetup de config.js
if (setupNeeded) {
  // Abre el dashboard en modo setup SIN arrancar el daemon (never-throws, sin exit).
  await runDashboardFn({ url: baseUrl, setup: true });   // flag propaga a App
  return;
}
// ... resto del flujo ensure-daemon → health-wait → attach (sin cambios)
```
**Anti-pattern evitado:** duplicar la lógica de detección en `runUp` y en `App.js` — ambos usan el MISMO `needsSetup()`.

### Pattern 3: Modo `setup` en la state-machine de `App.js` (D-04)
**What:** Un nuevo `mode` con sub-pasos lineales, molde EXACTO de los modos existentes (`config`/`config-edit`, `projects`).
**When to use:** Es el corazón de la fase. La state-machine ya tiene 14 modos (App.js:509); `setup` es el 15º.
**Example (estructura, no literal):**
```javascript
// Source: molde de App.js:945-1104 (config/config-edit) + App.js:587-595 wizard selector
// El useInput mode-gated ya enruta por `if (mode === 'X')`. setup añade:
//   - paso 'provider' : cursor sobre ['plane','github'] (↑/↓ + Enter). github → mensaje D-06.
//   - paso 'base_url'/'workspace_slug' : text-input controlado (buffer/cursor), molde config-edit.
//   - paso 'apikey'   : masked field (maskValue=true), molde Phase 67 (App.js:1029-1057).
// Cada Enter de campo → saveConfig(next) (provider/base_url/slug) o onSaveApiKey (key).
// Al completar → setFocusError(CONFIG_SAVED_RESTART) + aviso honesto (D-08).
```
**Reuso directo (cero reinvención):**
- text-input: `buffer`/`cursor` + inserción en cursor (App.js:1097-1102).
- masked field: `maskValue` + `onSaveApiKey`→`writeEnvVar` (App.js:1029-1057).
- copy literal-estable: constantes exportadas (App.js:239-260); añadir `SETUP_*` siguiendo el patrón.

### Pattern 4: Selector de provider (D-05)
**What:** Lista de 2 opciones (`plane`/`github`) con cursor, escribe `config.provider`.
**When to use:** Primer paso del modo setup.
**Example:**
```javascript
// Source: cli.js:588-595 (wizard readline) — molde de la lista, adaptado a ink useInput
const PROVIDERS = ['plane', 'github'];   // D-01 Phase 26, ya canónico en cli.js:588
// ↑/↓ mueven un cursor clamp-sin-wrap (molde adoptCursor/fieldCursor);
// Enter en 'github' → mensaje "usa kodo config" (D-06), NO continúa el guiado;
// Enter en 'plane' → setByPath(config,'provider','plane') + saveConfig, avanza a base_url.
```

### Pattern 5: Rewire mínimo de `interactiveConfig` (SETUP-05/D-10)
**What:** Garantizar que el wizard headless usa los MISMOS escritores que el dashboard.
**Estado actual (verificado):** `interactiveConfig` YA usa `saveConfig`/`saveProjects` (cli.js:653, 579) y YA NO captura el valor de la key (cli.js:613-620 solo comprueba presencia vía `getProviderApiKey`). El rewire es **casi un no-op de verificación** + posiblemente hacer explícito el import compartido.
**When to use:** Cerrar SETUP-05 formalmente + test que asegure que ningún camino escribe config/secretos fuera de los 3 escritores.
**Anti-pattern evitado:** que el wizard escriba el `.env` directamente o capture el valor de la key con `rl.question` (eco del secreto — Pitfall 11).

### Anti-Patterns to Avoid
- **Detectar first-run con `loadConfig()`:** devuelve DEFAULT_CONFIG (plane válido) → falso negativo en máquina limpia (Pitfall 12). Usar `existsSync(CONFIG_PATH)`.
- **Reusar `writeFileAtomic` para el `.env`:** no hace chmod → secreto 0644 (Pitfall 13). Usar `writeEnvVar` (ya existe).
- **Shell-out para escribir el secreto (`execFile kodo config --api-key …`):** secreto en argv/`ps` (Pitfall 11). Escritura en-proceso vía `writeEnvVar`.
- **`process.exit(1)` en el daemon por falta de config:** launchd crash-loop + first-run roto. El managed mode (Phase 65) ya lanza en vez de salir; NO regresar.
- **Confiar en `process.env` cacheado para confirmar "configurado" tras escribir:** `loadEnvFile` es no-override (Pitfall 15). Ver §Pattern 1 nota + Pitfall 15.
- **Duplicar la lógica de detección** en `runUp` y `App.js`: un solo helper (D-01/D-02).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Escribir la API key a `~/.kodo/.env` | Un writer nuevo con `writeFileSync` | `writeEnvVar` (config.js:359) | Ya hace chmod 0600 pre-rename + parse-merge-write + validación (Phase 67); reinventar reintroduce Pitfalls 13/14 |
| Text-input editable en la TUI | Un input controlado desde cero | `buffer`/`cursor` de App.js (Phase 63) | Inserción-en-cursor, backspace/delete, clamp ya resueltos y testeados |
| Campo enmascarado de secreto | Enmascarado ad-hoc | `maskValue` + render `•`.repeat (SessionTable:342) | Boundary PERSIST-04 ya validado con grep de higiene (Phase 67) |
| Escritura atómica de `config.json` | temp+rename manual | `saveConfig` (config.js:167) | `writeFileAtomic` ya intra-fs no-corruptivo (PERSIST-05) |
| Detección de config completa | Inline en cada consumidor | Helper puro `needsSetup()` compartido | DRY + una sola verdad (D-01/D-02); testeable en aislamiento |
| Presencia de la API key | Leer `process.env` inline | `isApiKeyConfigured` (config.js:227) | Nunca expone el valor (Pitfall 11); ya es el helper canónico |
| Selector de provider | Menú custom | Lista `['plane','github']` (cli.js:588) | Ya es la lista canónica desde Phase 26 |

**Key insight:** Phase 68 es ~90% COMPOSICIÓN de piezas enviadas en Phases 63/65/66/67. El único código genuinamente nuevo es (a) el helper `needsSetup()`, (b) la rama `setup` en la state-machine, y (c) el selector de provider. Todo lo demás es cablear lo existente. La deuda de reinvención es el mayor riesgo — el planner debe forzar reuso explícito de `writeEnvVar`/`saveConfig`/`buffer`/`maskValue`.

## Runtime State Inventory

> Aunque no es un rename, esta fase pivota sobre **estado de runtime** (config en disco + `process.env` cacheado). El inventario es load-bearing por Pitfall 15.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `~/.kodo/config.json` (provider/base_url/workspace_slug), `~/.kodo/.env` (API key, 0600) | Escritura vía `saveConfig`/`writeEnvVar` (ya existen). El setup los CREA en first-run. |
| Live service config | El daemon (server + polling) NO se arranca en first-run (D-02). Tras el setup, el daemon del 2º `kodo up` lee config fresca al import. | Ninguna migración de datos; el aviso de reinicio (D-08) cubre la propagación. |
| OS-registered state | `~/.kodo/kodo.pid` (liveness del daemon). En first-run el daemon no se spawnea → no hay pid. | Ninguna. `brew services` (launchd) está fuera de scope de esta fase. |
| Secrets/env vars | `process.env[api_key_env]` poblado por `loadEnvFile` al import (no-override). `writeEnvVar`+wrapper actualizan `process.env[key]` in-proceso (index.js:296). **Webhook secret `KODO_WEBHOOK_SECRET_PLANE` NO lo toca el setup guiado** (server.js:452). | Ver Open Question 1 (webhook secret gap). D-09 para la lectura fresca de la API key. |
| Build artifacts | Ninguno relevante (fase de comportamiento, no de empaquetado). | Ninguna. |

**El estado de runtime más delicado:** la caché `process.env` que `loadEnvFile` puebla al import con semántica **no-override** (config.js:23-25). Dentro del proceso dashboard, el wrapper `onSaveApiKey` sortea el problema seteando `process.env[key] = value` explícitamente (index.js:296). Cross-proceso (nuevo `kodo up`), en máquina limpia la var está ausente → `loadEnvFile` la puebla fresca → funciona. El no-override solo muerde si la var YA tenía un valor viejo (no ocurre en first-run limpio). Ver Pitfall 15.

## Common Pitfalls

### Pitfall 1 (LOAD-BEARING): El webhook secret mata el daemon aunque el setup esté "completo"
**What goes wrong:** Tras completar el setup guiado (provider/base_url/slug/API key), el operador re-ejecuta `kodo up`. `needsSetup()` devuelve false (config completa) → se spawnea el daemon → `startServer({managed})` lanza `KODO_SETUP_REQUIRED` porque falta el **webhook secret** (`KODO_WEBHOOK_SECRET_PLANE`/`PLANE_WEBHOOK_SECRET`) → `teardown(1)` → daemon muerto → `waitForHealth` falla → dashboard abre contra un server caído.
**Why it happens:** El criterio de first-run (D-03: config.json + API key + campos estructurales) y el criterio que mata al daemon (server.js:459: webhook secret) son **secretos distintos**. El setup guiado no captura el webhook secret.
**How to avoid:** DEBE decidirse en discuss/plan (Open Question 1). Opciones: (a) `KODO_DEV=1`/`--insecure` para la UAT de máquina limpia (el server.js:459 lo permite); (b) incluir el webhook secret en el criterio de first-run y/o en el guiado (aumenta scope); (c) aceptar que "de principio a fin" en máquina limpia real requiere el webhook secret por fuera y documentarlo honestamente. La opción por defecto para el UAT es probablemente (a) o documentar (c) — NO asumir que el 2º arranque simplemente funciona.
**Warning signs:** UAT en máquina limpia: `kodo up` tras setup → dashboard muestra "server caído" en vez de la tabla viva.
**Confidence:** HIGH [VERIFIED: server.js:451-468 + run.js:152-166]

### Pitfall 2 (LOAD-BEARING, Pitfall 12 del research): Detectar first-run con `loadConfig()` da falso negativo
**What goes wrong:** Un check tipo `if (config.providers.plane.base_url)` pasa siempre porque `loadConfig()` devuelve `DEFAULT_CONFIG` (que trae `base_url: 'https://tasks.kintsugi-lab.com'`, `workspace_slug: 'k-lab'`) cuando `config.json` NO existe.
**Why it happens:** `loadConfig` (config.js:157) hace `if (!existsSync(CONFIG_PATH)) return { ...DEFAULT_CONFIG }` — los defaults son indistinguibles de una config Plane real.
**How to avoid:** El helper `needsSetup()` DEBE usar `existsSync(CONFIG_PATH)` directo como primera señal (Pattern 1). Los campos estructurales solo se evalúan si `config.json` existe.
**Warning signs:** `kodo up` en máquina limpia arranca la tabla (o el daemon) en vez del setup.
**Confidence:** HIGH [VERIFIED: config.js:32-67 + 155-164]

### Pitfall 3 (Pitfall 15 del research, D-09): `loadEnvFile` no-override enmascara la key recién escrita
**What goes wrong:** Un daemon/proceso de larga vida tiene `process.env` ya poblado; tras escribir el `.env`, ni re-lee el archivo ni sobrescribe la var ya seteada (`if (!process.env[key])`, config.js:23).
**Why it happens:** `loadEnvFile` es deliberadamente no-override (respeta env vars pre-existentes del shell).
**How to avoid (D-09):** Cualquier confirmación de completitud/"configurado" tras un write debe leer el estado fresco. Dentro del dashboard, el wrapper `onSaveApiKey` ya setea `process.env[key] = value` (index.js:296) → el indicador `[configurado]` (`isApiKeyConfigured`) se refleja al instante. Para el presence-check que decide setup→running, si el planner introduce una re-lectura, debe leer **directo del archivo** (`.env`/`config.json`), NO llamar `loadEnvFile` de nuevo (que no override-aría). En first-run limpio la var está ausente → no hay conflicto; el riesgo es al re-configurar sobre una key vieja.
**Warning signs:** "Entré la key y el indicador sigue en [sin configurar]" / "el daemon usa la key vieja tras cambiarla".
**Confidence:** HIGH [VERIFIED: config.js:12-30 + 227-230, index.js:293-301]

### Pitfall 4 (Pitfall 16 del research): raw-mode/TTY en el attach de `kodo up`
**What goes wrong:** El setup necesita raw-mode (`useInput`/masked field). Si stdin no es TTY (pipe/CI/wrapper), ink lanza "Raw mode is not supported" o el campo no acepta teclas → first-run atascado o crash (viola never-throws).
**Why it happens:** `runDashboard` (index.js:90-93) hace `process.exit(1)` si `!stdout.isTTY || !stdin.isTTY` — ANTES del render. Para el setup esto es un `exit(1)` que tensiona con el literal SC#1 "sin ningún exit(1)".
**How to avoid:** Reusar el gate `isRawModeSupported` (belt-and-suspenders) y la degradación honesta ya presente en Phase 67 (`API_KEY_NO_RAWMODE` = "Usa `kodo config` para editar la API key", App.js:260). El modo setup en non-TTY debe degradar a un mensaje que remita a `kodo config` — never-throws. El planner debe decidir si el `exit(1)` del guard non-TTY de index.js es aceptable para el caso pipe/CI (que NO es el first-run-en-terminal esperado) o si debe convertirse en un mensaje + exit 0 para no violar el literal SC#1. Ver Open Question 2.
**Warning signs:** `kodo up | cat` crashea; el campo enmascarado ignora teclas en algún emulador.
**Confidence:** HIGH [VERIFIED: index.js:88-93, App.js:253-260 + 339-340]

### Pitfall 5 (Pitfall 11 del research): fuga del secreto al tocar el render del setup
**What goes wrong:** El nuevo modo setup pinta el estado de la key; un descuido (loguear el buffer, meter el valor en un snapshot, título de overlay con el valor) lo filtra a scrollback/logs/`/status`.
**Why it happens:** El valor del secreto vive en `buffer` mientras se teclea; cualquier `console.log`/render del valor lo fuga.
**How to avoid:** El valor entra SOLO por el masked field (D-11), se enmascara a `•` en el render (SessionTable:342), y se limpia del buffer al guardar/cancelar (App.js:1043-1044, 1002-1004). Nunca pasar el valor a un logger/evento/argv. El grep de higiene de Phase 67 (`test/...` de los 5 sinks) debe seguir verde tras añadir el modo setup.
**Warning signs:** El valor de la key aparece en `ps`, en `~/.kodo/logs`, en `/status`, o en el scrollback tras Ctrl-C.
**Confidence:** HIGH [VERIFIED: App.js:525-530 + 1029-1057, SessionTable.js:339-350]

### Pitfall 6: El aviso de reinicio debe ser honesto (no auto-restart)
**What goes wrong:** Tentación de auto-reiniciar el daemon tras el setup para lograr "de principio a fin".
**Why it happens:** El goal dice "arranca kodo de principio a fin"; el atajo es orquestar un restart.
**How to avoid (D-08):** SC#4 pesa más: aviso de reinicio honesto, sin hot-reload, coherente con el daemon persistente LOCKED. Reusar el patrón `CONFIG_SAVED_RESTART` (App.js:240). NO orquestar restart del daemon (tensa con el modelo persistente y con Pitfall 1). El operador re-ejecuta `kodo up`.
**Confidence:** HIGH [VERIFIED: CONTEXT D-08 + App.js:240]

## Code Examples

### Render del modo setup (molde de renderConfigOverlay)
```javascript
// Source: SessionTable.js:296-360 (renderConfigOverlay) — molde para renderSetupOverlay
// La rama de dispatch (SessionTable.js:692) añade:
if (mode === 'setup') {
  return renderSetupOverlay(setupStep, provider, buffer, cursor, mask, ...);
}
// El masked field ya deriva '•' por char:
const display = mask ? '•'.repeat(buffer.length) : buffer;   // SessionTable.js:342
```

### Guardar provider + avanzar paso (molde config-edit Enter)
```javascript
// Source: App.js:1074-1086 (config-edit save) — molde para el save del setup
const next = structuredClone(configSnapshot);   // Pitfall 1 de Phase 63: deep-clone
setByPath(next, 'provider', selectedProvider);   // o base_url / workspace_slug
const result = await onSaveConfig(next);         // wrapper never-throws ya cableado (index.js:279)
if (!result || result.ok !== false) {
  setConfigSnapshot(next);
  // avanzar al siguiente paso del setup (lineal, D-04)
}
```

### Guardar la API key enmascarada (reuso literal de Phase 67)
```javascript
// Source: App.js:1029-1057 — el flujo YA existe; el modo setup lo reusa tal cual
const apiKeyEnv = configSnapshot?.providers?.[provider]?.api_key_env;
const result = await onSaveApiKey(apiKeyEnv, buffer);   // → writeEnvVar (0600) + process.env[key]=value
if (!result || result.ok !== false) {
  setBuffer(''); setMaskValue(false);                   // limpia el secreto de memoria (Pitfall 5)
  setFocusError(API_KEY_SAVED_RESTART);                 // aviso honesto (D-08)
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Daemon `process.exit(1)` en misconfig | `throw KODO_SETUP_REQUIRED` bajo managed (server.js:463) | Phase 65 | Precondición: el daemon puede servir sin crashear; el setup mode es posible |
| `kodo up` llama `ensureConfig` (readline) | `kodo up` NO llama `ensureConfig` (deferido a Phase 68) | Phase 66 | El punto de inserción del presence-check pre-spawn está libre (up.js) |
| Sin escritor de `.env` en el código | `writeEnvVar` (0600, atómico, parse-merge) | Phase 67 | La API key se escribe en-proceso, boundary PERSIST-04 cerrado |
| Dashboard solo edita campos DENTRO de un provider | (Phase 68) selector de provider ACTIVO → `config.provider` | esta fase | Capacidad nueva pequeña (D-05) |

**Deprecated/outdated:**
- `getPlaneApiKey()` (config.js:207) está `@deprecated` → usar `getProviderApiKey('plane')`. No introducir nuevos usos.
- `PLANE_WEBHOOK_SECRET` (sin sufijo de provider) está en deprecation warning (server.js:456) → el sufijado `KODO_WEBHOOK_SECRET_PLANE` es el canónico.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | La UAT de máquina limpia usará `KODO_DEV=1`/`--insecure` para sortear el webhook secret, O se documentará el gap honestamente | Pitfall 1 / Open Q1 | Si se espera "de principio a fin" SIN webhook secret, el 2º `kodo up` sirve un dashboard contra daemon muerto → UAT falla |
| A2 | El nombre/firma del helper (`needsSetup` vs `isConfigComplete`) es discreción del planner | Pattern 1 | Bajo — es naming; el contrato (existsSync + API key + estructurales) es lo load-bearing |
| A3 | El flag de propagación setup (`runDashboard({setup:true})`) es el mecanismo de cableado; alternativa es que App compute `needsSetup` por sí mismo vía prop `needsSetupFn` | Pattern 2/3 | Bajo — ambas rutas válidas; D-01 dice que la decisión de render vive local en App, así que `needsSetupFn` como prop es la más coherente con D-01 |
| A4 | El wizard `interactiveConfig` YA cumple SETUP-05 casi por completo (usa saveConfig/saveProjects, no captura valor de key) | Pattern 5 | Bajo — verificado en cli.js:579/613-620/653; el trabajo es de verificación + test, no de refactor grande |
| A5 | El modo setup es non-TTY-degradable reusando `isRawModeSupported` + `API_KEY_NO_RAWMODE`; el `exit(1)` del guard non-TTY de index.js aplica solo a pipe/CI (no al first-run-en-terminal) | Pitfall 4 / Open Q2 | Medio — si SC#1 "sin ningún exit(1)" se interpreta literal incluso para pipe/CI, hay que convertir el guard en mensaje+exit 0 |

## Open Questions

> **Estado 2026-07-02 — RESUELTAS:** Q1 y Q2 fueron decididas por el operador durante planning y quedan LOCKED en `68-CONTEXT.md` (**D-12** cierra Q1: webhook secret FUERA del guiado, UAT limpia con `KODO_DEV=1`; **D-13** cierra Q2: "sin exit(1)" aplica a terminal real, non-TTY degrada a `kodo config`). Q3 resuelta: se generó `68-UI-SPEC.md` (aprobado 6/6 dimensiones). Las resoluciones están propagadas a los `68-*-PLAN.md`.

1. **[ALTA PRIORIDAD — ✅ RESUELTA por D-12] El webhook secret mata el daemon tras el setup — ¿cómo se cierra "de principio a fin"?**
   - What we know: `KODO_SETUP_REQUIRED` se lanza por webhook secret ausente (server.js:459-464), NO por la API key. El setup guiado no lo captura. En máquina limpia, el 2º `kodo up` spawnea un daemon que muere con `teardown(1)`.
   - What's unclear: si el GATE MANUAL de UAT espera la tabla viva tras el setup, o solo verifica "setup mode sin exit(1)" + "transición honesta". El goal dice "arranca kodo de principio a fin".
   - Recommendation: Resolver en discuss/plan ANTES de ejecutar. Opción por defecto: la UAT de máquina limpia usa `KODO_DEV=1` (o `--insecure`) para el webhook, y se documenta que el webhook secret real es configuración por fuera del guiado (coherente con D-06 que ya deja GitHub fuera). Alternativa mayor: extender el criterio/guiado al webhook secret (aumenta scope; probablemente NO para esta fase). NO planificar la ruta feliz asumiendo que el daemon arranca solo.

2. **[MEDIA] Non-TTY en el attach de `kodo up`: ¿el `exit(1)` del guard viola SC#1?**
   - What we know: `runDashboard` hace `process.exit(1)` en non-TTY (index.js:90-93). SC#1 dice "sin ningún exit(1)".
   - What's unclear: si "sin ningún exit(1)" se aplica solo al camino normal (terminal real) o también al degradado pipe/CI.
   - Recommendation: Interpretar SC#1 como "el first-run en terminal real nunca sale con exit(1)"; el degradado non-TTY (pipe) puede mostrar un mensaje que remita a `kodo config`. Si se quiere estricto, convertir el guard non-TTY en mensaje a stderr + `process.exitCode = 0`. Reusar `isRawModeSupported` + `API_KEY_NO_RAWMODE` para el degradado dentro del render.

3. **[BAJA] ¿Se necesita un UI-SPEC para la pantalla guiada?**
   - What we know: Hay una observación de memoria "Phase 68 blocked by missing UI specification". El proyecto tiene el skill `gsd-ui-phase`. La copy del dashboard sigue el patrón de constantes literal-estables exportadas (App.js:239-260).
   - What's unclear: si el planner requiere un UI-SPEC formal antes de PLAN.md o si el patrón de copy + el molde de `renderConfigOverlay` bastan.
   - Recommendation: El patrón establecido (copy `SETUP_*` exportada + molde `renderConfigOverlay`) es suficiente para planificar. Si el orquestador exige UI-SPEC, generarlo con `gsd-ui-phase` cubriendo: los 4 pasos lineales, el copy de cada paso, el estado de "configurado" de la key, el aviso de reinicio, y la degradación non-TTY.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Todo el runtime + tests | ✓ | v22.22.3 | — |
| `node:test` runner | Suite de tests (`node --test`) | ✓ | built-in | — |
| `ink` / `react` / `ink-testing-library` | Dashboard + tests de App | ✓ | ya en package.json | — |
| Terminal TTY (raw-mode) | Render del setup interactivo | ✓ (en terminal real) | — | non-TTY → degradar a `kodo config` (Pitfall 4) |

**Missing dependencies with no fallback:** ninguna.
**Missing dependencies with fallback:** non-TTY (pipe/CI) → degradación honesta a `kodo config` (never-throws).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in, Node 22.22.3) + `ink-testing-library` para App |
| Config file | none — `package.json` `scripts.test: "node --test $(find test -name '*.test.js' -type f)"` |
| Quick run command | `node --test test/config.test.js test/cli/up.test.js` (los módulos tocados) |
| Full suite command | `npm test` (88 archivos `.test.js`) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SETUP-01 | `needsSetup()` true si falta config.json | unit (puro) | `node --test test/config.test.js` | ❌ Wave 0 (extender) |
| SETUP-01 | `needsSetup()` true si falta API key (config existe) | unit (puro) | `node --test test/config.test.js` | ❌ Wave 0 |
| SETUP-01 | `needsSetup()` false con config completa | unit (puro) | `node --test test/config.test.js` | ❌ Wave 0 |
| SETUP-01 | `needsSetup()` NO da falso negativo con DEFAULT_CONFIG (Pitfall 12) | unit (puro, held-out) | `node --test test/config.test.js` | ❌ Wave 0 |
| SETUP-01 | `runUp` NO spawnea daemon si `needsSetup` (D-02) | unit (DI) | `node --test test/cli/up.test.js` | ❌ Wave 0 (extender makeDeps con `_needsSetup`) |
| SETUP-01 | `runUp` abre dashboard en modo setup sin `exit(1)` | unit (DI) | `node --test test/cli/up.test.js` | ❌ Wave 0 |
| SETUP-02 | Modo setup: selector de provider → `config.provider` (saveConfig) | integration (ink-testing-library) | `node --test test/dashboard/app-setup.test.js` | ❌ Wave 0 (nuevo) |
| SETUP-02 | Modo setup: base_url/workspace_slug → saveConfig | integration | `node --test test/dashboard/app-setup.test.js` | ❌ Wave 0 |
| SETUP-02 | Modo setup: API key enmascarada → onSaveApiKey (`•` en render) | integration | `node --test test/dashboard/app-setup.test.js` | ❌ Wave 0 |
| SETUP-02 | Aviso de reinicio honesto tras completar (D-08) | integration | `node --test test/dashboard/app-setup.test.js` | ❌ Wave 0 |
| SETUP-02 | Non-TTY: degrada a `kodo config`, never-throws (Pitfall 4) | integration | `node --test test/dashboard/app-setup.test.js` | ❌ Wave 0 |
| SETUP-05 | Wizard `kodo config` usa saveConfig/saveProjects/writeEnvVar (únicos escritores) | unit (source-hygiene/DI) | `node --test test/...` | ❌ Wave 0 |
| PERSIST-04 | El valor de la key nunca alcanza los 5 sinks tras añadir modo setup | held-out (grep de higiene) | `node --test test/config-env-writer.test.js` (o el de higiene de Phase 67) | ✅ existe (re-verificar) |

### Sampling Rate
- **Per task commit:** `node --test` sobre el/los archivo(s) tocados (config.test.js / up.test.js / app-setup.test.js).
- **Per wave merge:** `npm test` completo (88 archivos).
- **Phase gate:** suite verde + **GATE MANUAL** UAT en máquina limpia (sin config.json ni .env) antes de `/gsd-verify-work`.

### Sampling justification (Nyquist)
- **Unit-testable (frecuencia alta, held-out donde aplica):** `needsSetup()` (todas las combinaciones config.json/API key/estructurales, incluido el held-out anti-falso-negativo Pitfall 12); rama pre-spawn de `runUp` (DI, sin procesos); state-machine del modo setup (ink-testing-library, stdin.write→lastFrame como en app-dismiss.test.js).
- **Property/held-out:** el anti-falso-negativo de Pitfall 12 (DEFAULT_CONFIG no debe leerse como config real) y el grep de higiene PERSIST-04 (el valor del secreto no alcanza los sinks) son held-out: verifican una propiedad invariante, no un caso feliz.
- **NO unit-testable → GATE MANUAL:** el ciclo real "máquina limpia → `kodo up` → setup mode → guardar → reiniciar → arranque" (incluido el webhook secret de Pitfall 1) requiere UAT humano en máquina/HOME limpio. Es la razón del GATE MANUAL LOCKED del roadmap.

### Wave 0 Gaps
- [ ] `test/config.test.js` — extender con casos de `needsSetup()` (incl. held-out Pitfall 12) — cubre SETUP-01
- [ ] `test/cli/up.test.js` — extender `makeDeps` con seam `_needsSetup`/`_runDashboard({setup})` — cubre SETUP-01/D-02
- [ ] `test/dashboard/app-setup.test.js` (NUEVO) — state-machine del modo setup, molde de `app-dismiss.test.js` (render + stdin.write + lastFrame) — cubre SETUP-02
- [ ] Test de source-hygiene/DI para SETUP-05 (escritores únicos) — puede extender un test existente de config
- [ ] Re-verificar el grep de higiene PERSIST-04 de Phase 67 sigue verde tras el modo setup

## Security Domain

> `security_enforcement` no está desactivado en config.json → aplica. El boundary PERSIST-04 es el eje de seguridad de esta fase.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No hay auth de usuarios; la "API key" es credencial de provider, cubierta por V6 |
| V3 Session Management | no | — |
| V4 Access Control | parcial | Permisos de archivo: `~/.kodo/.env` 0600, `~/.kodo` 0700 (writeEnvVar ya los garantiza) |
| V5 Input Validation | yes | `validateEnvKey`/`validateEnvValue` (config.js:304/319) rechazan `#`/`=`/whitespace (Pitfall 14). El text-input del setup NO compila regex desde input (anti-ReDoS, ya invariante) |
| V6 Cryptography / Secrets | yes | El valor de la API key vive SOLO en `~/.kodo/.env` (0600), nunca renderizado/logueado/en config.json/`/status`/argv (PERSIST-04, Pitfall 11). Escritura en-proceso vía `writeEnvVar`, jamás shell-out |

### Known Threat Patterns for kodo (TUI + secretos locales)

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Fuga de la API key a scrollback/logs/`/status`/argv al tocar el render del setup | Information Disclosure | Masked field (`•`), buffer limpiado al guardar/cancelar, valor solo a `writeEnvVar`, grep de higiene held-out (Pitfall 5/11) |
| `.env` world-readable (0644) o `.env.tmp` con secreto en claro | Information Disclosure | `writeEnvVar` chmod 0600 pre-rename (ya enviado, Pitfall 13) — NO reusar `writeFileAtomic` |
| Inyección de línea en `.env` vía valor con `\n`/`=`/`#` (clobbea otras keys) | Tampering | `validateEnvValue` rechaza (Pitfall 14, ya enviado) |
| Regex-injection/ReDoS desde el text-input del setup | Denial of Service | Substring puro (`String.includes`), nunca compilar patrón desde input (invariante del dashboard) |
| Daemon crash-loop / DoS de arranque por misconfig | Denial of Service | Managed mode NO `process.exit` (Phase 65); never-throws / fail-open en `runUp` y el modo setup |

## Sources

### Primary (HIGH confidence)
- `src/config.js` (leído completo) — `loadConfig`/DEFAULT_CONFIG, `saveConfig`/`saveProjects`, `writeEnvVar`, `isApiKeyConfigured`/`getProviderApiKey`, `loadEnvFile` (no-override), `validateEnvKey`/`validateEnvValue`, `CONFIG_PATH`/`ENV_PATH`
- `src/cli/up.js` (leído completo) — `runUp` (punto de inserción pre-spawn D-02), seams DI
- `src/daemon/run.js` (leído completo) — `catch (KODO_SETUP_REQUIRED)` → `teardown(1)`
- `src/server.js:440-480` — throw de `KODO_SETUP_REQUIRED` por **webhook secret** ausente (hallazgo crítico Pitfall 1)
- `src/cli/dashboard/App.js` (leído 1-1718) — state-machine, modos config/config-edit/projects, masked field (Phase 67), copy literal-estable
- `src/cli/dashboard/index.js` (leído completo) — wiring de `onSaveConfig`/`onSaveApiKey`/`isApiKeyConfiguredFn`, guard non-TTY
- `src/cli/dashboard/SessionTable.js:44-360, 667-713` (grep) — `renderConfigOverlay`, render enmascarado, dispatch por modo
- `src/cli.js:550-749` — `ensureConfig`/`interactiveConfig` (wizard readline, estado de SETUP-05)
- `.planning/research/PITFALLS.md` — P11 (fuga secreto), P12 (chicken-and-egg first-run), P13 (chmod 0600), P14 (formato .env), P15 (no-override), P16 (raw-mode/TTY)
- `.planning/phases/68-.../68-CONTEXT.md` — D-01..D-11
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md` — SETUP-01/02/05, invariantes LOCKED
- `test/cli/up.test.js`, `test/dashboard/app-dismiss.test.js`, `package.json` — patrones de test (DI + ink-testing-library)

### Secondary (MEDIUM confidence)
- Observaciones de memoria de sesión (claude-mem): "Phase 68 blocked by missing UI specification" (24626), historia de Phases 63/65/66/67

### Tertiary (LOW confidence)
- Ninguna — toda la investigación se fundamentó en código verificado en sesión.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — cero deps nuevas, todo verificado en package.json + código.
- Architecture: HIGH — el patrón de state-machine está probado 5 veces en App.js; el modo setup es un molde directo.
- Pitfalls: HIGH — los 6 pitfalls se verificaron contra líneas de código concretas; el webhook-secret gap (Pitfall 1) es un hallazgo empírico de server.js.
- Open Question 1 (webhook secret): la EXISTENCIA del gap es HIGH; la RESOLUCIÓN preferida es una decisión de producto (discuss/plan).

**Research date:** 2026-07-02
**Valid until:** 2026-08-01 (30 días — código base estable; re-verificar si Phases 65-67 se modifican antes de planificar)
</content>
</invoke>
