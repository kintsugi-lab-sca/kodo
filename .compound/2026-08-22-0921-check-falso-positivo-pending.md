---
fecha: 2026-08-22
proyecto: kodo
slug: check-falso-positivo-pending
---

## Resumen
Ronda de orquestación con 3 sesiones ITCLIP (A1–A3) corriendo; al cruzar el "5 pending, 2 slots" de `kodo check` con Plane, las 5 eran las 3 running + una `kodo:adopted` + una sin label — el orquestador se había lanzado sin nada que dispatchar.
Corregido en `550ac48`: `listPendingTasks` del provider Plane filtra con `isDispatchable` (mismos 3 gates del dispatcher) y `check`/`/status` restan las tareas con sesión viva vía `excludeActiveTasks`; `kodo check --dry-run` pasa de lanzar a `✓ All clear` (2987 tests verdes).

## Reto
El conteo venía de dos carriles que cada uno cumplía su contrato local: el provider devolvía "todo lo que está en el estado trigger" y `check` comparaba ese número con los slots, sin que nadie cerrara la brecha "pendiente ≠ en curso". Lo que lo destapó fue reproducir `provider.listPendingTasks()` en un script suelto y leer los refs uno a uno, no el código. Pendiente: el daemon vivo sirve `/status` con el código previo hasta reiniciarlo.

## Propuesta de skill
Un `kodo check --explain` que liste los refs que cuenta como pendientes con el motivo de cada uno (label, estado, sesión viva) en vez de solo el número — habría hecho visible el falso positivo en la primera línea del arranque del orquestador.
