# Phase 66: `kodo up` + Stop/Status unificados + Homebrew - Discussion Log

> **Audit trail only.** Decisiones en CONTEXT.md; este log preserva alternativas.

**Date:** 2026-07-01
**Phase:** 66-kodo-up-stop-status-unificados-homebrew
**Mode:** `--auto` (gray areas auto-seleccionadas; opción recomendada del research)
**Areas discussed:** Mecánica kodo up, Idempotencia, Stop/Status unificados, Homebrew/launchd, Health-wait, Windows fallback, Gate manual

---

## Mecánica de `kodo up` (GA-1)
**Auto:** ensure-daemon (`statusDaemon`+port probe → `startDaemon('kodo',['daemon','run'])` detached, o attach) → health-wait `/health` → `runDashboard` visor → salida deja daemon vivo (D-01). Persistencia sale gratis del `detached:true` de Phase 65.

## Idempotencia (GA-2)
| Option | Selected |
|--------|----------|
| statusDaemon + sonda node:net de puerto → attach-if-running | ✓ |
| Spawn siempre (arriesga colisión de puerto) | |
**Auto:** attach-if-running (D-02).

## Stop/Status unificados (GA-3)
| Option | Selected |
|--------|----------|
| `stop`/`status` daemon-first (kodo.pid) + fallback legacy server.pid | ✓ |
| Reemplazar/borrar el stop/status/polling legacy | |
**Auto:** daemon-first + fallback (D-04). **Notes:** legacy se mantiene (LOCKED); `--json` determinista molde runPollingStatusCli.

## Homebrew/launchd (GA-4)
| Option | Selected |
|--------|----------|
| Tap separado + `service do` DSL, plist invoca `kodo daemon run` | ✓ |
| homebrew-core / plist a mano / plist invoca `kodo up` | |
**Auto:** tap + service DSL (D-05). **Notes CRÍTICO:** plist NUNCA `kodo up` (launchd foreground trap, crash-loop). `depends_on node`, opt_bin absoluto, secretos solo en .env.

## Windows fallback (GA-5)
**Auto:** `kodo up` en win32 → foreground documentado sin crash (D-06), misma guardia que polling.

## Gate manual (GA-6)
**Auto:** `checkpoint:human-verify` para el ciclo real de `brew services` en macOS (D-07) — se pausa para el operador en `--auto`, NO se auto-aprueba (Pitfalls 6/9 no unit-testables).

---

## Claude's Discretion
- Owner del tap (`kintsugi-lab/homebrew-kodo` recomendado).
- Forma del fallback legacy de stop/status.
- Timeout health-wait + detalles de la sonda de puerto.
- `/health` vs `/status` para readiness.

## Deferred Ideas
- writeEnvVar / masked input / setup mode / CFGF-03 → Phases 67-68.
- homebrew-core → futuro. Deprecar legacy → futuro. Hot-reload → v2.
