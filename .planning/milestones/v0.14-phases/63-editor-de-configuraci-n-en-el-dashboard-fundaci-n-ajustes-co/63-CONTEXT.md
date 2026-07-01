# Phase 63: Editor de configuración en el dashboard — fundación + ajustes comunes - Context

**Gathered:** 2026-06-29
**Status:** Ready for planning
**Mode:** `--auto` (decisiones auto-seleccionadas con la opción recomendada; revisar antes de planificar)

<domain>
## Phase Boundary

El operador edita los **ajustes comunes** de kodo desde el dashboard TUI mediante un overlay con un campo de texto **editable** en ink, y los cambios se persisten localmente a `~/.kodo/config.json` de forma **no-corruptiva**, sin re-correr `kodo config` ni añadir endpoints al server. Esta fase construye la **base de bajo nivel** del milestone v0.14 — overlay de config (UX-01), text-input editable en ink (UX-02, patrón de UX NUEVO: los overlays actuales `c`/`l`/`p` son read-only), cancel que preserva la selección por `task_id` (UX-03), degradación never-throws (UX-04), validación pre-escritura (CFG-05) y fontanería de escritura local no-corruptiva reusando `saveConfig`/`loadConfig` (PERSIST-01..05) — probada end-to-end con el editor de **ajustes comunes** (carril 100% local, sin conexión al provider, menor riesgo).

**Campos editables en esta fase (CFG-01..04):** `claude.default_model`, `claude.max_parallel`, `states.trigger`/`review`/`done` (del provider activo), `server.idle_threshold_min`, `server.stuck_threshold_min`, `cmux.colors.{running,done,error,review}`.

**En alcance:** overlay + text-input + navegación + validación + escritura atómica local + aviso de reinicio, todo sobre `config.json`.

**Fuera de alcance:** el editor de **proyectos** (`projects.json` / `listProjects()` en vivo) → Phase 64; edición de API keys / `provider` activo / `base_url` / `workspace_slug` / `api_key_env` (CFGF-03, diferido); hot-reload (CFGF-01); endpoint nuevo en `server.js`; refactor del wizard `kodo config` CLI.

> **UI hint: yes** — el sub-trabajo text-input/overlay es candidato a `/gsd-ui-phase` antes de planificar (UX-01/02/03 definen un contrato de interacción nuevo).

</domain>

<decisions>
## Implementation Decisions

> Todas auto-seleccionadas en modo `--auto` con la opción recomendada. Marcadas con `[auto]`.

### Componente text-input editable en ink (UX-02 — patrón nuevo)
- **D-01 `[auto]`:** Construir un **text-input in-house mínimo**, NO añadir dependencia (`ink-text-input` u otra). `package.json` solo declara `ink`/`react`/`picocolors`/`commander`; el patrón filter-mode de `App.js` ya tiene el 80% (append de `input`, borrado con `key.backspace||key.delete`). Se extiende con un **cursor visible** y un buffer controlado. Preserva los invariantes vigentes: color-isolation (todo color vía props de `<Text>`), no-JSX/no-build (`React.createElement` plano), y DI-testeable con `ink-testing-library`.
  - *Alternativas descartadas:* `ink-text-input` (dependencia nueva + superficie de color/JSX ajena al estilo del repo); reusar filter-mode verbatim (sin cursor, no cumple "cursor, backspace" de UX-02).

### Tecla de apertura + máquina de modos
- **D-02 `[auto]`:** Tecla **`e`** (edit) abre el overlay de config desde `mode:'list'`. Teclas libres verificadas (ocupadas: `q` `/` `c` `l` `p` `o` `a` `d` ↑/↓ Esc Enter); `e` está libre. El planner debe re-verificar que no colisione antes de implementar.
- **D-03 `[auto]`:** Dos estados nuevos en la máquina `mode` de `App.js`: **`'config'`** (lista de campos navegable, display read-only del valor actual) y **`'config-edit'`** (editando el campo seleccionado con el text-input D-01). Se gatean en `useInput` **antes** del mode-gate de filtro, espejo exacto del sub-modo `overlay`/picker existente (Phase 39/56).
- **D-04 `[auto]`:** La config se **congela en un snapshot al abrir** (molde `overlaySnapshot` de Phase 39), no se re-lee bajo el poll. El poll de `/status` sigue corriendo por debajo sin tocar el overlay.

### Navegación campo-lista → edición (two-level)
- **D-05 `[auto]`:** Flujo **two-level**:
  - En `mode:'config'`: ↑/↓ mueven un cursor (clamp sin wrap, molde `adoptCursor`) sobre la lista de campos editables; `Enter` entra a `mode:'config-edit'` precargando el valor actual en el buffer; `Esc` cierra el overlay y vuelve a `mode:'list'` **preservando `selectedTaskId`** (UX-03 — `resolveSelection` re-deriva la misma fila gratis).
  - En `mode:'config-edit'`: edición de texto (D-01); `Enter` valida y guarda (si inválido → footer rojo + NO escribe, sigue en edición); `Esc` cancela la edición y vuelve a `mode:'config'` sin guardar.

### Validación pre-escritura (CFG-05)
- **D-06 `[auto]`:** **Módulo de validadores PUROS nuevo** (sugerencia: `src/config-validate.js`), no-I/O, never-throws, contrato `{ok:true, value}` | `{ok:false, error}`. Reusado por el editor (y disponible para Phase 64). La validación corre **antes** de `saveConfig` — un valor inválido se rechaza con mensaje al footer y el archivo NO se escribe.
- **D-07 `[auto]`:** Reglas CFG-05:
  - `claude.max_parallel`, `server.idle_threshold_min`, `server.stuck_threshold_min` → **entero positivo**.
  - `claude.default_model` → ∈ set conocido **`{opus, sonnet, haiku}`** (valores que kodo pasa a `claude --model`; el default actual en `DEFAULT_CONFIG` es `opus`).
  - `states.trigger`/`review`/`done` → string no-vacío (trim).
  - `cmux.colors.{running,done,error,review}` → ∈ set conocido de colores cmux (default actual: `Amber`/`Green`/`Crimson`/`Blue`). El planner fija el set exacto válido (discreción).

### Escritura no-corruptiva atómica (PERSIST-01/05)
- **D-08 `[auto]`:** **Escritura atómica temp+rename**. El `saveConfig` actual hace un `writeFileSync` plano → NO es crash-safe. Se introduce un helper de escritura atómica (escribe a `<path>.tmp` en el mismo dir/filesystem y luego `rename` atómico) reusado por `saveConfig`/`saveProjects`. Si la escritura o serialización falla, el `config.json` previo queda **intacto** (nunca a medias, PERSIST-05). Cambio quirúrgico: preserva la firma de `saveConfig` y su formato actual (`JSON.stringify(cfg, null, 2) + '\n'`). El planner decide refactor in-place vs wrapper.

### Persistencia local sin endpoint + aviso de reinicio (PERSIST-02/03)
- **D-09 `[auto]`:** El editor escribe **directo al filesystem** importando `saveConfig` de `src/config.js` en el propio proceso ink del dashboard — **NO shell-out a `kodo config`, NO endpoint en `server.js`**. Razón: el dashboard ya corre en Node con acceso a `src/config.js`; importar `saveConfig` (función pura trivial) es más simple, determinista y testeable que spawnear un subproceso. (Phase 62 shelleó `kodo adopt` porque adopt tiene lógica compleja 0-token; aquí no aplica.) `src/server.js` queda intacto → preserva "cero endpoints nuevos desde v0.10".
- **D-10 `[auto]`:** Tras guardar con éxito → **footer transitorio** (molde `focusError`/`footerColor` de Phase 37/42) verde/ámbar con el aviso "reinicia server/daemon para aplicar" (PERSIST-03, sin hot-reload).

### Invariantes de seguridad y degradación
- **D-11 `[auto]` (PERSIST-04):** El editor **NUNCA** muestra ni edita API keys. La lista de campos editables se restringe EXPLÍCITAMENTE a los de D (domain). `providers.*.api_key_env`/`base_url`/`workspace_slug` y el `provider` activo quedan fuera (CFGF-03). Las keys viven solo en `~/.kodo/.env` (`loadEnvFile`, nunca en `config.json`).
- **D-12 `[auto]` (UX-04):** Degradación never-throws, molde del dashboard. Config ilegible al abrir → `loadConfig` ya cae a `DEFAULT_CONFIG` (never-throws actual); escritura fallida → footer rojo + panel ink montado + `config.json` previo intacto (D-08). Cero throws al árbol React.

### Claude's Discretion
- Tecla exacta si `e` colisiona (planner re-verifica; `e` está libre hoy).
- Layout/render del overlay de config (agrupación por sección claude/states/server/cmux, columnas).
- Set exacto de colores cmux válidos y si los campos enum (`default_model`, `cmux.colors`) se editan como free-text+validate o con cycle-through (↑/↓ entre valores conocidos) — recomendado: free-text+validate en v1 por simetría con el text-input.
- Ubicación/firma exacta del módulo de validadores (D-06) y del helper de escritura atómica (D-08).
- Caps de longitud del buffer del text-input.
- Si `states.*` se edita solo para el provider activo o para todos los configurados (recomendado: solo el activo).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisito y trazabilidad
- `.planning/ROADMAP.md` — Phase 63 (Goal, 5 Success Criteria, requisitos UX-01..04/CFG-01..05/PERSIST-01..05) + contexto del milestone v0.14.
- `.planning/REQUIREMENTS.md` §UX / §CFG / §PERSIST — los 14 requisitos completos + Out of Scope (qué NO tocar) + v2 (CFGF-01..03 diferidos).

### Activos de código a reusar (verificados en scout 2026-06-29)
- `src/config.js` — `loadConfig`/`saveConfig` (a hacer atómico, D-08), `migrateConfig`/`migrateConfigIfNeeded` (preservar migración de schema, PERSIST-01), `DEFAULT_CONFIG` (shape + default `opus`/`max_parallel:3`/thresholds/colors), `loadProjects`/`saveProjects` (Phase 64), `KODO_DIR`/`CONFIG_PATH`, `loadEnvFile` (las keys viven solo en `.env`, D-11).
- `src/cli/dashboard/App.js` — máquina de modos `useInput` (`list`/`filter`/`overlay`/`confirm`/`deriving`); el **filter-mode** (char-append `input` + `key.backspace||key.delete`) es el molde del text-input (D-01); footer transitorio (`focusError`/`footerColor`, D-10); `overlaySnapshot` congelado al abrir (D-04); cursor de picker (`adoptCursor`, clamp sin wrap, D-05); patrón never-throws + DI por `*Fn`.
- `src/cli/dashboard/SessionTable.js` — render del footer + overlays; copy literal-estable EXPORTADA (molde para los mensajes de validación/guardado).
- `src/cli.js:19-43` — comando `kodo config --set <key=value>` + `setNestedValue` (precedente de set-by-dot-path; útil como modelo, NO necesariamente reusado); wizard `interactiveConfig` con `node:readline` (CLI, **NO reusar para ink** — es otro paradigma).

### Patrón de fase reciente (overlay/mode)
- `.planning/milestones/v0.13-phases/62-adopci-n-inteligente-desde-el-dashboard/62-CONTEXT.md` — el sub-modo `deriving`/`confirm` más reciente añadido a la misma máquina de modos; referencia de cómo se integra un estado nuevo en `App.js` sin romper los existentes.

### Convenciones del proyecto
- `.planning/codebase/CONVENTIONS.md`, `.planning/codebase/ARCHITECTURE.md` — convenciones de código y arquitectura (provider-agnostic, never-throws, DI).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `loadConfig`/`saveConfig`/`migrateConfig` (`src/config.js`): fontanería de lectura/escritura + migración de schema. `saveConfig` necesita volverse atómico (D-08); el resto se reusa tal cual.
- Filter-mode de `App.js`: la lógica de append/backspace de la query es el esqueleto del text-input editable (falta cursor).
- Footer transitorio `focusError`/`footerColor` + `setMode` gating: molde directo para el aviso de guardado/reinicio y los mensajes de validación.
- `overlaySnapshot` + `adoptCursor`: moldes del snapshot congelado y del cursor navegable de la lista de campos.
- `setNestedValue` (`src/cli.js`): precedente de aplicar un valor por dot-path (modelo conceptual para `claude.default_model`, `server.idle_threshold_min`, etc.).

### Established Patterns
- never-throws / fail-open en todos los carriles del dashboard (panel ink permanece montado).
- color-isolation (todo color vía props de `<Text>`), no-JSX/no-build (`React.createElement` plano).
- DI por `*Fn` params para testabilidad con `ink-testing-library`.
- Copy literal-estable EXPORTADA + asserts de igualdad en tests (anti-drift code/render).

### Integration Points
- Nuevos estados `mode:'config'` / `mode:'config-edit'` se insertan en el `useInput` de `App.js`, antes del mode-gate de filtro.
- La tecla `e` en `mode:'list'` abre el overlay (snapshot de `loadConfig`).
- El módulo de validadores (D-06) y el helper de escritura atómica (D-08) son módulos nuevos puros, importados por el handler de guardado.
- `index.js` del dashboard inyecta `loadConfig`/`saveConfig` (o sus DI fakes) en `App`, espejo de cómo ya inyecta `projects`/`onAdopt`.

</code_context>

<specifics>
## Specific Ideas

- El text-input es deliberadamente la **2ª ruptura consciente** de "TUI read-only" (tras el dismiss de v0.10) — el milestone lo asume explícitamente.
- Modelo conocido por defecto hoy: `opus` (`DEFAULT_CONFIG.claude.default_model`). El set de validación arranca en `{opus, sonnet, haiku}`.
- Colores cmux por defecto: `Amber`/`Green`/`Crimson`/`Blue` (running/done/error/review).
- La escritura atómica beneficia también a Phase 64 (`saveProjects`) — vale la pena hacerla en el helper compartido, no solo en `saveConfig`.

</specifics>

<deferred>
## Deferred Ideas

- **Editor de proyectos** (`projects.json`, `listProjects()` en vivo, mapear/quitar ruta + módulos) — Phase 64 (reusa esta fundación).
- **Hot-reload de config en server/daemon** — CFGF-01 (v2). El operador aceptó el aviso de reinicio.
- **Edición TUI de campos estructurales del provider** (`base_url`, `workspace_slug`, `api_key_env`, `provider` activo) — CFGF-03 (v2).
- **`kodo config` CLI no-lineal** compartiendo fontanería con el editor del dashboard — CFGF-02 (v2).
- **Edición de cmux.colors con cycle-through (↑/↓ entre valores conocidos)** en vez de free-text — posible mejora de UX v2 si free-text resulta tosco.

None — la discusión (auto-resuelta) se mantuvo dentro del scope de la fase.

</deferred>

---

*Phase: 63-editor-de-configuraci-n-en-el-dashboard-fundaci-n-ajustes-comunes*
*Context gathered: 2026-06-29*
