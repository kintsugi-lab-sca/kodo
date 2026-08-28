---
fecha: 2026-08-28
proyecto: kodo
slug: hardening-http-server
---

## Resumen
Cuatro endurecimientos en la capa HTTP del daemon (KODO-45): token-bucket por IP en `/webhook` con 429 + `Retry-After`, `maxHeaderSize` explícito de 8 KB, 415 ante `Content-Type` no JSON pre-HMAC, y aviso al arrancar con bind wildcard.
Suite completa en verde (3398 pass / 0 fail) con 63 tests nuevos o ampliados repartidos entre el unitario del limiter y los tres ficheros e2e del server.

## Reto
Dos límites nuevos generaban su propio problema al añadirlos: el Map de buckets del rate limiter es un vector de memoria si no se acota (flood desde muchas IPs), y un `console.warn` por cada 429 deja que el atacante elija el volumen del log y barra el ring buffer de 200 líneas que sirve `/logs`. Ambos aparecieron al releer el código ya escrito, no al diseñarlo — la primera versión tenía los dos.

## Propuesta de skill
Una skill `hardening-review` que, ante cualquier límite o contador nuevo añadido a una ruta pública, pregunte por escrito tres cosas antes de dar el cambio por bueno: qué crece sin cota, qué escribe el atacante en el log, y qué test distinguiría el límite nuevo del default del runtime (aquí: los 10 KB del test de 431, elegidos para caer entre el tope de kodo y el de Node).
