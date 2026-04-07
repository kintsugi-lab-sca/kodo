# kodo v0.2 — Provider Abstraction

## What This Is

kodo es un bridge entre sistemas de gestión de tareas y sesiones de Claude Code via cmux. Actualmente funciona solo con Plane CE. Este milestone abstrae el proveedor de tareas detrás de una interfaz genérica, refactorizando Plane como el primer adaptador y preparando la arquitectura para soportar GitHub Issues, ClickUp y un modo local sin servicio externo.

## Core Value

Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación.

## Requirements

### Validated

Capacidades existentes del sistema actual (v0.1):

- ✓ Webhook server recibe eventos y lanza sesiones — existing
- ✓ cmux client crea workspaces, envía comandos, lee screens — existing
- ✓ Session manager trackea sesiones en state.json — existing
- ✓ Labels (kodo, kodo:sonnet, kodo:haiku, kodo:yolo) controlan comportamiento — existing
- ✓ Health checker detecta sesiones gone/stuck/idle — existing
- ✓ Stop hook actualiza proveedor y notifica orquestador — existing
- ✓ SessionStart hook inyecta contexto — existing
- ✓ kodo check como vigilante sin tokens — existing
- ✓ Orquestador con skill de autoaprendizaje — existing
- ✓ Comentarios de progreso en tareas — existing
- ✓ Config wizard interactivo — existing

### Active

- [ ] Definir interfaz genérica `TaskProvider` con operaciones comunes
- [ ] Refactorizar `PlaneClient` como adaptador que implementa `TaskProvider`
- [ ] Desacoplar el server de Plane — usa `TaskProvider` en vez de `PlaneClient` directamente
- [ ] Desacoplar hooks de Plane — usan `TaskProvider`
- [ ] Desacoplar session manager de Plane — usa `TaskProvider`
- [ ] Desacoplar kodo check de Plane — usa `TaskProvider`
- [ ] Sistema de registro de proveedores (config selecciona cuál usar)
- [ ] Soporte para múltiples mecanismos de trigger (webhook, polling, manual)
- [ ] Mejorar error handling y logging en todo el sistema
- [ ] Mejorar UX del CLI: output más claro, feedback visual
- [ ] Refactorizar arquitectura interna para extensibilidad

### Out of Scope

- Adaptador de GitHub Issues — milestone futuro, primero la interfaz
- Adaptador de ClickUp — milestone futuro
- Adaptador local/archivo — milestone futuro
- Dashboard web — no necesario, el CLI es suficiente
- Multi-tenant / multi-usuario — es una herramienta personal
- Persistencia en base de datos — JSON files son suficientes para el uso actual

## Context

El sistema actual (v0.1) fue construido en una sesión y funciona end-to-end con Plane CE. El código tiene ~1500 líneas en 14 archivos JS. Usa Node.js 20+ con una sola dependencia externa (commander).

El acoplamiento a Plane está en:
- `src/plane/client.js` — API REST client
- `src/server.js` — webhook handler asume payload de Plane
- `src/hooks/stop.js` — actualiza estados de Plane directamente
- `src/hooks/session-start.js` — lee IDs de Plane
- `src/session/manager.js` — resuelve identifiers tipo "TENDERIO-42"
- `src/check.js` — cuenta tareas pendientes via Plane API
- `src/labels.js` — parsea labels de Plane
- `src/orchestrator/` — prompt referencia Plane MCP

Proveedores futuros previstos: GitHub Issues, ClickUp, modo local (JSON/Markdown).
Mecanismos de trigger: webhook (Plane, GitHub), polling (ClickUp, otros), CLI manual.

Codebase map disponible en `.planning/codebase/`.

## Constraints

- **Stack**: Node.js, sin frameworks pesados, mínimas dependencias externas
- **Compatibilidad**: Breaking changes OK (v0.x, no hay usuarios externos)
- **Runtime**: Debe funcionar en macOS con cmux instalado
- **Tokens**: Vigilante/server consumen 0 tokens; solo el orquestador usa LLM

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Interfaz en JS puro, no TypeScript | Consistente con el stack actual, JSDoc para tipos | — Pending |
| Plane como primer adaptador de referencia | Es el que funciona, valida la interfaz con uso real | — Pending |
| Labels como mecanismo de config inline | Funciona cross-provider (Plane labels, GitHub labels, ClickUp tags) | — Pending |
| Webhook + polling + manual como triggers | Cada proveedor tiene capacidades distintas | — Pending |

---
*Last updated: 2026-04-07 after initialization*
