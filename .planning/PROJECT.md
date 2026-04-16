# kodo

## What This Is

kodo es un bridge entre sistemas de gestión de tareas y sesiones de Claude Code via cmux. La arquitectura es provider-agnostic: cualquier sistema de tareas (Plane, GitHub Issues, ClickUp, local) se integra implementando la interfaz `TaskProvider` de 9 métodos. Plane CE es el primer adaptador implementado y validado.

## Core Value

Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación.

## Current Milestone: v0.3 GSD Integration + Structured Logging

**Goal:** Que una tarea Plane con label `kodo:gsd` arranque una sesión Claude que opera bajo el workflow GSD (1 tarea = 1 fase), con bootstrap automático si el repo no está inicializado, y que todo el sistema emita logs estructurados inspeccionables desde el CLI.

**Target features:**
- Tag `kodo:gsd` que dispara modo GSD en la sesión
- Resolver de fase: detecta bootstrap (`.planning/PROJECT.md`) y deriva número de fase desde ROADMAP.md
- Inyección de contexto GSD en `session-start` hook con instrucciones `/gsd:new-project` o `/gsd:plan-phase <n>`
- Skill del orquestador extendido para reconocer y supervisar tareas GSD
- Logger estructurado (niveles debug/info/warn/error, salida JSON)
- Archivo de log por sesión en `~/.kodo/logs/<session-id>.log`
- Comando `kodo logs <session-id>` para tail/inspección

## Requirements

### Validated

- ✓ TaskProvider interface genérica con 9 métodos (init + 7 negocio + listProjects) — v0.2
- ✓ TaskItem/TriggerEvent shapes canónicas provider-agnostic — v0.2
- ✓ PlaneProvider adaptador completo (normalizer, HMAC, labels) — v0.2
- ✓ Provider registry con factory functions y singleton caching — v0.2
- ✓ Todos los consumidores internos rewired a TaskProvider — v0.2
- ✓ Server como HTTP shell delegando a handleWebhookRequest — v0.2
- ✓ dispatchTrigger centralizado para webhook y CLI manual — v0.2
- ✓ Config wizard provider-agnostic con ensureConfig guard — v0.2
- ✓ Orchestrator prompt neutral con {{provider}} placeholders — v0.2
- ✓ State migration automática v1→v2 con schema_version — v0.2
- ✓ 122 tests cubriendo contratos, normalización, rewiring, triggers y config — v0.2
- ✓ Logger estructurado NDJSON con niveles (debug/info/warn/error) y redactor — v0.3 Phase 6
- ✓ `kodo logs` CLI con filtros (--level, --component, --event-type, --json, --follow) — v0.3 Phase 7
- ✓ Event taxonomy tipada (7 tipos: session.start/end, state.transition, orchestrator.review, gsd.phase.resolved, gsd.bootstrap, plane.api.call) — v0.3 Phase 7
- ✓ Correlación con transcript de Claude Code vía `transcript_path` en `session.start` — v0.3 Phase 7
- ✓ Resolver `kodo logs --session-of <plane-task-id>` (two-step: state.json → head-line scan) — v0.3 Phase 7

### Active

- [ ] Adapter de GitHub Issues que implementa TaskProvider
- [ ] Adapter de ClickUp que implementa TaskProvider
- [ ] Adapter local (JSON/Markdown) que implementa TaskProvider
- [ ] Polling trigger channel para providers sin webhook
- [ ] File watcher trigger para provider local
- [ ] Output del CLI con colores y formato mejorado

### Out of Scope

- Dashboard web — CLI es suficiente para uso personal
- Multi-tenant / multi-usuario — herramienta personal
- Persistencia en base de datos — JSON files suficientes para el volumen actual
- TypeScript migration — JSDoc + @ts-check cubre las necesidades sin build step
- Retry/backoff en la interfaz — responsabilidad de cada adapter internamente
- CRUD completo de tareas — kodo no crea ni elimina tareas, solo las lee y actualiza

## Context

**Current state (post v0.2):** 4,650 LOC JavaScript (1,868 LOC tests) across ~29 files. Node.js 20+ con una sola dependencia externa (commander). 122 tests passing.

**Architecture:**
- `src/interface.js` — TaskProvider/TaskItem/TriggerEvent typedefs + constants
- `src/providers/registry.js` — Provider registry (getProvider, initRegistry)
- `src/providers/plane/` — Plane adapter (provider, normalize, client, labels)
- `src/triggers/` — dispatcher.js (central dispatch) + webhook.js (HTTP-free handler)
- `src/session/` — state.js + manager.js + health.js (all provider-agnostic)
- `src/hooks/` — stop.js + session-start.js (use TaskProvider)
- `src/orchestrator/` — prompt.md ({{provider}} placeholders) + launch.js (resolvePromptTemplate)
- `src/server.js` — Slim HTTP shell (~130 lines)
- `src/cli.js` — Commander-based CLI with provider-agnostic wizard
- `src/config.js` — Config management with migration + getProviderApiKey

**Adding a new provider requires only:**
1. Create `src/providers/<name>/provider.js` implementing 9 TaskProvider methods
2. Register in `src/providers/registry.js`
3. No changes to generic modules needed

## Constraints

- **Stack**: Node.js, sin frameworks pesados, mínimas dependencias externas
- **Compatibilidad**: Breaking changes OK (v0.x, no hay usuarios externos)
- **Runtime**: Debe funcionar en macOS con cmux instalado
- **Tokens**: Vigilante/server consumen 0 tokens; solo el orquestador usa LLM

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Interfaz en JS puro con JSDoc @typedef | Consistente con el stack, sin build step | ✓ Good — 122 tests validate contracts |
| Plane como primer adaptador de referencia | Valida la interfaz con uso real | ✓ Good — all 9 methods exercised |
| Labels como mecanismo cross-provider | Funciona en Plane labels, GitHub labels, ClickUp tags | ✓ Good — parseKodoLabels is generic |
| Webhook + polling + manual como triggers | Cada proveedor tiene capacidades distintas | ✓ Good — webhook + manual validated |
| Pure helper extraction + DI for testability | Node 24 test runner lacks mock.module | ✓ Good — all consumers testable without mocking |
| Fire-and-forget dispatch in webhook handler | Fast HTTP response, session launch is async | ✓ Good — server responds 200 before dispatch |
| State migration clears active sessions | v1 schema incompatible with v2 fields | ✓ Good — clean break, no corruption |
| ensureConfig guards commands needing provider | First-run UX, auto-launches wizard | ✓ Good — clean onboarding flow |

---
*Last updated: 2026-04-16 — Phase 7 complete (kodo logs CLI + event taxonomy)*
