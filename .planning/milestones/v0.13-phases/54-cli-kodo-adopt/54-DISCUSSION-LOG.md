# Phase 54: CLI `kodo adopt` - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-16
**Phase:** 54-cli-kodo-adopt
**Mode:** `--auto` (Claude auto-selected the recommended option per area; no interactive prompts)
**Areas discussed:** Mapeo de flags → inputs, Taxonomía de exit codes, Resolución del proyecto, Forma del feedback

---

## Mapeo de flags → inputs de `adoptSession`

| Option | Description | Selected |
|--------|-------------|----------|
| `--session-id` explícito + `projectPath` resuelto local desde `loadProjects()[projectId]` | El CLI recibe `--session-id` como flag (independiente del spike); `projectPath` se deriva del mapeo de config, no es flag | ✓ |
| Sin `--session-id` (derivar de workspace) | Acoplaría la 54 a detección automática (rompe SC1 "input explícito") | |
| `--project-path` como flag explícito | Redundante con el mapeo de config existente; obliga al operador a repetir lo que ya está en config | |

**Selección (auto):** `--session-id <id>` required + `--workspace`/`--cwd` required; `--project <id>` → `projectId`, `projectPath` resuelto localmente vía espejo de `resolveProjectPath`. `--title`/`--description` opcionales (default + saneo en el core).
**Notes:** Phase 55 (`describeSurface`) auto-derivará session-id/cwd para los OTROS consumers; la 54 es el carril de input explícito.

---

## Taxonomía de exit codes derivada del discriminante

| Option | Description | Selected |
|--------|-------------|----------|
| Espejo Opción A de `gsd verify` (0/1/2) | 0=ok/ALREADY_ADOPTED, 1=INVALID_INPUT/UNSUPPORTED/PERSIST_FAILED(LOUD), 2=CREATE_FAILED(transient) | ✓ |
| Un exit code por cada estado del discriminante (0-5) | Más granular pero rompe la convención 0/1/2 del codebase y no aporta a scripts reales | |
| Solo 0/1 (éxito/fallo) | Pierde la distinción transient (CREATE_FAILED retryable) que un script operador necesita | |

**Selección (auto):** Mapeo Opción A. `ALREADY_ADOPTED`→0 (idempotente), `CREATE_FAILED`→2 (transient), `PERSIST_FAILED`→1 con banner LOUD (task_id+task_url).
**Notes:** Tensión reconocida en ALREADY_ADOPTED→0 (vs código de no-op distinto); resuelta a favor de idempotencia con mensaje explícito. Anotado como reconsiderable en Deferred.

---

## Resolución del proyecto: explícito vs interactivo

| Option | Description | Selected |
|--------|-------------|----------|
| `--project <id>` explícito required | Determinista, scriptable, simétrico con cómo dashboard/orquestador lo shellean | ✓ |
| Prompt interactivo `listProjects` en el CLI | Rompe scriptabilidad y la simetría con los consumers; UI especulativa | |

**Selección (auto):** `--project <id>` explícito required en v1. UI de selección diferida a dashboard (Phase 56) / orquestador (Phase 57).
**Notes:** SC1 enfatiza "input explícito (no detección automática)". Cierra el deferred de Phase 53 D-04 a favor del carril no-interactivo.

---

## Forma del feedback de salida

| Option | Description | Selected |
|--------|-------------|----------|
| Handler `src/cli/adopt.js` espejo de `runGsdVerifyCli` (human + `--json`) | Render TTY-aware vía formatter + `--json` byte-determinista del discriminante completo; DI testeable | ✓ |
| Solo human-readable (sin `--json`) | Rompe la convención scriptable del resto de CLIs (gsd verify/inspect, polling) | |
| Solo `--json` | Pobre DX para el operador interactivo | |

**Selección (auto):** `runAdoptCli(opts, deps)` con DI, render human (color semántico por severidad) + `--json`. Éxito → task_id/task_url/session_id; fallo → code/detail; PERSIST_FAILED → banner stderr.
**Notes:** Espejo 1:1 de `gsd-verify.js`. Color isolation vía `src/cli/format.js`.

---

## Claude's Discretion

- Texto exacto de mensajes human-readable (banner PERSIST_FAILED, mensaje ALREADY_ADOPTED, ayuda de projectIds disponibles).
- Ortografía de las flags si commander exige formato concreto (`--session-id` vs `--sessionId`).
- Si existe un fallback `projectPath = cwd` cuando `--project` se omite, o se rechaza con INVALID_INPUT (recomendado: required).
- Posición del comando en `src/cli.js` (top-level `kodo adopt` asumido).

## Deferred Ideas

- Auto-derivación de `--cwd`/`--session-id`/`workspaceRef` vía `describeSurface()` → Phase 55.
- Selección interactiva de proyecto (`listProjects`) + título inteligente → Phase 56/57 (ORCH-01).
- Tecla `a` del dashboard que shellea `kodo adopt` → Phase 56.
- Exit code distinto para ALREADY_ADOPTED (no-op ≠ éxito) — rechazado en v1, reconsiderable.
