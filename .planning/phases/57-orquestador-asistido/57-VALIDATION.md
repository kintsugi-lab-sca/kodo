---
phase: 57
slug: orquestador-asistido
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-18
---

# Phase 57 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

> NOTE: Phase 57 is a PURE-PROSE phase — the deliverable is two `.md` edits
> (`.claude/skills/kodo-orchestrate/skill.md` + `src/orchestrator/prompt.md`),
> ZERO `src/` business logic (SC3). Validation is therefore about INVARIANT
> PRESERVATION, not new test coverage: the existing orchestrator-prose tests
> must stay green (placeholders/golden bytes preserved, `launch.js` untouched,
> reporting-gate markers intact).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in, Node 20+) |
| **Config file** | none — `node --test test/**/*.test.js` |
| **Quick run command** | `node --test test/prompt.test.js test/skill-sync.test.js test/orchestrator-launch-isolation.test.js` |
| **Full suite command** | `node --test $(find test -name '*.test.js' -type f)` |
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
| {N}-01-01 | 01 | 1 | ORCH-01 | T-57-01 (shell-injection) | El mandato de invocación shell-segura del `--title` derivado está presente en el skill (charset seguro + arg entre comillas + confirmación humana) | prose-assert + suite | `node --test test/prompt.test.js test/skill-sync.test.js test/orchestrator-launch-isolation.test.js` | ✅ existing | ⬜ pending |

*Planner fills this map (Dimension 8) keyed to ORCH-01. For a prose phase, acceptance is: (a) the skill section exists with the load-bearing safe-shell mandate + confirm step, (b) prompt.md mirror present + placeholders/golden bytes preserved, (c) launch.js untouched, (d) full suite green.*

---

## Wave 0 Requirements

- [ ] No new test files required — existing `test/prompt.test.js` / `test/skill-sync.test.js` / `test/orchestrator-launch-isolation.test.js` cover the invariants (placeholder/golden-byte preservation, launch.js isolation). If the prompt.md edit changes golden bytes intentionally, update the golden expectation in `test/prompt.test.js` as part of the task.

*If none: "Existing infrastructure covers all phase invariants."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| El orquestador, en sesión interactiva, propone un título inteligente derivado del contexto real, lo confirma con el operador, y shellea `kodo adopt --title` de forma shell-segura | ORCH-01 | Requiere una sesión orquestador viva + una sesión ad-hoc; el comportamiento es LLM-driven (prosa), no determinista | Lanzar el orquestador (`kodo orchestrate` / skill), apuntarlo a una sesión ad-hoc, verificar que deriva un título mejor que basename(cwd), pide confirmación, y crea la tarea con título saneado |

*El comportamiento LLM-driven (calidad del título) es inherentemente HUMAN-UAT; los tests automatizados cubren las invariantes de estructura/isolation.*

---

## Validation Sign-Off

- [ ] El skill contiene la sección de adopción con el mandato de invocación shell-segura (T-57-01)
- [ ] prompt.md mirror presente; placeholders + golden bytes preservados (test/prompt.test.js verde)
- [ ] launch.js sin cambios (test/orchestrator-launch-isolation.test.js verde)
- [ ] Full suite green
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
