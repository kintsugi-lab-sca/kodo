---
phase: 81-saneo-de-deuda-v0-17
plan: 01
subsystem: session-state
tags: [handoff, state.json, three-state-merge, session-end, nudge, live-07, debt-01]

# Dependency graph
requires:
  - phase: 74-handoff-persistente
    provides: "upsertTaskHandoff writer + writeHandoff RMW + 74/WR-02 asymmetry rationale"
  - phase: 75-nudge-live-07
    provides: "effectiveNext post-merge threading to buildStopNudgeText"
provides:
  - "Three-state `next` merge in upsertTaskHandoff discriminated by field PRESENCE (overwrite / clear / preserve)"
  - "Authorship-mapped caller in writeHandoff: LLM branch includes `next` (may clear), mechanical backstop omits it (preserve)"
  - "LIVE-07 nudge coupling preserved: nudge reads post-merge value (generic on clear, contextual on preserve)"
affects: [session-end, dashboard-next-cell, orchestrator-nudge, debt-02, debt-03]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Presence-based three-state merge (not truthiness `??`) — string overwrites, explicit null clears, absent field preserves"
    - "Authorship discriminator surviving out of withFileLock via `authored: 'llm'|'auto'` flag + conditional-key object spread"

key-files:
  created: []
  modified:
    - src/session/state.js
    - src/hooks/session-end.js
    - test/state/handoff-state.test.js
    - test/hooks/session-end-handoff.test.js

key-decisions:
  - "Discriminate `next` by field PRESENCE (`'next' in entry` / `=== undefined`), never by truthiness — the `??` conflation of null/undefined WAS the DEBT-01 bug"
  - "Authorship flag `authored: 'llm'|'auto'` threads out of withFileLock; call-site spreads `next` only for the LLM branch"
  - "Reframe (not delete) the 74/WR-02 rationale: mechanical close = field-absent = preserve; LLM-no-NEXT = explicit null = clear"
  - "No schema bump — `next: string|null` stays legal (D-04)"

patterns-established:
  - "Three-state merge-on-write by presence: absent→preserve, null→clear, string→overwrite"
  - "Out-of-lock authorship discriminator + conditional-key spread at the writer call-site"

requirements-completed: [DEBT-01]

coverage:
  - id: D1
    description: "upsertTaskHandoff merges `next` as a three-state contract by field presence — explicit null clears the previous pointer, absent field preserves it, non-empty string overwrites"
    requirement: DEBT-01
    verification:
      - kind: unit
        ref: "test/state/handoff-state.test.js#CLEAR: `next: null` explícito con un prev pre-existente BORRA el previo"
        status: pass
      - kind: unit
        ref: "test/state/handoff-state.test.js#PRESERVE: campo `next` AUSENTE con un prev pre-existente PRESERVA el previo"
        status: pass
    human_judgment: false
  - id: D2
    description: "writeHandoff maps session authorship to the writer contract — LLM close without NEXT: passes next:null (clear), mechanical backstop omits next (preserve); LIVE-07 nudge reads the post-merge value"
    requirement: DEBT-01
    verification:
      - kind: unit
        ref: "test/hooks/session-end-handoff.test.js#bloque mecánico appendeado → la entry al stateWriterFn OMITE la clave `next`"
        status: pass
      - kind: unit
        ref: "test/hooks/session-end-handoff.test.js#LLM escribió su bloque SIN **NEXT:** → la entry al stateWriterFn LLEVA `next: null`"
        status: pass
    human_judgment: false

# Metrics
duration: 5min
completed: 2026-07-24
status: complete
---

# Phase 81 Plan 01: Semántica clear/stale de `next` (DEBT-01) Summary

**Un cierre de sesión sin `NEXT:` redactado por el LLM ahora BORRA el puntero `next` obsoleto (clear deliberado), mientras que un cierre mecánico lo PRESERVA — cerrando el bug donde el `??` conflaciaba `null` y `undefined` y nada podía limpiar jamás un `next` viejo.**

## Performance

- **Duration:** ~5 min
- **Started:** 2026-07-24T07:36:43Z
- **Completed:** 2026-07-24T07:41:54Z
- **Tasks:** 2 completed (both TDD)
- **Files modified:** 4

## Accomplishments
- Reemplazado el merge `entry.next ?? (prev ? prev.next : null) ?? null` por una discriminación de TRES estados por presencia del campo: string → overwrite, `null` explícito → clear, campo ausente → preserve.
- Mapeada la autoría al contrato en `writeHandoff`: un flag `authored` sobrevive fuera de `withFileLock`, y el call-site construye la entry con spread condicional (`next` presente solo en la rama LLM).
- Preservado el acoplamiento LIVE-07: el nudge sigue leyendo el valor POST-merge (`upsertResult.value.next`) — genérico en el clear, contextual en el preserve.
- JSDoc reescrito como la tabla de tres estados reencuadrando (sin borrar) el racional 74/WR-02.

## Task Commits

Each task was committed atomically (TDD RED→GREEN):

1. **Task 1 (RED): failing three-state contract for the writer** - `05234fa` (test)
2. **Task 1 (GREEN): three-state next merge in upsertTaskHandoff** - `b8869c2` (feat)
3. **Task 2 (RED): assert authorship-mapped entry keys** - `a54182f` (test)
4. **Task 2 (GREEN): map authorship to three-state contract** - `31d2bfe` (feat)

_Note: TDD tasks carry a test (RED) commit followed by a feat (GREEN) commit._

## Files Created/Modified
- `src/session/state.js` — `upsertTaskHandoff`: three-state merge by presence + JSDoc table (D-04); invariants intact (prev from mutator state, `next` never logged, post-merge value returned).
- `src/hooks/session-end.js` — `writeHandoff`: `authored: 'llm'|'auto'` flag out of the lock + conditional-key entry build; `effectiveNext` still post-merge; return-contract JSDoc updated.
- `test/state/handoff-state.test.js` — reexpressed `:147`/`:224` mechanical cases to field-absent; added null-clear, omit-preserve, overwrite, and LIVE-07 clear/preserve return cases (19→24 tests).
- `test/hooks/session-end-handoff.test.js` — mechanical branch now asserts the `next` key is omitted; added LLM-no-NEXT → `next: null` case; updated the stale LIVE-07 mechanical case.

## Decisions Made
- Discriminación por PRESENCIA del campo, nunca por truthiness — la conflación `null`/`undefined` del `??` ERA el bug DEBT-01.
- La autoría viaja fuera del lock con un flag `authored`; el call-site nunca pasa `r.value.next` incondicionalmente (colapsaría ambas ramas — RESEARCH Pitfall 1).
- Sin bump de schema: `next: string|null` sigue legal (D-04).

## Deviations from Plan
None - plan executed exactly as written. The three test updates (mechanical `:147`/`:224` reexpressed to field-absent and the stale LIVE-07 mechanical case) were explicitly anticipated by the plan (Task 1/Task 2 actions and PATTERNS Pitfall 2: "existing cases encode the OLD semantics and MUST be edited").

## Issues Encountered
None. Both TDD cycles reached RED (clear/omit cases failing against the old `??`) and GREEN cleanly.

## Threat / Privacy Verification
- T-81-01-01 (Information Disclosure): confirmed `logger.info('state.task.handoff_saved', { task_id })` carries ONLY `{ task_id }` — `next` never logged (T-71-18 invariant preserved).
- T-81-01-02 (Tampering): merge stays inside `withStateLock`; `prev` read from the mutator's own `state` arg (no re-load — T-74-16 lost-update guard intact).
- T-81-01-03 (Tampering): `effectiveNext` reads the post-merge value; incoming value never drives the nudge.

## Known Stubs
None.

## Verification
- `node --test test/state/handoff-state.test.js` → 24/24 pass
- `node --test test/hooks/session-end-handoff.test.js test/hooks/session-end.test.js` → 53/53 pass
- Full suite: `node --test $(find test -name '*.test.js' -type f)` → 2361 pass, 0 fail, 1 skipped (pre-existing)

## Self-Check: PASSED
- `src/session/state.js` — FOUND (three-state merge, `'next' in entry` present, `??` only in comments)
- `src/hooks/session-end.js` — FOUND (conditional spread, no unconditional `r.value.next`)
- Commits `05234fa`, `b8869c2`, `a54182f`, `31d2bfe` — all FOUND in git log
