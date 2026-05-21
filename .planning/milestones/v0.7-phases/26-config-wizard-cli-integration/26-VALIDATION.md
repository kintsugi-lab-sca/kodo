---
phase: 26
slug: config-wizard-cli-integration
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-05-14
---

# Phase 26 — Validation Strategy

> Per-phase validation contract derived from `26-RESEARCH.md § "Validation Architecture"`.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node --test` (Node.js stdlib) + `node:assert/strict` |
| **Config file** | None — `package.json` `scripts.test` runs `node --test` |
| **Quick run command** | `node --test test/cli/polling.test.js test/cli/wizard-github.test.js test/cli/polling-daemon.test.js test/cli/orchestrate-polling.test.js test/migration.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | < 2s quick suite (in-proc), ~8-10s full suite (post-Phase-26 baseline 715 + ~25 new = ~740 tests) |

---

## Sampling Rate

- **After every task commit:** `node --test test/cli/polling.test.js test/cli/wizard-github.test.js test/cli/polling-daemon.test.js test/cli/orchestrate-polling.test.js test/migration.test.js`
- **After every plan wave:** `npm test` (full suite must stay green)
- **Before `/gsd-verify-work`:** Full suite must be green (target ≥ 740 pass, 0 fail; +25 nuevos sobre baseline 715)
- **Max feedback latency:** < 2s quick · < 10s full

---

## Per-Task Verification Map

> Task IDs `26-NN-MM` are placeholders — planner assigns exact IDs once 3 plans are created (26-01 wizard / 26-02 daemon / 26-03 orchestrate).

| Task ID | Plan | Wave | Requirement | Secure Behavior | Test Type | Automated Command | File | Status |
|---------|------|------|-------------|-----------------|-----------|-------------------|------|--------|
| 26-01-NN | 01 | 1 | CFG-01 | Wizard `github` branch ejecuta sin crash con scripted readline answers | unit | `node --test test/cli/wizard-github.test.js -g "happy path"` | ❌ W0 NEW | ⬜ pending |
| 26-01-NN | 01 | 1 | CFG-01 | `parseGitHubRemote` reconoce SSH + HTTPS + HTTPS.git formats | unit | `node --test test/cli/polling.test.js -g "parseGitHubRemote"` | ❌ W0 NEW | ⬜ pending |
| 26-01-NN | 01 | 1 | CFG-01 | `parseGitHubRemote` retorna `null` para gitlab / enterprise / empty | unit | `node --test test/cli/polling.test.js -g "parseGitHubRemote rejects"` | ❌ W0 NEW | ⬜ pending |
| 26-01-NN | 01 | 1 | CFG-01 | `detectOriginRepo` fail-open cuando `git remote get-url` lanza | unit | `node --test test/cli/polling.test.js -g "detectOriginRepo fail-open"` | ❌ W0 NEW | ⬜ pending |
| 26-01-NN | 01 | 1 | CFG-01 | Wizard rechaza repo inválido (sin `/`) y re-prompts | unit | `node --test test/cli/wizard-github.test.js -g "rejects invalid repo"` | ❌ W0 NEW | ⬜ pending |
| 26-01-NN | 01 | 1 | CFG-01 | Auto-detect rechazado → entrada manual sucede | unit | `node --test test/cli/wizard-github.test.js -g "manual entry"` | ❌ W0 NEW | ⬜ pending |
| 26-01-NN | 01 | 1 | CFG-01 (T-26-01 token leak) | Wizard NUNCA escribe `GITHUB_TOKEN` valor a `config.json` (security invariante) | unit | `node --test test/cli/wizard-github.test.js -g "token never persisted"` | ❌ W0 NEW | ⬜ pending |
| 26-01-NN | 01 | 1 | CFG-02 | `loadConfig(fixture v0.6)` retorna idéntico — NO inyecta `providers.github` | unit | `node --test test/migration.test.js -g "v0.6 zero-breaking-change"` | ❌ W0 NEW fixture | ⬜ pending |
| 26-01-NN | 01 | 1 | CFG-02 | `loadConfig(fixture v0.7)` idempotente — segundo load === primero | unit | `node --test test/migration.test.js -g "v0.7 idempotent"` | ❌ W0 NEW fixture | ⬜ pending |
| 26-01-NN | 01 | 1 | CFG-02 (D-08) | `DEFAULT_CONFIG` NO contiene `providers.github` (configs v0.6 quedan limpias) | unit | `node --test test/migration.test.js -g "DEFAULT_CONFIG sin github"` | ❌ W0 | ⬜ pending |
| 26-02-NN | 02 | 2 | CFG-03 | `kodo polling start` sin config válida → exit 2 + stderr canonical | integration | `spawnSync kodo polling start` con `HOME=tmpdir` | ❌ W0 NEW | ⬜ pending |
| 26-02-NN | 02 | 2 | CFG-03 | `kodo polling start --no-daemon` arranca + SIGINT detiene cleanly | integration | spawn detached + setTimeout(kill, 500) + assert exit 0 | ❌ W0 NEW | ⬜ pending |
| 26-02-NN | 02 | 2 | CFG-03 | `kodo polling start` (daemon) escribe PID file ≤2s; padre exit 0 | integration | spawnSync + poll `~/.kodo/polling.pid` | ❌ W0 NEW | ⬜ pending |
| 26-02-NN | 02 | 2 | CFG-03 | `kodo polling start` con PID file vivo → exit 1 + msg `already running` | integration | spawn dos veces consecutivas | ❌ W0 NEW | ⬜ pending |
| 26-02-NN | 02 | 2 | CFG-03 | `kodo polling status` (sin PID file) → `idle` + exit 0 | integration | `spawnSync` con `HOME=tmpdir` vacío | ❌ W0 NEW | ⬜ pending |
| 26-02-NN | 02 | 2 | CFG-03 | `kodo polling status` (PID vivo) → `running` + exit 0 | integration | spawnSync + fake PID file con `process.pid` | ❌ W0 NEW | ⬜ pending |
| 26-02-NN | 02 | 2 | CFG-03 | `kodo polling status` (PID stale, proceso muerto) → `idle` + exit 0 | integration | fake PID file con PID inexistente (e.g. 999999) | ❌ W0 NEW | ⬜ pending |
| 26-02-NN | 02 | 2 | CFG-03 (DX-06) | `kodo polling status --json` byte-determinístico — idle shape | integration | `spawnSync NO_COLOR=1` + regex bytes exactos | ❌ W0 NEW | ⬜ pending |
| 26-02-NN | 02 | 2 | CFG-03 (DX-06) | `kodo polling status --json` byte-determinístico — running shape | integration | `spawnSync NO_COLOR=1` + regex bytes exactos | ❌ W0 NEW | ⬜ pending |
| 26-02-NN | 02 | 2 | CFG-03 | `kodo polling stop` (sin PID file) → exit 3 + stderr canonical | integration | spawnSync con HOME limpio | ❌ W0 NEW | ⬜ pending |
| 26-02-NN | 02 | 2 | CFG-03 | `kodo polling stop` envía SIGTERM + borra PID file | integration | spawn `--no-daemon` luego stop | ❌ W0 NEW | ⬜ pending |
| 26-02-NN | 02 | 2 | CFG-03 | `writePidFile` atomic (tmp → rename; tmp ausente post-write) | unit | unit con fs spies o snapshot del directorio | ❌ W0 NEW | ⬜ pending |
| 26-02-NN | 02 | 2 | CFG-03 | `readPidFile` fail-open (JSON corrupted → null, no throw) | unit | escribir basura a polling.pid → assert `null` | ❌ W0 NEW | ⬜ pending |
| 26-03-NN | 03 | 3 | CFG-04 | `kodo orchestrate --polling` sin `repos` → exit 2 + stderr | integration | spawnSync con fixture v0.6 | ❌ W0 NEW | ⬜ pending |
| 26-03-NN | 03 | 3 | CFG-04 | `kodo orchestrate --polling` sin `GITHUB_TOKEN` → exit 2 + stderr | integration | spawnSync con env scrubbed | ❌ W0 NEW | ⬜ pending |
| 26-03-NN | 03 | 3 | CFG-04 | `kodo orchestrate --polling` arranca `startPolling` (spy invoked) | unit (in-process) | DI `startPollingFn` spy, assert call args | ❌ W0 NEW | ⬜ pending |
| 26-03-NN | 03 | 3 | CFG-04 (D-18) | `kodo orchestrate --polling` SIGINT llama `stop()` antes de exit | integration | spawn + kill SIGINT + assert clean exit 0 | ❌ W0 NEW | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/cli/` — directory does NOT exist; planner crea con primer test file
- [ ] `test/cli/wizard-github.test.js` — 7 casos CFG-01 (incluye T-26-01 token-leak guard)
- [ ] `test/cli/polling.test.js` — 13 casos CFG-03 integration + helpers (`parseGitHubRemote`, `detectOriginRepo`)
- [ ] `test/cli/polling-daemon.test.js` — 2 casos unit (atomic write, fail-open read)
- [ ] `test/cli/orchestrate-polling.test.js` — 4 casos CFG-04 incl. SIGINT cleanup
- [ ] `test/fixtures/configs/` — directory does NOT exist; planner crea
- [ ] `test/fixtures/configs/v0.6-no-github.json` — fixture mínima sin `providers.github`
- [ ] `test/fixtures/configs/v0.7-with-github.json` — fixture poblada con `providers.github.repos`
- [ ] `test/migration.test.js` — extend existing (3 casos CFG-02) o crear si no existe

*Wave 0 está distribuida across 3 plans (no es Wave 0 monolítica); cada plan crea las fixtures/dirs que consume.*

---

## Mock Strategies (from RESEARCH § "Validation Architecture")

### Stdin mocking (wizard)
**Pattern:** DI `ask` function — NO global `readline` override.
**Refactor required:** extraer la rama `github` de `interactiveConfig` (`src/cli.js:344`) a un helper exportado `configureGithubProvider({ ask, execGitRemote, providerConfig })`.
**Test setup:** tests pasan `ask` que retorna `Promise.resolve(scripted_answer)` por turno.
**Reference:** RESEARCH § Example 1.

### FS mocking (PID file)
**Pattern:** NO mock — usar `mkdtempSync` + `HOME` override (precedent `test/skill-sync.test.js:38-54`).
**Test setup:** `process.env.HOME = mkdtempSync(...)` antes de cada caso; cleanup en `after()`.

### SIGINT capture (daemon + orchestrate cleanup)
**Pattern:** spawn child real con `detached: true` o `--no-daemon`; tras PID file detectado, `process.kill(child.pid, 'SIGTERM'|'SIGINT')`; resolve en `child.on('exit')`.
**Bounded timeout:** 3s.

### Byte-determinism `--json` (DX-06 invariante v0.5)
**Pattern:** `spawnSync NO_COLOR=1` + regex exacto contra stdout bytes + `/\x1b\[/.test(stdout) === false`.
**Reference:** `test/skill-sync.test.js:346-353`.

### Clock mocking
**Not required** — Phase 26 NO depende de timers virtuales; SIGINT cleanup es síncrono respecto del handler. Sub-300ms tests usan wall-clock real.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Wizard `kodo config` real con stdin TTY interactivo | CFG-01 | Stdin TTY ≠ pipe — el comportamiento de `readline` cambia (no es factible cubrir 100% en CI) | Smoke UAT operador: `kodo config` → seleccionar github → confirmar prompts → verificar `~/.kodo/config.json` + `~/.kodo/.env` |
| Daemon real lifetime > 60s (no orphan tras SIGHUP / TTY close) | CFG-03 | El comportamiento `detached: true` + `unref()` requiere TTY real para verificar | Smoke UAT operador: `kodo polling start` + `tty close` + check process tree tras 5min |
| `kodo orchestrate --polling` end-to-end con repo GitHub real | CFG-04 | Live API call (excluida de CI per Karpathy Rule "zero live API calls"); valida wire real | Operator dogfood — label `kodo` sobre un issue real → assert session arranca |

*Otras behaviors (PID file lifecycle, exit codes, byte-determinism `--json`, SIGINT cleanup en pipe-mode) están automatizadas via spawnSync HOME-isolated.*

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (test/cli/, test/fixtures/configs/)
- [ ] No watch-mode flags
- [ ] Feedback latency < 2s quick suite
- [ ] `nyquist_compliant: true` set in frontmatter after sign-off

**Approval:** pending — auto-generated 2026-05-14 from `26-RESEARCH.md`. Planner refines task IDs once 26-01..03 PLAN.md files exist.
