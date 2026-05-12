# Requirements — Milestone v0.6 Session Isolation & Skill Sync

**Milestone goal:** Aislar sesiones en worktrees por defecto, sincronizar la canonical skill `kodo-orchestrate` automáticamente, recordar a TODAS las sesiones que no hay push automático, y cerrar la tech debt acumulada en v0.5.

**Scope:** 19 requirements en 4 categorías (WT × 6, HOOK × 3, SKILL × 4, DEBT × 6).

---

## v0.6 Requirements

### Worktree always-on (WT-*)

- [x] **WT-01** — Toda sesión kodo se lanza con `claude --worktree` (full + quick + no-GSD). No depende de labels ni flags opt-in.
- [x] **WT-02** — El path del worktree se deriva determinísticamente del session-id (ej. `<repo>/.bg-shell/<session-id>/`) y se persiste en `SessionRecord.worktree_path`.
- [x] **WT-03** — El lock per-repo (Phase 8 GSD-10) sigue siendo sobre el repo principal, NO sobre el worktree. Dos sesiones contra el mismo repo siguen coalesciendo.
- [x] **WT-04** — El `stop` hook hace cleanup del worktree (`git worktree remove`) tras release del lock, fail-open si la sesión dejó cambios sin commitear (log warn, no borrar).
- [x] **WT-05** — `auto-commit` de la skill `kodo-orchestrate` opera dentro del worktree (cwd correcto en `stop.js`); `KODO_ROOT` env override (Phase 999.1) sigue funcionando para tests.
- [x] **WT-06** — `kodo gsd verify` lee `VERIFICATION.md` desde el worktree de la sesión (path correcto en runtime).

### HOOK-01 universal (HOOK-*)

- [x] **HOOK-01** — `buildSessionContext` añade sección "Anti-push-fantasma" a TODAS las sesiones (GSD + no-GSD). Texto: kodo NO hace push automático; el agente debe verificar `git push` real o redactar en condicional ("una vez se haga push…") las afirmaciones de deploy/publicación. Driver: ROMAN-125 / ROMAN-126.
- [x] **HOOK-02** — Golden bytes preservados — los tags `[GSD quick]`, `[GSD phase N]`, `[GSD bootstrap]` y los demás artefactos del prompt no cambian shape; el bloque HOOK-01 se inserta en posición determinista (mismo offset por modo).
- [x] **HOOK-03** — Test coverage para los 3 modos × `buildSessionContext` (full / quick / no-GSD) cubre que el recordatorio aparece y que el resto del prompt no muta.

### Skill sync (SKILL-*)

- [ ] **SKILL-01** — CLI `kodo skill sync` empuja `<repo>/.claude/skills/` → `~/.claude/skills/`. Diff-aware: solo copia archivos cambiados; NO borra archivos foráneos en `~/.claude/skills/` salvo flag `--prune` explícito.
- [ ] **SKILL-02** — `kodo orchestrator` detecta drift entre repo y home antes de lanzar (hash o mtime); si hay drift, ejecuta sync automáticamente con evento `skill.sync.auto` en el log NDJSON.
- [ ] **SKILL-03** — Auto-sync NO rompe Constraint cwd=repo: el orchestrator sigue funcionando si se lanza desde el repo (la skill local override sigue ganando); auto-sync solo asegura que `~/.claude/skills/` no quede stale para invocaciones cross-cwd futuras.
- [ ] **SKILL-04** — Exit codes deterministas en `kodo skill sync`: 0 sync ok / 0 no-op si no hay drift / 1 error de filesystem / 2 fuera de un repo kodo. Documentado en stderr canonical messages.

### Tech debt v0.5 closure (DEBT-*)

- [ ] **DEBT-01** (Phase 14) — `SECURITY.md` para Phase 14 con `threats_open: 0` auditado (low-risk presentation-only).
- [ ] **DEBT-02** (Phase 14) — `test/version-smoke.test.js` recibe `timeout` explícito en spawnSync (WR-01); regresión `format-isolation.test.js` cubre el caso.
- [ ] **DEBT-03** (Phase 14) — Regex ANSI defensiva (IN-01) + test explícito `FORCE_COLOR=''` con `useColor=false` esperado (IN-02).
- [ ] **DEBT-04** (Phase 15) — Retirar `ANSI_*` exports de `src/logger.js`; grep cross-repo verifica 0 consumers externos; ajustar `format-isolation.test.js` si la regla cambia.
- [ ] **DEBT-05** (Phase 16) — 8 WR del Resolution Log cerrados: doble logger en `stop.js`, eager EVENTS + dynamic helpers en `dispatcher.js`, etc. (lista completa en `milestones/v0.5-phases/16-log-09-debt-cleanup/16-REVIEW.md`).
- [ ] **DEBT-06** (Phase 16) — 4 IN del Resolution Log resueltos (cosméticos/documentales: nombres de variables, comentarios, ordenamiento de imports).

---

## Future Requirements (deferred to v0.7+)

- Adapter de GitHub Issues que implementa `TaskProvider`
- Adapter de ClickUp que implementa `TaskProvider`
- Adapter local (JSON/Markdown) que implementa `TaskProvider`
- Polling trigger channel para providers sin webhook
- File watcher trigger para provider local

---

## Out of Scope

- Dashboard web — CLI sigue siendo suficiente
- Multi-tenant / multi-usuario — herramienta personal
- Persistencia en base de datos — JSON files suficientes
- TypeScript migration — JSDoc + @ts-check cubre las necesidades
- Migración de `SessionRecord` legacy (`worktree_path` ausente) — campo aditivo opcional, sesiones v0.5 siguen leyéndose; lock liberation idempotente
- `--prune` mode por defecto en `kodo skill sync` — destructivo, requiere opt-in explícito
- Worktree shared entre sesiones — un worktree por session-id, no shared pool
- Auto-sync de `~/.claude/skills/` → `<repo>/.claude/skills/` (dirección inversa) — el repo es la source canonical; cambios manuales en home se descartan en próximo sync

---

## Traceability

Mapped to phases by `gsd-roadmapper` 2026-05-11 — see `ROADMAP.md` for full phase definitions.

| REQ-ID   | Phase    | Status  |
|----------|----------|---------|
| WT-01    | Phase 18 | Complete |
| WT-02    | Phase 18 | Complete |
| WT-03    | Phase 18 | Complete |
| WT-04    | Phase 19 | Complete |
| WT-05    | Phase 19 | Complete |
| WT-06    | Phase 19 | Complete |
| HOOK-01  | Phase 20 | Complete |
| HOOK-02  | Phase 20 | Complete |
| HOOK-03  | Phase 20 | Complete |
| SKILL-01 | Phase 21 | pending |
| SKILL-02 | Phase 21 | pending |
| SKILL-03 | Phase 21 | pending |
| SKILL-04 | Phase 21 | pending |
| DEBT-01  | Phase 22 | pending |
| DEBT-02  | Phase 22 | pending |
| DEBT-03  | Phase 22 | pending |
| DEBT-04  | Phase 22 | pending |
| DEBT-05  | Phase 22 | pending |
| DEBT-06  | Phase 22 | pending |

**Coverage:** 19/19 requirements mapped (100%) — no orphans, no duplicates.

---

*Created: 2026-05-11 — milestone v0.6 initialized via `/gsd-new-milestone`. Requirements gathered without research (skip — features son específicas a kodo, no hay framework externo nuevo). Traceability filled by `gsd-roadmapper` 2026-05-11.*
