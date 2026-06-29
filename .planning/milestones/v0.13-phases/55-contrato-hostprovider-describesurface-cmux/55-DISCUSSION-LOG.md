# Phase 55: Contrato `HostProvider.describeSurface()` (cmux) - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-16
**Phase:** 55-contrato-hostprovider-describesurface-cmux
**Mode:** `--auto` (todas las gray areas auto-seleccionadas; cada pregunta resuelta con la opción recomendada)
**Areas discussed:** Forma/nombre del método · Esquema de campos devueltos · Opcional vs contrato congelado · Fixture + contract-lock · Modos fail-open + dónde filtra

---

## Forma y nombre del método

| Option | Description | Selected |
|--------|-------------|----------|
| `listAgentSurfaces()` → array (enumeración) | Devuelve todas las surfaces-agente; lo que Phase 56 necesita para el set-difference | ✓ |
| `describeSurface(ref)` → 1 surface | Consulta per-ref de una surface ya conocida | |
| Ambos métodos | Enumeración + consulta per-ref | |

**Auto-selección:** `listAgentSurfaces()` (recommended) — el consumidor crítico (Phase 56) descubre TODAS las surfaces; un consumer per-ref filtra el array. Evita una segunda API especulativa (Karpathy regla 2).
**Notes:** Nombre exacto a confirmar por el planner; semántica (enumeración → array) fijada.

---

## Esquema de los campos devueltos

| Option | Description | Selected |
|--------|-------------|----------|
| camelCase `{ workspaceRef, cwd, sessionId, kind }` | Alineado con la entrada de `adoptSession` + DETECT-01/roadmap | ✓ |
| snake_case (espejo de `WorkspaceInfo`) | Consistente con el shape de observación existente | |

**Auto-selección:** camelCase (recommended) — encaja sin transformación en `adoptSession`; es un shape de input de adopción, no de observación de lifecycle. `sessionId = resume_binding.checkpoint_id`.

---

## Opcional typeof-detected vs contrato congelado

| Option | Description | Selected |
|--------|-------------|----------|
| Fuera de `HOST_METHODS`, typeof-detected | Espejo de `getTaskState`/`createTask`; degrada fail-open | ✓ |
| Añadir a `HOST_METHODS` (contrato requerido) | Obligaría a todos los hosts + NullHost a implementarlo | |

**Auto-selección:** Fuera del contrato congelado (recommended) — DETECT-01 lo exige "opcional typeof-detected"; preserva `HOST_METHODS` en 4.

---

## Fixture + contract-lock

| Option | Description | Selected |
|--------|-------------|----------|
| Fixture nueva + aserción vía `run` DI | `test/fixtures/cmux/surface-resume-show.json` servida por `fakeExecFromFixtures`, asertada campo a campo | ✓ |
| Sin fixture (mock inline) | JSON inventado en el test | |

**Auto-selección:** Fixture real + `run` DI (recommended) — DETECT-01 (a) lo exige; molde de las fixtures existentes. La fixture incluye casos válidos + de fallo.

---

## Modos fail-open y dónde vive el filtrado

| Option | Description | Selected |
|--------|-------------|----------|
| Método solo descubre; consumer hace el set-diff | never-throws fila-a-fila; dedup vs `state.json` (keyed por sessionId/cwd) en Phase 56 | ✓ |
| Método filtra adoptables contra `state.json` | El host conoce `state.json` y devuelve solo lo adoptable | |

**Auto-selección:** Método solo descubre (recommended) — preserva la regla transversal LOCKED (`adopt.js`/`reconcile.js` host-agnósticos); el set-difference keyed por `sessionId`/`cwd` (NUNCA `workspaceRef` — defensa Phase 43) vive en el consumer.

## Claude's Discretion

- Nombre final del método (`listAgentSurfaces` vs `describeSurfaces`).
- Helper puro `normalizeSurface(raw)` separado vs parseo inline.
- Si `NullHost` stubea el método o se deja ausente para probar la rama "host sin soporte".
- Nombres exactos de eventos NDJSON (`host.list_agent_surfaces.ok/fail`).

## Deferred Ideas

- Set-difference + tecla `a` del dashboard → Phase 56 (DETECT-02).
- Auto-derivar flags de `kodo adopt` desde el seam → Phase 54/57.
- P1 reconcile event-driven (`cmux events`) → v0.14.
- P2 sidebar nativo (`set-progress`/`set-status`) → mejora oportunista.
- P3 `notify` rico + `send-key` → oportunista.

## Pregunta abierta flageada al researcher

`cmux surface resume show --json` muestra UN surface en la fixture de research. Confirmar empíricamente el comando de **enumeración** de todas las surfaces (¿variante del mismo comando? ¿`surface resume list`? ¿iterar `~/.cmuxterm/claude-hook-sessions.json`?) antes de congelar la fixture.
</content>
