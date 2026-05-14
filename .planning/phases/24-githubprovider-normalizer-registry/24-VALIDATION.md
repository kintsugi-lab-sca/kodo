---
phase: 24
slug: githubprovider-normalizer-registry
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-14
---

# Phase 24 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derived from `24-RESEARCH.md` §Validation Architecture (Nyquist gate).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (Node 20+) + `node:assert/strict` |
| **Config file** | none — runner built into Node |
| **Quick run command** | `node --test test/providers/github/provider.test.js test/providers/github/normalize.test.js test/registry.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | quick ~1s; full ~3-4s (v0.6 baseline + Phase 24 new tests) |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/providers/github/{provider,normalize}.test.js` (quick — afecta solo el módulo tocado)
- **After every plan wave:** Run `npm test` (full suite verde antes de cerrar el wave)
- **Before `/gsd-verify-work`:** `npm test` verde + zero live API calls + LOG-12 guard verde
- **Max feedback latency:** ≤ 5s wall-time por quick run; full suite ≤ 5s

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 24-01-01 | 01 | 1 | TEST-01 / D-34 | — | N/A (test fixtures) | unit | `ls test/fixtures/github/issue-with-priority.json issue-with-kodo.json issue-closed.json issue-no-body.json issue-no-labels.json` | ❌ W0 | ⬜ pending |
| 24-01-02 | 01 | 1 | GH-03 / D-07..D-18 | — | normalizer pure (zero side effects) | unit | `node --test test/providers/github/normalize.test.js` | ❌ W0 | ⬜ pending |
| 24-01-03 | 01 | 1 | GH-03 / D-10 | — | `body: null` → `description: ''` | unit | `node --test test/providers/github/normalize.test.js` | ❌ W0 | ⬜ pending |
| 24-01-04 | 01 | 1 | GH-03 / D-11 | — | `labels[].name` → strings; empty → `[]` | unit | `node --test test/providers/github/normalize.test.js` | ❌ W0 | ⬜ pending |
| 24-01-05 | 01 | 1 | GH-03 / D-14 | — | `groups` siempre `[]` (milestone NO extraído) | unit | `node --test test/providers/github/normalize.test.js` | ❌ W0 | ⬜ pending |
| 24-01-06 | 01 | 1 | GH-03 / D-17 / TEST-01 | — | priority extraction urgent/high/medium/low + case-insensitive + invalid → null | unit | `node --test test/providers/github/normalize.test.js` | ❌ W0 | ⬜ pending |
| 24-02-01 | 02 | 2 | GH-02 / D-01 | — | `createGitHubProvider` retorna obj con los 9 `TASK_PROVIDER_METHODS` como funciones | unit | `node --test test/providers/github/provider.test.js` | ❌ W0 | ⬜ pending |
| 24-02-02 | 02 | 2 | GH-02 / D-19 | — | `init()` no-op (cero API calls, no throw) | unit | `node --test test/providers/github/provider.test.js` | ❌ W0 | ⬜ pending |
| 24-02-03 | 02 | 2 | GH-02 / D-20 / D-22 | V5.1 (input validation) | `getTask('owner/repo#N')` → parseRef → client.getIssue → normalizeIssue | unit | `node --test test/providers/github/provider.test.js` | ❌ W0 | ⬜ pending |
| 24-02-04 | 02 | 2 | GH-02 / D-21 | V5.1 | `resolveRef('owner/repo#N')` → `node_id`; invalid ref → throw canonical message | unit | `node --test test/providers/github/provider.test.js` | ❌ W0 | ⬜ pending |
| 24-02-05 | 02 | 2 | GH-02 / D-22 | V5.1 | `parseRef` rechaza `KL-42`, `#42`, URL formats con mensaje fijo | unit | `node --test test/providers/github/provider.test.js` | ❌ W0 | ⬜ pending |
| 24-02-06 | 02 | 2 | GH-02 / D-23 | — | `updateTaskState(task, 'closed')` → PATCH `{state:'closed'}`; passthrough 'open'/'closed'; rechaza unknown | unit | `node --test test/providers/github/provider.test.js` | ❌ W0 | ⬜ pending |
| 24-02-07 | 02 | 2 | GH-02 / D-24 | — | `addComment(task, markdown)` postea Markdown literal (sin HTML wrap) | unit | `node --test test/providers/github/provider.test.js` | ❌ W0 | ⬜ pending |
| 24-02-08 | 02 | 2 | GH-02 / D-25 | — | `listPendingTasks()` itera `config.repos`, llama `client.listIssues({labels:['kodo'], state:'open'})`, filtra PRs, concat normalized | unit | `node --test test/providers/github/provider.test.js` | ❌ W0 | ⬜ pending |
| 24-02-09 | 02 | 2 | GH-02 / D-26 | — | `parseTriggerEvent(anyPayload)` → `null` determinístico | unit | `node --test test/providers/github/provider.test.js` | ❌ W0 | ⬜ pending |
| 24-02-10 | 02 | 2 | GH-02 / D-27 | — | `verifySignature(rawBody, headers)` → `false` determinístico | unit | `node --test test/providers/github/provider.test.js` | ❌ W0 | ⬜ pending |
| 24-02-11 | 02 | 2 | GH-02 / D-28 | — | `listProjects()` returns `config.repos.map(...)`, cero API calls | unit | `node --test test/providers/github/provider.test.js` | ❌ W0 | ⬜ pending |
| 24-02-12 | 02 | 2 | TEST-01 / D-37 | — | Zero live API calls (leak guard restaura `globalThis.fetch` en before/after) | unit | `node --test test/providers/github/provider.test.js` (top-of-file guard) | ❌ W0 | ⬜ pending |
| 24-03-01 | 03 | 3 | invariant LOG-12 | — | `kodo check` NO importa transitivamente `src/providers/github/provider.js` ni `normalize.js` | integration | `node --test test/check-isolation.test.js` | ✅ (extend) | ⬜ pending |
| 24-03-02 | 03 | 3 | GH-05 / D-32 | — | `parseKodoLabels(task.labels.map(name => ({name})))` reconoce `kodo`/`kodo:sonnet`/`kodo:gsd-quick` desde TaskItem GitHub (shape REAL `{isKodo, model, flags}` + `getGsdMode(flags)`) | unit | `node --test test/labels.test.js` | ✅ | ⬜ pending |
| 24-03-03 | 03 | 3 | GH-04 / D-29..D-30 | — | `getProvider('github')` valida el contrato de 9 métodos (vía `registerProvider` injection con factory real) | unit | `node --test test/registry.test.js` | ✅ (extend) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

> Task IDs aligned with PLAN.md (W6 alignment 2026-05-14): each row's `Task ID` matches the canonical task ID inside the corresponding `XX-NN-PLAN.md` file.
> Plan grouping (locked): 01 normalizer + fixtures (Wave 1), 02 provider factory + provider tests (Wave 2), 03 registry/invariants (Wave 3) — see ROADMAP.md Phase 24 plans list.

---

## Wave 0 Requirements

- [ ] `test/providers/github/provider.test.js` — new file (Phase 23 only created `client.test.js`)
- [ ] `test/providers/github/normalize.test.js` — new file
- [ ] `test/fixtures/github/issue-with-priority.json` — new fixture (D-34)
- [ ] `test/fixtures/github/issue-with-kodo.json` — new fixture (D-34)
- [ ] `test/fixtures/github/issue-closed.json` — new fixture (D-34)
- [ ] `test/fixtures/github/issue-no-body.json` — new fixture (D-34)
- [ ] `test/fixtures/github/issue-no-labels.json` — new fixture (D-34)
- [ ] `test/registry.test.js` — extend with `getProvider('github')` case (D-38)
- [ ] `test/check-isolation.test.js` — extend (or add row) verificando `src/providers/github/provider.js` fuera del grafo transitivo de `kodo check` (LOG-12)

*Framework already installed (Node built-in); fixtures + new test files are the only Wave 0 deliverables.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Cross-provider TaskItem shape symmetry | invariant v0.2 / Phase 27 TEST-03 | Phase 27 owns the automated cross-provider contract matrix; Phase 24 only ships the GitHub side | After Phase 24 green, run `npm test` and inspect any TaskItem fixture in test logs to confirm GitHub `priority` shares the same enum (`'urgent'|'high'|'medium'|'low'|null`) as Plane |
| GitHub API contract drift | GH-02 / GH-03 | If GitHub changes `node_id`/`html_url`/`state` field names, recorded fixtures become stale | Quarterly: re-capture fixtures against a canonical repo (Phase 23 plan 23-03 optional script) and diff |
| ROADMAP/REQUIREMENTS doc consistency | D-01 | Documentation drift not caught by code tests | Pre-plan grep: `grep -E "listTasks\|listLabels\|listStates\|transitionTask" .planning/ROADMAP.md .planning/REQUIREMENTS.md` must return zero matches (corrected 2026-05-14) |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (fixtures + new test files)
- [ ] No watch-mode flags (`--watch` excluded)
- [ ] Feedback latency < 5s wall-time
- [ ] `nyquist_compliant: true` set in frontmatter once planner-generated PLAN.md(s) reference each row above

**Approval:** pending
