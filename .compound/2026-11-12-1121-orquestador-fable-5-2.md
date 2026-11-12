---
fecha: 2026-11-12
proyecto: kodo
slug: orquestador-fable-5-2
---

## Resumen
Causa confirmada: `--model fable` lo resolvió claude 2.1.319 al lanzar (5.1); 2.1.322 ya da 5.2, y el binario de cmux en config no existe.
Validación admite ids `claude-*`, hint de `--model` en el dashboard, opencode → 5-2; PR #31 con npm test en verde.

## Reto
Saber qué versión real corre un alias sin gastar API: hizo falta cruzar `lsof` del proceso vivo con el campo `model` del transcript.

## Propuesta de skill
Skill `kodo-model-probe`: dado un session id, imprime binario y versión del proceso (`lsof`), modelo por tramo del transcript y a qué resuelve hoy cada alias.
