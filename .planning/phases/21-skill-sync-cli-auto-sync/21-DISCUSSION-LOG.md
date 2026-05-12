# Phase 21: Skill Sync CLI + Auto-Sync - Discussion Log

> **Audit trail only.** Auto-mode single-pass — all decisions auto-selected with recommended option.

**Date:** 2026-05-12
**Phase:** 21-skill-sync-cli-auto-sync
**Mode:** --auto (single pass, no AskUserQuestion prompts)
**Areas discussed:** Scope del sync, Diff signal, Auto-sync fail mode, Manejo del symlink legacy, --prune default

---

## Scope del sync

| Option | Description | Selected |
|--------|-------------|----------|
| Solo `kodo-orchestrate/` (skill canonical) | Phase 21 es específica de la skill canonical; otras skills no son responsabilidad de kodo. | ✓ |
| Todo `<repo>/.claude/skills/` | Sincronizaría cualquier skill en el repo, incluyendo futuras. Suma superficie y riesgo. | |

**Auto-selected:** Solo `kodo-orchestrate/` (recommended; scope mínimo, cohesivo con Phase 999.1 D-04..D-06).

---

## Diff signal

| Option | Description | Selected |
|--------|-------------|----------|
| Hash SHA-256 por archivo | Robusto contra touch/git checkout/sync external. Coste ~1ms por archivo. Sin nueva dep (`node:crypto`). | ✓ |
| mtime + size | Barato pero engañoso. `touch` falsifica drift. | |
| Solo mtime | Más barato aún, más engañoso. | |

**Auto-selected:** Hash SHA-256 (recommended; determinismo > velocidad para skill pequeña).

---

## Auto-sync fail mode (en launchOrchestrator)

| Option | Description | Selected |
|--------|-------------|----------|
| Fail-open + warn + event NDJSON | Sync falla → orchestrator continúa launch normal. Skill local del repo gana por construcción. | ✓ |
| Fail-closed (abortar launch) | Bloquea el operator del orchestrator por un drift recuperable manualmente. Peor UX. | |
| Silent fail | No emite evento ni warn. Drift invisible. | |

**Auto-selected:** Fail-open con event (recommended; patrón Phase 19 cleanup D-03).

---

## Manejo del symlink legacy

| Option | Description | Selected |
|--------|-------------|----------|
| Detectar + reemplazar con dir real | `lstat` detecta symlink → borra link → crea dir → copia canónicos. Idempotente. | ✓ |
| Respetar el symlink (no tocar) | El symlink apunta a path inexistente; no respetarlo es lo correcto. | |
| Resolver symlink y syncar al target | Si el target no existe (caso actual), el sync falla. Anti-patrón. | |

**Auto-selected:** Detectar + reemplazar (recommended; resuelve residuo Phase 999.1 por construcción).

---

## --prune default

| Option | Description | Selected |
|--------|-------------|----------|
| Sin --prune por defecto (preserva foráneos) | Operador puede tener overrides locales; default no-destructivo. | ✓ |
| Con --prune por defecto (borra foráneos) | Estado más limpio pero arriesga overrides del operador. | |

**Auto-selected:** Sin --prune por defecto (recommended; REQUIREMENTS.md "Out of Scope" lo exige opt-in).

---

## Claude's Discretion

- Bytes exactos del stderr canonical (4 estados D-07).
- Estructura interna de `syncSkill` (walker vs `fs.cp`).
- Ubicación `src/skill/sync.js` vs `src/skill-sync.js` flat.
- Test fixture strategy (tmpdir + HOME override).
- Logger DI opcional en `syncSkill`.

## Deferred Ideas

- Sync inverso (descartado por scope).
- `kodo skill diff` / `list` (defer v0.7+).
- Watch mode (defer indefinido).
- Sync de skills genéricas (defer).
- Pre-execute bootstrap script (innecesario; sync inline lo resuelve).
- `--dry-run` (defer si emerge CI/CD necesidad).
- Hash cache (premature optimization).
- Fail-closed enforcement (descartado por D-03).
- `kodo doctor` para residuos (inline en sync).
