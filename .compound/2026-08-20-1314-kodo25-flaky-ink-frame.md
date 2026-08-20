---
fecha: 2026-08-20
proyecto: kodo
slug: kodo25-flaky-ink-frame
---

## Resumen
Se sustituyó el drenaje de turnos fijos de los tests de dashboard por esperas sobre el estado observado del frame de ink (`test/helpers/ink-frame.js`), eliminando el flake de «TUI-08: navegación ↑/↓» y las tres calibraciones divergentes repartidas en 7 copias locales de `drain()`.
Resultado: 10 pasadas de `npm test` sin fallo en el dashboard, 25/25 y 20/20 bajo carga, y dos mutaciones (wrap y no-op en ↓) confirman que el test sigue detectando fallos reales de navegación.

## Reto
El flake tenía DOS causas y la segunda solo apareció al arreglar la primera: al cambiar a espera de estado, el arranque se volvió tan rápido que las teclas empezaron a perderse sin rastro — ink suscribe su handler de input en un passive effect posterior al commit, y el write-back de la selección (D-07) pisa el cursor si la tecla entra en esa ventana. Diagnosticarlo exigió una sonda fuera del test runner que midiera en qué turno se aplicaba la flecha; el mensaje de rojo del propio test no lo decía. Queda abierto un flake de la misma familia en `test/cli/polling-verbose.test.js:130` (espera 3500 ms de reloj a que un subproceso emita), con tasa 2/10.

## Propuesta de skill
Una skill `flaky-hunt`: dado un test flaky, monta el bucle de reproducción bajo carga (N busy loops = cores, fichero aislado en bucle, log con tasa), clasifica la espera rota (turnos del event loop / plazo de reloj / señal sin estado), y cierra con una prueba de mutación que verifique que el test arreglado sigue detectando el fallo que dice cubrir. Es el mismo guion que ya se ejecutó a mano en KODO-24 y KODO-25.
