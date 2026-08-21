---
fecha: 2026-07-02
proyecto: kodo
slug: phase67-execute-index-vs-deps
---

## Resumen
Ejecuté la Fase 67 (writeEnvVar seguro 0600 + input enmascarado + grep de higiene de 5 sinks) en 3 planes secuenciales: 16 commits, suite 1756 pass/0 fail, verificación goal-backward 3/3 must-haves.
Quedó en `human_needed` por el UAT runtime manual de 8 pasos; KODO-8 movido a "In review" con el `~/.kodo/.env` real intacto en todo momento.

## Reto
`phase-plan-index` agrupó los 3 planes en "wave 1" con `depends_on`/`files_modified` vacíos porque los planes no tienen frontmatter YAML (solo cabeceras markdown `**Wave:**`/`**Depends on:**`), ocultando la cadena real 67-01→67-02→67-03 y el solape de `src/config.js`; hubo que leer el cuerpo de cada plan y forzar orden secuencial (que además coincidió con la degradación de worktrees por #683).

## Propuesta de skill
Un fallback en el parser de `phase-plan-index`: cuando `depends_on`/`files_modified` salgan vacíos, parsear las cabeceras markdown `**Wave:**`/`**Depends on:**`/`Related Files` del cuerpo como respaldo y avisar de la discrepancia antes de ejecutar (no hay candidata en find-skills; nombrarla `gsd-plan-index-body-fallback`).
