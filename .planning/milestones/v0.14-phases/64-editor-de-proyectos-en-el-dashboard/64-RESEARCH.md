# Phase 64: Editor de proyectos en el dashboard - Research

**Researched:** 2026-06-29
**Domain:** TUI ink — fuente de datos ASYNC con guard de request-token (`listProjects()` de red) + sub-máquina de modos + degradación never-throws de un rechazo async dentro de ink + preservación de la forma dual de `projects.json`
**Confidence:** HIGH (todo verificado contra el código real del repo; cero conocimiento de training en las afirmaciones centrales)

<user_constraints>
## User Constraints (from CONTEXT.md)

> La fundación de Phase 63 (D-01..D-12 de `63-CONTEXT.md`) se da por **heredada y vigente**. Aquí se investiga lo NUEVO de Phase 64.

### Locked Decisions

- **D-01:** Fetch async espejando el patrón `deriving` (Phase 62). Tecla de apertura desde `mode:'list'` → `mode:'projects-loading'`, dispara `listProjects()` (DI `listProjectsFn`) con **guarda de request-token** (molde `overlayReqRef`). Éxito → snapshot **congelado** `{ remoteProjects, projectsMap = loadProjects() }` + `mode:'projects'`. Fallo → `mode:'projects-error'` (PROJ-05). El poll `/status` sigue por debajo sin tocar el overlay.
- **D-02:** Modos nuevos espejo de Phase 63: `mode:'projects'` (lista navegable con estado de mapeo `[ruta]`/`sin mapear`) y `mode:'projects-edit'` (text-input de Phase 63 para la ruta), más transitorios `projects-loading` y `projects-error`. Gateados en `useInput` **antes** del mode-gate de filtro, exactamente como `config`/`config-edit`.
- **D-03:** Navegación **two-level + acciones por tecla** (NO un tercer menú): en `projects` ↑/↓ mueven cursor (clamp sin wrap), `Enter` → `projects-edit` precargando la ruta actual, una tecla **quita el mapeo** (PROJ-03), una tecla **abre módulos** (PROJ-04), `Esc` cierra preservando `selectedTaskId`. En `projects-edit`: edición; `Enter` valida (ruta debe existir) y guarda; inválido → footer rojo + NO escribe; `Esc` cancela sin guardar.
- **D-04:** Reusar validadores puros de Phase 63 añadiendo un validador de **ruta-directorio que debe existir** (`existsSync` + `statSync().isDirectory()`), contrato `{ok:true,value}|{ok:false,error}`, never-throws. Corre **antes** de `saveProjects`. *Concesión consciente:* este validador toca el FS — el planner decide si va en `config-validate.js` o en un módulo adyacente (`path-validate.js`) — **discreción**.
- **D-05:** Soporte **mínimo** de módulos, espejo del wizard (`cli.js:700-740`). Tecla de módulos → `projects-modules-loading` → `listModules(projectId)` (async, DI `listModulesFn`, mismo guard de token) → `projects-modules`, reusando el mismo text-input + validador de ruta. Persiste como `{ default, modules: { [nombreMódulo]: ruta } }`. Provider sin `listModules` (GitHub) → footer informativo, no-op, never-throws.
- **D-06:** Preservar la **forma dual** de `projects.json`: `string` **o** `{ default, modules }`. Editar la ruta de una entrada-objeto **preserva `modules`** (solo cambia `default`). Quitar = `delete projects[id]` + `saveProjects`. Guardar usa `saveProjects` (ya atómico) + footer transitorio de aviso de reinicio.
- **D-07:** `mode:'projects-error'`: panel/footer rojo; `r` reintenta (re-dispara D-01), `Esc` sale a `mode:'list'`. Never-throws, `projects.json` intacto (el carril de fallo es de **lectura** remota — no se escribe nada). El snapshot local (`loadProjects`, 100% local) PUEDE mostrarse aunque la lista remota falle (degradación parcial) — **discreción** del planner si lo implementa en v1.
- **D-08 (PERSIST-02):** Persistencia **directa al filesystem** importando `saveProjects`/`loadProjects` — NO shell-out, NO endpoint. `index.js` inyecta `listProjectsFn`/`listModulesFn`/`loadProjectsFn`/`saveProjectsFn` en `App`, espejo de `loadConfigFn`/`onSaveConfig`/`projects`/`onAdopt`.
- **D-09:** Never-throws/fail-open en todos los carriles; color-isolation (todo color vía props de `<Text>`); no-JSX/no-build (`React.createElement` plano); DI por `*Fn`; copy literal-estable EXPORTADA + asserts anti-drift en tests con `ink-testing-library`.
- **D-10:** Tecla **`m`** abre el editor desde `mode:'list'`. El planner re-verifica que no colisione (alternativa `P` si surge conflicto).

### Claude's Discretion

- Tecla exacta de apertura si `m` colisiona (re-verificado: `m` libre hoy — ver Pitfall 0).
- Layout/render del overlay de proyectos y del sub-overlay de módulos (columnas, truncado de rutas largas, agrupación).
- Validador de ruta en `config-validate.js` vs módulo adyacente (`path-validate.js`) — **recomendación: módulo adyacente**, ver Pitfall 4.
- Teclas exactas para **quitar mapeo** y **abrir módulos** en `mode:'projects'` (sugerencia: `d`/`x` quitar, `m`/`Enter`-variant módulos) — evitar colisión con la navegación del sub-modo.
- Si en `projects-error` se muestra el mapeo local cacheado (degradación parcial) o solo error+retry en v1.
- Confirmación al quitar mapeo: reusar `mode:'confirm'` (modal) vs quitar directo con footer de undo-hint — **recomendado quitar directo** por simplicidad.
- Caps de longitud del buffer de ruta del text-input.

### Deferred Ideas (OUT OF SCOPE)

- **Crear proyectos en el provider desde el dashboard** — el editor solo mapea proyectos existentes.
- **Edición de `provider` activo / API keys / `base_url` / `workspace_slug` / `api_key_env`** — CFGF-03 (v2).
- **Hot-reload de `projects.json`** — CFGF-01 (v2); se mantiene el aviso de reinicio.
- **Editor de módulos full-grid (multi-columna, batch)** — mejora UX v2.
- **Caché persistente de la lista remota** (mostrar proyectos sin conexión) — v2; en v1 la degradación es error+retry (+ mapeo local opcional, D-07).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROJ-01 | Ver lista de proyectos del provider en vivo (`listProjects()`) con estado de mapeo | `listProjects()` en el contrato `TaskProvider` (`interface.js:47,61`); plane `provider.js:411`; github `provider.js:224`. Fetch async vía molde `deriving`/`c`/`l` con token guard (`App.js:632-690`, `:939-941`). Estado de mapeo = `loadProjects()` (`config.js:173`), forma dual mostrada como en el wizard (`cli.js:666-668`) |
| PROJ-02 | Asignar/editar ruta local validada (debe existir) | Text-input de Phase 63 (`App.js:818-886`); validador de ruta-directorio NUEVO (`existsSync`+`statSync().isDirectory()`, never-throws) — formaliza el `existsSync` plano del wizard (`cli.js:689`) |
| PROJ-03 | Quitar el mapeo de un proyecto | `delete projects[id]` + `saveProjects` (`config.js:184`, ya atómico). Tecla discreta en `mode:'projects'` |
| PROJ-04 | Mapear carpetas de módulos (opcional), espejo del wizard | `listModules` SOLO en `PlaneClient` (`client.js:151`), NO en el provider ni en la interfaz — wiring especial (ver Pattern 4). Forma `{ default, modules }` (`cli.js:737`) |
| PROJ-05 | `listProjects()` falla → comunica, reintenta o sale, sin crashear ni corromper | `mode:'projects-error'` + `r`/`Esc`. Primer **rechazo async** convertido en estado (los never-throws previos como `onDerive` no distinguían error). Wrapper never-throws en index.js (molde `onSaveConfig`, `index.js:211-218`). `projects.json` intacto porque el fallo es de LECTURA remota |
</phase_requirements>

## Summary

Phase 64 es, como Phase 63, **casi 100% ensamblaje de patrones internos ya verificados** — cero dependencias nuevas, reusa la fundación de 63 (text-input, snapshot congelado, footer transitorio, escritura atómica `writeFileAtomic` que `saveProjects` YA usa, `config.js:184-186`). El trabajo nuevo es portar a la TUI el flujo lineal que **ya existe y está validado** en el wizard `kodo config` (`cli.js:655-754`): listar proyectos → estado de mapeo → ruta con validación → módulos opcionales → forma dual.

La diferencia de riesgo respecto a 63 es **una sola**: la fuente de datos es **async y de red** (`listProjects()` en Plane es `fetch` con `AbortSignal.timeout(10_000)`, `client.js:46-53`). Esto introduce el **primer carril de error async surfaced como estado** del dashboard. Los precedentes async existentes (`deriving`/`onDerive` de Phase 62, `c`/`l` de Phase 39) usan un molde de request-token (`overlayReqRef`, `App.js:632-690`) y `onDerive` es never-throws que **fail-open a `{}`** — nunca distinguió éxito de fallo. PROJ-05 SÍ necesita distinguir, así que el patrón a adoptar es el de `onSaveConfig` (`index.js:211-218`): un **wrapper never-throws en index.js** que devuelve un discriminado `{ok:true, projects}|{ok:false, error}`, que App ramifica a `projects` o `projects-error`.

Tres hallazgos críticos verificados que cambian el plan respecto al texto del CONTEXT: **(1)** `listModules` NO está en el contrato `TaskProvider` ni en los objetos provider — vive SOLO en `PlaneClient` (`client.js:151`); el wizard lo invoca instanciando `PlaneClient` directo (`cli.js:704-710`). El wiring de `listModulesFn` debe construir el `PlaneClient` en index.js (plane) o ser no-op (github). **(2)** El `PlaneClient` constructor **lanza** si no hay API key (`client.js:13-15`) — el wrapper never-throws debe cubrir la CONSTRUCCIÓN, no solo la llamada, o un proyecto sin key crashearía el handler. **(3)** El validador de ruta toca el FS, lo que rompe la pureza 0-I/O que `config-validate.js` declara explícitamente en su cabecera (`config-validate.js:14-15`) — recomiendo un módulo adyacente `path-validate.js`.

**Primary recommendation:** Insertar `projects`/`projects-loading`/`projects-edit`/`projects-error` (+ `projects-modules`/`projects-modules-loading` si se hace módulos en la misma ola) en el `useInput` ENTRE el bloque `config-edit` y `filter` (`App.js:887`), con un **ref de token dedicado `projectsReqRef`** (no reusar `overlayReqRef`, que c/l/adopt/deriving comparten). El fetch lo hace un `listProjectsFn` **wrapper never-throws** inyectado por index.js (`getProvider(config.provider).listProjects()` envuelto en try/catch que cubre construcción+llamada → `{ok,...}`). `listModulesFn` se wira solo para plane (`new PlaneClient(...).listModules`); github → `async () => []`. El validador de ruta va en `src/path-validate.js` (never-throws, `statSync` en try/catch). Persistencia: `loadProjectsFn`/`saveProjectsFn` importados de `config.js`, preservando la forma dual exacta.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Captura de teclado / sub-máquina de modos | Browser/Client (TUI ink, `App.js useInput`) | — | `useInput` es la única superficie de entrada; los modos `projects*` se gatean junto a `config*` |
| Fetch de la lista remota (`listProjects`) | **API/Backend (provider Plane → red)** | Frontend Server (wiring en index.js) | ÚNICO tier de red de TODO el milestone v0.14 — `client.js:46` hace `fetch` real al Plane API. GitHub es local (config.repos) |
| Fetch de módulos (`listModules`) | **API/Backend (PlaneClient → red)** | Frontend Server (wiring condicional) | Solo Plane; `client.js:152` hace `GET /projects/{id}/modules/`. GitHub no-op |
| Validación de ruta (existe + es dir) | Lógica + Storage local (`path-validate.js`, NUEVO) | — | Toca el FS (`existsSync`/`statSync`) — NO es 0-I/O como los validadores de 63 |
| Snapshot congelado al abrir | Lógica pura (estado React) + lectura local (`loadProjects`) | API (la lista remota se fusiona) | El poll `/status` no toca el snapshot (molde `overlaySnapshot`, D-04 de 63) |
| Escritura de `projects.json` | Database/Storage local (`saveProjects` + `writeFileAtomic`) | — | Filesystem local; cero endpoint, cero server; YA atómico (`config.js:184-186`) |
| Cableado DI | Frontend Server (`runDashboard`/`index.js`) | — | Construye provider/PlaneClient e inyecta los 4 `*Fn` |

**Nota de tier:** A diferencia de Phase 63 (100% local), Phase 64 SÍ toca el tier de API/red — pero SOLO en lectura (`listProjects`/`listModules`). La escritura sigue 100% local. Por eso PROJ-05 (degradación) es el carril diferenciador: el fallo posible es de **lectura remota**, y nunca puede corromper la **escritura local** (que ni siquiera se ejecuta en el carril de fallo).

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ink` | `6.8.0` (instalado) | TUI React; `useInput`/`Box`/`Text` | Ya es el motor del dashboard; todos los flags de `Key` necesarios ya verificados en Phase 63 `[VERIFIED: node_modules/ink, Phase 63 research]` |
| `react` | `19.2.0` (instalado) | Estado (`useState`/`useRef`); `React.createElement` plano | Ya en uso; no-JSX `[VERIFIED: package.json]` |
| `node:fs` | builtin (Node 22.22.3) | `existsSync`/`statSync` (validador de ruta) | El validador de ruta-directorio es la única pieza nueva de FS `[VERIFIED: node --version]` |
| `node:test` + `ink-testing-library` | builtin + `4.0.0` | Tests TUI herméticos | Patrón establecido (`test/dashboard-*.test.js`) `[VERIFIED: test/]` |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `src/providers/registry.js` | interno | `initRegistry()` + `getProvider(name)` | Para obtener el provider activo y llamar `listProjects()` (molde `cli.js:652`, `adopt.js:124`) `[VERIFIED: registry.js:96-125]` |
| `src/providers/plane/client.js` | interno | `new PlaneClient(...).listModules(id)` | ÚNICA vía para módulos — `listModules` no está en el provider (ver Pattern 4) `[VERIFIED: client.js:151]` |
| `structuredClone` | builtin global | Deep-clone del snapshot antes de mutar | OBLIGATORIO (mismo Pitfall que 63) si se edita un objeto anidado del snapshot `[VERIFIED]` |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `listModulesFn` que construye `PlaneClient` en index.js | Añadir `listModules` al contrato `TaskProvider` | DESCARTADO en v1: ampliar la interfaz toca github (que no tiene módulos) y la validación de `getProvider` (`registry.js:107`). Wiring condicional en index.js es más quirúrgico (espejo del wizard `cli.js:704`) |
| `path-validate.js` (módulo nuevo) | Añadir el validador a `config-validate.js` | `config-validate.js` declara 0-I/O explícitamente (`:14-15`); meter `existsSync`/`statSync` ahí rompe ese invariante y su test unit. Módulo adyacente lo preserva (recomendado) |
| `projectsReqRef` dedicado | Reusar `overlayReqRef` | `overlayReqRef` ya lo comparten c/l/adopt/deriving (`App.js:426`); reusarlo arriesga invalidación cruzada accidental. Un ref dedicado aísla el carril (recomendado) |

**Installation:**
```bash
# NINGUNA. Cero dependencias nuevas (igual que Phase 63). package.json intacto (4 deps prod).
```

**Version verification:** `ink@6.8.0`, `react@19.2.0`, Node `v22.22.3` — todos verificados en Phase 63 research contra `node_modules`/`node --version`. Esta fase no bumpea nada.

## Package Legitimacy Audit

> **No aplica instalación de paquetes nuevos.** D-09 mantiene cero dependencias; el editor reusa la fundación de 63 y los módulos internos del provider. `package.json` permanece intacto.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (ninguno nuevo) | — | — | — | — | — | — |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

## Architecture Patterns

### System Architecture Diagram

```
                       tecla `m` (mode:'list')                       [PROJ-01]
                              │
                              ▼
                  ┌────────────────────────────┐
                  │   mode:'projects-loading'   │  spinner; Esc cancela
                  │   reqId = ++projectsReqRef  │  (avanza ref → invalida)
                  └─────────────┬───────────────┘
                                │  await listProjectsFn()   ◄── wrapper never-throws (index.js)
                                │  (provider Plane → fetch /projects/)   {ok:true,projects}|{ok:false,error}
                       ┌────────┴─────────┐
              if (projectsReqRef !== reqId) return   (T5 staleness — Esc u otra apertura)
                       │                  │
                 {ok:false}          {ok:true}
                       │                  │
                       ▼                  ▼
        ┌───────────────────────┐   snapshot CONGELADO:
        │ mode:'projects-error' │   { remoteProjects, projectsMap = loadProjectsFn() }
        │ panel/footer rojo     │   + mode:'projects'
        │ `r` retry · Esc salir │            │
        └───────────────────────┘            ▼
         projects.json INTACTO       ┌────────────────────────────┐
         (carril de LECTURA)         │       mode:'projects'       │ ◄ ↑/↓ cursor (clamp sin wrap)
                                     │  fila: ID — name [ruta]/    │ ── Esc ──► mode:'list'
                                     │        [sin mapear]         │   (selectedTaskId intacto)
                                     └──┬─────────┬──────────┬─────┘
                              Enter     │   `d`/`x`│   `m`/var│
                            (editar)    │  (quitar)│ (módulos)│            [PROJ-03]   [PROJ-04]
                                ▼       ▼          ▼          
            ┌──────────────────────┐  delete    mode:'projects-modules-loading'
            │  mode:'projects-edit'│  projects   reqId2 = ++projectsReqRef
            │  text-input (Phase63)│  [id] +     await listModulesFn(id)  ◄ plane: PlaneClient; github: []
            └──────────┬───────────┘  saveProj   │ (staleness guard)
                Enter   │              + footer    ▼
                        ▼              reinicio   mode:'projects-modules'
       validatePath(buffer)  ◄── existsSync+statSync().isDirectory()   (lista módulos, mismo text-input
       (path-validate.js, never-throws)                                 + mismo validador de ruta)
            ┌──────────┴──────────┐
       {ok:false}            {ok:true,value}
            │                     │
            ▼                     ▼
     footer rojo          preservar forma dual:                        [PROJ-02 / D-06]
     NO escribe           string→string ó {default,modules} (modules INTACTO)
     sigue editando       saveProjectsFn(next)  ──► writeFileAtomic (YA atómico, config.js:186)
                                 │
                                 ▼
                          footer verde/ámbar "reinicia server/daemon"
                          + mode:'projects'
```

### Recommended Project Structure
```
src/
├── path-validate.js          # NUEVO (recomendado): validador de ruta-directorio (existe+isDirectory),
│                             #   never-throws, {ok,value}|{ok,error}. NO en config-validate.js (0-I/O).
└── cli/dashboard/
    ├── App.js                # MOD: modos projects/projects-loading/projects-edit/projects-error
    │                         #   (+ modules si misma ola); handler `m`; projectsReqRef; footer hint
    ├── SessionTable.js       # MOD: renderProjectsOverlay + estados loading/error; copy EXPORTADA
    └── index.js              # MOD: initRegistry+getProvider; wrapper never-throws listProjectsFn;
                              #   listModulesFn condicional (plane/github); load/saveProjectsFn

test/
├── path-validate.test.js     # NUEVO: tabla existe-dir / existe-archivo / no-existe / symlink roto
├── projects-shape.test.js    # NUEVO (o dentro de dashboard-projects): preservación forma dual + remove
└── dashboard-projects.test.js # NUEVO: molde dashboard-config.test.js — fetch ok/error/retry/staleness
```

### Pattern 1: Fetch async con request-token (molde `deriving` + `c`/`l`)
**What:** Al abrir, entra a un modo transitorio, captura un `reqId` incrementando un ref dedicado, `await` la fn inyectada, y tras el await comprueba staleness (`ref.current !== reqId`) antes de aplicar el resultado.
**When to use:** Apertura del editor (`listProjects`) y apertura de módulos (`listModules`).
**Example:**
```js
// Source: VERIFIED molde App.js:632-690 (deriving) + App.js:939-941 (c) + App.js:982-984 (l)
// Ref DEDICADO (NO reusar overlayReqRef que c/l/adopt/deriving comparten — App.js:426):
const projectsReqRef = useRef(0);

// Handler `m` en mode:'list' (junto a c/l/p/d/o/a/e — App.js:914-1112):
if (input === 'm') {
  setMode('projects-loading');
  const reqId = ++projectsReqRef.current;
  const result = await listProjectsFn();           // wrapper never-throws (Pattern 2)
  if (projectsReqRef.current !== reqId) return;     // T5: Esc/2ª apertura durante el await → descartar
  if (result.ok) {
    // snapshot CONGELADO: remota + mapeo local (loadProjects es 100% local, no falla)
    setProjectsSnapshot({ remote: result.projects, map: loadProjectsFn() });
    setFieldCursor(0);
    setMode('projects');
  } else {
    setProjectsError(result.error);                 // copy del mensaje de error
    setMode('projects-error');                      // PROJ-05
  }
  return;
}
```
**Esc durante loading** (cancela e invalida el fetch en vuelo, molde `deriving` `App.js:682-690`):
```js
if (mode === 'projects-loading') {
  if (key.escape) { projectsReqRef.current++; setMode('list'); return; } // selectedTaskId intacto
  return; // traga el resto mientras carga
}
```

### Pattern 2: Wrapper never-throws en index.js (PROJ-05 — distinguir éxito de fallo)
**What:** A diferencia de `onDerive` (never-throws que fail-open a `{}`, sin distinguir error), `listProjectsFn` debe devolver un **discriminado** para que App ramifique a `projects-error`. Molde EXACTO: el wrapper de `onSaveConfig` (`index.js:211-218`).
**Crítico:** El `PlaneClient` constructor (vía `getProvider`/factory) **lanza** si falta la API key (`client.js:13-15`). El try/catch debe cubrir CONSTRUCCIÓN + llamada.
**Example:**
```js
// Source: VERIFIED molde index.js:211-218 (onSaveConfig wrapper) + cli.js:652-659 (provider init)
// En runDashboard, tras los lazy imports existentes:
const { initRegistry, getProvider } = await import('../../providers/registry.js');
const { loadProjects, saveProjects } = await import('../../config.js'); // saveProjects NUEVO (hoy solo loadProjects, index.js:154)

const providerName = loadConfig().provider;

// listProjectsFn: never-throws. Cubre construcción del provider/cliente Y la llamada de red.
const listProjectsFn = async () => {
  try {
    await initRegistry();
    const provider = getProvider(providerName);     // puede lanzar (factory → PlaneClient sin key)
    const projects = await provider.listProjects(); // fetch /projects/ (puede rechazar: red/timeout/HTTP)
    return { ok: true, projects };                  // [{id, identifier, name}], interface.js:47
  } catch (e) {
    return { ok: false, error: String(e?.message ?? e) };
  }
};
```

### Pattern 3: Sub-máquina de modos — orden de gating
**What:** Inserción de las ramas `projects*` en el `useInput` de App.js.
**Orden ACTUAL verificado (`App.js`, early-return en cada rama):**
```
1. focusError != null   → clear-on-any-input (consume tecla)   [App.js:562]
2. mode === 'overlay'    → scroll / picker adopt                [App.js:570]
3. mode === 'deriving'   → spinner, solo Esc cancela            [App.js:682]
4. mode === 'confirm'    → dismiss/adopt double-confirm         [App.js:697]
5. mode === 'config'     → lista de campos navegable           [App.js:785]
6. mode === 'config-edit'→ text-input                          [App.js:818]
7. mode === 'filter'     → text-append del query               [App.js:887]
8. mode === 'list'       → q / e c l p d o a m / ↑↓ / Enter     [App.js:913]
```
**Inserción recomendada:** las ramas `projects-loading` / `projects` / `projects-edit` / `projects-error` (+ `projects-modules*`) van ENTRE el bloque `config-edit` (6) y `filter` (7), espejo del CONTEXT D-02 ("antes del mode-gate de filtro"). La tecla `m` se añade en la rama `mode === 'list'` (8) junto a `e`/`c`/`l`/`p`/`d`/`o`/`a`.
```js
// mode:'projects' — lista navegable (molde config, App.js:785-812)
if (mode === 'projects') {
  const items = projectsSnapshot?.remote ?? [];
  if (key.escape) { setMode('list'); return; }                 // UX-03: selectedTaskId intacto
  if (key.upArrow)   { setFieldCursor((i) => Math.max(0, i - 1)); return; }
  if (key.downArrow) { setFieldCursor((i) => Math.min(items.length - 1, i + 1)); return; }
  if (key.return) { /* precarga ruta actual → mode:'projects-edit' */ return; }
  if (input === 'd' || input === 'x') { /* quitar mapeo — Pattern 5 */ return; }
  if (input === 'm') { /* abrir módulos — Pattern 4 */ return; }
  return; // traga el resto
}
// mode:'projects-error' — PROJ-05 / D-07
if (mode === 'projects-error') {
  if (input === 'r') { /* re-dispara el fetch de Pattern 1 */ return; }
  if (key.escape)    { setMode('list'); return; }
  return;
}
```
**Precarga de la ruta actual en `projects-edit`** (forma dual — D-06):
```js
const entry = projectsSnapshot.map[items[fieldCursor].id];
const current = typeof entry === 'string' ? entry : (entry?.default ?? ''); // string|objeto|sin mapear
setBuffer(current);
setCursor(current.length);
```

### Pattern 4: `listModules` — variancia de provider (HALLAZGO CRÍTICO)
**What:** `listModules` **NO está en el contrato `TaskProvider`** (`interface.js:38-62` — no aparece) ni en los objetos provider. Vive SOLO en `PlaneClient.listModules(projectId)` (`client.js:151`). El wizard lo invoca instanciando `PlaneClient` directo (`cli.js:704-710`).
**Wiring (index.js) — condicional por provider:**
```js
// Source: VERIFIED client.js:151 (listModules), cli.js:704-710 (instanciación directa en el wizard),
//          github/provider.js:224 (sin módulos)
let listModulesFn;
if (providerName === 'plane') {
  const planeCfg = loadConfig().providers.plane;
  listModulesFn = async (projectId) => {
    try {
      const { PlaneClient } = await import('../../providers/plane/client.js');
      const client = new PlaneClient({
        baseUrl: planeCfg.base_url,
        apiKey: process.env[planeCfg.api_key_env],
        workspaceSlug: planeCfg.workspace_slug,
      });                                            // constructor LANZA sin apiKey (client.js:13)
      const modules = await client.listModules(projectId); // GET /projects/{id}/modules/ → {results}
      return { ok: true, modules };                  // [{id, name, ...}] — la KEY del mapa es mod.name (cli.js:728)
    } catch (e) {
      return { ok: false, error: String(e?.message ?? e) };
    }
  };
} else {
  listModulesFn = async () => ({ ok: true, modules: [] }); // github: sin módulos (no-op)
}
```
**En App (tecla módulos):** si `modules.length === 0` → footer informativo "este provider no tiene módulos" (espejo `cli.js:711-714`), no-op, never-throws. Persistir como `projects[id] = { default, modules: { [mod.name]: ruta } }` (`cli.js:737`).

### Pattern 5: Preservación de la forma dual + quitar mapeo (D-06 / PROJ-03)
**What:** `projects.json` es `Record<projectId, string | { default, modules }>`. Los consumidores `resolveProjectPath` (`manager.js:78-103`) y `adopt.js:126-135` dependen de esta forma exacta.
**Reglas verificadas contra el wizard (`cli.js:683-737`):**
```js
// Source: VERIFIED cli.js:721,737 + manager.js:88-103 (resolveProjectPath consume la forma dual)
// EDITAR ruta — preservar modules si la entrada es objeto:
const prev = next[id];
if (prev && typeof prev === 'object' && prev.modules) {
  next[id] = { default: validatedPath, modules: prev.modules };  // solo cambia default
} else {
  next[id] = validatedPath;                                       // string plano (legacy)
}
// QUITAR mapeo (PROJ-03):
delete next[id];
// En ambos casos: saveProjectsFn(next) — writeFileAtomic, ya atómico (config.js:186)
```
**Anti-corrupción:** nunca escribir `{ default: undefined }` ni colapsar un objeto-con-módulos a string al editar solo la ruta. `resolveProjectPath` hace `typeof entry === 'string'` (`manager.js:88`) y `entry.modules?.[moduleName]` (`manager.js:92`) — romper la forma rompe la resolución de rutas de TODAS las sesiones de ese proyecto.

### Anti-Patterns to Avoid
- **Reusar `overlayReqRef` para el carril projects:** lo comparten c/l/adopt/deriving (`App.js:426,572,635,939,982`). Un Esc en projects-loading que avanza `overlayReqRef` podría invalidar un overlay c/l legítimo en vuelo. Usar `projectsReqRef` dedicado.
- **`listProjectsFn` que lanza:** si la fn inyectada propaga el throw, el `await` dentro de `useInput` rechaza y (aunque ink no tumba el árbol por un handler async rechazado) el flujo no llega a `setMode('projects-error')` → el operador se queda en `projects-loading` colgado. El wrapper DEBE devolver `{ok:false}`, no lanzar (PROJ-05).
- **Validador de ruta sin try/catch:** `statSync` LANZA en symlink roto / sin permisos (no solo cuando no existe). `existsSync` es false-y-silencioso, pero `statSync` no. Envolver en try/catch → `{ok:false}`.
- **Meter el validador FS en `config-validate.js`:** rompe su invariante 0-I/O declarado (`:14-15`) y contamina su test unit hermético. Módulo adyacente.
- **Colapsar la forma dual al editar la ruta:** ver Pattern 5. Preservar `modules`.
- **Precargar `listProjects()` en el poll global:** acopla el editor al ciclo de `/status` y contamina el estado base (descartado en CONTEXT D-01).
- **Construir el provider/PlaneClient en el render o en module-scope:** la construcción puede lanzar (key ausente) y hace red. Va DENTRO del wrapper never-throws, on-demand.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Fetch async con guard de staleness | Tu propio token | Molde `deriving`/`c`/`l` + `useRef` token (`App.js:632-690`,`:939-941`) | Ya resuelto: reqId + check post-await + Esc invalida |
| Escritura atómica de `projects.json` | temp+rename nuevo | `saveProjects` (`config.js:184-186`, YA usa `writeFileAtomic`) | Hecho en Phase 63 — confirmado, no es deuda |
| Text-input con cursor para la ruta | Nuevo componente | El de Phase 63 (`App.js:818-886` + render `SessionTable.js:293-298`) | Reuso directo, mismo buffer/cursor |
| Snapshot congelado bajo poll vivo | Lógica de freeze | Molde `overlaySnapshot`/`configSnapshot` (`App.js:444`,`:415`) | El poll no re-escribe el snapshot |
| Cursor clamp sin wrap | Tu clamp | Molde `fieldCursor`/`adoptCursor` (`App.js:791-796`,`:583-589`) | `Math.max(0,i-1)`/`Math.min(len-1,i+1)` probado |
| Footer transitorio de reinicio | Objeto {text,color} | `focusError`+`footerColor` (`App.js:363,370`) + `CONFIG_SAVED_RESTART` (`App.js:230`) | Ya hace verde/ámbar/rojo derivado de estado; reusar la copy (o un `PROJECTS_SAVED_RESTART` análogo) |
| Obtener el provider activo | Instanciar a mano | `initRegistry()`+`getProvider(config.provider)` (`registry.js:96`,`cli.js:652`,`adopt.js:124`) | Molde idéntico al wizard y al adopt CLI |
| Listar módulos de Plane | Llamada REST nueva | `PlaneClient.listModules` (`client.js:151`) | Ya existe; el wizard lo usa así (`cli.js:710`) |
| Estado de mapeo string\|objeto | Parser nuevo | `typeof entry === 'string' ? entry : entry?.default` (`cli.js:685`,`manager.js:88`) | Forma dual canónica, no reinventar |
| Copy literal-estable | Strings inline | Constantes EXPORTADAS (molde `CONFIG_*` `App.js:229-231`, `OVERLAY_*`, `DISMISS_*`) | Tests las importan y asseren equality → mata drift |

**Key insight:** Igual que 63, el ~80% es ensamblaje. Lo genuinamente nuevo: (1) el wrapper never-throws que distingue éxito/fallo de un fetch (Pattern 2), (2) el validador de ruta FS (Pattern 4 de 63 era 0-I/O; este toca disco), (3) el wiring condicional de `listModules` por la asimetría provider/cliente. Todo lo demás ya tiene molde exacto.

## Runtime State Inventory

> NO es una fase de rename/refactor/migración — es feature nueva. El inventario "qué strings quedan cacheados" no aplica. Punto análogo relevante (estado runtime que el editor toca):

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `~/.kodo/projects.json` (el dato que el editor escribe). Forma dual `string`\|`{default,modules}` consumida por `manager.js:88` y `adopt.js:126` | Preservar forma exacta (Pattern 5). NO migración de datos — solo lectura/escritura |
| Live service config | El server/daemon lee `projects.json` **al arrancar** (vía `loadProjects`/`resolveProjectPath`), NO en vivo. La lista REMOTA viene del provider en cada apertura (no cacheada) | Aviso de reinicio (D-06) es la mitigación. No se notifica al server (sin hot-reload, CFGF-01 diferido) |
| OS-registered state | Ninguno | None — verificado: el editor no toca Task Scheduler/launchd/pm2 |
| Secrets/env vars | API key del provider en `~/.kodo/.env` (`api_key_env`). El editor la LEE para construir `PlaneClient` (Pattern 4) pero NUNCA la muestra ni edita | None — la key se lee de `process.env[api_key_env]`, jamás se escribe ni se renderiza |
| Build artifacts | Ninguno | None |

**Punto crítico:** tras guardar `projects.json`, el server/daemon vivo sigue con el mapeo viejo en memoria hasta reiniciar. El aviso de reinicio es la mitigación aceptada (espejo de 63). Esto es esperado, no un bug.

## Common Pitfalls

### Pitfall 0: Verificación de tecla `m` (D-10)
**What:** El CONTEXT propone `m`; el planner debe re-verificar antes de implementar.
**Estado verificado HOY:** teclas ocupadas en `mode:'list'` (`App.js:914-1158`): `q`(914) `/`(918) `e`(922) `c`(934) `l`(977) `p`(1008) `d`(1029) `o`(1048) `a`(1088) + `↑`(1113) `↓`(1119) `Enter`(1124). `Esc` deliberadamente ignorado. **`m` está LIBRE** — confirmado por lectura completa del bloque list. Recordar actualizar el footer hint (`App.js:1216`) añadiendo `· m projects`.
**Sub-modo:** dentro de `mode:'projects'`, las teclas de acción (`d`/`x` quitar, `m`/variante módulos) NO colisionan con la navegación del sub-modo (que solo usa ↑/↓/Enter/Esc) — pero ojo: si se reusa `m` para módulos dentro de `projects`, es coherente (m=módulos) y no colisiona porque la rama `mode:'projects'` se evalúa antes que `mode:'list'`.

### Pitfall 1: El constructor de PlaneClient lanza sin API key
**What goes wrong:** `getProvider('plane')` → factory → eventualmente el código que necesita la key, y `new PlaneClient(...)` lanza `Plane API key not found` (`client.js:13-15`) si `api_key_env` no está en el entorno.
**Why it happens:** El cliente exige la key en construcción, no en la llamada.
**How to avoid:** El wrapper never-throws (Pattern 2/4) envuelve CONSTRUCCIÓN + llamada en el mismo try/catch. Un proyecto sin key → `{ok:false}` → `projects-error` con mensaje claro, nunca un crash.
**Warning signs:** Dashboard que se cuelga en `projects-loading` o (peor) un throw no capturado en el handler async.

### Pitfall 2: `statSync` lanza (no solo "no existe")
**What goes wrong:** El validador de ruta usa `existsSync` (false silencioso) PERO `statSync().isDirectory()` LANZA en symlink roto, permisos denegados, o race (borrado entre exists y stat).
**Why it happens:** `existsSync` traga errores; `statSync` los propaga.
**How to avoid:** `try { return existsSync(p) && statSync(p).isDirectory() ... } catch { return {ok:false, error:...} }`. Never-throws por contrato.
**Warning signs:** Crash al validar una ruta que es un symlink colgante o un archivo sin permisos.

### Pitfall 3: Staleness con DOS hops async (listProjects + listModules)
**What goes wrong:** Abrir módulos (hop 2) mientras un re-fetch de la lista (hop 1) está en vuelo, o Esc entre medias, puede aplicar un resultado obsoleto.
**Why it happens:** Dos awaits distintos comparten el carril.
**How to avoid:** Cada apertura async (lista Y módulos) captura su propio `reqId = ++projectsReqRef.current` y comprueba `projectsReqRef.current !== reqId` tras SU await. Un solo ref dedicado sirve para ambos hops porque cada incremento invalida lo anterior (molde `deriving` T5, `App.js:635,645`).
**Warning signs:** La lista de módulos de un proyecto aparece bajo otro; un Esc no cancela un fetch en vuelo.

### Pitfall 4: El validador de ruta NO es 0-I/O (rompe el invariante de `config-validate.js`)
**What goes wrong:** Meter `existsSync`/`statSync` en `config-validate.js` contradice su cabecera ("no importa `node:fs`... preserva el invariante 0-I/O", `:14-15`) y ensucia su test unit hermético.
**Why it happens:** Tentación de reusar el archivo de validadores.
**How to avoid:** Módulo adyacente `src/path-validate.js`. Su test puede usar `mkdtempSync`/tmpdir para crear un dir real y validar contra él (a diferencia de `config-validate.test.js`, que es puro).
**Warning signs:** `config-validate.test.js` deja de ser hermético; el walker de aislamiento se queja.

### Pitfall 5: `loadProjects()` devuelve `{}` por defecto (no lanza)
**What goes wrong:** Asumir que el mapeo local puede fallar y meterlo en el carril de error remoto.
**Why it happens:** Confusión entre el fallo REMOTO (listProjects) y la lectura LOCAL (loadProjects).
**How to avoid:** `loadProjects` es never-throws y cae a `{}` si falta el archivo o el JSON es inválido (`config.js:173-181`). El snapshot local SIEMPRE está disponible aunque la lista remota falle → habilita la degradación parcial de D-07 (mostrar mapeo cacheado en `projects-error`) si el planner la implementa.
**Warning signs:** Código que trata `loadProjects()` como si pudiera rechazar.

### Pitfall 6: Render del cursor y ANSI en `lastFrame()` (heredado de 63)
**What goes wrong:** `<Text inverse>` (cursor) serializa ANSI; asertar la posición por styling es frágil.
**How to avoid:** Asertar por CONTENIDO (substring de la ruta), no por bytes ANSI. Reusar el render del text-input de 63 (`SessionTable.js:293-298`).

## Code Examples

### Validador de ruta-directorio (NUEVO, never-throws)
```js
// Source: src/path-validate.js (NUEVO). Formaliza el existsSync plano del wizard (cli.js:689,727)
// añadiendo isDirectory. Never-throws (statSync lanza en symlink roto/permisos — Pitfall 2).
// @ts-check
import { existsSync, statSync } from 'node:fs';

/** @typedef {{ ok: true, value: string } | { ok: false, error: string }} ValidationResult */

/**
 * Valida que `raw` sea una ruta a un directorio EXISTENTE (PROJ-02/D-04).
 * @param {any} raw - buffer del text-input (string, pero never-throws ante cualquier tipo).
 * @returns {ValidationResult}
 */
export function validateExistingDir(raw) {
  const s = String(raw).trim();
  if (s.length === 0) return { ok: false, error: 'la ruta no puede estar vacía' };
  try {
    if (!existsSync(s)) return { ok: false, error: `"${s}" no existe` };
    if (!statSync(s).isDirectory()) return { ok: false, error: `"${s}" no es un directorio` };
    return { ok: true, value: s };
  } catch {
    return { ok: false, error: `no se pudo acceder a "${s}"` }; // symlink roto / permisos
  }
}
```

### Copy literal-estable EXPORTADA (molde `CONFIG_*`, `App.js:229-231`)
```js
// Source: VERIFIED molde App.js:229-231 (CONFIG_OVERLAY_TITLE/CONFIG_SAVED_RESTART/CONFIG_SAVE_FAILED)
export const PROJECTS_OVERLAY_TITLE = 'proyectos de kodo';
export const PROJECTS_LOADING = 'cargando proyectos…';                 // mode:'projects-loading'
export const PROJECTS_SAVED_RESTART = 'guardado — reinicia el server/daemon para aplicar los cambios';
export const PROJECTS_UNMAPPED = '[sin mapear]';                       // estado de fila (espejo cli.js:667)
export const PROJECTS_NO_MODULES = 'este provider no tiene módulos';   // PROJ-04 github / lista vacía
/** @param {string} reason */
export const PROJECTS_LOAD_FAILED = (reason) => `[!] no se pudo cargar la lista de proyectos (${reason}) — r reintentar · Esc salir`;
```

### Test hermético del editor de proyectos (molde `dashboard-config.test.js`)
```js
// Source: VERIFIED patrón test/dashboard-config.test.js:26-90 + test/dashboard-overlay.test.js:81-95
// injectProps se EXTIENDE con los 4 *Fn DI nuevos. drain() = 2x setImmediate (overlay test:93-95).
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App from '../src/cli/dashboard/App.js';

// fakes deterministas:
const listProjectsOK = async () => ({ ok: true, projects: [
  { id: 'p1', identifier: 'KL', name: 'k-lab' },
] });
const listProjectsFail = async () => ({ ok: false, error: 'ECONNREFUSED' });

// PROJ-01 + PROJ-05: éxito vs error
const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn, {
  listProjectsFn: listProjectsOK,
  listModulesFn: async () => ({ ok: true, modules: [] }),
  loadProjectsFn: () => ({ p1: '/tmp/existing-dir' }),
  saveProjectsFn: (m) => { saved = m; },            // spy
})));
try {
  await clock.flushTick();      // primer poll /status
  stdin.write('m');             // abre → projects-loading
  await drain();                // resuelve listProjectsFn → projects
  assert.match(lastFrame(), /k-lab/);
  assert.match(lastFrame(), /sin mapear|\/tmp\/existing-dir/);
  // ... Enter → projects-edit → escribir ruta → Enter → valida → saveProjectsFn
} finally { unmount(); }
```
**Códigos de tecla `stdin.write`:** char literal, Enter `'\r'`, Esc `'\x1b'`, backspace `'\x7f'`, ←`'\x1b[D'` →`'\x1b[C'` ↑`'\x1b[A'` ↓`'\x1b[B'`.

### Cableado DI en index.js (molde `loadConfigFn`/`onSaveConfig`/`projects`)
```js
// Source: VERIFIED index.js:106 (lazy import config), :154-155 (loadProjects), :204-218 (DI wrappers)
// Añadir saveProjects al import existente (hoy solo loadProjects, :154):
const { loadProjects, saveProjects } = await import('../../config.js');
// ... y al createElement(App, { ... }):
listProjectsFn,                                   // Pattern 2 (never-throws, cubre construcción+red)
listModulesFn,                                    // Pattern 4 (condicional plane/github)
loadProjectsFn: () => loadProjects(),
saveProjectsFn: (m) => saveProjects(m),           // saveProjects es síncrono y atómico (config.js:186)
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Mapeo de proyectos solo vía wizard `kodo config` lineal (`cli.js:655`) | Editor no-lineal en el dashboard | Phase 64 (esta) | El operador mapea/edita/quita sin re-correr el wizard completo |
| Overlays async never-throws que NO distinguen error (`onDerive` fail-open a `{}`, `App.js:638-642`) | Primer overlay async con **estado de error explícito** (`projects-error`, PROJ-05) | Phase 64 | El wrapper devuelve discriminado `{ok}` en vez de fail-open silencioso |
| `saveProjects` = `writeFileSync` plano | temp+rename atómico (`writeFileAtomic`) | Phase 63 (heredado) | Crash-safety: `projects.json` nunca a medias (PERSIST-05) — YA hecho |

**Asimetría provider/cliente verificada:** `listProjects` está en el contrato `TaskProvider` (`interface.js:47,61`, validado por `getProvider` en `registry.js:107`). `listModules` NO — vive solo en `PlaneClient` (`client.js:151`); el provider lo usa internamente (`provider.js:148,336`) pero no lo expone. Consecuencia: el wiring de módulos es especial (Pattern 4), no provider-agnostic uniforme.

**Deprecated/outdated:** nada relevante; stack (ink 6, react 19, node 22) al día.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (builtin, Node 22.22.3) + `ink-testing-library@4.0.0` |
| Config file | none — script `npm test` = `node --test $(find test -name '*.test.js' -type f)` |
| Quick run command | `node --test test/path-validate.test.js` (o el fichero tocado) |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PROJ-02 | `validateExistingDir`: dir existe / es archivo / no existe / symlink roto / vacío | unit | `node --test test/path-validate.test.js` | ❌ Wave 0 |
| PROJ-06(forma) | Preservar forma dual al editar (objeto conserva `modules`); remove = delete | unit | `node --test test/projects-shape.test.js` | ❌ Wave 0 |
| PROJ-01 | `m` abre → `listProjectsFn` ok → lista con estado `[ruta]`/`[sin mapear]` | integration | `node --test test/dashboard-projects.test.js` | ❌ Wave 0 |
| PROJ-02(UI) | Ruta inválida → footer rojo, NO escribe, sigue editando | integration | `node --test test/dashboard-projects.test.js` | ❌ Wave 0 |
| PROJ-03 | Tecla quitar → `delete` + `saveProjectsFn` llamado con el mapa sin la key | integration | `node --test test/dashboard-projects.test.js` | ❌ Wave 0 |
| PROJ-04 | Tecla módulos → `listModulesFn` ok → mapa `{default,modules}`; github/vacío → footer no-módulos | integration | `node --test test/dashboard-projects.test.js` | ❌ Wave 0 |
| PROJ-05 | `listProjectsFn` `{ok:false}` → `projects-error`; `r` reintenta; `Esc` sale; panel montado; `saveProjectsFn` NUNCA llamado | integration | `node --test test/dashboard-projects.test.js` | ❌ Wave 0 |
| PROJ-05(race) | Esc durante `projects-loading` invalida el fetch en vuelo (resultado tardío descartado) | integration | `node --test test/dashboard-projects.test.js` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test test/<fichero tocado>.test.js`
- **Per wave merge:** `npm test`
- **Phase gate:** `npm test` verde antes de `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/path-validate.test.js` — cubre PROJ-02 (usar `mkdtempSync(os.tmpdir())` para un dir real; tabla: dir-existe→ok, archivo→error, no-existe→error, vacío→error, symlink-roto→error never-throws)
- [ ] `test/projects-shape.test.js` — cubre preservación forma dual + remove (funciones puras de mutación de mapa; sin ink). Si la mutación vive inline en App.js, extraer a helper puro testeable (recomendado, espejo de `setByPath`/`mapDismissResult`)
- [ ] `test/dashboard-projects.test.js` — cubre PROJ-01/03/04/05 + race (molde `dashboard-config.test.js` + `dashboard-overlay.test.js`: `injectProps` extendido con los 4 `*Fn`, `drain()` para settle async, fakes que resuelven/devuelven `{ok:false}`)
- [ ] No hace falta instalar framework: `node:test` + `ink-testing-library` ya presentes

**Observabilidad clave (sampling points):** (a) el discriminante `{ok}` del wrapper es el punto de muestreo del éxito/fallo del fetch; (b) el `saveProjectsFn` spy es el punto de muestreo de que un carril de fallo NUNCA escribe (PROJ-05); (c) el `projectsReqRef` (incremento por apertura) es el punto de muestreo de la staleness — un test puede encolar dos aperturas y verificar que solo la última aplica.

## Security Domain

> `security_enforcement` no está en `false` → incluido. Carril de LECTURA remota (provider) + ESCRITURA local. La key del provider se LEE pero nunca se muestra/edita.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Editor local; sin auth de usuario |
| V3 Session Management | no | Sin sesiones HTTP propias |
| V4 Access Control | no | Filesystem local con permisos del usuario |
| V5 Input Validation | **yes** | `validateExistingDir` valida la ruta antes de `saveProjects` (PROJ-02); el ID de proyecto viene de `listProjects` (no del operador) |
| V6 Cryptography | no | No se maneja crypto en este carril |
| V9/V13 Communications/API | **yes** | `listProjects`/`listModules` van por HTTPS al Plane API con `X-API-Key` (`client.js:48`) y `AbortSignal.timeout(10s)` (`client.js:53`) — ya implementado en el cliente |
| V12 File Resources | **yes** | Escritura atómica a path fijo (`PROJECTS_PATH`); la ruta del operador se VALIDA (existe+isDirectory) pero se almacena como dato, no se ejecuta |

### Known Threat Patterns for {ink TUI + provider de red + escritura local}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Fallo de red / provider caído tumba el dashboard | DoS | Wrapper never-throws → `projects-error`; panel ink siempre montado (PROJ-05/D-07) |
| Mapeo corrupto por ruta inválida | Tampering | `validateExistingDir` pre-escritura + escritura atómica (forma dual preservada) |
| API key del provider expuesta en la TUI | Info Disclosure | La key se lee de `process.env[api_key_env]` para construir el cliente; NUNCA se renderiza ni edita (espejo D-11 de 63) |
| Ruta del operador usada en una llamada de shell | Injection | NO hay shell: la ruta se valida con `existsSync`/`statSync` (FS API, no shell) y se persiste como string JSON |
| ReDoS por buffer de ruta | DoS | El validador usa FS calls + comparaciones de string, nunca regex compilada desde input |
| Path traversal en el ID de módulo como key | Tampering | La key del mapa de módulos es `mod.name` (del provider, no del operador, `cli.js:728`) — no hay path construido desde input libre |

**Nota:** El único input libre del operador es la RUTA (validada FS) y la selección de fila (de una lista derivada del provider). El `projectId` y el `mod.name` provienen del provider, no del teclado — superficie de inyección mínima.

## Project Constraints (from CLAUDE.md)

> No existe `./CLAUDE.md` ni `./.claude/CLAUDE.md` en el repo kodo (solo la global del usuario, que pide respuestas en español y crítica honesta). Invariantes aplicables del proyecto (STATE.md / convenciones, verificados en el código):

- **Cero endpoints nuevos desde v0.10** — el editor escribe local importando `saveProjects`; `server.js` intacto (D-08).
- **TUI never-throws / fail-open** — panel ink siempre montado; el wrapper de `listProjects` no propaga throws (PROJ-05/D-07).
- **Color isolation** — todo color vía props de `<Text>`; el cursor con `<Text inverse>` (no picocolors). Verificado por `test/format-isolation.test.js`.
- **Provider-agnostic** — `listProjects` vía el contrato; PERO `listModules` es asimétrico (solo Plane) → wiring condicional explícito (Pattern 4), documentado como excepción consciente.
- **DI por `*Fn`** — `listProjectsFn`/`listModulesFn`/`loadProjectsFn`/`saveProjectsFn`, espejo de `loadConfigFn`/`onSaveConfig`/`onAdopt`.
- **no-JSX/no-build** — `React.createElement` plano.
- **Estilo** — comentarios densos en español + `// @ts-check` en cada módulo; el validador de ruta y los handlers nuevos lo siguen.
- **Selección por identidad `task_id`** — preservada al entrar/salir del editor (UX-03 gratis: `Esc` no toca `selectedTaskId`).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `listModulesFn` se wira condicionalmente en index.js (plane→PlaneClient, github→[]) en vez de ampliar el contrato `TaskProvider` | Pattern 4 | Bajo — es la opción más quirúrgica y espeja el wizard; ampliar el contrato es válido pero toca github y `getProvider`. El planner puede elegir |
| A2 | El validador de ruta va en `src/path-validate.js` (no en `config-validate.js`) | Pitfall 4 / D-04 | Bajo — D-04 lo deja a discreción; la recomendación preserva el invariante 0-I/O documentado |
| A3 | `projectsReqRef` dedicado (no reusar `overlayReqRef`) | Pattern 1 / Anti-patterns | Bajo — reusar funciona si los modos son disjuntos, pero el ref dedicado es más seguro y claro |
| A4 | El wrapper `listProjectsFn` devuelve discriminado `{ok}` (no fail-open a `[]` como `onDerive`) | Pattern 2 | Medio — si se hiciera fail-open a `[]`, PROJ-05 no podría distinguir "0 proyectos" de "error de red"; el discriminado es necesario para el estado de error |
| A5 | `listModules` devuelve objetos con `.name` usable como key del mapa de módulos | Pattern 4/5 | Bajo — VERIFIED en `cli.js:728` (`moduleMap[mod.name] = path`) y `client.js:152` (`data.results`) |
| A6 | Quitar mapeo directo (sin modal de confirmación) en v1 | Discreción D-03 | Bajo — recomendación de CONTEXT por simplicidad; el planner puede reusar `mode:'confirm'` si prefiere |

**Nota:** Todos los hechos técnicos centrales (modos de App.js, contrato `listProjects`, ubicación de `listModules`, atomicidad de `saveProjects`, forma dual y sus consumidores, constructor de PlaneClient que lanza, `m` libre) están VERIFIED contra el código real. Los ASSUMED son decisiones de diseño con recomendación, no hechos sin verificar.

## Open Questions

1. **¿La fase incluye `/gsd-ui-phase` antes de planificar?**
   - Lo que sabemos: CONTEXT marca "UI hint: yes" para el overlay de proyectos + sub-overlay de módulos + estados loading/error. Una observación de memoria nota "Phase 64 blocked by missing UI-SPEC from phase 63" — Phase 63 NO produjo UI-SPEC (no existe en su carpeta).
   - Lo que no está claro: si el orquestrador correrá `/gsd-ui-phase` para Phase 64.
   - Recomendación: dado que el render reusa moldes de 63 (lista navegable + text-input + footer), una UI-SPEC ligera bastaría; el riesgo está en el LAYOUT del sub-overlay de módulos y el truncado de rutas largas (discreción D). No bloquea el plan técnico.

2. **¿Quitar mapeo directo o con confirmación modal?**
   - Lo que sabemos: D-03 lo deja a discreción; CONTEXT recomienda directo.
   - Recomendación: directo + footer de undo-hint en v1 (simplicidad). `mode:'confirm'` (molde dismiss, `App.js:697`) está disponible si el planner lo prefiere — quitar un mapeo no es destructivo de datos (re-mapeable), así que el modal puede ser sobre-ingeniería.

3. **¿Degradación parcial en `projects-error` (mostrar mapeo local cacheado) en v1?**
   - Lo que sabemos: `loadProjects()` es 100% local y never-throws (`config.js:173`); el snapshot local está disponible aunque la lista remota falle (Pitfall 5).
   - Recomendación: v1 = error+retry simple (más simple de testear); la degradación parcial (mostrar el mapeo local sin nombres del provider) es un nice-to-have que el planner puede diferir. D-07 lo deja a discreción.

4. **¿Editor de módulos en la misma ola que el editor de rutas, o ola separada?**
   - Lo que sabemos: módulos añade 2 modos (`projects-modules-loading`/`projects-modules`) + el wiring asimétrico de `listModules`.
   - Recomendación: separar en una ola/plan posterior dentro de la fase (PROJ-01/02/03/05 primero, PROJ-04 después) — reduce el blast radius y permite verificar el carril async base antes de añadir el segundo hop. El planner decide según su estructura de olas.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | todo | ✓ | 22.22.3 (>= engines 20) | — |
| ink / react | TUI | ✓ | 6.8.0 / 19.2.0 | — |
| ink-testing-library | tests | ✓ | 4.0.0 (devDep) | — |
| Provider Plane (red) | `listProjects`/`listModules` en runtime | runtime-dependent | — | **PROJ-05 ES el fallback**: `projects-error` + retry; los tests inyectan fakes (sin red) |
| API key del provider (`~/.kodo/.env`) | construir `PlaneClient` | runtime-dependent | — | Ausente → `PlaneClient` lanza → wrapper → `projects-error` (never-throws) |
| `~/.kodo/projects.json` | snapshot de mapeo local | runtime-dependent | — | `loadProjects` cae a `{}` si falta (never-throws, `config.js:175`) |

**Missing dependencies with no fallback:** ninguna que bloquee la implementación o los tests (todo el carril de red se inyecta como fake en tests).
**Missing dependencies with fallback:** la conexión al provider y la API key son runtime — su ausencia ES el caso PROJ-05, manejado por diseño.

## Sources

### Primary (HIGH confidence — código real del repo)
- `src/cli/dashboard/App.js` — sub-máquina de modos completa: `deriving` (632-690), `c`/`l` token guard (939-941, 982-984), `config`/`config-edit` (785-886), handlers list incl. verificación de `m` libre (914-1158), `overlayReqRef` (426), footer hint (1216), copy `CONFIG_*` (229-231) `[VERIFIED]`
- `src/cli/dashboard/index.js` — wiring DI: lazy import config (106), `loadProjects` (154-155), wrappers `loadConfigFn`/`onSaveConfig` (204-218) `[VERIFIED]`
- `src/cli/dashboard/SessionTable.js` — `renderConfigOverlay` + render del cursor (280-332), early-return por modo (421-432) `[VERIFIED]`
- `src/config.js` — `loadProjects`/`saveProjects` con `writeFileAtomic` (173-187), `loadConfig` spread superficial (157) `[VERIFIED]`
- `src/cli.js` — wizard `kodo config`: flujo lineal a espejar (655-754), estado de mapeo (666-668), validación `existsSync` (689,727), módulos vía PlaneClient directo (704-710), forma `{default,modules}` (737) `[VERIFIED]`
- `src/interface.js` — contrato `TaskProvider` con `listProjects` (47,61); `listModules` AUSENTE del contrato `[VERIFIED]`
- `src/providers/plane/provider.js` — `listProjects` (411-418); uso interno de `client.listModules` (148,336) `[VERIFIED]`
- `src/providers/plane/client.js` — `listProjects` (280-283), `listModules` (151-154), constructor lanza sin key (13-15), `fetch` con timeout (46-53) `[VERIFIED]`
- `src/providers/github/provider.js` — `listProjects` = config.repos, cero API, sin módulos (224-230) `[VERIFIED]`
- `src/providers/registry.js` — `initRegistry`/`getProvider` + validación contra `TASK_PROVIDER_METHODS` (96-125) `[VERIFIED]`
- `src/session/manager.js` — `resolveProjectPath` consume forma dual (78-103) `[VERIFIED]`
- `src/cli/adopt.js` — consume `loadProjects()` forma dual (115-135) `[VERIFIED]`
- `test/dashboard-config.test.js` / `test/dashboard-overlay.test.js` — molde de test hermético (injectProps, drain, fakes) `[VERIFIED]`
- `.planning/phases/63-.../63-RESEARCH.md` — fundación reusada (text-input, atomic write, pitfalls) `[VERIFIED]`

### Secondary (MEDIUM confidence)
- Semántica de `statSync` que lanza vs `existsSync` silencioso — comportamiento estándar de `node:fs`, consistente con el repo `[CITED: Node fs docs]`

### Tertiary (LOW confidence)
- Ninguna afirmación central depende de fuentes no verificadas.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — cero deps nuevas; todo verificado en Phase 63 contra `node_modules`
- Async fetch + token guard: HIGH — molde `deriving`/`c`/`l` leído línea a línea en App.js
- Variancia de provider (listModules): HIGH — confirmado que NO está en la interfaz ni en los providers, solo en PlaneClient; consumo del wizard verificado
- PROJ-05 / never-throws async: HIGH — el wrapper `onSaveConfig` es el molde exacto; el constructor de PlaneClient que lanza está verificado
- Forma dual de projects.json: HIGH — consumidores (`manager.js`/`adopt.js`) y productor (wizard `cli.js`) leídos directamente
- Validador de ruta (FS): HIGH — `existsSync`/`statSync` estándar; el riesgo de `statSync` lanzando está documentado

**Research date:** 2026-06-29
**Valid until:** 2026-07-29 (stack estable; reverificar solo si se bumpea ink/react/node o si se refactoriza la máquina de modos de App.js)
</content>
</invoke>
