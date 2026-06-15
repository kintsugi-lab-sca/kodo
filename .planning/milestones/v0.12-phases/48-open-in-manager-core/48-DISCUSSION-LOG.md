# Phase 48: Open-in-manager core - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-11
**Phase:** 48-open-in-manager-core
**Areas discussed:** Feedback de éxito, Disponibilidad por estado, Link muerto / split-deploy

---

## Selección de áreas

| Área | Discutida |
|------|-----------|
| Feedback de éxito | ✓ |
| Disponibilidad por estado | ✓ |
| Taxonomía de errores | (delegada a Claude — espejo focus.js) |
| Link muerto / split-deploy | ✓ |

---

## Feedback de éxito

### Q1 — ¿Qué ve el operador al lanzar `open` con éxito?

| Option | Description | Selected |
|--------|-------------|----------|
| Confirmación transitoria | Footer `opening PROJ-123…` limpiado al siguiente keypress | ✓ |
| Silencio total (espejo focus) | Nada en footer; el navegador apareciendo es el feedback | |
| Tú decides | Claude evalúa el tradeoff | |

**User's choice:** Confirmación transitoria
**Notes:** La TUI no cambia visualmente al abrir el navegador → la confirmación da señal de que la tecla actuó.

### Q2 — ¿Qué muestra exactamente y de qué color?

| Option | Description | Selected |
|--------|-------------|----------|
| Ref + neutro/verde | `opening PROJ-123…` con task_ref, verde, sin prefijo `[!]` | ✓ |
| Genérico + neutro | `opening in browser…` sin ref | |
| Tú decides | Claude elige wording/color coherentes | |

**User's choice:** Ref + neutro/verde
**Notes:** Modelado sobre `DISMISS_OK` (verde + ref).

---

## Disponibilidad por estado

### Q1 — ¿Sobre qué filas funciona `o`?

| Option | Description | Selected |
|--------|-------------|----------|
| Toda fila con task_url | Abre sin importar alive/zombie/dismissed; único guard = sin URL | ✓ |
| Mismo guard que Enter | Rechaza zombies (alive===false) por consistencia de teclas | |
| Tú decides | Claude evalúa consistencia vs utilidad | |

**User's choice:** Toda fila con task_url
**Notes:** La task_url es independiente del estado de sesión; diverge deliberadamente del guard `alive===false` de Enter.

---

## Link muerto / split-deploy

### Q1 — Contrato cuando el operador no configuró `web_url` en deploy partido

| Option | Description | Selected |
|--------|-------------|----------|
| web_url es el único mecanismo | kodo abre lo que web_url produzca (default base_url); responsabilidad del operador configurarlo | ✓ |
| Guard + warning | kodo intenta detectar patrones de host API y avisa/bloquea | |
| Tú decides | Claude elige el contrato más honesto | |

**User's choice:** web_url es el único mecanismo
**Notes:** Sin heurísticas de detección de host API (frágiles). El caso `UNKNOWN-<seq>` ya está locked como "sin URL" por Success Criteria #5.

---

## Claude's Discretion

- **Taxonomía de mensajes de error:** delegada explícitamente — espejo de `focus.js`
  (`FOCUS_ERR_*`, formato `[!] … — press any key`). El no-url está locked.
- **Hint de footer:** añadir `o` a la línea de hints existente.
- **Dónde se detecta `UNKNOWN-<seq>`** (normalize vs launch): decisión del planner.

## Deferred Ideas

None — la discusión se mantuvo dentro del scope. Capacidades adyacentes ya listadas como
Out of Scope en REQUIREMENTS.md (picker multi-URL, cross-platform open, web view embebida,
pbcopy fallback).
