---
phase: 68
slug: dashboard-setup-mode-cfgf-03-first-run
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-02
---

# Phase 68 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derivado de `68-RESEARCH.md` §Validation Architecture. Fase ~90% composición
> (Phases 63/65/66/67); el riesgo mayor es la reinvención y el ciclo real de first-run.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (built-in, Node 22.22.3) + `ink-testing-library` (App) |
| **Config file** | none — `package.json` `scripts.test` (`node --test $(find test -name '*.test.js')`) |
| **Quick run command** | `node --test test/config.test.js test/cli/up.test.js test/dashboard/app-setup.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~pocos segundos (quick) · full ≈ 88 archivos `.test.js` |

---

## Sampling Rate

- **After every task commit:** `node --test` sobre el/los archivo(s) tocados (config / up / app-setup)
- **After every plan wave:** `npm test` completo
- **Before `/gsd-verify-work`:** Full suite verde **+ GATE MANUAL** (UAT máquina limpia)
- **Max feedback latency:** < 30s (quick run)

---

## Per-Task Verification Map

> Task IDs los asigna el planner (TBD). Filas mapeadas por requisito/comportamiento
> desde el research Test Map.

| Task ID | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | 0 | SETUP-01 | — | `needsSetup()` true si falta `config.json` | unit (puro) | `node --test test/config.test.js` | ❌ W0 | ⬜ pending |
| TBD | 0 | SETUP-01 | — | `needsSetup()` true si falta API key (config existe) | unit (puro) | `node --test test/config.test.js` | ❌ W0 | ⬜ pending |
| TBD | 0 | SETUP-01 | — | `needsSetup()` false con config completa | unit (puro) | `node --test test/config.test.js` | ❌ W0 | ⬜ pending |
| TBD | 0 | SETUP-01 | — | **held-out**: NO falso negativo con DEFAULT_CONFIG (Pitfall 12) | unit (held-out) | `node --test test/config.test.js` | ❌ W0 | ⬜ pending |
| TBD | 0 | SETUP-01 | — | `runUp` NO spawnea daemon si `needsSetup` (D-02) | unit (DI) | `node --test test/cli/up.test.js` | ❌ W0 | ⬜ pending |
| TBD | 0 | SETUP-01 | — | `runUp` abre dashboard en modo setup sin `exit(1)` (terminal real, D-13) | unit (DI) | `node --test test/cli/up.test.js` | ❌ W0 | ⬜ pending |
| TBD | 0 | SETUP-02 | — | selector provider → `config.provider` (saveConfig) | integration (ink) | `node --test test/dashboard/app-setup.test.js` | ❌ W0 | ⬜ pending |
| TBD | 0 | SETUP-02 | — | base_url/workspace_slug → saveConfig | integration (ink) | `node --test test/dashboard/app-setup.test.js` | ❌ W0 | ⬜ pending |
| TBD | 0 | SETUP-02 | T-PERSIST-04 | API key enmascarada → onSaveApiKey (`•` en render, valor nunca visible) | integration (ink) | `node --test test/dashboard/app-setup.test.js` | ❌ W0 | ⬜ pending |
| TBD | 0 | SETUP-02 | — | aviso de reinicio honesto tras completar (D-08) | integration (ink) | `node --test test/dashboard/app-setup.test.js` | ❌ W0 | ⬜ pending |
| TBD | 0 | SETUP-01 | — | non-TTY: degrada a `kodo config`, never-throws (D-13/Pitfall 16) | integration (ink) | `node --test test/dashboard/app-setup.test.js` | ❌ W0 | ⬜ pending |
| TBD | 0 | SETUP-05 | — | `kodo config` usa saveConfig/saveProjects/writeEnvVar (únicos escritores) | unit (source-hygiene/DI) | `node --test test/cli/config-writers.test.js` | ❌ W0 | ⬜ pending |
| TBD | 0 | PERSIST-04 | T-PERSIST-04 | **held-out**: valor de la key nunca alcanza los 5 sinks tras añadir modo setup | held-out (grep higiene) | `node --test test/config-env-writer.test.js` | ✅ (re-verificar) | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/config.test.js` — extender con casos de `needsSetup()` (incl. **held-out** Pitfall 12) — SETUP-01
- [ ] `test/cli/up.test.js` — extender `makeDeps` con seam `_needsSetup` / `_runDashboard({setup})` — SETUP-01/D-02
- [ ] `test/dashboard/app-setup.test.js` (**NUEVO**) — state-machine del modo setup, molde de `app-dismiss.test.js` (render + `stdin.write` + `lastFrame`) — SETUP-02
- [ ] Test source-hygiene/DI para SETUP-05 (escritores únicos) — puede extender un test de config existente
- [ ] Re-verificar el grep de higiene PERSIST-04 de Phase 67 sigue verde tras el modo setup

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Ciclo real first-run: máquina/HOME limpio (sin `config.json` ni `.env`) → `kodo up` → **setup mode sin exit(1)** → editar provider/base_url/slug/API key → guardar → aviso honesto → reiniciar → arranque | SETUP-01, SETUP-02 | Requiere TTY real + estado de disco limpio + spawn del daemon; no reproducible en unit | **GATE MANUAL LOCKED.** En HOME temporal limpio: 1) `kodo up` debe servir el setup mode **sin ningún `exit(1)`**; 2) completar los 4 campos → persistidos a `~/.kodo/config.json` + `.env` (0600); 3) transición honesta (leer valor recién escrito **directo del archivo**, Pitfall 15/D-09); 4) 2º `kodo up` con `KODO_DEV=1` (o `--insecure`) para sortear el webhook secret (**D-12**) → tabla viva. |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
