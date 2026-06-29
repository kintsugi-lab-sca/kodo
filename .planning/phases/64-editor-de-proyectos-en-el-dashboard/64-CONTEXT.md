# Phase 64: Editor de proyectos en el dashboard - Context

**Gathered:** 2026-06-29
**Status:** Ready for planning
**Mode:** `--auto` (decisiones auto-seleccionadas con la opción recomendada; revisar antes de planificar)

<domain>
## Phase Boundary

El operador **añade, edita o quita** el mapeo `proyecto del provider → ruta local` (+ carpetas de módulos opcionales) desde el dashboard TUI, listando los proyectos **en vivo** con `listProjects()` y persistiendo a `~/.kodo/projects.json` vía `saveProjects` (ya atómico desde Phase 63). Reusa la **fundación de Phase 63** (overlay de edición, text-input editable en ink, módulo de validadores puros, footer transitorio de aviso de reinicio, degradación never-throws) y **espeja el flujo lineal del wizard CLI** `kodo config` (`src/cli.js:655-745`: listar proyectos → ruta con validación `existsSync` → módulos vía `listModules`).

**Diferencia clave vs Phase 63 (mayor riesgo):** la fuente de datos es **async y depende del provider** (`listProjects()` es una llamada de red en Plane). El editor DEBE degradar con gracia si la conexión falla (PROJ-05): comunicar el error, permitir reintentar o salir, sin crashear (panel ink montado) ni corromper el mapeo existente.

**En alcance:** overlay de lista de proyectos en vivo con estado de mapeo · editar/asignar ruta local con validación de existencia · quitar mapeo · mapeo opcional de módulos · persistencia local no-corruptiva a `projects.json` con aviso de reinicio · estados async de carga/error/retry.

**Fuera de alcance:** edición de ajustes comunes (`config.json`) → ya cubierto en Phase 63; edición de `provider` activo / API keys / `base_url` / `workspace_slug` / `api_key_env` (CFGF-03, diferido); hot-reload (CFGF-01); endpoint nuevo en `server.js`; refactor del wizard `kodo config` CLI; crear proyectos en el provider (solo se mapean los existentes).

> **UI hint: yes** — el sub-trabajo overlay de proyectos + sub-overlay de módulos + estados async (loading/error) es candidato a `/gsd-ui-phase` antes de planificar.

</domain>

<decisions>
## Implementation Decisions

> Todas auto-seleccionadas en modo `--auto` con la opción recomendada. Marcadas con `[auto]`. La fundación de Phase 63 (D-01..D-12 de `63-CONTEXT.md`) se da por **heredada y vigente**; aquí solo se decide lo nuevo de Phase 64.

### Fetch async de `listProjects()` + estados (GA-1)
- **D-01 `[auto]`:** Espejar el patrón async `deriving` de Phase 62. Al pulsar la tecla de apertura desde `mode:'list'`, entrar a `mode:'projects-loading'`, disparar `listProjects()` (DI `listProjectsFn`) con **guarda de request-token** (molde `overlayReqRef`/`adoptReqRef`). En éxito → snapshot **congelado** de `{ remoteProjects, projectsMap = loadProjects() }` + `mode:'projects'`. En fallo → `mode:'projects-error'` (PROJ-05). El poll de `/status` sigue corriendo por debajo sin tocar el overlay (molde `overlaySnapshot` D-04 de 63).
  - *Descartado:* fetch síncrono al render (bloquea / no aplica a una llamada de red); precargar la lista en el poll global (acopla el editor al ciclo de status y contamina el estado base del dashboard).

### Modos nuevos + navegación (GA-2)
- **D-02 `[auto]`:** Modos nuevos espejo de Phase 63: **`mode:'projects'`** (lista navegable de proyectos remotos con su estado de mapeo `[ruta]` / `sin mapear`) y **`mode:'projects-edit'`** (text-input editable de Phase 63 — D-01 de 63 — para la ruta), más dos transitorios async **`projects-loading`** y **`projects-error`**. Se gatean en `useInput` **antes** del mode-gate de filtro, exactamente como `config`/`config-edit`.
- **D-03 `[auto]`:** Navegación **two-level + acciones por tecla en la lista** (NO un tercer menú de acciones):
  - `mode:'projects'`: ↑/↓ mueven el cursor (clamp sin wrap, molde `fieldCursor`/`adoptCursor`); `Enter` → `projects-edit` precargando la ruta actual (el `default` si la entrada es objeto, el string si es string, vacío si sin mapear); una tecla **quita el mapeo** (PROJ-03); una tecla **abre el editor de módulos** (PROJ-04); `Esc` cierra el overlay y vuelve a `mode:'list'` **preservando `selectedTaskId`** (UX-03 heredado, `resolveSelection` re-deriva la fila gratis).
  - `mode:'projects-edit'`: edición de texto (text-input de 63); `Enter` valida (ruta debe existir) y guarda; inválido → footer rojo + **NO escribe**, sigue en edición; `Esc` cancela sin guardar y vuelve a `mode:'projects'`.
  - *Razón:* dos niveles bastan para editar una ruta; las acciones discretas (quitar/módulos) como teclas evitan un tercer sub-menú innecesario (simplicidad primero).

### Validación de ruta (PROJ-02)
- **D-04 `[auto]`:** Reusar el módulo de validadores puros de Phase 63 (`src/config-validate.js`, D-06 de 63) añadiendo un validador de **ruta de directorio que debe existir** (`existsSync` + `statSync().isDirectory()`), contrato `{ ok:true, value } | { ok:false, error }`, never-throws. Corre **antes** de `saveProjects`. El wizard CLI ya valida con `existsSync` plano (`src/cli.js:686`, `:732`) — aquí se formaliza en el validador puro reusable.
  - *Concesión consciente:* este validador toca el filesystem (`existsSync`/`statSync`) mientras que el resto de validadores de 63 son no-I/O. El planner decide si va en `config-validate.js` o en un módulo adyacente (p. ej. `path-validate.js`) — discreción.

### Mapeo de módulos en v1 (GA-3 / PROJ-04)
- **D-05 `[auto]`:** Soporte **mínimo** de módulos, espejo del wizard CLI (`src/cli.js:700-740`). La tecla de módulos en `mode:'projects'` → `mode:'projects-modules-loading'` → `listModules(projectId)` (async, DI `listModulesFn`, mismo guard de token que D-01) → `mode:'projects-modules'` (lista de módulos con su mapeo), reusando el **mismo text-input + validador de ruta**. Persiste como `projects[id] = { default, modules: { [nombreMódulo]: ruta } }`.
  - Si el provider **no** expone `listModules` (GitHub: `listProjects()` devuelve `config.repos`, sin módulos — `src/providers/github/provider.js:224`) → footer informativo "este provider no tiene módulos", no-op, never-throws.
  - *Descartado:* editor de módulos full-grid en v1 (sobre-ingeniería); omitir módulos (PROJ-04 es criterio de éxito, no opcional para la fase).

### Forma de entrada en `projects.json` + quitar mapeo (GA-4 / PROJ-03)
- **D-06 `[auto]`:** Preservar la **forma dual** de `projects.json` exactamente como el wizard: entrada = `string` (solo ruta) **o** `{ default, modules }` (con módulos). Editar la ruta de una entrada-objeto **preserva `modules`** (actualiza solo `default`). Quitar mapeo (PROJ-03) = `delete projects[id]` + `saveProjects`. Guardar usa `saveProjects` (**ya atómico** vía `writeFileAtomic`, PERSIST-01/05 — heredado de 63) + **footer transitorio** de aviso de reinicio (PERSIST-03, molde `focusError`/`footerColor`, D-10 de 63).

### Degradación si `listProjects()` falla (GA-5 / PROJ-05 — carril de mayor riesgo)
- **D-07 `[auto]`:** `mode:'projects-error'`: panel/footer rojo con el mensaje de error; tecla `r` **reintenta** (re-dispara D-01), `Esc` **sale** a `mode:'list'`. Never-throws (panel ink permanece montado), `projects.json` **intacto** (el carril de fallo es de **lectura** de la lista remota — no se escribe nada). El snapshot de mapeo local (`loadProjects`, 100% local) PUEDE mostrarse aunque la lista remota falle (degradación parcial) — el planner decide si lo implementa en v1 o solo error+retry (discreción).

### Invariantes heredados de Phase 63
- **D-08 `[auto]` (PERSIST-02):** Persistencia **directa al filesystem** importando `saveProjects`/`loadProjects` de `src/config.js` en el proceso ink del dashboard — **NO shell-out, NO endpoint en `server.js`** (espejo de D-09 de 63). `index.js` del dashboard inyecta `listProjectsFn`/`listModulesFn`/`loadProjectsFn`/`saveProjectsFn` (o fakes DI) en `App`, espejo de cómo ya inyecta `loadConfig`/`saveConfig`/`projects`/`onAdopt`.
- **D-09 `[auto]`:** Never-throws / fail-open en todos los carriles (D-12 de 63); color-isolation (todo color vía props de `<Text>`); no-JSX/no-build (`React.createElement` plano); DI por `*Fn`; copy literal-estable **EXPORTADA** + asserts de igualdad anti-drift en tests.

### Tecla de apertura (GA-6)
- **D-10 `[auto]`:** Tecla **`m`** (mapeo de proyectos) abre el editor desde `mode:'list'`. Teclas ocupadas verificadas en `src/cli/dashboard/App.js` (`useInput`, mode list): `q / e c l p d o a` ↑/↓ Enter (Esc deliberadamente ignorado en lista); **`m` está libre**. El planner **re-verifica** que no colisione antes de implementar; alternativa `P` (shift) si surge conflicto.

### Claude's Discretion
- Tecla exacta de apertura si `m` colisiona (planner re-verifica; `m` libre hoy).
- Layout/render del overlay de proyectos y del sub-overlay de módulos (columnas, truncado de rutas largas, agrupación).
- Si el validador de ruta vive en `config-validate.js` o en un módulo adyacente (`path-validate.js`).
- Teclas exactas para **quitar mapeo** y **abrir módulos** dentro de `mode:'projects'` (sugerencia: `d`/`x` quitar, `m`/Enter-variant módulos) — evitar colisión con la navegación del propio sub-modo.
- Si en `projects-error` se muestra el mapeo local cacheado (degradación parcial) o solo error+retry en v1.
- Confirmación al quitar mapeo: reusar `mode:'confirm'` (modal) **vs** quitar directo con footer de undo-hint — recomendado quitar directo por simplicidad; el planner decide.
- Caps de longitud del buffer de ruta del text-input.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisito y trazabilidad
- `.planning/ROADMAP.md` — Phase 64 (Goal, 5 Success Criteria, requisitos PROJ-01..05) + contexto del milestone v0.14.
- `.planning/REQUIREMENTS.md` §PROJ (PROJ-01..05) + §PERSIST (PERSIST-01..05, compartidos con Phase 63) + Out of Scope + v2 (CFGF-01..03 diferidos).

### Fundación reusada (Phase 63 — leer entera, es la base de esta fase)
- `.planning/phases/63-editor-de-configuraci-n-en-el-dashboard-fundaci-n-ajustes-co/63-CONTEXT.md` — overlay + text-input editable (D-01), máquina de modos `config`/`config-edit` (D-03), snapshot congelado (D-04), navegación two-level (D-05), validadores puros (D-06), escritura atómica (D-08), persistencia local sin endpoint (D-09), footer transitorio de reinicio (D-10), invariantes de seguridad/degradación (D-11/D-12).

### Activos de código a reusar (verificados en scout 2026-06-29)
- `src/config.js` — `loadProjects`/`saveProjects` (`PROJECTS_PATH = ~/.kodo/projects.json`; `saveProjects` ya usa `writeFileAtomic`, líneas 173-187), `writeFileAtomic` (helper atómico de Phase 63, exportado), `KODO_DIR`, `migrateConfig` (preservar migración de schema).
- `src/cli.js:655-745` — wizard `kodo config`: listar proyectos con estado de mapeo `[ruta]`/`[sin mapear]`, asignar ruta con `existsSync`, **mapeo de módulos** vía `listModules` y forma `{ default, modules }`. **Es el flujo lineal exacto a espejar** en el editor del dashboard.
- `src/cli/dashboard/App.js` — máquina de modos `useInput` (`list`/`filter`/`overlay`/`confirm`/`deriving`/`config`/`config-edit`); `deriving` (Phase 62) = molde async await+token (D-01); `config`/`config-edit` (Phase 63) = molde de los nuevos `projects`/`projects-edit`; `overlaySnapshot` congelado (D-04 de 63); cursor de campos `fieldCursor`/`adoptCursor` (clamp sin wrap); footer `focusError`/`footerColor`; teclas ocupadas (verificación de `m`).
- `src/cli/dashboard/SessionTable.js` — render de footer + overlays; copy literal-estable EXPORTADA (molde para los mensajes de validación/guardado/error).
- `src/config-validate.js` — validadores puros de Phase 63 (extender con validador de ruta-directorio, D-04).
- `src/interface.js:47,61` — contrato `listProjects(): Promise<Array<{id, identifier, name}>>` del `TaskProvider`.

### Implementaciones de provider (degradación + módulos)
- `src/providers/plane/provider.js:411` + `src/providers/plane/client.js:280` — `listProjects()` Plane (llamada de red, puede fallar → PROJ-05); `listModules` para PROJ-04.
- `src/providers/github/provider.js:224` — `listProjects()` GitHub = `config.repos.map(...)` (cero API calls, **sin módulos** → no-op de D-05).

### Convenciones del proyecto
- `.planning/codebase/CONVENTIONS.md`, `.planning/codebase/ARCHITECTURE.md` — provider-agnostic, never-throws, DI por `*Fn`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `loadProjects`/`saveProjects` (`src/config.js`): lectura/escritura de `projects.json`; `saveProjects` **ya es atómico** (`writeFileAtomic`) — beneficio anticipado de Phase 63, PROJ no necesita re-hacer la escritura crash-safe.
- Text-input editable + validadores puros + footer transitorio + `overlaySnapshot` + cursor `fieldCursor`/`adoptCursor`: toda la maquinaria de UI de Phase 63 se reusa tal cual; Phase 64 solo añade modos nuevos y una fuente async.
- Patrón `deriving` (Phase 62) en `App.js`: molde de await async + request-token + never-throws para `listProjects()`/`listModules()`.
- Wizard CLI (`src/cli.js:655-745`): la lógica de negocio (estado de mapeo, validación de ruta, forma dual string/objeto, mapeo de módulos) ya existe en forma lineal — el editor la re-expresa en la TUI.

### Established Patterns
- never-throws / fail-open (panel ink siempre montado) — crítico para PROJ-05.
- color-isolation, no-JSX/no-build (`React.createElement` plano).
- DI por `*Fn` params para test con `ink-testing-library`.
- Copy literal-estable EXPORTADA + asserts anti-drift code/render.
- `projects.json` forma dual: `string` | `{ default, modules }`.

### Integration Points
- Nuevos modos `projects` / `projects-loading` / `projects-edit` / `projects-modules(-loading)` / `projects-error` se insertan en el `useInput` de `App.js`, antes del mode-gate de filtro, espejo de `config`/`config-edit`.
- Tecla `m` en `mode:'list'` dispara `listProjectsFn()` (async, token-guarded).
- `index.js` del dashboard inyecta `listProjectsFn`/`listModulesFn`/`loadProjectsFn`/`saveProjectsFn` (o fakes DI) en `App`.
- El validador de ruta (D-04) y la escritura (`saveProjects`) son importados por el handler de guardado.

</code_context>

<specifics>
## Specific Ideas

- Phase 64 es el **carril de mayor riesgo** del milestone v0.14: a diferencia de Phase 63 (100% local sync), depende de `listProjects()` (red/provider). La degradación con gracia (PROJ-05) es el criterio diferenciador.
- El flujo a espejar ya existe y está validado en el wizard CLI (`src/cli.js:655-745`) — el trabajo es portarlo a la TUI reusando la fundación de 63, no inventar lógica nueva.
- `saveProjects` ya es atómico (Phase 63 hizo el helper compartido `writeFileAtomic`) — confirmado en scout, no es deuda pendiente.
- Forma dual de `projects.json` (`string` vs `{ default, modules }`) debe preservarse exactamente para no romper a `src/session/manager.js:79` ni `src/cli/adopt.js:127`, que ya la consumen.

</specifics>

<deferred>
## Deferred Ideas

- **Crear proyectos en el provider desde el dashboard** — fuera de alcance; el editor solo mapea proyectos existentes.
- **Edición de `provider` activo / API keys / `base_url` / `workspace_slug` / `api_key_env`** — CFGF-03 (v2), heredado del scope de Phase 63.
- **Hot-reload de `projects.json` en server/daemon** — CFGF-01 (v2); se mantiene el aviso de reinicio (PERSIST-03).
- **Editor de módulos full-grid (multi-columna, batch)** — posible mejora de UX v2 si el mapeo módulo-a-módulo resulta tosco.
- **Caché persistente de la lista remota** (para mostrar proyectos sin conexión) — posible v2; en v1 la degradación es error+retry (+ mapeo local opcional, D-07).

None — la discusión (auto-resuelta) se mantuvo dentro del scope de la fase.

</deferred>

---

*Phase: 64-editor-de-proyectos-en-el-dashboard*
*Context gathered: 2026-06-29*
