---
phase: 60
slug: enriquecimiento-de-tareas-adoptadas-por-el-orquestador
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-24
audited: 2026-06-24
reconstructed: true
---

# Phase 60 — Validation Strategy

> Per-phase validation contract. **Reconstruido retroactivamente** (State B) durante
> `/gsd:validate-phase 60` el 2026-06-24. Phase 60 entrega BIDIR-F2 (backlog item):
> enriquecimiento de tareas adoptadas vía `kodo comment` (backfill por `addComment`
> FROZEN-9) + at-adopt `--description`. El carril CLI es determinista 0-token
> (automatizable); la derivación de título/resumen vive en la prosa del orquestador
> (LLM-driven, manual-only — espejo de Phase 57).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, Node 20+) |
| **Config file** | none — `package.json` test script |
| **Quick run command** | `node --test test/comment-cli.test.js test/format-isolation.test.js test/cmux-isolation.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~1s (targeted) / full suite |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/comment-cli.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** ~30 segundos

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 60-01-01 | 01 | 1 | SC3 (backfill addComment) | — | `kodo comment <ref> --body` resuelve provider → `getTask` → sanea → `addComment` (FROZEN-9, cero métodos nuevos); validación ref/body vacíos → exit 1; happy path exit 0 | unit | `node --test test/comment-cli.test.js` | ✅ | ✅ green (4 casos: validación + happy) |
| 60-01-02 | 01 | 1 | SC1 (sanitización BIDIR-08) | T-53-03 (info disclosure) | rutas absolutas / home redactados ANTES del POST; usa el `sanitizeAdoptionData` real por defecto (never-throws) | unit | `node --test test/comment-cli.test.js` | ✅ | ✅ green (2 casos sanitize) |
| 60-01-03 | 01 | 1 | SC3 (exit codes deterministas) | — | `getTask` falla → FETCH_FAILED exit 2 (addComment NO llamado); `addComment` falla → POST_FAILED exit 2; `--json` byte-determinista sin ANSI | unit | `node --test test/comment-cli.test.js` | ✅ | ✅ green (3 casos transient + json) |
| 60-01-04 | 01 | 1 | SC3 (wiring estático) | — | `cli.js` registra `comment <ref>` + import dinámico + `runCommentCli` + `--body` requiredOption | unit | `node --test test/comment-cli.test.js` | ✅ | ✅ green (4 casos CLI1-4) |
| 60-01-05 | 01 | 1 | SC4 (isolation invariantes) | — | comment.js NO leakea color (format-isolation) ni cmux (cmux-isolation); carril 0-token determinista; cero endpoints nuevos | unit | `node --test test/format-isolation.test.js test/cmux-isolation.test.js` | ✅ | ✅ green (8 walkers) |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> **SC2** (at-adopt `kodo adopt --description`): el plumbing `--description` ya existía
> y estaba testeado en Phase 54 (`src/cli/adopt.js`); Phase 60 solo lo **desbloquea en
> la prosa** del skill. La parte determinista (sanea description vía mismo BIDIR-08
> backstop) está cubierta por `test/adopt.test.js` (Phase 53).

---

## Wave 0 Requirements

- [x] `test/comment-cli.test.js` — net-new; 12 tests cubriendo validación, happy path, sanitización BIDIR-08, fallos transient (exit 2), --json determinista, wiring estático
- [x] `addComment` ya estaba en el contrato FROZEN-9 y testeado en la contract matrix Plane+GitHub — el backfill lo reusa sin tocar el contrato

*Existing infrastructure covers the rest — no framework install.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| El orquestador deriva un título inteligente Y un resumen-descripción del contexto real (git log/diff/transcript), summarizado nunca verbatim, y pide confirmación antes de postear | SC1/SC4 | Comportamiento LLM-driven (prosa del skill) — la calidad del resumen, que summarice vs verbatim, y la pausa de confirmación son propiedades emergentes no verificables con tests | Lanzar el orquestador, pedirle enriquecer una tarea adoptada; verificar que propone un resumen de 2-4 frases (no verbatim del transcript), espera confirmación, y shellea `kodo comment`/`kodo adopt --description` shell-seguro |

> **Nota:** la sanitización BIDIR-08 (el backstop del núcleo) SÍ está automatizada
> (corre deterministamente en `comment.js`/`adopt.js` independientemente de lo que el
> LLM emita). Lo manual-only es solo la **calidad/comportamiento LLM** de la derivación.

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references
- [x] No watch-mode flags
- [x] Feedback latency < 30s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-24

---

## Validation Audit 2026-06-24

| Metric | Count |
|--------|-------|
| Gaps found | 0 |
| Resolved | 0 (reconstrucción State B — cobertura pre-existente) |
| Escalated to manual-only | 1 (comportamiento LLM de derivación título/resumen — inherentemente HUMAN-UAT) |
| Requirements covered | BIDIR-F2 (SC1-SC4): carril CLI determinista auto; derivación LLM manual-only |
| Tests run | 20 pass / 0 fail (comment-cli 12 + format-isolation + cmux-isolation 8) |
