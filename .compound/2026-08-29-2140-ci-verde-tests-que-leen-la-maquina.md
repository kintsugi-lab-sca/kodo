---
fecha: 2026-08-29
proyecto: kodo
slug: ci-verde-tests-que-leen-la-maquina
---

## Resumen
Cerrados los 16 fallos de la primera corrida de la matriz ubuntu × macos: ninguno era un fallo de producción en Linux, todos eran tests que leían de la máquina algo que el caso daba por supuesto (el host default de KODO-56, la variable `CI` que consulta ink, y dos umbrales de tiempo calibrados en la máquina de desarrollo).
Suite 3935/0 en macOS y en una VM Linux con Node 22, PR de prueba verde y `main` verde tras el merge fast-forward `7c55847a..24030c1a` en los dos remotes.

## Reto
La reproducción fue lo caro, no el arreglo. Tres de los seis fallos no se manifiestan en la máquina de desarrollo bajo ninguna combinación de flags: hicieron falta una VM Linux con Node 22 instalado a mano y descubrir que el disparador de CAPT-07 era `CI=true` (ink consulta `is-in-ci`), no la ausencia de TTY que decía el diagnóstico de partida. Los dos fallos de timing tampoco eran «runner lento» sin más: el presupuesto del lock en tiempo de pared escala con el coste de las syscalls del runner (160 ms aquí, 747 ms en CI), así que la premisa «hold > presupuesto» del guard de cobertura del inbox se INVIERTE justo en las máquinas lentas — un umbral absoluto no podía arreglarse subiéndolo.

## Propuesta de skill
Una skill `repro-ci-failure` que, dado un run id de GitHub Actions, extraiga los `not ok` con su mensaje de error, mapee cada uno a su fichero de test, y levante el entorno de reproducción que corresponda (VM de OrbStack con la versión de Node del job, `CI=true`, HOME aislado) en vez de dejar que cada sesión redescubra que `orb run` existe y que la VM tiene otra versión de Node. No he encontrado candidata equivalente en el catálogo actual (`find-skills`).
