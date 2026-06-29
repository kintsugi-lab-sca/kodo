---
phase: 57
slug: orquestador-asistido
status: complete
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-18
audited: 2026-06-24
---

# Phase 57 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

> NOTE: Phase 57 is a PURE-PROSE phase — the deliverable is two `.md` edits
> (`.claude/skills/kodo-orchestrate/skill.md` + `src/orchestrator/prompt.md`),
> ZERO `src/` business logic (SC3). Validation is therefore about INVARIANT
> PRESERVATION, not new test coverage: the existing orchestrator-prose tests
> must stay green (placeholders/golden bytes preserved, `launch.js` untouched,
> reporting-gate markers intact). The ORCH-01 LLM behavior (title derivation
> quality, confirmation pause, safe-shell command formation) is inherently
> MANUAL-ONLY — LLM-driven prose-following is non-deterministic and not
> Nyquist-automatable. `nyquist_compliant: true` here means: every automatable
> invariant IS automated; the one behavioral item is correctly classified
> manual-only (tracked separately as HUMAN-UAT, see 57-HUMAN-UAT.md).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, Node 20+) |
| **Config file** | none — `node --test test/**/*.test.js` |
| **Quick run command** | `node --test test/prompt.test.js test/skill-sync.test.js test/orchestrator-launch-isolation.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~24s (full suite) |

---

## Sampling Rate

- **After every task commit:** Run the quick command (prompt + skill-sync + launch-isolation).
- **Before `/gsd:verify-work`:** Full suite green.
- **Max feedback latency:** 30 seconds.

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 57-01-01 | 01 | 1 | ORCH-01 | T-57-01 (shell-injection) | Mandato shell-seguro del `--title` (charset prohibido + arg single-quote literal + confirmación humana D-03) presente en skill.md §"Adopción asistida"; espejo en prompt.md ANTES de `<!-- BEGIN reporting -->` | prose-assert + suite | `node --test test/prompt.test.js test/skill-sync.test.js test/orchestrator-launch-isolation.test.js` | ✅ | ✅ green |
| 57-01-02 | 01 | 1 | ORCH-01 (SC3 isolation) | — | CERO lógica nueva: `launch.js`/`adopt.js`/`cli/adopt.js`/`cli.js` byte-idénticos; placeholders + golden bytes de prompt.md preservados; reporting-gate markers 1× cada uno | prose-assert + suite | `node --test test/orchestrator-launch-isolation.test.js test/prompt.test.js` | ✅ | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [x] No new test files required — `test/prompt.test.js` / `test/skill-sync.test.js` / `test/orchestrator-launch-isolation.test.js` cubren las invariantes (placeholder/golden-byte preservation, launch.js isolation).

*Existing infrastructure covers all phase invariants.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| El orquestador, en sesión interactiva, propone un título inteligente derivado del contexto real (cwd/git log/transcript), lo confirma con el operador, y shellea `kodo adopt --title` shell-seguro | ORCH-01 | Comportamiento LLM-driven (prosa), no determinista — la calidad del título derivado, que el LLM lea git log vs basename, la pausa de confirmación, y la formación correcta del comando son propiedades emergentes no verificables con grep/tests | ⚠️ **PENDIENTE** — Lanzar el orquestador apuntado a un repo real con historial de commits; pedirle adoptar la sesión ad-hoc; verificar (a) título mejor que basename(cwd), (b) muestra título + espera confirmación, (c) `kodo adopt` sale exit 0 con título saneado en single-quotes. Ver 57-HUMAN-UAT.md + 57-VERIFICATION.md §Human Verification Required. |

*El comportamiento LLM-driven es inherentemente HUMAN-UAT; los tests automatizados cubren TODAS las invariantes automatizables (estructura/isolation/golden-bytes/shell-safety prose). Este ítem NO es un gap Nyquist — es un track de verificación humana separado.*

---

## Validation Sign-Off

- [x] El skill contiene la sección de adopción con el mandato de invocación shell-segura (T-57-01)
- [x] prompt.md mirror presente; placeholders + golden bytes preservados (test/prompt.test.js verde)
- [x] launch.js sin cambios (test/orchestrator-launch-isolation.test.js verde)
- [x] Full suite green (38/38 invariantes)
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-24 (PARTIAL — 2 invariantes automatizadas + 1 comportamiento LLM manual-only)

---

## Validation Audit 2026-06-24

| Metric | Count |
|--------|-------|
| Gaps found | 0 (todo lo automatizable está cubierto) |
| Resolved | 0 (pre-existing coverage) |
| Escalated to manual-only | 1 (comportamiento LLM ORCH-01 — inherentemente HUMAN-UAT, ya en track separado) |
| Requirements covered | 1/1 estructural (ORCH-01 invariantes); comportamiento LLM en HUMAN-UAT |
| Tests run | 38 pass / 0 fail (prompt + skill-sync + launch-isolation) |

> **Nota para el milestone audit:** el HUMAN-UAT del comportamiento LLM de ORCH-01 sigue `pending` (57-HUMAN-UAT.md). Esto NO afecta la Nyquist-compliance (que mide cobertura automatizable), pero SÍ es el ítem pendiente que el v0.13-MILESTONE-AUDIT marcó como deuda. La validación automatizada está completa.
