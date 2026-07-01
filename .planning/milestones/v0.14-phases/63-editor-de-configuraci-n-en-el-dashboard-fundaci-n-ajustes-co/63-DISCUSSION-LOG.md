# Phase 63: Editor de configuración en el dashboard — fundación + ajustes comunes - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-29
**Phase:** 63-editor-de-configuraci-n-en-el-dashboard-fundaci-n-ajustes-comunes
**Mode:** `--auto` (todas las gray areas auto-seleccionadas con la opción recomendada; sin interacción del usuario)
**Areas discussed:** Text-input editable en ink, Tecla + máquina de modos, Navegación campo→edición, Validación pre-escritura, Escritura no-corruptiva, Persistencia local sin endpoint

---

## Text-input editable en ink (UX-02)

| Option | Description | Selected |
|--------|-------------|----------|
| In-house mínimo | Extiende el patrón filter-mode de App.js (append+backspace) con cursor; cero deps | ✓ |
| `ink-text-input` (dep nueva) | Componente de tercero; añade dependencia + superficie de color/JSX ajena | |
| Reusar filter-mode verbatim | Sin cursor; no cumple "cursor, backspace" de UX-02 | |

**Auto-choice:** In-house mínimo (recomendado).
**Notes:** `package.json` solo tiene ink/react/picocolors/commander. Preserva color-isolation + no-JSX/no-build + DI-testable.

---

## Tecla de apertura + máquina de modos (UX-01)

| Option | Description | Selected |
|--------|-------------|----------|
| `e` + modos `config`/`config-edit` | Tecla libre; dos estados nuevos espejo del sub-modo overlay/picker | ✓ |
| `g` / `,` | Otras teclas libres; menos mnemónicas para "edit" | |

**Auto-choice:** `e` (recomendado). Planner re-verifica colisión.
**Notes:** Ocupadas: q / c l p o a d ↑↓ Esc Enter. Snapshot congelado al abrir (molde overlaySnapshot).

---

## Navegación campo-lista → edición (UX-02/03)

| Option | Description | Selected |
|--------|-------------|----------|
| Two-level | ↑↓ selecciona campo, Enter edita, Esc cierra preservando task_id | ✓ |
| Flujo secuencial | Recorre todos los campos en orden fijo; menos control | |

**Auto-choice:** Two-level (recomendado).
**Notes:** Esc en config-edit cancela sin guardar; Esc en config cierra preservando selección de sesión (UX-03).

---

## Validación pre-escritura (CFG-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Módulo de validadores puros nuevo | `{ok,value}`/`{ok,error}` never-throws; reusado por editor (y Phase 64) | ✓ |
| Validación inline en el handler | Sin módulo; menos testeable y no reusable | |

**Auto-choice:** Módulo puro nuevo (recomendado).
**Notes:** Set `default_model` = {opus, sonnet, haiku}; enteros positivos para max_parallel/thresholds; corre ANTES de saveConfig.

---

## Escritura no-corruptiva (PERSIST-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Atomic temp+rename | Escribe a `.tmp` + rename atómico; archivo previo intacto ante fallo | ✓ |
| writeFileSync directo (actual) | No crash-safe; un fallo a media escritura corrompe el archivo | |

**Auto-choice:** Atomic temp+rename (recomendado).
**Notes:** Helper compartido reusado por saveConfig/saveProjects (beneficia a Phase 64). Preserva firma + formato actual.

---

## Persistencia local sin endpoint (PERSIST-02/03)

| Option | Description | Selected |
|--------|-------------|----------|
| Escritura directa vía `saveConfig` importado | Mismo proceso ink; simple, determinista, testeable | ✓ |
| Shell-out a `kodo config --set` | Spawn de subproceso; innecesario para una función pura trivial | |
| Endpoint nuevo en server.js | Viola "cero endpoints nuevos desde v0.10" | |

**Auto-choice:** Escritura directa (recomendado). `src/server.js` intacto.
**Notes:** Footer transitorio con aviso de reinicio tras guardar (sin hot-reload).

---

## Claude's Discretion

- Tecla exacta si `e` colisiona; layout del overlay; set exacto de colores cmux válidos; free-text+validate vs cycle-through para enums; ubicación/firma de los módulos nuevos (validadores + atomic-write); caps del buffer; alcance de `states.*` (solo provider activo vs todos).

## Deferred Ideas

- Editor de proyectos → Phase 64.
- Hot-reload (CFGF-01), edición de campos estructurales del provider (CFGF-03), `kodo config` CLI no-lineal (CFGF-02) → v2.
- cmux.colors con cycle-through → posible mejora UX v2.
