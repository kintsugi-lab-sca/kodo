---
plan: 66-04
phase: 66-kodo-up-stop-status-unificados-homebrew
type: checkpoint:human-verify
status: complete
result: approved
verified_by: operator
arch: Apple Silicon (/opt/homebrew)
released: v0.15.3
date: 2026-07-02
---

# 66-04 — GATE MANUAL: spike real de `brew services` + `kodo up` E2E (D-07)

**Resultado: APROBADO por el operador** (arquitectura Apple Silicon, release **v0.15.3**).

El checkpoint no era automatizable (launchd/brew runtime). Se validó con una instalación real vía tap `kintsugi-lab-sca/homebrew-kodo`. El spike **cazó 3 bugs reales** que ningún unit test veía (todos corridos en TTY con fakes) — cerrados como gap-closures antes de aprobar.

## Checks validados
| # | Check | Resultado |
|---|-------|-----------|
| 1 | `brew install kodo` (tap, depends_on node, symlink) | ✅ |
| 2 | `opt_bin` por arquitectura (`/opt/homebrew`, Apple Silicon) | ✅ |
| 3 | `brew services start` → `started` estable, sin flapping | ✅ (tras 66-05/06) |
| 4 | `node` bajo launchd (sin `env: node ENOENT` en el log) | ✅ |
| 5 | `.env` leído bajo launchd — credenciales reales en uso (`/status` sirve sesiones reales de Plane) | ✅ |
| 6 | RunAtLoad/keep_alive (supervisión launchd) | ✅ (vía plist `keep_alive`) |
| 7 | `brew services stop` limpio | ✅ |
| 8 | Log limpio bajo `brew services` (server-only) — 4 líneas de arranque, sin `Broken pipe` | ✅ (tras 66-05/06) |
| 9 | `kodo up` E2E: attach (idempotencia UP-03) ✅ desde el inicio; cold-spawn ✅ tras 66-07 | ✅ |

## Bugs encontrados y cerrados durante el spike
- **66-05** — flood infinito de EPIPE bajo launchd: el monkey-patch de `console.*` re-escribía a stdout roto → bucle. Fix: `makeSafeConsoleWriter` (try/catch, nunca re-loguea) + `installStreamEpipeGuard` en `runDaemon`.
- **66-06** — leak residual (~1/s): el hijo `cmux` (reconcile loop) heredaba stderr y escribía "Failed to write to socket" bajo launchd (sin sesión cmux). Fix: `cmux.js` captura stderr (`stdio: ['ignore','pipe','pipe']`), fail-open silencioso.
- **66-07** — cold-spawn de `kodo up` daba "failed to write PID within 2000ms": el pid se escribía DESPUÉS del `await startServer` (network `provider.init`). Fix: escribir `kodo.pid` temprano (pid = liveness) + cleanup en fail-path + mensaje distinto para "falta config".

## Decisión de alcance (B)
`brew services` corre kodo en **modo server-only** (webhook + polling); las features acopladas a cmux (liveness/adopción) requieren **`kodo up` desde una sesión cmux** (cmux no es alcanzable bajo launchd headless). Documentado en `REQUIREMENTS.md` DIST-02, `caveats` de la fórmula y `packaging/homebrew/README.md`.

## Aprendizaje de distribución
Ritual de release documentado en `packaging/homebrew/README.md`: cada cambio que llega a usuarios de brew requiere nuevo tag + bump del `sha256` (recién calculado, nunca reusado — un mismatch salió durante el spike) en la fórmula del tap. `brew` nunca sigue `main`.

**Suite final:** 1708 pass / 0 fail / 1 skip. **Release en uso:** v0.15.3 (sha `30f9cf3d…`, integridad verificada).
