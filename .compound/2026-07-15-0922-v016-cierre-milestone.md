---
fecha: 2026-07-15
proyecto: kodo
slug: v016-cierre-milestone
---

## Resumen
Milestone v0.16 Hardening cerrado end-to-end: audit de milestone ejecutado y PASSED (27/27 reqs, 6/6 seams cross-phase vía integration-checker, E2E completo), archivado canónico (ROADMAP/REQUIREMENTS/AUDIT/phases), PROJECT.md/STATE.md/RETROSPECTIVE.md evolucionados, tag v0.16 local (push pendiente).

## Reto
Tercer cierre consecutivo con fricción de tooling en vez de código: falso "UAT gap" por vocabulario de frontmatter (`status: passed` vs `complete` en 72-UAT.md), `milestone.complete` contando el Backlog como fases unstarted (necesitó `--force`) y devolviendo stats a cero, y los phase dirs de v0.15 (65-68) borrados del working tree sin archivar — hubo que restaurarlos de HEAD y archivarlos junto a los de v0.16.

## Propuesta de skill
Un pre-flight de cierre (`gsd-close-preflight`) que normalice frontmatter de UAT/VALIDATION al vocabulario canónico, verifique que todo milestone shipped tiene su `vX.Y-phases/` archivado, y valide checkboxes del ROADMAP contra las VERIFICATION antes de invocar `/gsd-complete-milestone` — eliminaría la investigación de causa raíz que se repite en cada cierre.
