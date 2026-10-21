---
fecha: 2026-10-10
proyecto: kodo
slug: orquestacion-9oct-webhook-caido
---

## Resumen
Ronda de orquestación del 9-oct: seis tareas cerradas (SCP-131/132, ITCLIP-208/210, ROMAN-250/251), ITCLIP-210 y ROMAN-252 creadas, tres PDF de prueba de la PR #108 generados en worktree aparte.
Diagnosticado y arreglado el webhook de Plane caído desde el 2-oct: el Tailscale del servidor de Plane estaba deslogueado y nadie lo notó porque el orquestador lanzaba a mano.

## Reto
Un fallo silencioso de infraestructura (webhook sin entregas durante una semana) quedó enmascarado porque el fallback manual (`kodo launch`) funcionaba; no hay ninguna señal de «hace N días que no llega un webhook» ni en `kodo check` ni en el dashboard.

## Propuesta de skill
Añadir a `kodo check` (o a `kodo doctor`) un chequeo «último webhook recibido hace > 24 h con tareas movidas a In Progress en Plane» que lo saque como `stuck` del daemon; mientras tanto, la receta de diagnóstico ya vive en §Lecciones aprendidas de `kodo-orchestrate` (mem #37188).
