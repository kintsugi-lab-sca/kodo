# Phase 53: Fontanería `src/adopt.js` - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-16
**Phase:** 53-fontaner-a-src-adopt-js
**Mode:** `--auto` (Claude seleccionó la opción recomendada por gray area, sin prompts interactivos)
**Areas discussed:** Taxonomía del discriminante, Descomposición del módulo, Forma del fallo LOUD, Contrato de input + sanitización, Ubicación de la atomicidad tmp+rename

---

## Taxonomía del discriminante de error (BIDIR-03)

| Option | Description | Selected |
|--------|-------------|----------|
| 5 codes espejo de `gsd verify`/`dismiss` (`ALREADY_ADOPTED`/`UNSUPPORTED`/`CREATE_FAILED`/`PERSIST_FAILED` + ok) | Reusa el discriminante universal del codebase; los consumers ya saben ramificar | ✓ |
| `code` libre por call site, sin taxonomía fija | Más flexible, pero rompe el contrato que el CLI de Phase 54 deriva en exit codes | |

**Selección:** Taxonomía de 5 estados (recommended default). Cierra el D-09 diferido de Phase 52.
**Notas:** Las strings exactas las afina el planner coordinando con el CLI de Phase 54.

---

## Descomposición del módulo (BIDIR-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Split puro/impuro: `adoptSession` (async I/O) + `buildSessionFromAdoption` (puro) + `sanitizeAdoptionData` (puro) en `src/adopt.js` top-level | Testeable sin I/O, inverso de `buildSessionFromTask`, no sabe de GSD | ✓ |
| Un solo `adoptSession` monolítico que hace todo inline | Menos funciones, pero imposible testear el saneo/shape sin mockear I/O | |

**Selección:** Split puro/impuro en `src/adopt.js` top-level (recommended default).
**Notas:** `buildSessionFromAdoption` omite `dead_since`/`last_seen_alive` (reconcile-owned) para preservar la invariante de único escritor de `alive`.

---

## Forma del fallo LOUD post-persist (BIDIR-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Discriminante `{ ok:false, code:'PERSIST_FAILED', detail con task_id+task_url }`; consumer lo hace ruidoso | Uniforme con el resto del API; consumer ya ramifica sobre el discriminante | ✓ |
| `throw` de una excepción en el caso persist-fail | Literalmente "loud" pero fuerza try/catch divergente en cada consumer | |

**Selección:** Discriminante con code distinto (recommended default).
**Notas:** Tensión reconocida con la letra de BIDIR-05 ("never-throws solo para lectura"). Se resuelve haciendo el code semánticamente loud + `detail` con las coordenadas del huérfano y obligando al consumer (CLI: exit≠0 + stderr) a no tratarlo como benigno.

---

## Contrato de input + sanitización (BIDIR-04 / BIDIR-08)

| Option | Description | Selected |
|--------|-------------|----------|
| El core recibe `projectId`/`title` resueltos; `listProjects` y la derivación viven en el consumer; default `basename(cwd)` + sanitizer backstop en el core | Preserva 0-token / non-owner; los 3 consumers reusan sin poseer | ✓ |
| `adoptSession` llama a `listProjects` y resuelve proyecto internamente | Más "completo" pero acopla el núcleo a selección interactiva, rompe 0-token | |

**Selección:** Core recibe datos resueltos; selección en el consumer (recommended default).
**Notas:** Guard idempotencia = `loadState()` fresco + `findSession({workspaceRef,cwd})` ANTES del POST (espejo del re-read 409 de `dismiss`).

---

## Ubicación de la atomicidad tmp+rename (BIDIR-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Upgrade del único writer `saveState` a tmp+rename | Chokepoint único; todo escritor de estado se beneficia; quirúrgico (una función) | ✓ |
| Escritura atómica específica solo para la adopción | Más acotado pero deja el resto de escrituras de `state.json` no-atómicas | |

**Selección:** Upgrade de `saveState` (recommended default).
**Notas:** Blast radius reconocido — cambia la durabilidad de toda escritura de estado; justificado porque `state.json` es la invariante central. Planner: confirmar compat con el `.bak` snapshot de migración (`state.js:202-208`).

---

## Claude's Discretion

- Strings exactas de los `code` del discriminante.
- Firma exacta del objeto de input de `adoptSession`.
- Mecánica byte a byte del tmp+rename (sufijo temp, `fsync`).

## Deferred Ideas

- CLI `kodo adopt` (argv, exit codes) → Phase 54.
- Selección interactiva de proyecto (`listProjects`) + título inteligente → consumers (Phase 54/56/57, ORCH-01).
- Detección cmux (`describeSurface()`) → Phase 55.
