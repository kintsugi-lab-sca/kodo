---
fecha: 2026-09-16
proyecto: kodo
slug: orquestador-cwd-raiz-repo
---

## Resumen
`launchOrchestrator` abre el workspace, sincroniza la skill y reporta `projectPath` desde la raíz resuelta por el módulo (`KODO_ROOT` o `src/orchestrator/../..`), no desde `process.cwd()`.
Test de regresión en subprocess con cwd ajeno (rojo antes, verde después); suite completa en verde (4661 pass, 0 fail).

## Reto
Un test de fuente exigía literalmente `cwd: process.cwd()`: blindaba el proxy («el cwd es el repo») en vez del invariante, y hubo que reescribirlo. La verificación manual con `kodo up` desde `~` queda pendiente del merge.

## Propuesta de skill
Una skill `daemon-cwd-audit` que liste los `process.cwd()` alcanzables desde `kodo daemon run` (import graph desde `src/daemon/`) y marque cuáles dependen del cwd heredado de `kodo up`.
