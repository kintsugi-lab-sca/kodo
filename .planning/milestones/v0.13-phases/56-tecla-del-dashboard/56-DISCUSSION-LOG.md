# Phase 56: Tecla del dashboard - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-17
**Phase:** 56-tecla-del-dashboard
**Mode:** `--auto` (sin interacción; Claude eligió la opción recomendada en cada área y la registró)
**Areas discussed:** Wiring del descubrimiento, Presentación + selección, Resolución del proyecto, argv a kodo adopt, never-throws + footer

---

## Wiring del descubrimiento sin endpoint nuevo

| Option | Description | Selected |
|--------|-------------|----------|
| Host in-process (`getHost('cmux')` + `listAgentSurfaces()`) | El dashboard instancia el host y llama el seam in-process; cero endpoints. Espejo de `focus.js`. | ✓ |
| Endpoint nuevo `GET /surfaces` en el server | El server expone las surfaces; el dashboard hace fetch. | |
| Shell `kodo adopt` que descubre internamente | Delegar todo al CLI. | |

**Choice:** Host in-process (D-01). **Notes:** `interface.js:91` ya designa "el wiring del dashboard" como consumidor de `getHost`; preserva "cero endpoints nuevos desde v0.10". El endpoint nuevo se rechazó por violar el invariante. Set-difference (D-02) contra el snapshot vivo de `/status`, keyeado por `sessionId` nunca `workspaceRef` (defensa Phase 43).

---

## Presentación + selección de surfaces descubiertas

| Option | Description | Selected |
|--------|-------------|----------|
| Overlay picker (`mode:'overlay'`, 5º tras c/l/p) | Las ad-hoc no están en `state.json` → no son filas; se listan en overlay navegable. | ✓ |
| Filas inyectadas en la tabla existente | Mostrar adoptables como filas especiales. | |
| Adoptar la primera/única sin selección | Sin UI de selección. | |

**Choice:** Overlay picker (D-03). **Notes:** Discovery on-demand (NO poll). 0 adoptables / host sin soporte → footer informativo, sin overlay. Double-confirm espejo Phase 42, armado por identidad `sessionId` (D-04).

---

## Resolución del proyecto destino (`--project` required)

| Option | Description | Selected |
|--------|-------------|----------|
| Reverse-lookup `cwd → projectId` (helper puro) | Match contra `projects.json`; único → usar; ambiguo/sin match → footer + escape al CLI. | ✓ |
| Overlay extra de selección de proyecto | Pedir el proyecto interactivamente. | |
| Default fijo / primer proyecto | Asumir un proyecto. | |

**Choice:** Reverse-lookup (D-05). **Notes:** Mantiene el dashboard como consumidor fino, determinista 0-token, falla ruidoso. **FLAG planner:** confirmar shape de `projects.json` y semántica de match (exacto vs ancestro).

---

## argv a `kodo adopt` + estrategia de título

| Option | Description | Selected |
|--------|-------------|----------|
| `runAdopt` molde `runFocus`/`runOpen`, argv literal, sin `--title` | execFile sin shell; el core aplica `basename(cwd)`. | ✓ |
| Pasar `--title` derivado desde el dashboard | El dashboard deriva un título. | |
| `--json` + parseo del resultado | Consumir el discriminante JSON. | |

**Choice:** argv literal sin título (D-06). **Notes:** Título inteligente es Phase 57 (LLM). `--json` innecesario (footer interactivo). `exec` inyectado sin default (leak guard).

---

## never-throws + resultado al footer

| Option | Description | Selected |
|--------|-------------|----------|
| Footer transitorio (verde/rojo), espejo `OPEN_OK`/`DISMISS_ERR` | never-throws end-to-end, panel montado. | ✓ |
| Overlay de resultado | Mostrar el resultado en overlay. | |

**Choice:** Footer (D-07). **Notes:** Exit codes Opción A de `kodo adopt` (0/1/2) como detalle del footer; el dashboard no los reimplementa. Color isolation preservado (D-08).

---

## Claude's Discretion

- Nombres exactos de sub-modos del picker + máquina de confirm.
- Semántica del reverse-lookup `cwd → projectId` (exacto vs ancestro).
- Resolución del path del binario kodo.
- Copy exacta del footer y eventos NDJSON.
- Estructura del helper `computeAdoptable` (puro separado vs inline).

## Deferred Ideas

- Título inteligente desde cwd/commits/transcript → Phase 57 (ORCH-01).
- Auto-derivar flags de `kodo adopt` desde el seam → Phase 54/57.
- Backfill de descripción desde transcript/diff → BIDIR-F2.
- Endpoint `GET /surfaces` → rechazado (cero endpoints nuevos).
- adopt hacia ClickUp / adapter local → BIDIR-F3.
