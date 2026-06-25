---
phase: 62
slug: adopci-n-inteligente-desde-el-dashboard
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-25
---

# Phase 62 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (builtin) + `node:assert/strict` |
| **Config file** | none — `package.json` script `"test"` |
| **Quick run command** | `node --test test/dashboard/enrich.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~quick <2s · full suite ~varios s (sin invocar `claude` real — todo via fakes DI) |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/dashboard/enrich.test.js` (+ el test del archivo tocado)
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** <5 segundos (los tests usan fakes, NO spawnean `claude`)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 62-XX | TBD | TBD | ORCH-02 | — | Parse del envelope feliz (`--json-schema`) → `{title,description}` | unit | `node --test test/dashboard/enrich.test.js` | ❌ W0 | ⬜ pending |
| 62-XX | TBD | TBD | ORCH-02 | — | `is_error:true` en envelope → `{}` (fail-open, never-throws) | unit | idem | ❌ W0 | ⬜ pending |
| 62-XX | TBD | TBD | ORCH-02 | — | stdout no-JSON / `result` no-JSON → `{}` (parse-fail → fallback basename) | unit | idem | ❌ W0 | ⬜ pending |
| 62-XX | TBD | TBD | ORCH-02 | — | `spawnFn` ENOENT (`claude` ausente en PATH) → `{}` | unit | idem | ❌ W0 | ⬜ pending |
| 62-XX | TBD | TBD | ORCH-02 | — | `spawnFn` timeout (err.killed) → `{}` | unit | idem | ❌ W0 | ⬜ pending |
| 62-XX | TBD | TBD | ORCH-02 | — | `spawnFn` throw síncrono → `{}` (never-throws) | unit | idem | ❌ W0 | ⬜ pending |
| 62-XX | TBD | TBD | ORCH-02 | — | Rama GSD (`isGsdProject`=true): lee PROJECT/ROADMAP/STATE capeados | unit | idem (readFileFn fake) | ❌ W0 | ⬜ pending |
| 62-XX | TBD | TBD | ORCH-02 | — | Rama non-GSD: usa `git log` + primer prompt del transcript | unit | idem (existsSyncFn=false) | ❌ W0 | ⬜ pending |
| 62-XX | TBD | TBD | ORCH-02 | — | Transcript: primer `user` en línea variable, salta `queue-operation` | unit | idem (fixture .jsonl) | ❌ W0 | ⬜ pending |
| 62-XX | TBD | TBD | ORCH-02 | — | Transcript: `content` array tool_result-only → saltado | unit | idem | ❌ W0 | ⬜ pending |
| 62-XX | TBD | TBD | ORCH-02 | — | Transcript ausente (ENOENT) → '' | unit | idem | ❌ W0 | ⬜ pending |
| 62-XX | TBD | TBD | ORCH-02 | T-57-01 (inerte) | `runAdopt` inserta `--description` (presente) / lo omite (vacío) | unit | `node --test test/dashboard/adopt.test.js` | ⚠️ extender | ⬜ pending |
| 62-XX | TBD | TBD | ORCH-02 | T-57-01 (inerte) | argv literal: title/description con metacaracteres → un solo arg (injection-inerte, `execFile`) | unit | idem (fakeExec captura argv) | ⚠️ extender | ⬜ pending |
| 62-XX | TBD | TBD | ORCH-02 | — | App.js: estado `deriving` entre arm y confirm; onDerive fusiona en armedSurface | unit | `node --test test/dashboard/app-*.test.js` | ❌ W0 | ⬜ pending |
| 62-XX | TBD | TBD | ORCH-02 | — | App.js: Esc en confirm cancela (v1 no-editable, D-09) | unit | idem | ⚠️ cubierto por confirm existente | ⬜ pending |
| 62-XX | TBD | TBD | ORCH-02 | BIDIR-08 | `{title,description}` derivado pasa por `sanitizeAdoptionData` (redacción home/rutas) | unit | idem | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Task IDs concretos los asigna el planner; este mapa fija la cobertura mínima.*

---

## Wave 0 Requirements

- [ ] `test/dashboard/enrich.test.js` — parse del envelope (`--json-schema`), fail-open (ENOENT/timeout/parse-fail/throw), ramas GSD/non-GSD, parsing del transcript. Usa `spawnFn`/`readFileFn`/`existsSyncFn` fakes (NO invoca `claude` real).
- [ ] Fixtures de transcript `.jsonl` (sintéticos): primer `user` en línea variable, `queue-operation` intercaladas, `content` string vs array, tool_result-only, ausente.
- [ ] Extender `test/dashboard/adopt.test.js` — assert del par `--description` en argv (presente/omitido) + injection-inerte con metacaracteres.
- [ ] App.js: test del estado `deriving` + onDerive DI (fusión en armedSurface) — patrón de los tests `app-*.test.js` existentes.
- [ ] Framework install: ninguno (`node:test` builtin).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Calidad del título/descripción derivados por Haiku | ORCH-02 | Salida LLM no determinista — no testeable por aserción exacta | HUMAN-UAT contra una sesión ad-hoc real. Reproducir el caso origen (ROMAN-194 / scp-cmri): el título derivado DEBE reflejar el proyecto, NO `basename(cwd)` (`scp-cmri`) ni el último commit. |
| UX derive-then-confirm en vivo (spinner "derivando…", segunda `a` confirma, Esc cancela) | ORCH-02 | Interacción TUI ink en tiempo real | HUMAN-UAT: pulsar `a` sobre surface ad-hoc → ver estado derivando → propuesta → confirmar y verificar `kodo adopt --title --description` ejecutado. |
| Latencia real de Haiku enmascarada en la transición | ORCH-02 | Depende del wallclock real de `claude -p` (medido 8.7–21.9s) | HUMAN-UAT: confirmar que el timeout (~25-30s, NO 8s) no dispara fallback en derivaciones normales. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 5s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
