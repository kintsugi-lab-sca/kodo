---
fecha: 2026-07-23
proyecto: kodo
slug: phase80-carril-orquestador-auto-chain
---

## Resumen
Cadena autónoma completa de la Phase 80 (v0.18): el sidebar doctor va de piggyback in-process en `runCheckAndAct` (gate needsOrchestrator, fail-open, LOG-12 intacto) y skill/prompt del orquestador quedan reconciliados con v0.17.
Resultado: 2/2 planes ejecutados, checker y suite (2356 tests) en verde, review 0 blocker/3 warnings, verify human_needed 11/12 — solo queda la convergencia en sidebar viva (80-UAT.md).

## Reto
El gate UI del plan-phase marcó frontend:true por keywords ("sidebar/dashboard/nudge" en prosa) en una fase sin superficie UI — hubo que tratarlo como falso positivo razonado (--skip-ui) para no generar un UI-SPEC sin sentido; el ui-safety-gate post-wave (hasUiFiles:false) confirmó el juicio.

## Propuesta de skill
Una skill "kodo-uat-live" que prepare el fixture del test de convergencia (sesión kodo suelta + pase motivado de kodo check) y recoja la evidencia del sidebar antes/después — automatizaría el único paso que hoy exige humano en cada fase del sidebar.
