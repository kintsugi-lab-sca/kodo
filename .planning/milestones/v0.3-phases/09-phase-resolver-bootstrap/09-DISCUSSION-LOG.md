# Phase 9: Phase Resolver + Bootstrap - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 09-phase-resolver-bootstrap
**Areas discussed:** Arquitectura resolver, Parser ROADMAP.md, Brief del bootstrap, Failure + inspect UX

---

## Gray Area Selection

| Option | Description | Selected |
|--------|-------------|----------|
| Arquitectura resolver | Módulos, contrato de retorno, stamp point phase_id | ✓ |
| Parser ROADMAP.md | Heading levels + normalización de título | ✓ |
| Brief del bootstrap | Canal de delivery al /gsd-new-project | ✓ |
| Failure + inspect UX | Fallos del resolver + kodo gsd inspect | ✓ |

**User's choice:** Todas las 4 áreas.

---

## Arquitectura resolver

### Q1: ¿Cómo organizar los módulos GSD del resolver?

| Option | Description | Selected |
|--------|-------------|----------|
| Parser + resolver separados (Recommended) | `roadmap.js` parser puro + `resolver.js` orquestación I/O | ✓ |
| Todo en `roadmap.js` | Un solo archivo, mezcla I/O con lógica | |
| Tú decides | Claude elige | |

### Q2: ¿Qué forma devuelve `resolvePhase()`?

| Option | Description | Selected |
|--------|-------------|----------|
| Discriminated union (Recommended) | `{action: 'phase'\|'bootstrap'\|'error', ...}` | ✓ |
| Flags planos | `{bootstrap, phase_id?, error?}` | |
| Throw on error | Retorna ok; lanza excepción | |

### Q3: ¿Dónde se ejecuta el resolver y stampea `phase_id`?

| Option | Description | Selected |
|--------|-------------|----------|
| Dispatcher, paralelo a sessionId (Recommended) | Tras lock, antes de launchWorkItem | ✓ |
| Dentro de launchWorkItem | Manager llama al resolver | |
| SessionStart hook (lazy) | Hook lee ROADMAP on-the-fly | |

### Q4: ¿Cómo expone el módulo la capacidad de `inspect`?

| Option | Description | Selected |
|--------|-------------|----------|
| Misma `resolvePhase()` + formatters (Recommended) | CLI reusa la misma función | ✓ |
| Función `inspectPhase()` separada | Helper específico del CLI | |

---

## Parser ROADMAP.md

### Q1: ¿Qué niveles de heading debe aceptar el parser?

| Option | Description | Selected |
|--------|-------------|----------|
| `##` y `###`, regex tolerante (Recommended) | Acepta ambos, pragmático con el ROADMAP actual | ✓ |
| Solo `##` (estricto a spec) | Cumple spec literal, rompe ROADMAP actual | |
| Cualquier nivel 1-4 | Demasiado permisivo | |

### Q2: ¿Cómo se extrae y compara el título del heading?

| Option | Description | Selected |
|--------|-------------|----------|
| Strip 'Phase N:' prefix, compara contra task.title (Recommended) | Humano solo escribe el título en Plane | ✓ |
| Comparar heading completo | Exige 'Phase N:' en task.title | |
| Match por número + fallback a título | Dos formas de resolver, rompe 1:1 estricto | |

### Q3: ¿Cómo normalizar strings para el match?

| Option | Description | Selected |
|--------|-------------|----------|
| Trim + collapse whitespace + case-insensitive (Recommended) | Minimal, estricto | ✓ |
| Agresiva (strip punctuation + backticks) | Debilita 1:1 | |
| Solo trim, todo lo demás exacto | Ultra-estricto | |

### Q4: ¿Sub-fases decimales / rangos?

| Option | Description | Selected |
|--------|-------------|----------|
| Aceptar enteros y decimales; ignorar rangos (Recommended) | Forward-compatible con gsd-insert-phase | ✓ |
| Solo enteros por ahora | YAGNI | |

---

## Brief del bootstrap

### Q1: ¿Cómo llega el brief al comando `/gsd-new-project`?

| Option | Description | Selected |
|--------|-------------|----------|
| Inline en additionalContext (Recommended) | Bloque 'Project brief' antes de los comandos | ✓ |
| Archivo temporal `.planning/.kodo/brief.md` | Ensucia repo | |
| Argumento del slash command | Escape/length issues | |

### Q2: ¿Qué contenido incluye el brief?

| Option | Description | Selected |
|--------|-------------|----------|
| task.title + task.description + task.url (Recommended) | + attachments diferidos a v0.4 (ver nota del usuario) | ✓ |
| Solo task.description | Requiere desc autosuficiente | |
| Template estructurado (goals/scope/constraints) | Sobre-ingeniería | |

**User notes:** Usuario preguntó por incluir ficheros adjuntos Plane. Diferido a v0.4 (requiere extender TaskItem contract, llamada API Plane, política de entrega).

### Q3: ¿Qué hace el bootstrap si `task.description` está vacía?

| Option | Description | Selected |
|--------|-------------|----------|
| Inyectar solo título + URL (Recommended) | Log `brief_empty: true` para visibilidad | ✓ |
| Fallar y no arrancar la sesión | Fricciona al humano | |
| Tratar como sí hubiera: seguir normal | Conservador | |

### Q4: ¿Orden del bloque brief vs comandos?

| Option | Description | Selected |
|--------|-------------|----------|
| Brief primero, comandos después (Recommended) | Orden natural de lectura | ✓ |
| Comandos primero, brief en apéndice | | |

### Q5 (follow-up): Attachments Plane → fase actual o diferido?

| Option | Description | Selected |
|--------|-------------|----------|
| Diferir a v0.4 (Recommended) | Noted en deferred ideas con rationale | ✓ |
| Incluir en Phase 9 como URLs solo | Añade plans, rompe contrato TaskItem | |
| Diseñar contrato ahora, implementar después | Contrato sin tests | |

---

## Failure + inspect UX

### Q1: ¿Cómo trata el resolver 0 matches y >1 matches?

| Option | Description | Selected |
|--------|-------------|----------|
| Ambos bloquean launch con error (Recommended) | Fail-closed estricto, libera lock | ✓ |
| 0 matches → bootstrap, >1 → bloquear | Rompe guard de presencia | |
| Ambos → sesión genérica (no-GSD) | Rompe expectativas del label | |

### Q2: ¿Qué hace si falta `ROADMAP.md` pero `.planning/PROJECT.md` existe?

| Option | Description | Selected |
|--------|-------------|----------|
| Fail-closed como >1 match (Recommended) | Estado inconsistente → error visible | ✓ |
| Tratar como bootstrap necesario | Riesgo de sobrescribir planning | |
| Sesión genérica | Pierde visibilidad del problema | |

### Q3: ¿Qué formato de salida tiene `kodo gsd inspect <task-id>`?

| Option | Description | Selected |
|--------|-------------|----------|
| Humano por defecto, `--json` opt-in (Recommended) | Sigue patrón de `kodo logs` | ✓ |
| Solo JSON | Obliga a jq | |
| Ambos siempre (stderr + stdout) | Viola un-canal-un-output | |

### Q4: ¿Qué scope cubre `kodo gsd inspect`?

| Option | Description | Selected |
|--------|-------------|----------|
| Verdict + preview del contexto GSD inyectado (Recommended) | Confirma end-to-end sin side effects | ✓ |
| Solo verdict del resolver | Menos útil para debugging | |
| Verdict + todo el launch plan (lock, workspace, cmd) | Riesgo de side effects | |

---

## Claude's Discretion

- Nombre exacto del flag `action` para error dispatcher (`resolver_failed` sugerido).
- Formato del header del preview en `kodo gsd inspect` (separadores, colores).
- Si `parseRoadmap` también expone el `## Progress` table o solo el listado.
- Organización de tests (unit parser con fixtures markdown, integración resolver con dirs temp).

## Deferred Ideas

- Attachments de Plane en el brief → v0.4
- Comentario automático Plane ante error de resolver → Phase 10 o post-milestone
- Normalización agresiva de títulos → reevaluar si surgen falsos negativos
- Multi-roadmap (monorepo) → GSD-F2 v2
- Persistencia del brief en disco → rechazada
- Auto-crear tarea Plane siguiente al completar fase → GSD-F3 v2
