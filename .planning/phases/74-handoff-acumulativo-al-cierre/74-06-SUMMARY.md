---
phase: 74-handoff-acumulativo-al-cierre
plan: 06
subsystem: session-state
tags: [state, handoff, persistence, upsert-semantics, regression, gap-closure]
status: complete

requires:
  - upsertTaskHandoff (src/session/state.js) — el escritor que el Plan 02 creó y que este plan corrige
  - withStateLock (src/session/state.js:324) — la carga fresca DENTRO del lock; la única razón por la que el merge no es un TOCTOU
  - test/state/handoff-state.test.js — la suite del Plan 02 que este plan extiende (+2 casos)
provides:
  - "upsertTaskHandoff con semántica de merge asimétrica en `next`: ausente/null preserva el previo; un `next` nuevo no nulo lo pisa"
  - "2 casos de regresión que vigilan la asimetría por ambos flancos (preserva-si-ausente / no-es-write-once)"
  - "typedef TaskHandoff + JSDoc que declaran la asimetría para el lector de la Phase 75"
affects:
  - Phase 75 (dashboard + nudge) — lee state.tasks[task_id].next; ahora ese valor puede provenir de un cierre ANTERIOR al updated_at que ve

tech-stack:
  added: []          # cero dependencias npm nuevas
  patterns:
    - "Merge asimétrico por campo: sólo `next` tiene fallback al previo, porque es el único donde «ausente» ≠ «null persistido» (D-02). plan_path/updated_at siguen siendo overwrite incondicional"
    - "El `prev` se lee del parámetro `state` del mutator, nunca de una carga propia (T-74-16) — el fallback vive dentro del lock que withStateLock ya adquirió"

key-files:
  created: []
  modified:
    - src/session/state.js                 # merge del `next` + typedef TaskHandoff + JSDoc de upsertTaskHandoff
    - test/state/handoff-state.test.js     # +2 casos (WR-02 y su límite); los 14 existentes intactos

key-decisions:
  - "El fix usa `??` y no `||`: `extractNext` (handoff.js:265) colapsa un NEXT vacío a `null` y nunca devuelve `''`, así que los únicos valores «ausentes» que alcanzan el upsert son null/undefined. `??` es el operador semánticamente exacto — `||` habría tratado un futuro `''` como ausente sin que nadie lo decidiera."
  - "La rama del LLM (`session-end.js:337`) también puede emitir `next: null` (bloque escrito sin línea NEXT:). Con el fix, ese cierre también preserva el NEXT previo. Es consistente con D-02 («null = ausente») y deliberado, no un efecto colateral: un bloque del LLM sin NEXT: tampoco afirma que la tarea no tenga siguiente paso."
  - "El Caso 2 se solapa parcialmente con el caso `upserts:` preexistente (:112), que ya habría cazado un fix degenerado en «el primero gana». Se añade igualmente porque el plan lo exige y porque documenta el límite en el sitio del fix — pero su valor marginal es de documentación, no de cobertura nueva. Reportado, no disimulado."

patterns-established:
  - "Asimetría documentada en el typedef del consumidor: cuando un campo deja de ser last-write-wins, el lector aguas abajo (Phase 75) necesita saberlo en el typedef, no en el commit"

requirements-completed: [LIVE-04]

coverage:
  - id: D1
    description: "Un NEXT: real de una sesión anterior sobrevive a un cierre mecánico posterior de la misma tarea (WR-02 / LIVE-04)"
    requirement: "LIVE-04"
    verification:
      - kind: unit
        ref: "test/state/handoff-state.test.js#un NEXT: real sobrevive a un cierre mecánico posterior de la misma tarea (WR-02)"
        status: pass
      - kind: integration
        ref: "réplica manual del script §Behavioral Spot-Checks de 74-VERIFICATION.md bajo HOME aislado: addSession → upsertTaskHandoff(next:'desplegar el fix') → upsertTaskHandoff(next:null) → next sigue siendo 'desplegar el fix'"
        status: pass
    human_judgment: false
  - id: D2
    description: "Un NEXT: nuevo y no nulo sigue pisando al previo — el fix no degenera en «el primero gana»"
    requirement: "LIVE-04"
    verification:
      - kind: unit
        ref: "test/state/handoff-state.test.js#un NEXT: nuevo y NO nulo sigue pisando al previo — preservar no es «el primero gana»"
        status: pass
    human_judgment: false
  - id: D3
    description: "El merge no reintroduce lost-update bajo carrera cross-process (T-74-16)"
    requirement: "LIVE-04"
    verification:
      - kind: integration
        ref: "test/state/handoff-concurrency.test.js (suite completa, teeth verificadas por mutación en el Plan 05)"
        status: pass
    human_judgment: false

metrics:
  duration: ~35 min
  completed: 2026-07-15
  tasks: 2
  files: 2
---

# Phase 74 Plan 06: Cierre del gap de LIVE-04 (WR-02) Summary

`upsertTaskHandoff` deja de borrar el `NEXT:` de una sesión anterior cuando un cierre mecánico
posterior de la misma tarea llega sin `NEXT:` — la asimetría de D-02 («ausente» no pisa a «presente»)
aplicada al único campo donde la ausencia significa algo distinto de `null`.

## What Was Built

**Task 1 — el caso de regresión, en rojo primero** (`acc7522`). Dos casos añadidos a
`test/state/handoff-state.test.js`, junto a su vecino semántico (`upserts:` `:112`):

- **Caso 1 (WR-02)** — espeja el guion exacto que el verifier reprodujo: `next: 'desplegar el fix'`
  con `updated_at` fijo → segunda llamada al mismo `task_id` con `next: null`, mismo `plan_path` y
  `updated_at` posterior (así es como llega `writeHandoff:366`). Assertea las dos mitades de la
  asimetría en el mismo caso: `next` sigue siendo el real **y** `updated_at` SÍ avanzó.
- **Caso 2** — el límite: un `next` nuevo y no nulo sigue pisando al previo.

Quedó **deliberadamente rojo**: `# tests 16 · # pass 15 · # fail 1`, y el fallo fue el esperado —
`ERR_ASSERTION`, `actual: null` vs `expected: 'desplegar el fix'`, no un `TypeError` ni un fallo de
setup. La red antes que el fix.

**Task 2 — el fix** (`13ecb9b`). Dentro del mutator, tras el guard `if (!state.tasks)`:

```js
const prev = state.tasks[taskId];
next: entry.next ?? (prev ? prev.next : null) ?? null,
```

`prev` sale del **parámetro `state` del mutator** (T-74-16), nunca de una carga propia:
`withStateLock` ya carga fresco dentro del lock adquirido, y releerlo por fuera reintroduciría el
lost-update que el test cross-process del Plan 05 existe para prohibir. `plan_path` y `updated_at`
siguen siendo overwrite incondicional, con el porqué en el comentario (el cierre mecánico **sí**
ocurrió; su bloque aterrizó en el plan). El typedef `TaskHandoff` y el JSDoc de `upsertTaskHandoff`
ahora declaran la semántica nueva para el lector de la Phase 75: **`next` puede provenir de un cierre
anterior al `updated_at` que ve**, y `null` significa «ninguna sesión de esta tarea dejó nunca un
NEXT:», no «el último cierre no lo traía».

## Key Decisions

- **`??`, no `||`** — `extractNext` colapsa un NEXT vacío a `null` y nunca devuelve `''`, así que los
  únicos valores ausentes que alcanzan el upsert son `null`/`undefined`. `??` es exacto; `||` habría
  tratado un futuro `''` como ausente sin que nadie lo decidiera.
- **La rama del LLM también se beneficia, a propósito** — `session-end.js:337` puede emitir
  `next: null` si el LLM escribió su bloque sin línea `NEXT:`. Con el fix, ese cierre también preserva
  el previo. Es consistente con D-02 y deliberado: un bloque sin `NEXT:` tampoco afirma que la tarea no
  tenga siguiente paso.

## Deviations from Plan

Ninguna. El plan se ejecutó exactamente como estaba escrito; los dos tasks, en orden, con sus
criterios de aceptación verificados uno a uno.

## Verification

| Check | Resultado |
|---|---|
| `node --test test/state/handoff-state.test.js` | **16/16 pass, 0 fail** (Caso 1 verde **sin editar el test**) |
| `test/state/handoff-concurrency.test.js` | verde — el merge no reintroduce lost-update (T-74-16) |
| `test/hooks/session-end-handoff.test.js` | verde — el contrato del caller no cambió |
| `test/check-isolation.test.js` | verde — LOG-12 intacto |
| `npm test` | **2132 tests · 2131 pass · 0 fail · 1 skipped**, en 3 runs consecutivos. Baseline 2130 + los 2 casos nuevos = 2132 exacto |
| Réplica manual del guion del verifier (HOME aislado) | `next` sigue siendo `'desplegar el fix'` tras el cierre mecánico (antes: `null`); `alive` intacto; `schema_version` 3 |
| `git diff --stat src/hooks/session-end.js package.json package-lock.json` | vacío |
| `git diff --stat` final | exactamente 2 ficheros |
| greps de código (`schema_version`, `loadState` en líneas añadidas) | 0 y 0 |
| `~/.kodo` real | 26 planes, sin residuo `.lock`/`.tmp.` — idéntico al snapshot previo |

## Known Issues / Honest Notes

**1. El primer `npm test` reportó `# fail 1` — es la flake documentada, verificada, no asumida.**
No capturé su identidad en ese primer run, así que en vez de darlo por hecho lo reproduje: 12 runs
aislados de `test/gsd-lock-race.test.js` → **1/12 fallos**, exactamente la tasa documentada en
`deferred-items.md` §D-1 («concurrent dead-holder steal (CR-01)», ~1 de cada 9-12). Los 3 `npm test`
completos posteriores dieron **0 fail**. Fuera de alcance por instrucción explícita: no se tocó.

**2. Residuo pre-existente en el `state.json` REAL del operador — confirmado, no introducido por este
plan.** `~/.kodo/state.json` tiene una clave `tasks: {}` vacía. Lo capturé **antes** de ejecutar nada
(snapshot inicial) y sigue idéntico después de 4 `npm test` completos: mis tests no filtran. Es benigno
(está vacía, y los readers usan el guard `state.tasks || {}`), pero es evidencia de que un executor
anterior de esta fase sí escribió en el HOME real en algún momento. No lo he limpiado: borrarlo es una
mutación del estado real del operador que nadie me pidió, y la clave vacía es inocua.

**3. El Caso 2 se solapa con el caso `upserts:` preexistente.** El plan justifica el Caso 2 diciendo
que «ninguno de los 14 casos existentes distingue preserva-si-ausente de nunca-sobrescribe». Eso no es
del todo cierto: `upserts: a second call for the same task_id replaces, never appends` (`:112`) ya
escribe `'Primero'` → `'Segundo'` y assertea `'Segundo'`, así que **ya habría cazado** un fix
degenerado en «el primero gana». El Caso 2 se añadió igualmente (el plan lo exige y la aritmética de
`# pass 16` lo requiere) y documenta el límite en el sitio del fix, pero su valor marginal es de
documentación, no de cobertura nueva. Lo digo en vez de vender dos casos con teeth cuando uno y medio
las tiene.

**4. Fuera de alcance, sin tocar, como se pidió:** WR-01 (`sessionId` sin validar), WR-03
(`migrateStateV2toV3` descarta `tasks`), WR-04 (`state.tasks` sin cap), WR-05 (`task_id` en
session-start). `src/hooks/session-end.js` no se modificó: su rama mecánica pasando `next: null` es
LIVE-03 funcionando por diseño — el defecto estaba en el receptor.

**Sin stubs.** Ningún placeholder, TODO ni valor hardcodeado introducido.

## Threat Flags

Ninguno. El cambio no añade superficie: sin input nuevo, sin parseo nuevo, sin I/O nuevo, sin
dependencias. T-74-16 (la única amenaza nueva del registro) queda mitigada por construcción — `prev`
se lee del `state` del mutator, dentro del lock — y verificada por el grep de código (0 `loadState`
añadidos) más `handoff-concurrency.test.js` en verde.

## Self-Check: PASSED

- `src/session/state.js` — FOUND (modificado)
- `test/state/handoff-state.test.js` — FOUND (modificado)
- Commit `acc7522` — FOUND
- Commit `13ecb9b` — FOUND
