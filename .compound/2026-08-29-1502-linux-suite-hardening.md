---
fecha: 2026-08-29
proyecto: kodo
slug: linux-suite-hardening
---

## Resumen
Desacoplé del entorno los 4 tests frágiles que el port a Linux destapó (API key heredada del `~/.kodo/.env`, filtro por el substring `kodo` de la ruta, `chmod 000` que root ignora, cwd asumido como repo git) más un quinto de la misma clase que el research no listaba.
Suite verde en las tres configuraciones: macOS, y Docker `node:20-bookworm-slim` como root y como no-root, con el árbol montado en un directorio que no se llama `kodo`.

## Reto
El inventario del research se quedó corto: sanear los 4 tests listados dejó un quinto fallo (`orchestrator-auto-sync.test.js`, mismo `chmod 000` bajo root) que solo apareció al correr la suite entera en el contenedor. La lección es que el criterio de éxito («verde como root y como no-root en un dir que no se llame kodo») vale más que la lista de casos: hay que ejecutarlo, no solo tachar items.

## Propuesta de skill
Una skill `test-env-portability` que corra la suite en una matriz de entornos hostiles (root/no-root, directorio con nombre aleatorio, HOME limpio sin `.env`, sin `.git`) y reporte solo los tests cuyo veredicto cambia entre configuraciones — que es exactamente la señal de acoplamiento al entorno. No he encontrado candidata existente con `find-skills`.
