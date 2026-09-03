---
fecha: 2026-09-02
proyecto: kodo
slug: tui-dismiss-refresco-inmediato
---

## Resumen
Revisión del flujo dead → dismiss del TUI: la fila descartada seguía pintada hasta el siguiente tick del poll (2,5 s, hasta 10 s con backoff), y el 409 `alive` avisaba de una sesión revivida sobre una tabla que la seguía mostrando muerta.
`runPollLoop` gana un `kick()` (cancela el re-arme, aborta el request en vuelo, dispara un tick ya) publicado por `opts.kickRef`; App lo expone como `refreshNow` y la rama DISMISS lo invoca tras el DELETE. Suite completa verde (4214/4215, 1 skip preexistente).

## Reto
El kick obliga a un tick-id guard que el teardown por sí solo no daba: abortar el request en vuelo hacía que ese tick reanudase con un `{ok:false}` de abort, reportando una desconexión falsa y re-armando su propio timer — dos loops corriendo. Se cerró con una generación por tick (`myGen !== gen` → retirada silenciosa), verificada con un fake `fn` de resolución controlada por el test.

## Propuesta de skill
Una skill de «verificación de sensibilidad del test»: antes de dar por bueno un test de regresión, desactivar mecánicamente la línea de producción que cubre, comprobar que el test se pone rojo y restaurar. Aquí se hizo a mano (sed + `.bak`) y detectó que el test (g) sí era load-bearing; automatizarlo evita tests que pasan por accidente.
