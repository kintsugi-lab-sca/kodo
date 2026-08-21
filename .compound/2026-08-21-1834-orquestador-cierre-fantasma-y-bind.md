---
fecha: 2026-08-21
proyecto: kodo
slug: orquestador-cierre-fantasma-y-bind
---

## Resumen
Ronda de orquestación de dos días: detectado y corregido el cierre fantasma de `findSession` (KODO-27, creada, lanzada, revisada y mergeada), más el cierre de KODO-25 y KODO-26 con verificación independiente de cada una antes de moverlas a Done.
Al final, diagnosticado el «TUI waiting for server» como un bind a `0.0.0.0` interceptado por LuLu — no era kodo — y devuelto `server.bind` al default `127.0.0.1`, con el daemon sirviendo `/status` en 0.03 s.

## Reto
Los dos diagnósticos importantes empezaron con una causa plausible y equivocada: el cierre fantasma parecía un fallo del hook y era el fallback por `cwd` eligiendo la primera sesión del repo; el cuelgue del TUI parecía el Application Firewall de macOS y era LuLu filtrando por bind. En ambos casos lo que resolvió fue un experimento que aislara **una** variable (dos sesiones del mismo `project_path`; dos servers idénticos con distinto bind) en vez de seguir leyendo código. Queda pendiente el arranque de 31 s del provider —10 proyectos en serie, sin timeout— capturado como `o56k7y`.

## Propuesta de skill
Un `kodo doctor --net` que ejecute la secuencia discriminante ya documentada en `kodo-orchestrate` (curl -v para separar connect de handler, nc contra puerto abierto/ajeno/cerrado, dos binds mínimos, `systemextensionsctl list`) y devuelva el veredicto — evitaría repetir a mano el diagnóstico y, sobre todo, evitaría mandar un `sudo` antes de haber aislado la variable.
