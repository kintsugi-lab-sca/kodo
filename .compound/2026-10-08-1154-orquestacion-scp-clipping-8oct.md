---
fecha: 2026-10-08
proyecto: kodo
slug: orquestacion-scp-clipping-8oct
---

## Resumen
Tres días de orquestación (1–8 oct): guiones y actas de cuatro reuniones (SCP 1-oct y 8-oct, clipping 5-oct, Traça 6-oct), ~30 tareas lanzadas en SCP y clipping y 25 PR fusionadas, con deploy de clipping a DEV y el cronograma de SCP replanificado al 1-dic.
Resultado: ingesta de CaixaBank, índice de grupo y búsqueda v2 en main; queda la demo de SCP (13-oct) y el correo a Villafañe en manos del operador.

## Reto
Las PR paralelas del mismo repo chocan en ficheros «lista» (menú, rutas, schema.rb) y hubo que relanzar cuatro veces la sesión para desconflictar; y el orquestador duplicó una tarea (ITCLIP-199/200) por no relistar el tablero antes de crear.

## Propuesta de skill
`kodo-merge-queue` (ya propuesta el 24-sep): fusionar de una en una, relanzar la siguiente sobre su rama con `merge origin/main`, y comprobar el tablero de Plane justo antes de crear una tarea.
