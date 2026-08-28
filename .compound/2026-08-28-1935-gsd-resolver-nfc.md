---
fecha: 2026-08-28
proyecto: kodo
slug: gsd-resolver-nfc
---

## Resumen
NFC-normalizado `normalizeTitle` del resolver GSD (último paso de la cadena, tras `toLowerCase`, porque el lowercase puede emitir secuencias descompuestas) y documentado en `deriveTargetForeign` el falso `dead` de sesiones extranjeras cuya cmdline deja de casar el pgrep tras un `--resume`/adopt.
9 tests nuevos verdes y suite completa 3385/3386 pass; el edge case del pgrep queda como riesgo documentado con sus tres salidas valoradas, ninguna implementada.

## Reto
El guard de `isProcessDeadBeyondGrace` cierra un agujero (sesiones nunca vistas vivas) con la misma condición estricta `process_alive === true` que abre el simétrico (sesiones vistas vivas que cambian de cmdline). Las tres salidas evaluadas fallan por sitios distintos: el flag `cmdline_matchable` solo cubre los resumes que atraviesan código de kodo, relajar el pgrep al uuid introduce falsos positivos permanentes porque los worktrees llevan el uuid en el path, y el mtime del transcript cambia la semántica de `process_alive` de «existe el proceso» a «hubo actividad reciente». Queda pendiente decidir cuál merece ticket.

## Propuesta de skill
Una skill `unicode-normalize-audit` que barra las funciones de normalización/comparación de strings de un repo (`normalize*`, `slugify`, comparaciones `===` sobre texto de usuario) y señale las que carecen de `.normalize('NFC')`, incluyendo el chequeo de orden respecto a `toLowerCase()` — que es la parte no obvia y la que se equivoca al aplicarlo a ojo.
