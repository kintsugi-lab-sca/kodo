---
fecha: 2026-07-16
proyecto: kodo
slug: phase77-workspace-groups-cmux
---

## Resumen
Phase 77 completa en cadena autónoma (discuss→plan→execute→verify) en una mañana: las sesiones de kodo aterrizan en el grupo cmux de su path resuelto vía `--group`, con fail-open en dos capas (resolución + retry TOCTOU) porque cmux hace fatal un ref inválido.
La fase nació de una prueba en vivo previa contra cmux 0.64.19 cuyos 9 hechos empíricos (el flag no acepta nombres, ref malo = exit 1 sin workspace, membresía solo visible en `workspace-group list --json`) se grabaron en ROADMAP como «no re-derivar» — ningún agente downstream quemó tokens redescubriéndolos ni tocó la sidebar real del operador.

## Reto
El matching por nombre derivado es determinista pero choca con la realidad del operador: de sus 3 grupos reales solo `Kodo` y `SCRIBBA` auto-matchean — `SCP-CMRi` ≠ identifier `SCP`, así que esas tareas se lanzan sin grupo hasta que renombre el grupo (decisión de operación, no de código). Queda además la verificación visual e2e (`human_needed`) y `/gsd-secure-phase 77` pendientes, igual que los dos manuales de la Phase 74.

## Propuesta de skill
`cmux-feature-probe`: protocolo de sondeo en vivo de una feature nueva de cmux (crear artefactos de prueba con `--from` explícito → probar la combinación exacta de flags del launch real → sondear caso por-nombre y caso ref-inválido → limpiar con `delete` del grupo de prueba → volcar los hechos como bloque «verificado en vivo, no re-derivar» en el ROADMAP). Es lo que hoy hicimos a mano y convirtió el research en HIGH confidence sin riesgo para la sidebar.
