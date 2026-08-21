---
fecha: 2026-08-21
proyecto: kodo
slug: cierre-fantasma-findsession
---

## Resumen
Arreglado el cierre fantasma de KODO-27 en dos capas: `findSession` resuelve los fallbacks no-identidad (cwd, workspaceRef) sólo cuando son únicos, y los tres hooks de sesión consultan exclusivamente por `session_id` (fail-closed), con traza tipada `session.close.unmatched` del no-op.
Suite completa en verde (2976 pass / 0 fail); los tests nuevos se validaron revirtiendo el fix para comprobar que reproducen el incidente antes de darlos por buenos.

## Reto
El diagnóstico heredado proponía dos arreglos que se solapaban y uno no bastaba: el guard de unicidad en `findSession` no cubre el caso de una única sesión registrada, donde el fallback por cwd sigue siendo «único» y volvería a imputar el cierre ajeno — que es el incidente literal. Lo que desatascó la decisión fue un hecho del código, no del ticket: una sesión de kodo corre en su worktree, no en `project_path`, así que el fallback por cwd **nunca** matcheaba al caso bueno, sólo a sesiones ajenas. Eso convirtió un supuesto tradeoff («fail-closed rompe el 90 % del uso») en una no-decisión, y lo confirmó la suite: ningún test existente dependía de ese fallback.

## Propuesta de skill
Una skill `assert-fix-fails-first`: antes de dar por buenos los tests de un bugfix, revertir mecánicamente cada capa del fix por separado y registrar qué tests caen con cada una — aquí reveló que de 6 tests sólo 3 cubrían el bug original y que cada capa protegía un caso distinto, información que ningún test verde da por sí solo.
