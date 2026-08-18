---
fecha: 2026-08-18
proyecto: kodo
slug: kodo21-rama-sin-mergear
---

## Resumen
El cleanup de sesión hacía `git branch -D` incondicional; ahora cuenta los commits inalcanzables desde otra ref y conserva la rama si queda trabajo, con traza `branch_kept_unmerged` y evento `worktree.branch.kept`.
Se arregló a la vez el `worktree_path` fantasma (`.bg-shell/<sid>` persistido vs `.claude/worktrees/<sid>` real), porque sin eso el guard nunca llegaba a ejecutarse.

## Reto
El log de la sesión afectada (KODO-13) desmintió el diagnóstico del issue: el cleanup de kodo no borró la rama, falló antes en `phase:status` contra el path fantasma. La rama la borró otro actor. Sin leer el ndjson se habría "arreglado" un culpable equivocado y, peor, arreglar solo el path habría vuelto sistemática la pérdida de trabajo.

## Propuesta de skill
Una skill `verify-bug-report` que, antes de tocar código, cruce el síntoma reportado con la traza real (logs ndjson de `~/.kodo/logs/<sid>`, `git reflog`, `git worktree list`) y devuelva qué parte del relato está confirmada y cuál es inferencia — el mismo trabajo que aquí se hizo a mano.
