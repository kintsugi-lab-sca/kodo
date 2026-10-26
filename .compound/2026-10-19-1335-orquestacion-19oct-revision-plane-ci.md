---
fecha: 2026-10-19
proyecto: kodo
slug: orquestacion-19oct-revision-plane-ci
---

## Resumen
Ronda de orquestación 18–19 oct: cerradas y desplegadas SCP-148/154/156/73/157/158 y clipping ITCLIP-164/165/166/232/233/239, dos tareas de revisión de Plane (SCP-155, ITCLIP-237) con informes y paquete J1–J5 para Juanjo, y CI de SCP de 164 runs×18 min a una ejecución por PR con shards (test en 8–9 min).
klab/main igualado a Roman y decisión de que Juanjo trabaje contra roman-clipping-mono; Vexa analizado (ITCLIP-233) y 206 diagnosticado (503 de Bedrock, PR #49).

## Reto
El daemon lanza cualquier tarea con label kodo + asignado al tocarla (SCP-73 salió sola al etiquetarla para Juanjo), las sesiones de SCP dejan la cuenta deikka activa en gh y rompen los PR de clipping, y el reconcile archivó sesiones vivas tras reiniciar cmux (D#4).

## Propuesta de skill
`kodo-cierre-sesion`: cerrar una sesión de kodo de forma segura (copiar .compound del worktree, /exit con Enter --force sobre el diálogo Keep, borrar worktree/rama solo si rev-list=0, restaurar gh auth switch a-nunez-c_rmn).
