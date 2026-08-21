---
fecha: 2026-07-06
proyecto: kodo
slug: phase69-red-auth-auto-chain
---

## Resumen
Cadena completa `/gsd-discuss-phase 69 --auto` → plan → execute cerró la Ola 1 de v0.16: bind 127.0.0.1, bearer default-deny, 413 pre-HMAC, 500 neutros, sessionId allowlist y README multi-nodo (NET-01..06, 12/12 must-haves).
El code review post-ejecución encontró un BLOCKER real (DoS pre-auth: `new URL(req.url)` sin try/catch mata el daemon con un request malformado) y 4 warnings; los 5 se corrigieron en la misma fase (suite 1843 pass).

## Reto
El propio hardening introdujo el vector que quería cerrar: los executors escribieron auth correcta pero dejaron el parse de URL crasheable pre-auth — sin el gate de code-review dentro de la cadena auto, la fase habría cerrado "verificada" con un DoS de un paquete. Queda un flake aislado (1 fail en 1 de 3 runs de la suite, test de integración en puerto efímero) sin diagnosticar, y `/gsd-secure-phase 69` pendiente (security enforcement activo sin SECURITY.md).

## Propuesta de skill
Un gate "crash-surface sweep" reutilizable que, tras tocar `server.js`/handlers HTTP, fuzzee automáticamente request targets malformados (`GET http://[`, `%zz`, oversize) contra el server real en puerto efímero — habría atrapado CR-01/WR-01 en ejecución, no en review (candidata: extensión de gsd-code-review o test-template en el planner).
