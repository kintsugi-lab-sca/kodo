---
fecha: 2026-10-14
proyecto: kodo
slug: kodo-101-cola-deriva-head
---

## Resumen
La cola de integración sella `head` por entrada; un loop del server re-mide las ramas que avanzaron y `kodo integrate --ff|--merge|--pr` se niega con `branch-moved` si la punta no coincide.
El listado marca `pass↑` / `✓N↑` sin llamar a git; 17 tests nuevos, suite completa en verde (4694/0).

## Reto
El enunciado pedía anular oráculo/auditoría en el refresco, pero eso impedía distinguir «auditado» de «auditado sobre un HEAD anterior»: se conservan y el desfase se deriva de `commit ≠ head` (pendiente de validar en review).

## Propuesta de skill
Skill «kodo-state-test» que genere el andamiaje de un test con HOME aislado e imports dinámicos de `src/` (la trampa de `state.js` fijando la ruta en module-load obliga a separar ficheros a mano cada vez).
