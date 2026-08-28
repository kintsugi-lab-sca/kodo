---
fecha: 2026-08-28
proyecto: kodo
slug: paths-centralizacion
---

## Resumen
Centralizada la raíz `~/.kodo` en `src/paths.js` y migrados los 12 sitios de `src/` que reconstruían `join(homedir(), '.kodo', …)` a mano, más un guard anti-drift en `test/paths.test.js`.
El enunciado pedía un módulo de solo-constantes; se entregó con funciones lazy porque una constante habría reintroducido la fuga de `homedir()` en module-load que esos doce sitios evitan a propósito — suite verde (3396 pass) y merge con main sin conflictos.

## Reto
Distinguir dos cosas que compartían síntoma: la duplicación del literal (drift real, que había que cerrar) y la evasión deliberada de la evaluación eager de `homedir()` (invariante vivo, documentado en ~15 ficheros y ~30 tests). Tomar el enunciado al pie de la letra habría cambiado un problema de mantenimiento por uno de corrección. Pendiente menor: 5 tests de carrera real y de teclado ink fallan de forma intermitente bajo la carga de la suite completa (pasan aislados, y una segunda pasada del mismo código dio 0 fallos) — es flakiness preexistente, no de esta tarea, pero nadie la mide.

## Propuesta de skill
Un guard reutilizable «leaf-module contract»: dado un fichero, asevera cero imports relativos, allowlist congelada de builtins, cero I/O y un assert de convergencia anti-vacuidad — el patrón que este repo ya reescribe a mano en ISO-02, ISO-03 y ahora PATHS-03, cada vez desde cero.
