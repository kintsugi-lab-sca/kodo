# Phase 80: Carril orquestador + reconciliación documental - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-23
**Phase:** 80-Carril orquestador + reconciliación documental
**Areas discussed:** Punto de invocación del piggyback, Gating/orden/fallo, Superficie de advisories, Reconciliación documental
**Mode:** --auto — todas las gray areas auto-seleccionadas; en cada pregunta se eligió la opción recomendada sin AskUserQuestion.

---

## Punto de invocación del piggyback

| Option | Description | Selected |
|--------|-------------|----------|
| In-process en `runCheckAndAct()` | Import directo de `scan`/`execute` del módulo doctor en `src/check.js`; determinista, 0 tokens, mismo patrón que `launchOrchestrator` | ✓ |
| LLM shellea `--fix` en cada ronda | El prompt/skill instruye al orquestador a ejecutarlo — no determinista, gasta tokens, no garantiza «≤1 pase» | |
| Dentro de `launchOrchestrator()` | Se llama también desde `kodo orchestrate` manual y tiene early-return "already exists"; mezcla higiene con launch | |

**Choice:** In-process en `runCheckAndAct()` (recommended default)
**Notes:** `kodo orchestrate` manual NO ejecuta el doctor — el carril es exclusivo de `kodo check`.

---

## Gating, orden y fallo dentro del pase

| Option | Description | Selected |
|--------|-------------|----------|
| Gate `needsOrchestrator === true`, doctor antes del launch, fail-open total | Solo pases motivados; el resultado del doctor nunca alimenta `reasons`; try/catch propio con línea de log | ✓ |
| Doctor en todo check (incluso All clear) | Convergería antes, pero rompe «piggyback en pases ya motivados» (success criterion 2) | |
| Doctor después del launch | El orquestador arrancaría con sidebar sucio y contextSummary desfasado | |

**Choice:** Gate estricto + antes del launch + fail-open (recommended default)

---

## Superficie de advisories (missing_group)

| Option | Description | Selected |
|--------|-------------|----------|
| Línea informativa en stdout del check | `[kodo:check] Sidebar advisories: N (acción de operador)`; nunca reason; skill documenta qué hacer | ✓ |
| Inyectar advisories en el contextSummary del launch | Infla el prompt del orquestador; redundante — puede correr dry-run bajo demanda | |
| Silencio total | Ocultaría deriva que requiere acción del operador | |

**Choice:** Línea informativa sin reason (recommended default)

---

## Reconciliación documental (reparto y profundidad)

| Option | Description | Selected |
|--------|-------------|----------|
| Asimétrico: skill detallada, prompt conciso | Skill canónica recibe § higiene sidebar + flujo diagnóstico 5 + features v0.17; prompt.md solo menciones de fallback; checklist manual HYG-08 | ✓ |
| Nivelar ambos docs con el mismo detalle | Rompe la jerarquía declarada (skill manda, prompt subordinado) y duplica mantenimiento | |
| Test automático de docs anti-deriva | Sobreingeniería para docs en prosa; HYG-08 se verificó como checklist manual | |

**Choice:** Reparto asimétrico + checklist manual (recommended default)
**Notes:** Bloque reporting y `resolvePromptTemplate`/`applyReportingGate` intactos (D-12).

---

## Claude's Discretion

Formato exacto de líneas de log, eventos `logger-events.js` si aplican, DI de tests para `runCheckAndAct`, estructura de tests, redacción exacta de las secciones nuevas de skill/prompt.

## Deferred Ideas

None — la discusión se mantuvo dentro del scope. FUT-02/FUT-03 ya trazados en REQUIREMENTS §Future.
