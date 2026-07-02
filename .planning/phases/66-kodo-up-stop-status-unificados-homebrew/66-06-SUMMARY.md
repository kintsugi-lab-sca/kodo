---
phase: 66-kodo-up-stop-status-unificados-homebrew
plan: 06
subsystem: daemon
gap_closure: true
tags: [cmux, stderr, logging, daemon, launchd, brew-services, hardening, tdd]

# Dependency graph
requires:
  - phase: 38
    provides: CmuxHost (src/host/cmux.js) — único punto que habla con el binario cmux (SC#5)
  - phase: 66-03
    provides: fórmula kodo.rb + `kodo daemon run` bajo launchd/brew services
  - phase: 66-05
    provides: fix del flood EPIPE del daemon (guards de stream + writer de console safe)
provides:
  - "cmux.js captura el stderr del binario cmux (stdio pipe) en TODA invocación — nunca lo hereda al fd del daemon"
  - "Bajo brew services/launchd el chatter 'Failed to write to socket (Broken pipe)' del CLI cmux ya NO se filtra al kodo.log"
affects: [homebrew, brew-services, release-v0.15.1]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "execFileSync HEREDA stderr al padre por defecto (Node docs): para no filtrar el stderr del child hay que pasar stdio:['ignore','pipe','pipe'] explícito"
    - "Fail-open silencioso: el stderr capturado del child (err.stderr) se TRAGA — jamás se re-loguea a stdout/stderr (re-loguear bajo pipe roto recursa, ver 66-05)"

key-files:
  created:
    - test/host/cmux-stderr-capture.test.js
  modified:
    - src/host/cmux.js

key-decisions:
  - "El fix vive en el único choke-point (makeRun de cmux.js): TODAS las invocaciones sync del binario cmux pasan por ahí, así que un solo cambio cubre list/notification/tree/surface (SC#5 walker respetado)"
  - "El stderr capturado NO se re-loguea (ni siquiera a debug por defecto): silencio total en fail-open — reescribir bajo un pipe roto es justo lo que auto-sostiene el bucle (continuidad con 66-05)"
  - "La ruta execFile (selectWorkspace → runFocus) NO se toca: execFile ya CAPTURA stderr en su callback (_stderr ignorado), no lo hereda — ya cumplía el contrato"
  - "Scope B (brew services es server-only; la liveness de cmux necesita `kodo up` desde una sesión cmux) se documenta aparte en packaging/REQUIREMENTS, no aquí"

metrics:
  duration: ~12m
  tasks: 2
  files-created: 1
  files-modified: 1
  completed: 2026-07-02

status: complete
---

# Phase 66 Plan 06: Captura del stderr del binario cmux (anti-leak al daemon) Summary

Gap-closure residual del spike `brew services` de Phase 66: tras el fix EPIPE de 66-05 quedaba un leak de ~1/seg en el log del daemon bajo launchd. La causa era distinta al EPIPE del propio daemon — era el stderr del binario **hijo** cmux, heredado al fd del daemon. Fix quirúrgico en `src/host/cmux.js`, implementado en TDD.

## El bug residual (destapado tras 66-05)

Con el flood EPIPE del daemon ya resuelto (66-05), bajo `brew services`/launchd persistía en `kodo.log` una línea recurrente (~1/seg): `Error: Failed to write to socket (Broken pipe, errno 32)`.

## Root cause (verificado leyendo fuente)

1. El reconcile loop del daemon consulta el host cmux cada tick (`src/session/reconcile.js` → `CmuxHost`).
2. `CmuxHost` habla con el binario cmux vía el wrapper `makeRun` (`src/host/cmux.js`), que usa `execFileSync`.
3. Bajo launchd (headless, sin sesión GUI de cmux) el CLI de cmux NO alcanza su socket y escribe `Failed to write to socket (Broken pipe, errno 32)` a **su propio stderr**.
4. `execFileSync` **hereda stderr al proceso padre por defecto** (documentado en Node: «`stderr` by default will be output to the parent process' stderr unless `stdio` is specified»). Ese stderr del child se escribía directo al stderr del daemon → `kodo.log`.

El wrapper de kodo ya era fail-open (never-throws, T-55-01: captura el exit ≠ 0 y devuelve «sin surfaces»), pero el stderr del child ya se había escrito al fd heredado ANTES de que el catch actuara.

## El fix (un solo choke-point)

`makeRun` (el ÚNICO wrapper síncrono del binario cmux, y `src/host/cmux.js` es el único módulo autorizado a hablar con cmux — SC#5) ahora pasa `stdio: ['ignore', 'pipe', 'pipe']`:

- stdin ignorado, stdout capturado (se sigue devolviendo como string — mismo return shape), stderr **capturado (pipe), no heredado**.
- En un exit ≠ 0, el stderr del child queda en `err.stderr`; el fail-open lo **traga en silencio** y NO lo re-loguea (re-loguear bajo un pipe roto es lo que recursa — continuidad con la decisión de 66-05).
- Todas las invocaciones sync (list/notification/tree/surface resume show) pasan por `makeRun`, así que un solo cambio las cubre todas.

**Ruta execFile (selectWorkspace → `runFocus`):** NO requiere cambios. `execFile` (callback-style) **captura** stderr en el callback (`_stderr`, ignorado) en lugar de heredarlo; ya cumplía el contrato de no-filtrado. Se dejó intacta (cambio quirúrgico).

Se preservan todos los return shapes, el contrato never-throws (T-55-01) y el confinamiento cmux a `src/host/cmux.js` (SC#5 — el walker `test/host/cmux-isolation.test.js` sigue verde).

## Tests añadidos (`test/host/cmux-stderr-capture.test.js`)

Mirror de los patrones de DI de `test/host/*.test.js` (execFileSync inyectable vía `opts.execSync`):

1. **stderr capturado, no heredado:** inyecta un `execSync` fake que registra las `options`; tras `listWorkspaces` asserta que TODA invocación recibió `stdio` con stderr = `'pipe'` (capturado), no el default undefined/inherit.
2. **fail-open sin leak:** inyecta un `execSync` fake que reproduce fielmente el default de `execFileSync` (hereda stderr al padre salvo stdio explícito) y lanza con `.stderr` = `"Failed to write to socket (Broken pipe, errno 32)"`. Espía `process.stderr.write` y asserta que (a) `listWorkspaces` se mantiene fail-open (`[]`) y (b) ese stderr JAMÁS se escribió al stderr del daemon. Antes del fix el fake heredaba → el spy lo cazaba (RED); con el fix queda capturado (GREEN).

## Verificación

- TDD RED confirmado (2 subtests fallando: stdio sin capturar + leak al stderr), luego GREEN.
- Suite completa `npm test`: **1703 pass / 0 fail / 1 skip** (era 1701/0/1 tras 66-05; +2 tests nuevos). Cero regresión; `test/host/cmux-isolation.test.js` (SC#5 walker) sigue verde.

## 66-05 + 66-06 juntos

Los dos gap-closures resuelven el flood del `kodo.log` del daemon bajo `brew services`:

- **66-05:** el stderr del **propio daemon** ya no recursa en un bucle EPIPE infinito (guards de stream + writer de console safe).
- **66-06 (este):** el stderr del binario **hijo** cmux ya no se hereda al fd del daemon (captura vía stdio pipe, fail-open silencioso).

## Decisión de scope (documentada aparte)

Scope B — `brew services` es **server-only** (el daemon corre headless bajo launchd, sin sesión GUI de cmux; la liveness real de cmux requiere lanzar `kodo up` desde una sesión cmux) — NO se aborda aquí. Es una decisión de packaging que se documenta en los docs de packaging/REQUIREMENTS, no en este fix. Este plan es puramente: el stderr de cmux nunca contamina el log del daemon.

## Re-validación pendiente

El fix está cubierto por unit tests con fakes que reproducen el inherit-por-defecto de `execFileSync`. La re-validación **real** end-to-end bajo launchd requiere el mismo ritual de release que 66-05: re-cortar release (v0.15.1) → bump del tap formula (tag + sha256) → re-correr el spike `brew services` y confirmar que el log ya no floodea. Fuera del scope de este plan.

## Deviations from Plan

None - fix implementado exactamente según spec.

## Self-Check: PASSED

- Archivos verificados en disco: `test/host/cmux-stderr-capture.test.js`, `src/host/cmux.js`, `66-06-SUMMARY.md`.
- Commits verificados: `797d72c` (RED test), `d8c4ae0` (GREEN fix).
