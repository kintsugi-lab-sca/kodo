# Phase 52: createTask + contrato + anti-recursión - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-16
**Phase:** 52-createtask-contrato-anti-recursión
**Mode:** `--auto` (opción recomendada auto-seleccionada en cada gray area; sin AskUserQuestion)
**Areas discussed:** Mecanismo de anti-recursión, Estado inicial de la tarea, Payload + normalización, Test del método opcional, Scope del PAT GitHub

---

## Mecanismo de anti-recursión (BIDIR-06)

| Option | Description | Selected |
|--------|-------------|----------|
| Doble capa: label trigger ausente + marker `kodo:adopted` con corte `isAdopted` en dispatcher | Primaria (isKodo=false → ignored) + defensa que sobrevive `--force` (espejo `isGsdChild`) | ✓ |
| Solo estado pasivo (Backlog) para que `listPendingTasks` no la devuelva | Depende del estado, no del label; frágil ante cambios de config de estados | |
| Solo guard de sesión-ya-activa en state.json | Es la 3ª capa (Phase 53), no suficiente por sí sola en Phase 52 | |

**User's choice:** Doble capa (recomendada).
**Notes:** El dispatcher solo lanza con label trigger kodo (`dispatcher.js:77`); la tarea adoptada se crea sin él. El marker `kodo:adopted` + corte `isAdopted` (espejo `isGsdChild`, `dispatcher.js:68`, sobrevive `--force`) es defensa en profundidad + procedencia.

---

## Estado inicial de la tarea creada

| Option | Description | Selected |
|--------|-------------|----------|
| in-progress / activo (refleja la realidad — el humano ya trabaja) | El anti-redispatch viene del label ausente, no del estado | ✓ |
| Backlog / estado pasivo | Mentiría sobre el estado real del trabajo; acopla la anti-recursión al estado | |

**User's choice:** in-progress/activo (recomendada).
**Notes:** Resuelve la Open Question de STATE.md — el lever es label-based, no state-based.

---

## Payload de createTask + normalización

| Option | Description | Selected |
|--------|-------------|----------|
| Espejo de createComment/addComment; normalizar 201 por normalizeWorkItem/normalizeIssue | TaskItem canónico, shape-idéntico a un fetch; Phase 53 lo consume sin caso especial | ✓ |
| Construir un TaskItem ad-hoc en createTask | Duplica lógica de normalización; riesgo de drift de shape | |

**User's choice:** Reuso de normalizers existentes (recomendada).
**Notes:** Plane `description_html` + `name`; GitHub `body` markdown + `title`. task_id: Plane `${identifier}-${sequence_id}`, GitHub `number`.

---

## Test del método opcional

| Option | Description | Selected |
|--------|-------------|----------|
| `it()` capability-gated espejo de B8 `getTaskState` (contract.test.js:498) | No toca el loop de validación FROZEN-9; round-trip de 201 mockeado | ✓ |
| Añadir createTask a la contract matrix obligatoria | Rompería FROZEN-9 (lo volvería un 10º método requerido) | |

**User's choice:** Capability-gated it() (recomendada).
**Notes:** Endpoint Plane CE validado con POST manual ~5 min al inicio (research flag, único ítem MEDIUM-confidence).

---

## Scope del PAT de GitHub

| Option | Description | Selected |
|--------|-------------|----------|
| Documentar `issues:write`/`repo`; fallar LOUD en 403/404 | Mutación pedida por el operador → never-throws NO aplica | ✓ |
| Fail-open silencioso ante scope insuficiente | Ocultaría el fallo de una mutación explícita | |

**User's choice:** Documentar scope + fallo LOUD (recomendada).

---

## Claude's Discretion

- Nombres internos exactos de los métodos de cliente (`createWorkItem`/`createIssue` sugeridos).
- Taxonomía exacta de strings `code` de error — se coordina con el discriminante de la fontanería (Phase 53).

## Deferred Ideas

- `adoptSession` + escritura en `state.json` (idempotencia, atomicidad LOUD, sanitización) → Phase 53.
- Selección de proyecto destino / título auto-derivado → Phase 53 (BIDIR-08).
- CLI `kodo adopt` → 54 · tecla dashboard → 56 · orquestador → 57.
