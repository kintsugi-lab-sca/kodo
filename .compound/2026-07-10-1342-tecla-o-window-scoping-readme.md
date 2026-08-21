---
fecha: 2026-07-10
proyecto: kodo
slug: tecla-o-window-scoping-readme
---

## Resumen
Tecla `O` (enfocar orquestador) rediseñada a resolve-only con ref persistido en `~/.kodo/orchestrator.json` tras descubrir que el daemon no puede consultar cmux; README reescrito contra la realidad v0.15 (Homebrew, kodo up, dashboard, GitHub) y publicado.
Repo público kintsugi-lab-sca/kodo sincronizado (111 commits), con descripción y topics nuevos; verificación live del endpoint (200 con ref real) y suite completa en verde (1943 pass).

## Reto
`cmux workspace list` es window-scoped (limitación P-4 ya documentada): el daemon detached vive en otro window y jamás ve el workspace del orquestador — tres hipótesis erróneas (PATH/socket, cliente async vs host sync, deprecation notice enmascarando el error real) antes de dar con el root cause; la salida fue romper la dependencia de la consulta en vivo persistiendo el ref desde el proceso con TTY.

## Propuesta de skill
Skill `readme-audit`: contrasta automáticamente los claims del README (comandos, flags, labels, paths, URLs) contra `--help` real, defaults de config y árbol de ficheros — la deriva detectada hoy (kodo start, repo privado en el clone, dashboard ausente) era mecánicamente detectable.
