---
fecha: 2026-08-20
proyecto: kodo
slug: queue-branch-sync
---

## Resumen
Sincronización de rama divergida mediante rebase de KODO-25 sobre main de KODO-26, restaurando historial linear y clean working tree. Actualización de logger-events.test.js para integrar nuevo evento `integrate.action` (count: 37) en taxonomía canonical.

## Reto
Test de status-unified.test.js asume byte-identical output pero formateador `fmt.ok()` prefija checkmark a status `running`, causando mismatch en assertion: espera `'running pid: 123\n'`, recibe `'✓ running pid: 123\n'`.

## Propuesta de skill
Skill `test-output-normalize` que abstrae comparación semántica de output en tests CLI, ignorando decoración visual del formateador para validar contenido funcional sin brittleness de byte-exact assertions.
