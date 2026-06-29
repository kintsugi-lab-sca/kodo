# Phase 57: Orquestador asistido - Discussion Log

> **Audit trail only.** Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-18
**Phase:** 57-orquestador-asistido
**Mode:** `--auto` (sin interacción; Claude eligió la opción recomendada en cada área)
**Areas discussed:** Fuente de la sesión, Derivación del título, Confirmación, Saneo+descripción, Dónde vive el cambio

---

## Cómo obtiene el orquestador la sesión a adoptar

| Option | Description | Selected |
|--------|-------------|----------|
| Input explícito, sin descubrimiento (prosa) | El orquestador recibe workspaceRef/cwd/sessionId; no auto-descubre (ORCH-01 "toma input explícito"). | ✓ |
| Read-CLI `kodo surfaces` envolviendo listAgentSurfaces | Añadir un comando de descubrimiento determinista. | (flag al planner) |
| Orquestador llama cmux directo | Violaría la regla LOCKED (cmux solo vía host). | |

**Choice:** Input explícito (D-01), con FLAG al planner sobre la fuente práctica de las coordenadas.

## Derivación del título inteligente

| Option | Description | Selected |
|--------|-------------|----------|
| LLM compone desde cwd + `git log` + transcript-summary | El orquestador usa Bash/Read; conciso; core sanea. | ✓ |
| Solo cwd basename | Igual que el dashboard; sin valor añadido. | |
| Heurística determinista en código | Violaría "LLM solo en el consumidor". | |

**Choice:** LLM-driven (D-02).

## Confirmación antes de crear

| Option | Description | Selected |
|--------|-------------|----------|
| Proponer título+proyecto y esperar aprobación/edición | SC2 "se confirma humano/CLI"; nunca silencioso. | ✓ |
| Crear directo sin confirmar | Violaría SC2. | |

**Choice:** Confirmación interactiva (D-03).

## Saneo + descripción

| Option | Description | Selected |
|--------|-------------|----------|
| Solo `--title`; saneo automático en el core; descripción diferida | El core ya sanea (BIDIR-08); descripción opcional, nunca transcript crudo. | ✓ |
| Incluir descripción (resumen) ya | Resumen LLM corto. | (discreción) |
| Embeber transcript en descripción | Prohibido por BIDIR-08. | |

**Choice:** Solo título, saneo automático (D-04).

## Dónde vive el cambio

| Option | Description | Selected |
|--------|-------------|----------|
| Skill `kodo-orchestrate` + espejo en prompt.md; cero código nuevo | Prosa canónica en el skill, fallback condensado; launch.js intacto. | ✓ |
| Código nuevo en src/orchestrator | Violaría "cero lógica de negocio nueva". | |

**Choice:** Prosa en skill + prompt.md (D-05).

## Claude's Discretion
- Wording exacto de la sección del skill + espejo en prompt.md.
- Nº de commits que mira `git log` para el título.
- Si incluir `--description` (resumen) ahora o diferirlo a BIDIR-F2.
- Forma del read-CLI si el planner lo incluye.

## Deferred Ideas
- Descripción auto-derivada del transcript/diff → BIDIR-F2.
- Read-CLI de descubrimiento de surfaces → solo si el planner lo confirma necesario.
- Liveness de sesiones adoptadas → Phase 59.
- adopt hacia ClickUp / adapter local → BIDIR-F3.
