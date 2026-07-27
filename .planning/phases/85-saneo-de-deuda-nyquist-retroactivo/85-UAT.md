---
status: testing
phase: 85-saneo-de-deuda-nyquist-retroactivo
source: [85-VERIFICATION.md]
started: 2026-07-27T14:10:00Z
updated: 2026-07-27T14:10:00Z
---

## Current Test

number: 1
name: Disposición de WR-01 (80-REVIEW) tras el hallazgo de alcance narrow de 85-REVIEW
expected: |
  Una decisión explícita del mantenedor entre:

  (a) **Aceptar** el fix actual como suficiente para el alcance literal de DEBT-07 («resueltos
  o re-aceptados individualmente con razón documentada») y registrar la limitación en
  `85/deferred-items.md` con su trigger. Nota del verificador: la fila 3 de ese fichero ya
  cubre `IN-01` de 80-REVIEW con el trigger «que el conteo de advisories se contradiga con lo
  aplicado en un caso real de operación», que es exactamente este caso — puede ampliarse esa
  fila en vez de abrir una nueva.

  (b) **Abrir un fix de seguimiento** que propague la degradación del scan: marcar
  `__degraded: true` en el fallback de `parseRaw` (`src/cmux/sidebar-doctor.js:153-162`) y
  comprobarlo en `src/check.js`. El snippet concreto ya está escrito en `85-REVIEW.md` §WR-01.
awaiting: user response

## Tests

### 1. Disposición de WR-01 tras el hallazgo de alcance narrow (85-REVIEW.md)

expected: Una fila nueva o ampliada en `85/deferred-items.md` (opción a), o un plan de seguimiento fuera de esta fase (opción b).
result: [pending]

**Contexto del hallazgo:** la línea de fallos añadida en `src/check.js:160-172` solo se dispara
ante fallos de **escritura por-item** de `executeFn`. En el escenario que la propia WR-01 usó
como motivación — cmux caído — `parseRaw` traga el error y devuelve el fallback vacío; con
`liveWorkspaceRefs` vacío el bucle descarta todo, cero acciones se intentan, `errors` queda `[]`
y el silencio original persiste: `Sidebar: 0 acción(es) aplicadas` sigue significando a la vez
«nada que arreglar» y «cmux caído».

**Por qué es decisión humana y no un gap:** el código implementa **literalmente** el fix que
80-REVIEW propuso (inspeccionar `r.errors`, emitir por `errorFn`), con cobertura de test real
(Test F y Test G, verdes) y sin comportamiento incorrecto. El propio `85-REVIEW.md` lo clasifica
WARNING, no BLOCKER. El desacuerdo es de alcance: si «resuelto como se especificó» basta cuando
el objetivo operativo que el warning perseguía sigue abierto para el caso más probable.

**Por qué no está ya registrado:** carrera entre dos pasos del mismo pipeline —
`85-REVIEW.md` se completó (13:43:55Z) *después* de que el plan 85-05 cerrara el bookkeeping de
la fase (13:32:15Z), así que el hallazgo llegó tarde para ser absorbido automáticamente.

## Summary

total: 1
passed: 0
issues: 0
pending: 1
skipped: 0
blocked: 0

## Gaps
