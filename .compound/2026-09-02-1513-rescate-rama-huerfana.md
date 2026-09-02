---
fecha: 2026-09-02
proyecto: kodo
slug: rescate-rama-huerfana
---

## Resumen
El bug reportado como «el cleanup de kodo borra ramas con commits sin mergear» resultó ser de Claude Code: su prompt «Remove worktree» hace `branch -D` antes de que corra `SessionEnd`, y kodo solo heredaba el destrozo con una entrada de cola llena de `null`.
Se cerró sellando el SHA de la punta en el hook Stop y recreando la rama desde él antes de la captura de integración; suite completa en verde (4218 pass) y un E2E con git real que reproduce SCP-21 entero.

## Reto
La hipótesis del ticket señalaba al gate KODO-21 y era falsa: solo se descartó ejecutando `rev-list --count <rama> --not --exclude=<rama> --branches --remotes` contra un repo temporal y viendo que devolvía `2`, no `0`. Leer el código habría confirmado el prejuicio — el gate «parece» el sospechoso porque es quien tiene el `branch -D`. El coste real del bug no era el borrado sino que el actor culpable estaba fuera del proceso, y ningún test de kodo podía verlo porque todos stubean `gitFn`.

## Propuesta de skill
Una skill de «reproducir antes de creer» para bugs de git: monta un repo temporal, ejecuta la secuencia exacta que describe el ticket (incluyendo lo que hacen herramientas de terceros como `worktree remove --force` + `branch -D`), y reporta qué comando devuelve qué ANTES de abrir el fichero sospechoso. La existente más cercana es `try-pr-local`, pero valida un PR ya escrito, no una hipótesis de diagnóstico.
