# Phase 64: Editor de proyectos en el dashboard - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-29
**Phase:** 64-editor-de-proyectos-en-el-dashboard
**Mode:** `--auto` (todas las gray areas auto-seleccionadas; opción recomendada elegida sin AskUserQuestion)
**Areas discussed:** Fetch async de listProjects, Modos + navegación, Validación de ruta, Mapeo de módulos v1, Forma de entrada + quitar, Degradación PROJ-05, Tecla de apertura

---

## Fetch async de `listProjects()` + estados (GA-1)

| Option | Description | Selected |
|--------|-------------|----------|
| Patrón `deriving` async (token-guard + snapshot) | Espejar Phase 62: loading → await listProjectsFn → snapshot/error | ✓ |
| Fetch síncrono al render | Bloquea, no aplica a llamada de red | |
| Precargar en el poll global de /status | Acopla el editor al ciclo de status, contamina estado base | |

**Auto-selected:** Patrón `deriving` async (D-01).
**Notes:** `listProjects` es la 1ª fuente async del editor; el molde `deriving` ya resuelve await+token+never-throws.

---

## Modos nuevos + navegación (GA-2)

| Option | Description | Selected |
|--------|-------------|----------|
| Two-level + acciones por tecla | `projects`/`projects-edit` espejo de config; quitar/módulos como teclas en la lista | ✓ |
| Three-level con menú de acciones | Lista → menú (editar/quitar/módulos) → edición | |
| Editor generalizado config+proyectos | Un solo editor con tabs | |

**Auto-selected:** Two-level + acciones por tecla (D-02/D-03).
**Notes:** Dos niveles bastan para una ruta; acciones discretas como teclas evitan un sub-menú innecesario.

---

## Validación de ruta (PROJ-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Validador puro reusando `config-validate.js` | Añadir validador de ruta-directorio (existsSync + isDirectory) | ✓ |
| Validación inline en el handler | Sin módulo reusable | |

**Auto-selected:** Validador puro (D-04).
**Notes:** Concesión consciente — este validador toca el filesystem (a diferencia de los no-I/O de 63). Planner decide ubicación (mismo módulo o `path-validate.js`).

---

## Mapeo de módulos en v1 (GA-3 / PROJ-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Mínimo, espejo del wizard CLI | sub-modo módulos vía listModulesFn async, reusa text-input + validador | ✓ |
| Editor full-grid multi-columna | Sobre-ingeniería para v1 | |
| Omitir módulos | PROJ-04 es criterio de éxito | |

**Auto-selected:** Mínimo, espejo del wizard (D-05).
**Notes:** GitHub no tiene módulos → footer informativo + no-op, never-throws.

---

## Forma de entrada en `projects.json` + quitar mapeo (GA-4 / PROJ-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Preservar forma dual string/objeto | string (ruta) o `{default, modules}`; quitar = delete + saveProjects | ✓ |
| Migrar todo a objeto siempre | Rompería consumidores que esperan string | |

**Auto-selected:** Preservar forma dual (D-06).
**Notes:** Consumido por `session/manager.js:79` y `cli/adopt.js:127`; editar ruta de entrada-objeto preserva `modules`.

---

## Degradación si `listProjects()` falla (GA-5 / PROJ-05)

| Option | Description | Selected |
|--------|-------------|----------|
| `projects-error` con retry (`r`) / exit (`Esc`) | never-throws, projects.json intacto (carril de lectura) | ✓ |
| Crashear / cerrar overlay | Viola never-throws | |

**Auto-selected:** `projects-error` con retry/exit (D-07).
**Notes:** Degradación parcial (mostrar mapeo local cacheado) queda a discreción del planner para v1.

---

## Tecla de apertura (GA-6)

| Option | Description | Selected |
|--------|-------------|----------|
| `m` (mapeo) | Libre verificada en App.js useInput; mnemónica | ✓ |
| `P` (shift) | Alternativa si `m` colisiona | |

**Auto-selected:** `m` (D-10).
**Notes:** Ocupadas: `q / e c l p d o a` ↑/↓ Enter. Planner re-verifica antes de implementar.

---

## Claude's Discretion

- Tecla exacta si `m` colisiona.
- Layout/render del overlay de proyectos y sub-overlay de módulos.
- Ubicación del validador de ruta (`config-validate.js` vs `path-validate.js`).
- Teclas exactas para quitar mapeo y abrir módulos dentro de `mode:'projects'`.
- Degradación parcial en `projects-error` (mostrar mapeo local) sí/no en v1.
- Confirmación al quitar mapeo (`mode:'confirm'` vs quitar directo con undo-hint).
- Caps de longitud del buffer de ruta.

## Deferred Ideas

- Crear proyectos en el provider desde el dashboard.
- Edición de provider activo / API keys / base_url / workspace_slug / api_key_env (CFGF-03, v2).
- Hot-reload de `projects.json` (CFGF-01, v2).
- Editor de módulos full-grid (v2).
- Caché persistente de la lista remota para uso offline (v2).
