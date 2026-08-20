---
fecha: 2026-08-18
proyecto: kodo
slug: kodo24-flaky-lock-race
---

## Resumen
Arreglado el flaky de `gsd lock steal race — holder stale-pero-VIVO que libera` con dos handshakes de disco (`ready-<pid>` antes de la primera etapa, `settled-<pid>` antes del teardown) en lugar de tocar ningún timeout.
De ~30% de fallo bajo CPU saturada a 0 fallos en 55 iteraciones cargadas y 10/10 pasadas de suite completa; `src/gsd/lock.js` sin un solo cambio.

## Reto
El diagnóstico del ticket era falso y costaba tiempo aceptarlo: apuntaba a presupuestos de tiempo agotados, pero `parkedMs` valía 8–67 ms sobre un techo de 3000. Solo una traza cross-proceso con timestamps relativos reveló lo real — los hijos extra arrancaban 43–245 ms tarde y contendían DESPUÉS del teardown, robando legítimamente un lock de PID muerto. El test sumaba dos `acquired` sin que ningún invariante se rompiera: medía una carrera distinta de la que decía medir. Queda como riesgo residual declarado el `--hold 500` de las dos suites hermanas del mismo fichero, misma familia de defecto con ~2x de margen.

## Propuesta de skill
`repro-flaky-under-load`: dado un fichero de test, levanta N procesos en bucle ocupado sobre los cores disponibles, corre el fichero en bucle M veces, cuenta la frecuencia de fallo y recoge el `ctx`/traza de cada rojo — el paso que convirtió «pasa aislado, falla en la suite» en una causa raíz medible. No encontré candidata existente con `find-skills`.
