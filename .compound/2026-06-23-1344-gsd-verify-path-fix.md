---
fecha: 2026-06-23
proyecto: kodo
slug: gsd-verify-path-fix
---

## Resumen
Fixed GSD verify gate reading VERIFICATION.md from stale session.worktree_path, which pointed to non-existent `.bg-shell/<id>` directory, blocking verdict computation and provider resolution. Implement computeRealWorktreePath derivation with fallback to project_path for v0.5 compatibility, enabling verify to correctly locate .planning artifacts across v0.6+ worktrees and legacy sessions.

## Reto
session.worktree_path persists a stale reference from initial session spawn; actual Claude Code worktrees live in ephemeral `.bg-shell/` paths that become inaccessible post-session. Verify gate needed transparent path resolution without breaking backward compatibility for sessions without real worktrees.

## Propuesta de skill
Automated path fixup scanner: detect all session state / Plane API integration points that cache worktree paths and audit for stale-path brittleness before it surfaces in live UAT workflows.
