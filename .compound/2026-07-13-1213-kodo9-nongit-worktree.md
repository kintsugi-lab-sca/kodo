---
fecha: 2026-07-13
proyecto: kodo
slug: kodo9-nongit-worktree
---

## Resumen
Se implementó un detector git-repo que verifica si el directorio de trabajo es un repositorio git antes de emitir el flag --worktree al launcher de Claude. Esto resuelve fallos críticos de arranque en proyectos no-git (como VAMPIRE) donde claude --worktree fallaba inmediatamente, dejando sesiones zombis con estado alive=true. La solución introduce isGitRepo() helper con fail-safe a false, y condiciona --worktree emission en buildClaudeCommand basado en un nuevo parámetro isGitRepo, con cobertura de tests para ambas ramas (git con --worktree, no-git sin).

## Reto
La arquitectura de kodo usa siempre --worktree para aislamiento de sesiones; proyectos que no son git-initialized quedaban sin alternativa de lanzamiento, impactando usuarios de directorios sin VCS. La detección debe ser síncrona y fail-safe para mantener la semántica de "lanzar siempre es válido; --worktree inválido es siempre fatal".

## Propuesta de skill
Un skill kodo-diagnose-sessions que valide la salud de sesiones activas: detecte zombis (alive=true pero proceso muerto), verifique persistencia de worktree_path coherente con git-status real, y marque outliers para limpiar. Automatizaría auditoría post-lanzamiento.
