# Phase 999.2 — SEED

> **Status:** BACKLOG. Promote with `/gsd-review-backlog` tras UAT sign-off de Phase 37.
> **Intended slot:** Phase 38 en v0.9 (empujar paneles auxiliares actuales a Phase 39).
> **Origin:** Sesión de diagnóstico 2026-05-29 con ROMAN-151/152 visibles en cmux GUI pero ausentes del dashboard de kodo.

## Goal

El dashboard `kodo dashboard` nunca pierde sesiones reanudables. Cuando el proceso Claude exit (turno terminado) pero la tab del workspace host sigue viva — esperando merge/push, segunda ronda con dudas, o input del usuario — la sesión queda como `idle` o `needs-input` en `state.sessions`, NO se mueve a `history`. La dependencia directa de cmux se elimina mediante un `WorkspaceHost` provider contract intercambiable (cmux hoy, orca u otros mañana), análogo al invariante v0.7 `TaskProvider 9-method contract`.

## Problema observado (2026-05-29)

ROMAN-151 (started 2026-05-28 11:33, ended 13:02) y ROMAN-152 (started 2026-05-29 08:01, ended 08:23) aparecen como `status: done` en `state.history` con `state.sessions = {}`. cmux GUI las tiene como tabs vivas con badge `🔔 Needs input`. El dashboard no las muestra porque sólo lista `state.sessions`. El usuario las pierde de vista justo en el momento donde más valor tendría verlas: esperando una decisión humana (merge, push, otra ronda de prompts).

## Causa raíz

`markSessionStatus(done)` se dispara al exit del proceso Claude, interpretando "turno terminado" como "sesión cerrada". El modelo correcto es:

| Estado | Significado | Ubicación |
|---|---|---|
| `running` | proceso vivo | `state.sessions` |
| `idle` | proceso exit, tab del host viva (esperando humano: merge / push / duda) | `state.sessions` |
| `needs-input` | host expone señal específica (cmux badge, orca equivalente) | `state.sessions` |
| `closed` / `archived` | tab cerrada + worktree resuelto + (opcional) task closed en provider | `state.history` |

`history` sólo debe contener `closed`.

## Requirements candidatos (TUI-17..TUI-20)

### TUI-17 — `WorkspaceHost` provider contract

`src/host/interface.js` con `HOST_METHODS` exportado + `getHost(name)` validador. Mínimo:

- `listWorkspaces()` → array de `{workspace_ref, alive, needs_input, last_activity}`
- `selectWorkspace(ref)` → fire-and-forget focus
- `isAlive(ref)` → bool
- `needsInput(ref)` → bool

`CmuxHost` migra la lógica actual de `src/cli/dashboard/focus.js` y `src/cmux/client.js`. Test de contrato análogo a `test/providers/contract.test.js`. **Cero referencias a cmux fuera de `src/host/cmux.js`** (color-isolation style guard).

### TUI-18 — Estados ciclo de vida `idle` / `needs-input` / `closed`

`markSessionStatus` acepta los nuevos estados; "proceso exit" mapea a `idle`, no `done`. Migración soft del state.json: entries de history con `ended_at` reciente cuya workspace_ref aún tiene tab en el host → vuelven a `sessions` como `idle`. Migración idempotente con `schema_version` bump (v2 → v3).

### TUI-19 — Dashboard render multi-estado

Listing une `state.sessions` (todos los estados no-closed); badges visuales por estado:

- `▶ running`
- `⏸ idle`
- `🔔 needs-input`
- `✗ dead`

El footer-error de Phase 36/37 absorbe errores del host. Filtros Phase 36 respetan multi-estado.

### TUI-20 — Reconciliación host ↔ state

Polling cruza `state.sessions + state.history` contra `host.listWorkspaces()`; rescata huérfanos de history que aún tienen tab; sella como `closed` los que ya no. Fire-and-forget, no bloquea render.

## Invariantes a preservar

- `TaskProvider 9-method contract` (v0.7) — el nuevo `WorkspaceHost` es hermano, no reemplazo.
- `findSession dual-scan` (v0.8 Phase 30) — sigue funcionando para lookup retrospectivo aunque ahora `idle` viva en `sessions`.
- `markSessionStatus contrato non-throwing` (v0.8 Phases 30+33) — la firma sigue retornando discriminated union `{ok, reason}`.
- `Color isolation` (`picocolors` sólo desde `src/cli/format.js`) — el nuevo host no introduce color.
- `Worktree always-on` (Phase 18).
- Plug del dashboard Phase 34-37: alt-screen toggle, SIGTERM handler, never-throws, literal-stable messages.

## Restricción de portabilidad (signal usuario 2026-05-29)

cmux podría reemplazarse por **Orca** (CLI también disponible). La fase debe terminar con:

- **Cero referencias a cmux** en `src/cli/dashboard/`, `src/session/`, `src/cli/polling.js`.
- cmux confinado a `src/host/cmux.js`.
- `OrcaHost` queda como follow-up no bloqueante (puede ir a v0.10 o como TUI-21 dentro del scope si encaja).

## Plans tentativos (4 plans — dimensión similar a Phase 37)

1. **Contract + CmuxHost impl + contract test** — `src/host/interface.js`, `src/host/cmux.js`, `test/host/contract.test.js`. Refactor `focus.js`, `polling.js` para consumir el host.
2. **Estados `idle`/`needs-input` en `markSessionStatus` + migración state.json** — schema v3, backup automático, migración idempotente.
3. **Dashboard render multi-estado con badges** — `SessionTable.js` badges + filtros multi-estado.
4. **Reconciliación host ↔ state vía polling** — debouncing para evitar flicker idle↔running.

## Dependencies

- **Depends on:** Phase 37 (focus wiring + `runFocus` orchestrator — base para extraer al host).
- **Depended-by:** Phase 39 ex-38 (paneles auxiliares) — los paneles operan sobre la tabla con modelo correcto.

## UAT

No requiere UAT manual bloqueante per sé. **Se recomienda re-correr el UAT de Phase 37 sobre el nuevo `CmuxHost`** para confirmar parity (los 2 escenarios obligatorios + 2 bonus de Phase 37 siguen pasando).

## Risk flags

- **Migración state.json es destructive** si schema_version bump no es idempotente → requiere backup automático (`state.json.bak.YYYYMMDD_HHMMSS`).
- **Reconciliación con polling puede causar flicker** en dashboard si la regla idle→running→idle se dispara rápido → debouncing en Plan 4 (cooldown ≥ 1 poll cycle).

## Evidencia

Inspección 2026-05-29 11:30 GMT+2:

```
$ jq '.history | map(select(.task_ref | test("ROMAN-15[12]"))) | map({task_ref, status, started_at, ended_at})' ~/.kodo/state.json
[
  { "task_ref": "ROMAN-152", "status": "done", "started_at": "2026-05-29T08:01:10.733Z", "ended_at": "2026-05-29T08:23:56.161Z" },
  { "task_ref": "ROMAN-151", "status": "done", "started_at": "2026-05-28T11:33:48.007Z", "ended_at": "2026-05-28T13:02:02.592Z" }
]
$ jq '.sessions | length' ~/.kodo/state.json
0
```

Screenshot de cmux GUI mostrando ROMAN-151/152 como tabs vivas con badge "Needs input": adjunto en sesión de chat 2026-05-29 (no comiteado).
