---
phase: 7
slug: kodo-logs-cli-event-taxonomy
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-04-16
---

# Phase 7 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution. Derived from the `## Validation Architecture` section of `07-RESEARCH.md`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (Node 20 stdlib, already in use) |
| **Config file** | none — tests en `test/*.test.js`, ejecutados por `node --test` |
| **Quick run command** | `node --test test/logger-events.test.js test/logs-reader.test.js` |
| **Full suite command** | `node --test` |
| **Estimated runtime** | ~8 segundos (baseline Phase 6: ~6s con 139 tests) |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/logger-events.test.js test/logs-reader.test.js` (scope reducido al área tocada)
- **After every plan wave:** Run `node --test` (suite completa — incluye guard de `test/check-isolation.test.js` LOG-12)
- **Before `/gsd-verify-work`:** Full suite must be green + manual `kodo logs` smoke (criterio 4 abajo)
- **Max feedback latency:** 10 segundos

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 07-01-01 | 01 | 0 | LOG-09 | — | N/A | unit-stub | `node --test test/logger-events.test.js` | ❌ W0 | ⬜ pending |
| 07-01-02 | 01 | 0 | LOG-05, LOG-06, LOG-07 | — | N/A | unit-stub | `node --test test/logs-reader.test.js` | ❌ W0 | ⬜ pending |
| 07-01-03 | 01 | 0 | LOG-11 | — | N/A | unit-stub | `node --test test/logs-session-of.test.js` | ❌ W0 | ⬜ pending |
| 07-01-04 | 01 | 0 | LOG-10 | — | N/A | unit-stub | `node --test test/logger-events.test.js` | ❌ W0 | ⬜ pending |
| 07-02-XX | 02 | 1 | LOG-09 | — | Redactor aplica (helpers pasan por emit → redact) | unit | `node --test test/logger-events.test.js` | ✅ W0 | ⬜ pending |
| 07-03-XX | 03 | 1 | LOG-05, LOG-06, LOG-07 | — | Fail-closed si archivo no existe con message claro | integration | `node --test test/logs-reader.test.js` | ✅ W0 | ⬜ pending |
| 07-04-XX | 04 | 1 | LOG-11 | — | Warn a stderr lista session_id descartados | integration | `node --test test/logs-session-of.test.js` | ✅ W0 | ⬜ pending |
| 07-05-XX | 05 | 2 | LOG-09 (DI consumers) | — | `check.js` sigue sin importar logger.js (test/check-isolation.test.js verde) | integration | `node --test` | ✅ | ⬜ pending |
| 07-06-XX | 06 | 2 | LOG-10 | — | session.start contiene transcript_path + plane_task_id | unit+manual | `node --test test/session-start-hook.test.js` | ✅ | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*Task IDs son placeholders — el planner los ajustará (07-NN-MM) según descomposición final en PLAN.md por wave.*

---

## Wave 0 Requirements

Seguimos la convención de Phase 6: Wave 0 crea test stubs que definen el contrato antes de cualquier implementación.

- [ ] `test/logger-events.test.js` — stubs para los 7 tipos de evento (LOG-09) + contrato D-10 (session.start con `session_id, plane_task_id, provider, project_path, transcript_path, started_at`)
- [ ] `test/logs-reader.test.js` — stubs para dump, `--follow`, filtros `--level`/`--component`/`--event-type`, salida `--json` vs pretty (LOG-05, LOG-06, LOG-07)
- [ ] `test/logs-session-of.test.js` — stubs para resolver en dos pasos (state.json → head-line-read) + multi-match DESC + warn stderr (LOG-11)
- [ ] `test/fixtures/events-golden.ndjson` — golden fixture con ejemplo limpio de cada uno de los 7 tipos (sirve también de oracle para tests de integración)
- [ ] Helpers en `test/helpers/logger-sink.js` — in-memory sink que captura NDJSON sin I/O real (fixture recomendada por research)

*No se requiere framework install — `node --test` ya en uso desde Fase 6.*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| `--follow` tail -f en vivo con dump completo + espera archivo inexistente | LOG-06 | `fs.watchFile` polling interval hace que tests de tiempo sean flaky | (1) `KODO_LOG_LEVEL=debug node bin/kodo launch …` en una terminal; (2) `node bin/kodo logs <id> --follow` en otra; (3) verificar dump + updates en tiempo real; (4) repetir con archivo inexistente para confirmar `"waiting for session..."` stderr one-shot |
| Pretty-print con colores en TTY, plano con `NO_COLOR=1` o stdout piped | LOG-05 | `process.stdout.isTTY` depende del entorno de ejecución | (1) `node bin/kodo logs <id>` — ver colores ANSI; (2) `NO_COLOR=1 node bin/kodo logs <id>` — sin colores; (3) `node bin/kodo logs <id> \| cat` — sin colores (isTTY false) |
| Pivot entre vista kodo y transcript Claude Code | LOG-10 | Requiere abrir fichero real en `~/.claude/projects/...` | (1) Arrancar sesión kodo; (2) `node bin/kodo logs <id> --json \| head -1` para ver `transcript_path`; (3) `cat <transcript_path>` confirma que resuelve a un JSONL válido |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (7 test files + golden fixture + sink helper)
- [ ] No watch-mode flags (node --test en one-shot)
- [ ] Feedback latency < 10s (suite actual ~8s)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
