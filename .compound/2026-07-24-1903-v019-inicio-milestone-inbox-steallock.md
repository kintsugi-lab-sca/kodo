---
fecha: 2026-07-24
proyecto: kodo
slug: v019-inicio-milestone-inbox-steallock
---

## Resumen
/gsd-new-milestone end-to-end: milestone v0.19 «Inbox de capturas + fix stealLock + saneo de deuda» iniciado con research de 4 dimensiones, 15 requirements (LOCK/CAPT/DEBT/NYQ) y roadmap de 4 fases (82-85) aprobado.
R-81-01 resuelto por el mantenedor (fix real de stealLock, no aceptación); la 999.2 promovida con extras (skill-sync multi-skill, trace pointer, nudge stale); commits 7c798c3, 607bfef, 0004507, 342f277.

## Reto
El research produjo dos modelos incompatibles para el estado del inbox (lock compartido withFileLock + token in-place vs event-log append-only que elimina el TOCTOU por construcción) — se dejó como decisión explícita para el discuss-phase de la Phase 83, no defaulteada; además corrigió el brief: el lock del inbox es src/session/state-lock.js, no src/gsd/lock.js.

## Propuesta de skill
Ya existe la cadena gsd (gsd-discuss-phase/gsd-plan-phase); lo automatizable nuevo sería un «milestone-kickoff-brief» que compile diferidos accionables vs no-ejecutables-a-demanda (con trigger real) desde STATE.md antes de preguntar el alcance — hoy se hace a mano cada vez.
