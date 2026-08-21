---
fecha: 2026-06-29
proyecto: kodo
slug: phase63-config-editor-foundation
---

## Resumen
Pipeline GSD `--auto` completo (discuss→research→plan→verify→execute→verify) para Phase 63: editor de ajustes comunes en el dashboard TUI — overlay + text-input editable in-house en ink + escritura atómica no-corruptiva, todo sobre `main` en modo secuencial.
Resultado: 14/14 requisitos y 12/12 decisiones cubiertos, suite 1601 pass / 0 fail, VERIFICATION passed 5/5, UAT humano aprobado en TTY real.

## Reto
El research detectó dos pitfalls de integración que el código real escondía y que habrían roto la fase si se ignoraban: (1) `loadConfig()` devuelve `{...DEFAULT_CONFIG}` con spread **superficial** → mutar campos anidados contamina el módulo (mitigado con `structuredClone` del snapshot); (2) el `clear-on-any-input` del `focusError` (App.js:~510) **consume cualquier tecla** → el error de validación del editor necesitaba un estado dedicado (`configEditError`), no `focusError`. Encontrarlos ANTES de planificar (no en debug post-hoc) fue lo que mantuvo la ejecución limpia.

## Propuesta de skill
Existe fricción recurrente en el routing del pipeline `--auto`: cada paso obliga a renderizar `loop render-hooks` y contrastar `activeHooks` contra `config-get` real (el dump `--raw` lista hooks registrados, no activos). Una skill `gsd-resolve-active-hooks <point>` que devuelva SOLO los hooks con `when` satisfecho (intersectando registro × config) evitaría spawns espurios de UI-phase/pattern-mapper y el doble chequeo manual en cada gate.
