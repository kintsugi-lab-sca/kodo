---
fecha: 2026-07-13
proyecto: kodo
slug: kodo9-nongit-worktree
---

## Resumen
KODO-9: `buildClaudeCommand` emitía `--worktree` incondicional (regresión Phase 18, commit 5a20eec), rompiendo todo launch en proyectos no-git. Fix: helper `isGitRepo` + gate por `isGitRepo` en el comando + no persistir `worktree_path` en no-git. Suite verde (1949 pass).

## Reto
El working tree del worktree traía eliminaciones y untracked ajenos (`.planning/phases/65-68`, `.compound/`, `.bg-shell/`, `homebrew-kodo/`) — probablemente otra sesión concurrente / limpieza GSD; hubo que stagear SOLO los 2 ficheros del fix a mano para no arrastrar ruido al commit.

## Propuesta de skill
Un skill "kodo-commit-scope" que, en sesiones kodo sobre worktrees compartidos, detecte y stagee solo los ficheros tocados en la sesión (diff vs HEAD del arranque), avisando de deleciones/untracked ajenas antes de commitear. Candidata previa: `/prep` (audita estado git) podría extenderse a este scoping.
