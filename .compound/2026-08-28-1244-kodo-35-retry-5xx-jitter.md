---
fecha: 2026-08-28
proyecto: kodo
slug: kodo-35-retry-5xx-jitter
---

## Resumen

Se amplió el loop de retry de `PlaneClient.request` —que solo cubría el 429— a 5xx y errores de transporte, con equal jitter sobre el backoff exponencial y cap 8s preservado.
Resultado: 15 tests nuevos con `fetch`/`sleep` inyectados, suite completa en 3110 pass / 0 fail, commit local `ee109c3` pendiente de push.

## Reto

La premisa del ticket ("network-error/timeout ⇒ la petición nunca llegó") no es estricta: un timeout de 10s sobre un POST que Plane sí procesó duplica el efecto. Se implementó lo pedido asumiendo el riesgo y documentándolo en el JSDoc, pero la decisión de limitar el retry de POST a errores de conexión puros sigue abierta para revisión humana.

## Propuesta de skill

Una skill `http-retry-audit` que, dada una clase cliente HTTP, clasifique cada método por idempotencia y verifique que el loop de retry cubre 429/5xx/transporte con jitter y seams de test — evitaría re-derivar desde cero el mismo análisis en `GitHubClient` y en el siguiente provider.
