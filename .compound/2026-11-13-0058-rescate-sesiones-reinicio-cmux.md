---
fecha: 2026-11-13
proyecto: kodo
slug: rescate-sesiones-reinicio-cmux
---

## Resumen
Sesión de orquestador del 10 al 12-nov: preparó el status de SCP, creó 12 tareas para Juanjo (SCP y Scribba) y lanzó SCP-179, KODO-112, ROMAN-282 y ROMAN-283.
Un reinicio de cmux archivó 6 sesiones vivas y el orquestador siguió contándolas; se rescataron con `reopenSession` y un DNS manual de Cloudflare en el Wi-Fi tumbó Plane y Basecamp hasta que el operador lo quitó.

## Reto
El orquestador informó «9 de 15» sumando sobre el recuento del handoff sin releer `state.json`; el operador lo detectó en el dashboard. El fallo de fondo (un reinicio de cmux archiva sesiones vivas) sigue sin corregir en el código.

## Propuesta de skill
Un comando `kodo sessions rescue` que cruce `state.history` con `cmux workspace list --json` por UUID y reabra las sesiones archivadas por error, en lugar del script manual con `reopenSession`.
