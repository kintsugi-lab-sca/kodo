---
fecha: 2026-09-24
proyecto: kodo
slug: noche-autonoma-scp-f2-f3
---

## Resumen
Orquestación autónoma de 23:10 a 03:35: planes de F2 y F3 de scp-cmri, 14 de 16 tareas construidas y fusionadas en main por el orquestador (PR #66–#83), con la CI de main en verde y el guión del status actualizado.
Merges por git local + push (main sin protección), verificación migrate/rollback en BD aislada para tier 3, conflictos de menú/rutas/Gemfile resueltos a mano y dos por subagente.

## Reto
Dos PR verdes por separado dejan main rojo al juntarlas (require_tenant de SCP-28 rompió tests de F1-2/F1-3/F1-4/F3-5; menú y rutas del backoffice chocaron en cada merge): hubo que esperar la CI de main tras cada merge y resolver 6 conflictos. Y `cmux send` no entrega mensajes largos a las sesiones: solo órdenes de una línea, con Escape antes si el prompt tiene texto atascado.

## Propuesta de skill
Skill `kodo-merge-queue`: tras la CI verde de una PR, fusionar origin/main en su rama, esperar la CI, mergear, esperar la CI de main y solo entonces lanzar la siguiente; con resolución automática de los ficheros «lista» (menú, rutas, Gemfile) por unión de ambos lados.
