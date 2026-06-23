---
fecha: 2026-06-23
proyecto: kodo
slug: kodo4-gsd-verify-provider
---

## Resumen
Arreglado `kodo gsd verify`/`inspect` que fallaban con "Unknown provider: undefined" (provider hardcodeado a `undefined` en el getProviderFn por defecto). Además, verify ahora lee VERIFICATION.md del worktree real (`.claude/worktrees/<id>`) en vez del `worktree_path` persistido obsoleto. Suite: 1317 pass / 0 fail.

## Reto
El bug vivía en el *valor por defecto* del seam DI (`getProviderFn`), no en el seam mismo — los tests existentes lo inyectaban y nunca ejercitaban la resolución del nombre del provider, dejando el bug invisible. El test de regresión tuvo que usar el registry real (initRegistry + registerProvider override) para cubrir el path por defecto.

## Propuesta de skill
Una skill "di-default-coverage-audit" que detecte seams DI cuyos *defaults* nunca se ejercitan en tests (todos los call-sites inyectan el override) — patrón de bug latente recurrente en este codebase.
