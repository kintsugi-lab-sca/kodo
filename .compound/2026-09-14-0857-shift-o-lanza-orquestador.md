---
fecha: 2026-09-14
proyecto: kodo
slug: shift-o-lanza-orquestador
---

## Resumen
Shift+O en la TUI trata igual un ref null y un focus fallido: lanza `kodo orchestrate`, vuelve a resolver el ref y lo enfoca; el footer enseña el motivo real que da cmux.
El «code 1» con un orquestador vivo se reprodujo con el entorno del TUI: fue un Shift+O antes del primer check del daemon, con orchestrator.json aún apuntando al ref de ayer.

## Reto
No hay lock entre lanzamientos concurrentes del orquestador (TUI o CLI contra el `kodo check` del daemon), así que sigue siendo posible un duplicado justo tras `kodo up` (diferido D#1).

## Propuesta de skill
Una skill `cmux-repro-env` que ejecute un verbo de cmux con las variables CMUX_* de un PID concreto y capture exit, stdout y stderr, para diagnosticar fallos de cmux que solo pasan en otro proceso.
