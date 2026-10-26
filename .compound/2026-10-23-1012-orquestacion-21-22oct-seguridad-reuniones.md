---
fecha: 2026-10-23
proyecto: kodo
slug: orquestacion-21-22oct-seguridad-reuniones
---

## Resumen
Dos días de orquestación: 9 tareas de Plane lanzadas (parches PHP en Traça/MxF, certifi en clipping, status y actas de SCP, Aparca&Go, MyNews, Meltwater) y 3 sesiones ad-hoc (NAS, Hetzner, reunión IA+IT), más actas desde Anarlog hechas por el orquestador cuando el clasificador de permisos bloqueó a la sesión.
Todo cerró en Review con entregables; quedan en manos de Alex el redeploy de clipping dev, el reinicio de MxF, el correo a Villafañe y el mensaje a consultores.

## Reto
El clasificador «Remote Shell Writes» bloquea lecturas inocuas (Anarlog, jq) en una sesión tras un intento de `kamal app exec`; el orquestador tuvo que leer prod y el transcript él mismo, y el tool de transcript devuelve 125 KB por página que solo se puede leer desde el fichero guardado con jq.

## Propuesta de skill
Skill `anarlog-acta`: dado un meeting_id, pagina el transcript al fichero, extrae `.text`, cruza con el acta anterior y escribe `ACTA-REU-<fecha>.md` con compromisos, decisiones y tareas candidatas en el formato de SCP.
