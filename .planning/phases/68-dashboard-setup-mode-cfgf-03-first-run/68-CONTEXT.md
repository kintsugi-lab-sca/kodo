# Phase 68: Dashboard Setup Mode + CFGF-03 + First-Run - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning
**Mode:** interactivo (decisiones seleccionadas por el operador; todas alinean con la opción recomendada por research/SC)

<domain>
## Phase Boundary

Cerrar el onboarding **dashboard-first** (Pilar 2b) y el milestone v0.15: el **primer arranque sin configuración** entra al dashboard en **modo setup** (pantalla guiada) en lugar de salir con `exit 1`, el operador edita `provider` activo / `base_url` / `workspace_slug` (+ la key enmascarada de Phase 67) → `~/.kodo/config.json`, y `kodo config` comparte la **misma fontanería de escritura** que el dashboard.

**En alcance (SETUP-01, SETUP-02, SETUP-05):**
- Detección de first-run: config incompleta (no existe `config.json` **O** falta la API key del provider activo **O** faltan campos estructurales del provider) → el dashboard sirve el modo setup **sin ningún `exit(1)`**.
- Pantalla de setup guiada, lineal, en el dashboard: selector de `provider` activo + `base_url` + `workspace_slug` + campo enmascarado de la key (reusando 63/67), persistiendo a `config.json` (`saveConfig`) y `.env` (`writeEnvVar`).
- Transición setup→running con **aviso de reinicio honesto** (sin hot-reload), leyendo el valor recién escrito directo del archivo (Pitfall 15).
- `kodo config` (wizard readline) rewired para compartir los escritores (`saveConfig`/`saveProjects`/`writeEnvVar`) — camino headless y TUI no divergen.

**Fuera de alcance:**
- Cobertura de **GitHub** en la pantalla guiada (forma `repos[]`) — se configura por `kodo config` headless. La pantalla guiada cubre **solo Plane**.
- Invocación manual del setup guiado post-first-run — solo aparece **auto** en first-run; los cambios posteriores usan el editor de config existente (63/64).
- Captura del **valor** de la key en el wizard readline (eco del secreto) — la key se introduce solo por el campo enmascarado del dashboard.
- Auto-restart del daemon tras el setup — se difiere a hot-reload (CFGF-01, futuro). Aquí solo aviso.
- Hot-reload de config (CFGF-01), rediseño no-lineal de `kodo config` (CFGF-02) → futuros milestones.

</domain>

<decisions>
## Implementation Decisions

### Detección de first-run (SETUP-01)
- **D-01:** La detección vive **LOCAL en el dashboard** (presence-check con `loadConfig` + `getProviderApiKey` + campos estructurales del provider activo). El dashboard decide render **setup vs tabla** en el arranque. Coherente con que el dashboard ya lee config local (Phase 63/64/67) y con el invariante **cero endpoints nuevos**.
- **D-02:** `kodo up` detecta config incompleta **ANTES del spawn** y **NO arranca el daemon** en first-run (evita enganchar el dashboard a un server muerto: hoy el daemon hace `teardown(1)` tras `KODO_SETUP_REQUIRED`, Phase 65 / `daemon/run.js:156-165`). El dashboard se abre igualmente y entra en modo setup.
- **D-03:** Criterio de "config incompleta" fijado por SETUP-01: **no existe `config.json` O falta la API key** del provider activo. Se extiende a "faltan campos estructurales del provider" (base_url/workspace_slug para Plane) para que el guiado sepa qué pedir. NO se usa el criterio laxo "solo no-config.json".

### UX de la pantalla de setup (SETUP-02)
- **D-04:** **Pantalla guiada dedicada** (nuevo modo `setup` del dashboard), **lineal step-by-step**: `provider` → `base_url` → `workspace_slug` → API key enmascarada. Reusa los componentes text-input controlado (Phase 63) y masked field + `onSaveApiKey`→`writeEnvVar` (Phase 67). Cumple el literal "pantalla guiada" del SC#1 y da onboarding claro en máquina limpia. NO se reusa el overlay config-edit como checklist.
- **D-05:** **Selector de `provider` activo** en la pantalla guiada (plane/github) → escrito a `config.provider` vía `saveConfig`. Campo nuevo pequeño (satisface el literal de SETUP-02 "edita el provider activo"; hoy el dashboard solo edita campos DENTRO de un provider, no cuál está activo).
- **D-06:** La pantalla guiada cubre **solo Plane** (provider/base_url/workspace_slug + key). Si el operador elige **GitHub** en el selector, se le **remite a `kodo config`** headless (que ya maneja la forma `repos[]`/`poll_interval`). Minimiza scope/superficie de test en la TUI; GitHub sigue plenamente configurable.
- **D-07:** El setup guiado aparece **solo auto en first-run** (config incompleta). Una vez configurado, los cambios se hacen con el editor de config existente (overlay Phase 63/64) + campo enmascarado (Phase 67). Un solo propósito claro, menos superficie.

### Transición setup→running (SETUP-02 SC#4, Pitfall 15)
- **D-08:** **Aviso de reinicio honesto**, sin auto-restart: al completar el setup el dashboard muestra "config guardada — reinicia kodo (`kodo up`) para aplicar". Es el literal del SC#4 ("aviso de reinicio honesto, sin hot-reload, coherente con v0.14"). Simple, never-throws, sin orquestar restart del daemon ni tensar con el modelo daemon persistente LOCKED. El operador re-ejecuta `kodo up`, que ahora encuentra config completa y arranca normal (D-02 se auto-resuelve en el 2º arranque). **[Aclarado 2026-07-02 — ver D-12]:** en máquina limpia real el 2º `kodo up` aún requiere el **webhook secret** (`KODO_WEBHOOK_SECRET_PLANE`) para que el daemon no muera con `KODO_SETUP_REQUIRED` (server.js:464); el "arranca normal" asume ese secreto presente o `KODO_DEV=1`/`--insecure`.
- **D-09 (Pitfall 15 — LOAD-BEARING):** Cualquier confirmación de "configurado"/completitud tras escribir debe **leer el valor recién escrito DIRECTO del archivo**, NO vía `loadEnvFile`/`process.env` cacheado (el parser hace load no-override → el valor viejo/ausente en memoria enmascararía el nuevo). Aplica al presence-check de la key y al render del estado de completitud.

### Alcance del rewire de `kodo config` (SETUP-05)
- **D-10:** Rewire **mínimo / quirúrgico**: `saveConfig`/`saveProjects`/`writeEnvVar` como **únicos escritores** compartidos por ambos caminos. El wizard readline **NO** captura el valor de la key (evita eco del secreto en terminal — vector de fuga PERSIST-04/Pitfall 11); sigue comprobando **presencia** como hoy (`cli.js:613-620`). SETUP-05 se satisface porque `saveConfig`/`saveProjects` ya son compartidos y CUALQUIER escritura de key (dashboard) pasa por `writeEnvVar`. **CFGF-02 (rediseño no-lineal del wizard) queda diferido.**
- **D-11:** La entrada del **valor** de la key es exclusiva del **campo enmascarado del dashboard** (Phase 67). Los dos caminos no divergen en el escritor (writeEnvVar), solo en si capturan o no el valor.

### Resolución de Open Questions del research (2026-07-02 — decididas por el operador)
- **D-12 (webhook secret — SETUP-01, cierra Open Q1 del research):** El `KODO_SETUP_REQUIRED` que mata al daemon se lanza por el **webhook secret** ausente (`KODO_WEBHOOK_SECRET_PLANE`, `server.js:464`), un secreto **distinto** de la API key. **Decisión: el setup guiado cubre SOLO `provider`/`base_url`/`workspace_slug` + API key** (scope SETUP-01/02). El webhook secret queda **FUERA del guiado** (se configura por fuera, coherente con D-06 que ya deja GitHub fuera); `needsSetup()` **NO** lo incluye. El aviso de reinicio (D-08) lo documenta honestamente. La **UAT en máquina limpia usa `KODO_DEV=1`/`--insecure`** para verificar el ciclo completo setup→running (el daemon no muere). **NO planificar la ruta feliz asumiendo que el daemon arranca solo sin webhook secret.**
- **D-13 (non-TTY — SETUP-01, cierra Open Q2 del research):** El literal "sin ningún `exit(1)`" del SC#1 aplica al first-run en **terminal real**. En **non-TTY (pipe/CI)** el setup **degrada a un mensaje** que remite a `kodo config` (never-throws en el render, reusando `isRawModeSupported` / `API_KEY_NO_RAWMODE` de Phase 67). **NO** se convierte el guard non-TTY de `index.js:90-93` (se mantiene tal cual — menos superficie/riesgo).

### Claude's Discretion (durante research/planning)
- Cómo se materializa el "modo setup" en `App.js` (nuevo estado de modo vs rama de render en el arranque) — respetando D-01/D-04.
- Mecánica exacta del selector de provider (lista simple 2-opciones estilo el wizard `cli.js:588-595`).
- Manejo **non-TTY** del setup en el attach de `kodo up` (pipe/wrapper): degradar con aviso a `kodo config` — **never-throws**, reusando el gate `isRawModeSupported` ya presente (Phase 67 D-07). No colgar el first-run.
- Punto exacto donde `kodo up` hace el presence-check pre-spawn (D-02) sin duplicar la lógica del dashboard (candidato a helper puro compartido).
- Detalle de la lectura directa del archivo para D-09 (re-leer `.env`/`config.json` vs helper específico).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisito y trazabilidad
- `.planning/ROADMAP.md` — Phase 68 (Goal, 4 Success Criteria, SETUP-01/02/05, **GATE MANUAL**: UAT en máquina limpia sin `config.json` ni `.env`; evita Pitfalls 12, 15, 16).
- `.planning/REQUIREMENTS.md` §SETUP-01/02/05 + Out of Scope (round-trip del valor viola PERSIST-04; `saveConfig`/`saveProjects`/`writeEnvVar` únicos escritores; semántica compose-style prohibida).

### Research del milestone (cubre esta fase — leer)
- `.planning/research/SUMMARY.md` — estructura de 4 fases; setup mode como cierre de Pilar 2; transición setup→running (Pitfall 15).
- `.planning/research/PITFALLS.md` — **P12** (setup mode / first-run), **P15** (transición setup→running: leer el valor recién escrito directo del archivo, no vía `loadEnvFile` no-override — LOAD-BEARING), **P16** (raw-mode/TTY en el attach de `kodo up`), **P11** (5 vectores de fuga del key — vigente al tocar el render del setup).
- `.planning/research/ARCHITECTURE.md` — fontanería de escritores en `config.js`; el dashboard como superficie de config local.

### Contexto de fases previas (dependencias directas — leer)
- `.planning/phases/67-secrets-writer-masked-input/67-CONTEXT.md` — `writeEnvVar` + campo enmascarado + `onSaveApiKey` DI + boundary PERSIST-04 (Phase 68 los CONSUME).
- `.planning/phases/65-daemon-lifecycle-foundation/` — managed mode sin `process.exit` + `KODO_SETUP_REQUIRED` (habilita servir el setup sin crash).

### Activos de código a reusar (verificados en scout 2026-07-02)
- `src/cli/up.js:151-220` — `runUp`: orden guard-win32 → loadConfig → ensure-daemon (spawn) → health-wait → attach. **Punto de inserción del presence-check pre-spawn (D-02).** Hoy NO llama `ensureConfig` (deferido a Phase 68 a propósito, `cli.js:77`).
- `src/daemon/run.js:152-166` — el `catch (KODO_SETUP_REQUIRED)` que hace `teardown(1)` (por qué el daemon muere en first-run → justifica D-02).
- `src/server.js:396,464` — dónde se lanza `KODO_SETUP_REQUIRED` bajo managed (missing secret).
- `src/config.js` — `loadEnvFile` (parser, load **no-override** — clave para Pitfall 15/D-09), `saveConfig`/`saveProjects` (escritores), `writeEnvVar` (Phase 67), `getProviderApiKey` (`:195`, presence-check), `CONFIG_PATH`/`ENV_PATH`, export barrel (`:263`).
- `src/cli.js:561-574` `ensureConfig` + `:576-680+` `interactiveConfig` (wizard readline) — dónde vive el rewire mínimo de SETUP-05 (D-10); `:613-620` la comprobación de presencia (NO escribe la key — se mantiene).
- `src/cli/dashboard/App.js` — modo `config-edit` (Phase 63), gate `useStdin().isRawModeSupported`/`useInput`, buffer/cursor del text-input, masked field (Phase 67). Punto de inserción del **modo setup** (D-04) y el **selector de provider** (D-05).
- `src/cli/dashboard/SessionTable.js` — consumidor del render del text-input/masked field.

### Convenciones e invariantes
- `.planning/codebase/CONVENTIONS.md`, `.planning/codebase/ARCHITECTURE.md` — never-throws TUI, DI puro, "una fontanería, varios consumidores", color isolation, source-hygiene tests, escritura atómica no-corruptiva.
- STATE.md §"Critical Invariants to Preserve" — daemon persistente LOCKED, `kodo start` legacy intacto, boundary PERSIST-04, cero endpoints nuevos, cero deps npm nuevas.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- Text-input controlado `buffer`/`cursor` + masked field `onSaveApiKey`→`writeEnvVar` (Phase 63/67, `App.js`): base directa de la pantalla guiada.
- Selector estilo lista del wizard (`cli.js:588-595`): molde para el selector de `provider` en la TUI (D-05).
- `getProviderApiKey`/`loadEnvFile`/`loadConfig` (`config.js`): base del presence-check de first-run (D-01) — con la salvedad de D-09 (leer directo del archivo tras escribir).
- `runUp` (`up.js`): orquestador donde se inserta el presence-check pre-spawn (D-02).
- Aviso de reinicio de v0.14 (patrón de mensaje sin hot-reload): reusado para la transición setup→running (D-08).

### Established Patterns
- never-throws / fail-open en la TUI; gate raw-mode `isRawModeSupported` como belt-and-suspenders (para non-TTY en el attach de `kodo up`).
- "una fontanería, varios consumidores": `saveConfig`/`saveProjects`/`writeEnvVar` únicos escritores (SETUP-05).
- Cero endpoints nuevos: la config vive local en `~/.kodo/`, el dashboard la escribe local (no `POST` a `server.js`).
- Managed mode sin `process.exit` (Phase 65): precondición para servir el setup sin crash.

### Integration Points
- Nuevo modo `setup` en `App.js` (render setup vs tabla según presence-check local, D-01/D-04).
- Selector de provider + campos base_url/workspace_slug + masked key en la pantalla guiada → `saveConfig` + `writeEnvVar`.
- Presence-check pre-spawn en `runUp` (D-02) — evita spawn del daemon en first-run.
- Rewire mínimo de `kodo config` para compartir escritores (D-10) sin capturar el valor de la key.

</code_context>

<specifics>
## Specific Ideas

- El **chicken-and-egg** del first-run está ya resuelto por Phase 65 (managed sin `exit(1)`) — pero el daemon aún **muere** con `teardown(1)` al faltar config; por eso el setup NO se sirve por HTTP, se resuelve **local** en el dashboard (D-01) y `kodo up` **no spawnea** en first-run (D-02).
- El pitfall **LOAD-BEARING** de esta fase es **P15**: tras escribir la key/config, confirmar leyendo **directo del archivo** — `loadEnvFile` hace load no-override y el valor cacheado mentiría (D-09).
- La honestidad del SC#4 pesa más que "arranca de punta a punta en un flujo": se elige **aviso de reinicio** (D-08), no auto-restart — coherente con "sin hot-reload" y el daemon persistente.
- El vector de fuga del secreto (P11) sigue vigente al tocar el render del setup: la key NUNCA en snapshot/scrollback/argv; entrada solo por el campo enmascarado (D-11).
- **GATE MANUAL OBLIGATORIO**: UAT en **máquina limpia** (sin `config.json` ni `.env`) — verificar que `kodo up` sirve el setup mode sin ningún `exit(1)` y que la transición es honesta. Es la fase de mayor complejidad de UX del milestone.

</specifics>

<deferred>
## Deferred Ideas

- **Cobertura de GitHub en la pantalla guiada** (forma `repos[]`/`poll_interval`) — se deja a `kodo config` headless; el guiado cubre solo Plane (D-06). Si se quiere GitHub en la TUI, su propia mini-fase futura.
- **Invocación manual del setup guiado post-first-run** (tecla que relanza el wizard) — deferido; los cambios posteriores usan el editor de config existente (D-07).
- **Captura del valor de la key en el wizard readline** — deferido por el eco del secreto en terminal (tensiona con PERSIST-04); la key entra solo por el dashboard enmascarado (D-10/D-11).
- **Auto-restart del daemon tras el setup** — deferido; converge con hot-reload (CFGF-01) en un futuro milestone.
- **Hot-reload de config (CFGF-01)** y **rediseño no-lineal de `kodo config` (CFGF-02)** → futuros milestones (ya en REQUIREMENTS §Future).

None adicional — la discusión se mantuvo dentro del scope de la fase.

</deferred>

---

*Phase: 68-dashboard-setup-mode-cfgf-03-first-run*
*Context gathered: 2026-07-02*
