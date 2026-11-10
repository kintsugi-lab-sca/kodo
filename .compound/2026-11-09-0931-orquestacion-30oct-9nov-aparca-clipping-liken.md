---
fecha: 2026-11-09
proyecto: kodo
slug: orquestacion-30oct-9nov-aparca-clipping-liken
---

## Resumen
Diez días de orquestación: 12 tareas creadas y lanzadas (Aparca&Go ×6, Clipping ×6, World in Progress, Media Hub la Caixa, ANFAC), merge local de todo Clipping en main para pruebas, y consulta técnica a ROMAN-279 sobre la v106 de GTM.
Entregas en disco en ~/dev/roman/{aparcago,worldinprogress,mediahub-lacaixa,anfac}; Liken sigue bloqueada en los pair tests del operador y la trimestral del 5-nov se dejó renovar.

## Reto
Sin fuente de memoria para esta sesión: la actualización de claude-mem-lite (6.30.8 → 6.30.15, 3-nov 12:01) borró la carpeta que referenciaban los hooks de todas las sesiones abiertas, y ni el orquestador ni las sesiones grabaron observaciones; además cmux se reinició dos veces y renumbró los workspace_ref de state.json.

## Propuesta de skill
Una skill «kodo-refs-reconcile» que, tras un reinicio de cmux, cruce `cmux list-workspaces` (títulos con el ref de tarea) con `state.json` y reescriba los workspace_ref sin tocar nada más, para que read-screen y send-key vuelvan a funcionar sin esperar al daemon.
