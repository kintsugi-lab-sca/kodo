---
fecha: 2026-07-27
proyecto: kodo
slug: phase85-saneo-deuda-nyquist
---

## Resumen
Cadena autónoma completa discuss→plan→execute de la Phase 85 (última de v0.19): 5 planes, 19 commits, DEBT-05/06/07 y NYQ-01/02 saldados — typedef `TaskHandoff` corregido, `deriveAnyNext` delegando en `nextCell`, los 3 warnings de 80-REVIEW resueltos y 6 `VALIDATION.md` archivados con backfill Nyquist citation-based.
Suite 2590 verde (2589 pass / 1 skip); verificación cerró en `human_needed` por un único ítem de decisión de alcance sobre WR-01, no por defecto de código.

## Reto
El code review (13:43Z) terminó **después** de que el plan de bookkeeping cerrara la contabilidad de la fase (13:32Z), así que su hallazgo más relevante —la línea de fallos del sidebar solo cubre fallos de escritura por-item, no el escenario cmux-caído que motivó WR-01, porque `parseRaw` traga el error y devuelve fallback vacío— llegó tarde para ser absorbido y quedó fuera de `deferred-items.md`. No es una regresión: es una carrera entre dos pasos del mismo pipeline que deja hallazgos válidos huérfanos.

## Propuesta de skill
Una skill `gsd-absorb-late-findings` que, tras `code-review`/`verify-phase`, compare el timestamp del REVIEW/VERIFICATION contra el del último commit de bookkeeping de la fase y, si el review es posterior, reabra automáticamente `deferred-items.md` para absorber los WARNING no registrados (o al menos los liste como pendientes de disposición) en vez de dejar que el humano descubra el hueco leyendo el UAT.
