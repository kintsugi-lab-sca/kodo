---
phase: 66
slug: kodo-up-stop-status-unificados-homebrew
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-01
---

# Phase 66 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derivada de `66-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (built-in, Node ≥20) + `node:assert/strict` |
| **Config file** | none — `npm test` = `node --test $(find test -name '*.test.js' -type f)` |
| **Quick run command** | `node --test test/cli/<fichero-tocado>.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~20–35 s (todo DI; sin procesos/brew reales en la suite) |
| **Test dir precedent** | `test/daemon/` (Phase 65: todo DI, sin procesos reales); HOME-isolation `mkdtempSync` (`test/config-atomic.test.js:15`) solo si un test toca FS real |

---

## Sampling Rate

- **After every task commit:** `node --test test/cli/<fichero-tocado>.test.js`
- **After every plan wave:** `npm test` (suite completa, 85+ ficheros)
- **Before `/gsd-verify-work`:** `npm test` verde **+** el `checkpoint:human-verify` del ciclo `brew services` aprobado por el operador
- **Max feedback latency:** ~35 s (unit) / manual para el spike brew

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 66-XX-XX | TBD | 0 | UP-03 | — | `probePortInUse`: ECONNREFUSED=libre, connect=ocupado, timeout=libre | unit (server efímero real / fake net) | `node --test test/cli/port-probe.test.js` | ❌ W0 | ⬜ pending |
| 66-XX-XX | TBD | 0 | UP-01 | — | `waitForHealth`: 200→true; ECONNREFUSED never-throws→retry→timeout=false | unit (fake fetchFn) | `node --test test/cli/health-wait.test.js` | ❌ W0 | ⬜ pending |
| 66-XX-XX | TBD | 1 | UP-01, UP-02, UP-03 | — | `runUp` compone start→wait→attach; daemon vivo→attach sin spawn; NO señala al daemon al salir | unit (DI fakes) | `node --test test/cli/up.test.js` | ❌ W0 | ⬜ pending |
| 66-XX-XX | TBD | 1 | DIST-03 | — | win32 guard: `runUp` `_platform:'win32'` → foreground, no detach, no crash | unit | `node --test test/cli/up.test.js` | ❌ W0 | ⬜ pending |
| 66-XX-XX | TBD | 1 | UP-05 | — | `stop` daemon-first: daemon presente→stopDaemon; ausente→fallback stopServer (legacy back-compat) | unit (fake stopDaemon + spy server import) | `node --test test/cli/stop-unified.test.js` | ❌ W0 | ⬜ pending |
| 66-XX-XX | TBD | 1 | UP-05 | — | `status --json` byte-determinista: keys fijas running/idle | unit (fake statusDaemon + capture stdout) | `node --test test/cli/status-unified.test.js` | ❌ W0 | ⬜ pending |
| 66-XX-XX | TBD | 2 | DIST-01, DIST-02 | V12 | `Formula/kodo.rb` pasa `brew audit --new --strict` + `brew style` (lint estático); plist invoca `kodo daemon run` NUNCA `kodo up` | static lint (si brew en runner) | `brew audit --new --strict Formula/kodo.rb; brew style Formula/kodo.rb` | ❌ W0 (repo tap) | ⬜ pending |
| 66-XX-XX | TBD | 2 | DIST-01, DIST-02 | — | Ciclo real: install→start→list→relogin→crash-restart→stop (8 chequeos) | **MANUAL (spike)** | **`checkpoint:human-verify` — NO automatizable** | N/A | ⬜ pending |

*Task IDs se concretan en PLAN.md. Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Automatable vs Manual boundary (crítico — scope del checkpoint D-07)

**AUTOMATABLE (unit, DI/fakes, sin procesos ni brew reales):** `runUp` orchestration (orden, attach-vs-spawn, win32 guard, no-signal-al-daemon); `probePortInUse` (contra `net.createServer` efímero o fake); `waitForHealth` (fake fetchFn, never-throws + retry + timeout); `stop`/`status` unificados (fakes + captura stdout `--json`); **lint estático de la fórmula** (`brew audit`/`brew style` si brew está en el runner — PERO no detecta el foreground-trap P6, eso es runtime).

**MANUAL (spike → `checkpoint:human-verify`, NO unit-testable):** `brew install kodo` real; `brew services start` → `list` = `started`; `opt_bin` por arquitectura (Apple Silicon `/opt/homebrew` vs Intel `/usr/local`); RunAtLoad tras relogin; crash-restart (`keep_alive`); resolución de `node` bajo el PATH mínimo de launchd (open question A1: shebang `#!/usr/bin/env node`); `~/.kodo/.env` leído bajo launchd; `brew services stop` limpio.

El plan pone **UN** `checkpoint:human-verify` enumerando estos 8 chequeos, DESPUÉS de que todo el código (`up`/`stop`/`status`/fórmula) esté implementado y con unit tests verdes. En `--auto`, el checkpoint se **PAUSA para el operador** (D-07) — NO se auto-aprueba como pasado.

---

## Wave 0 Requirements

- [ ] `test/cli/up.test.js` — UP-01, UP-02, UP-03 (attach-vs-spawn), DIST-03 (win32 guard). DI fakes espejo de `test/daemon/lifecycle.test.js`.
- [ ] `test/cli/port-probe.test.js` — UP-03 (sonda `node:net`). Server efímero real o fake net.
- [ ] `test/cli/health-wait.test.js` — UP-01 (readiness never-throws). Fake fetchFn.
- [ ] `test/cli/stop-unified.test.js` — UP-05 (stop daemon-first + fallback). Fake stopDaemon + spy server import.
- [ ] `test/cli/status-unified.test.js` — UP-05 (status `--json` byte-determinista). Fake statusDaemon.
- [ ] `Formula/kodo.rb` en repo tap + (opcional) CI `brew audit`/`brew style` — DIST-01/02 estáticamente.
- [ ] Framework: ninguno — `node:test` built-in; patrón HOME-isolation ya establecido si algún test toca FS real (la mayoría es DI).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Ciclo real `brew services` en macOS (8 chequeos) | DIST-01, DIST-02 | launchd/brew no unit-testable (Pitfalls 6/9/7/10); `brew audit` no detecta el foreground-trap | `brew install kodo` → `brew services start kodo` → `brew services list` (=`started`) → `readlink $(brew --prefix)/opt/kodo/bin/kodo` (opt_bin correcto) → relogin (RunAtLoad) → `kill` daemon (crash-restart) → revisar `var/log/kodo.log` (sin node ENOENT) → `.env` leído → `brew services stop kodo` limpio |
| `kodo up` end-to-end en terminal real | UP-01, UP-02 | attach del dashboard + persistencia del daemon al cerrar requieren TTY real | `kodo up` → ver dashboard → `q` → confirmar daemon sigue vivo (`kodo status`) → `kodo stop` |

---

## Nota de testabilidad

Phase 66 es ~90% composición sobre la fundación de Phase 65 (`startDaemon`/`stopDaemon`/`statusDaemon`/`runDaemon` ya name-parametrizados a `'kodo'`). El código nuevo automatable (sonda de puerto, health-wait, `runUp`, rewire stop/status) es todo DI-testeable espejo de `test/daemon/`. El riesgo NO automatizable vive enteramente en el runtime de launchd/brew → aislado en el `checkpoint:human-verify`. Corrección heredada del research: la fórmula usa `kodo daemon run` (Phase 65), NO el `kodo up --foreground`/`kodod.pid` obsoleto de STACK.md.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies (excepto el `checkpoint:human-verify` del spike, manual por diseño)
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (up, port-probe, health-wait, stop-unified, status-unified, Formula)
- [ ] No watch-mode flags
- [ ] Feedback latency < 35s (unit)
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
