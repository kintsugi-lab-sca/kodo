---
fecha: 2026-08-29
proyecto: kodo
slug: linux-port-viabilidad
---

## Resumen
Se verificó empíricamente (contenedor node:20-bookworm-slim, aarch64) que kodo ya corre en Linux: 3558/3562 tests y el CLI arranca, con cmux como único componente macOS-only.
Entregado `.planning/research/LINUX-PORT.md` con 8 hallazgos clasificados y plan en 4 fases (2-3 días), commit 558a3968 sin push.

## Reto
La tentación era responder por análisis estático (grep de `process.platform`, rutas hardcodeadas) y entregar un plan especulativo. Correrlo de verdad en Linux cambió la conclusión: los 4 tests que fallaron no eran de plataforma sino fugas de entorno de la suite — incluida una que hace que `test/hooks/install.test.js` pase en macOS solo porque el checkout vive en un directorio llamado `kodo`. Un plan sin ejecución habría dicho «port pendiente» en vez de «ya funciona, falta declararlo».

## Propuesta de skill
`verify-cross-platform`: dado un repo Node, clona a un tmpdir con nombre neutro, monta en Docker (Linux) y corre la suite como root y como no-root, separando en el informe los fallos de plataforma de los fallos por entorno (credenciales ausentes, uid privilegiado, nombre del directorio del checkout).
