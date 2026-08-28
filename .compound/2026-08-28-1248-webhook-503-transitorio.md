---
fecha: 2026-08-28
proyecto: kodo
slug: webhook-503-transitorio
---

## Resumen
El webhook de kodo pasaba de fire-and-forget puro (200 incondicional) a clasificar el fallo de dispatch y devolver 503 solo en transitorios reconocidos, con una ventana de gracia acotada de 2 s en vez de awaitear el dispatch entero.
Resultado: KODO-34 commiteado (`d570004`) con 22 tests de clasificador + un fichero de integración contra el dispatcher real que prueba que el reintento no duplica sesión; suite completa 3125 pass, 0 fail.

## Reto
La mitad peligrosa del cambio no era el 503 sino su consecuencia: un 503 con el dedupe roto es *peor* que el bug original — en vez de perder el evento, Plane lo reentrega y se lanza una segunda sesión sobre la misma tarea. Verificarlo obligó a montar un test contra el dispatcher REAL (no un stub) inyectando `dispatchLockDir` a un sandbox, y a cubrir explícitamente el caso "fallo transitorio DURANTE el launch": si el `finally` no soltara `dispatch-<task_id>.lock`, el reintento chocaría con un lock huérfano y la tarea se quedaría sin sesión hasta el TTL de 120 s. Queda pendiente el único número elegido a ojo: el default de 2 s, porque no consta el timeout de entrega del cliente de webhooks de Plane.

## Propuesta de skill
Una skill `error-classification-audit`: dado un punto donde el código traduce un error a una decisión de reintento (status HTTP, backoff, dead-letter), rastrea los `throw` reales del árbol de llamadas —incluida la forma anidada de undici (`TypeError: fetch failed` + `cause.code`)— y contrasta la taxonomía propuesta contra ellos, señalando los que quedan sin clasificar y los falsos transitorios que abrirían tormentas de reintentos.
