# Phase 8: GSD Label + Session Plumbing - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-17
**Phase:** 08-gsd-label-session-plumbing
**Areas discussed:** Inyección GSD en hook, Lock por repo, Schema de SessionRecord, Formato del contexto GSD

---

## Inyección GSD en hook

| Option | Description | Selected |
|--------|-------------|----------|
| Placeholder condicionado | Phase 8 inyecta bloque GSD con bifurcación: phase_id existe → comandos GSD con número; no existe → bootstrap /gsd-new-project | ✓ |
| Solo flag, sin inyección | Phase 8 solo propaga gsd=true. Inyección completa en Phase 9 | |
| Inyección genérica GSD | Bloque genérico "opera bajo GSD, espera instrucciones del resolver" | |

**User's choice:** Placeholder condicionado
**Notes:** Skill invocation directa, no prosa. Comandos usan forma `gsd-new-project` (guiones), no `gsd:new-project` (dos puntos).

### Sub-question: Bootstrap format

| Option | Description | Selected |
|--------|-------------|----------|
| Skill invocation directa | Literal /gsd-new-project con descripción de tarea como brief | ✓ |
| Prosa con contexto | Bloque elaborado en español con guía paso a paso | |

**User's choice:** Skill invocation directa
**Notes:** El usuario confirmó que la nueva versión de GSD usa `gsd-new-project` como nombre de skill.

---

## Lock por repo

### Lock release semantics

| Option | Description | Selected |
|--------|-------------|----------|
| TTL auto-release | Lock file con PID + timestamp. PID muerto o TTL expirado → robar automáticamente | ✓ |
| `kodo unlock` explícito | Intervención manual requerida ante crashes | |
| Híbrido | TTL + comando explícito | |

**User's choice:** TTL auto-release
**Notes:** Sin `kodo unlock` explícito. TTL default 4h.

### Lock check location

| Option | Description | Selected |
|--------|-------------|----------|
| Dispatcher | Centraliza guards. Solo evalúa cuando flags incluye 'gsd' | ✓ |
| Manager | Encapsulado en ciclo de vida de sesión | |

**User's choice:** Dispatcher

### Lock release trigger

| Option | Description | Selected |
|--------|-------------|----------|
| Hook stop | Se libera cuando Claude cierra. TTL cubre crash | ✓ |
| State transition | Se libera al cambiar a done/review/error | |
| Ambos | Belt and suspenders | |

**User's choice:** Hook stop

---

## Schema de SessionRecord

| Option | Description | Selected |
|--------|-------------|----------|
| Campo booleano simple | `gsd?: boolean` aditivo. Sin migración. Falsy = no GSD | ✓ |
| Objeto GSD anidado | `gsd: { enabled, phase_id?, ... }`. Más extensible, más complejo | |
| Tú decides | Claude elige | |

**User's choice:** Campo booleano simple
**Notes:** `phase_id?: string` como campo separado (preparación Phase 9).

---

## Formato del contexto GSD

### Reemplazo vs coexistencia

| Option | Description | Selected |
|--------|-------------|----------|
| Reemplaza | Contexto GSD sustituye instrucciones genéricas completamente | ✓ |
| Coexisten | Base genérico + sección GSD adicional | |
| Tú decides | Claude elige | |

**User's choice:** Reemplaza
**Notes:** Flujo GSD incompatible con genérico (no "comenta tu plan" ni "mueve a Review" manuales).

### Idioma

| Option | Description | Selected |
|--------|-------------|----------|
| Inglés | Skills GSD operan en inglés. Datos en su idioma original | ✓ |
| Español | Consistencia con contexto genérico existente | |

**User's choice:** Inglés

---

## Claude's Discretion

- Nombre y organización del módulo de lock
- TTL default exacto (4h sugerido)
- Formato del warn al robar lock
- Ubicación de `buildGsdContext` (mismo archivo o módulo aparte)
- Mecanismo de PID check (kill -0 vs /proc)

## Deferred Ideas

- `kodo unlock` CLI command — no necesario con TTL auto-release
- Lint rule anti-interpolación de secretos (deuda Fase 6)
- Refactor check.js separando snapshot/act (deuda Fase 6)
- Lock multi-tier repo + workspace (evaluar en v0.4)
