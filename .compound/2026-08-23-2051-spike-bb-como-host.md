---
fecha: 2026-08-23
proyecto: kodo
slug: spike-bb-como-host
---

## Resumen
Análisis y spike real de BB (github.com/get-bb/bb) como tercer WorkspaceHost de kodo junto a cmux/Orca: thread lanzado en worktree con claude-code, env y hooks verificados en vivo.
Resultado: encaja en el contrato de 4 métodos (mejor señal needs-input que Orca), pero BB corre Claude vía Agent SDK y el runtime sigue vivo en `idle` → SessionEnd solo dispara con `bb thread stop`.

## Reto
Correlación de sesión: BB genera el `--session-id` (no admite flags ni env propios en `spawn`); el hook tendría que resolver por `BB_THREAD_ID` (presente en el env del proceso claude) y el cierre de sesión pasa de SessionEnd a Stop+idle o a un `bb thread stop` explícito de kodo.

## Propuesta de skill
Skill `host-spike`: dado un host candidato, arranca instancia aislada (data dir + puertos), lanza un thread con hooks-marcador en `.claude/settings.local.json`, y vuelca env/estado/hook-events para rellenar la tabla del contrato WorkspaceHost.
