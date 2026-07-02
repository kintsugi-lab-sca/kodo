---
phase: 66-kodo-up-stop-status-unificados-homebrew
plan: 03
subsystem: cli
tags: [commander, homebrew, launchd, brew-services, daemon, cli-wiring]

# Dependency graph
requires:
  - phase: 66-01
    provides: runUp (src/cli/up.js) — orquestador ensure-daemon → health-wait → attach dashboard
  - phase: 66-02
    provides: runStopUnified / runStatusUnified (src/cli/stop-status.js) — handlers daemon-first con --json
  - phase: 65
    provides: startDaemon/stopDaemon/statusDaemon + runDaemon + `kodo daemon run` hidden
provides:
  - "`kodo up` registrado en cli.js (lazy import runUp) — el operador puede arrancar el daemon + visor con un comando"
  - "`kodo stop`/`kodo status` re-cableados daemon-first con --json (fallback legacy server.pid en stop)"
  - "packaging/homebrew/Formula/kodo.rb — fórmula in-tree lista para el tap kintsugi-lab/homebrew-kodo (brew install + brew services)"
affects: [66-04, homebrew, brew-services, spike-instalacion]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Wiring lazy-import en cli.js: cada .action hace await import() del módulo pesado (aísla ink/lifecycle/server del arranque del CLI)"
    - "Homebrew service do DSL (Homebrew renderiza el plist; nunca def plist/XML a mano)"
    - "Comentarios de fórmula libres de tokens que darían falsos positivos en greps de verificación (environment_variables, \"up\")"

key-files:
  created:
    - packaging/homebrew/Formula/kodo.rb
  modified:
    - src/cli.js

key-decisions:
  - "kodo up NO llama ensureConfig ni process.exit (D-01): el daemon queda vivo en su propio process group; el wizard es Phase 68"
  - "kodo stop/status pasan a daemon-first (D-04); status ya NO lista sesiones (listSessions) — reporta running/stopped del daemon"
  - "La fórmula usa run [opt_bin/\"kodo\",\"daemon\",\"run\"] (Pitfall 6): jamás el comando self-detach (crash-loop de launchd)"
  - "Se OMITE el bloque de variables de entorno del plist: secretos en ~/.kodo/.env 0600 (T-66-08)"
  - "Tag/sha256 de la fórmula quedan como TODO(spike 66-04); se fijan al cortar la release v0.15"

patterns-established:
  - "Comando nuevo + re-cableado quirúrgico en cli.js sin tocar start/polling/daemon run (D-03)"
  - "Fórmula Homebrew in-tree (packaging/homebrew/Formula/) como espejo lintable del tap externo"

requirements-completed: [UP-01, UP-05, DIST-01, DIST-02]

coverage:
  - id: D1
    description: "`kodo up` registrado en cli.js (lazy import runUp) y visible en `kodo --help`"
    requirement: "UP-01"
    verification:
      - kind: integration
        ref: "node bin/kodo up --help (exit 0) + kodo --help lista `up`"
        status: pass
    human_judgment: false
  - id: D2
    description: "`kodo stop`/`kodo status` daemon-first con --json; start/polling/daemon run intactos"
    requirement: "UP-05"
    verification:
      - kind: integration
        ref: "node bin/kodo stop --help | grep --json; node bin/kodo status --help | grep --json"
        status: pass
      - kind: unit
        ref: "test/cli/kodo-start-regression.test.js (UP-06 golden: legacy start + server.pid intacto)"
        status: pass
    human_judgment: false
  - id: D3
    description: "packaging/homebrew/Formula/kodo.rb con service do → daemon run, depends_on node, sin secretos en plist"
    requirement: "DIST-01"
    verification:
      - kind: automated_ui
        ref: "grep run [opt_bin/kodo,daemon,run] + depends_on node + bin.install_symlink + !environment_variables"
        status: pass
    human_judgment: false
  - id: D4
    description: "Ciclo real brew install → brew services start/list/stop en macOS (opt_bin por arquitectura, PATH mínimo launchd)"
    requirement: "DIST-02"
    verification: []
    human_judgment: true
    rationale: "El ciclo brew services / launchd NO es unit-testable (Pitfalls 6/9); brew style requiere red (rubygems). Se valida en el checkpoint del Plan 66-04."

# Metrics
duration: 7min
completed: 2026-07-02
status: complete
---

# Phase 66 Plan 03: Cableado CLI (`kodo up`/stop/status) + fórmula Homebrew Summary

**`kodo up` registrado en cli.js (lazy runUp) y `kodo stop`/`kodo status` re-cableados daemon-first con `--json`, más la fórmula Homebrew `packaging/homebrew/Formula/kodo.rb` con `service do → daemon run` (nunca self-detach) — Pilar 1 shippable a falta del spike de instalación real.**

## Performance

- **Duration:** ~7 min
- **Started:** 2026-07-02T06:35:40Z
- **Completed:** 2026-07-02T06:42:51Z
- **Tasks:** 2
- **Files modified:** 2 (1 modificado, 1 creado)

## Accomplishments
- `kodo up` es un comando nuevo en cli.js que lazy-importa `runUp` (Phase 66-01), sin `ensureConfig` ni `process.exit` (D-01): el daemon persiste al cerrar el visor.
- `kodo stop` re-cableado a `runStopUnified` daemon-first con `--json` (conserva el fallback legacy `server.pid`); `kodo status` re-cableado a `runStatusUnified` daemon-first con `--json` — cambio consciente D-04: reporta running/stopped del daemon en vez de listar sesiones.
- `kodo start`, `kodo polling *` y el `kodo daemon run` hidden quedan intactos (D-03); el golden `kodo-start-regression` sigue verde.
- Fórmula Homebrew in-tree: `depends_on "node"`, `std_npm_args`→libexec + `bin.install_symlink`, `service do` con `run [opt_bin/"kodo","daemon","run"]` + `keep_alive` + `log_path`/`error_log_path`, sin bloque de variables de entorno (secretos fuera del plist).

## Task Commits

Cada tarea se comiteó atómicamente:

1. **Task 1: Cablear cli.js — up + stop/status daemon-first** - `69503b7` (feat)
2. **Task 2: Formula Homebrew — service do → daemon run** - `bbd03e4` (feat)

## Files Created/Modified
- `src/cli.js` - Comando `up` nuevo (lazy runUp); `stop`/`status` re-cableados a runStopUnified/runStatusUnified con `--json`; eliminado el helper `timeSince` (huérfano tras quitar el cuerpo listSessions de status).
- `packaging/homebrew/Formula/kodo.rb` - Fórmula Homebrew (espejo del tap kintsugi-lab/homebrew-kodo): install a libexec + symlink, `service do` con el entrypoint foreground `daemon run`, sha256/tag como TODO del spike 66-04.

## Decisions Made
- **`--url` en `kodo up`:** se registra la opción y se reenvía `{ url: opts.url }` a runUp tal como pide el plan. `runUp` (66-01) resuelve `baseUrl` config-driven internamente y todavía no consume ese `url`; queda reenviado para cuando up.js lo soporte. No se tocó up.js (fuera del scope `files_modified` de este plan).
- **`process.exit` en stop/status:** ambos handlers retornan exit code; se usa `process.exit(await ...)` (mismo patrón que `polling stop/status`) para un cierre determinista. stop/status siempre retornan 0.
- **Versión de la fórmula (`v0.15.0`):** se usa el tag del milestone v0.15 (coincide con la forma canónica del RESEARCH), no la `0.1.0` stale de package.json. El bump de package.json + el tag real + el sha256 se sincronizan al cortar la release en el spike 66-04 (documentado como TODO en la fórmula).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Comentarios de la fórmula reescritos para no disparar falsos positivos en los greps de verificación**
- **Found during:** Task 2 (Formula Homebrew)
- **Issue:** La forma canónica del RESEARCH incluía los literales `environment_variables` (en un comentario `# environment_variables: OMITIR…`) y `"up"` (en `# NUNCA "up"`). El `<verify>` del plan exige `! grep -q 'environment_variables'`, y el plan pide explícitamente no incluir el token del self-detach en el bloque service — ambos comentarios habrían roto la verificación.
- **Fix:** Reescritos los comentarios para expresar el mismo intent sin esos tokens ("el bloque de variables de entorno del plist", "el comando interactivo self-detach").
- **Files modified:** packaging/homebrew/Formula/kodo.rb
- **Verification:** los 5 greps (run daemon run / depends_on node / bin.install_symlink / ausencia environment_variables / ausencia "up") pasan.
- **Committed in:** bbd03e4 (Task 2 commit)

**2. [Rule 1 - Dead code] Eliminado el helper `timeSince` huérfano**
- **Found during:** Task 1 (re-cableado de `kodo status`)
- **Issue:** El re-cableado de `status` a daemon-first eliminó el único llamador de `timeSince` (que formateaba el elapsed de las sesiones), dejándolo como código muerto.
- **Fix:** Eliminada la función `timeSince` (dead code causado directamente por el cambio del task).
- **Files modified:** src/cli.js
- **Verification:** `grep -rn timeSince src/` sin resultados; suite completa verde.
- **Committed in:** 69503b7 (Task 1 commit)

---

**Total deviations:** 2 auto-fixed (1 blocking, 1 dead-code cleanup)
**Impact on plan:** Ambos ajustes necesarios y en scope (el primero para satisfacer la verificación del plan; el segundo limpia código que el propio task dejó huérfano). Sin scope creep.

## Issues Encountered
- **`brew style` no ejecutable en el runner:** `brew` está instalado pero `brew style` intenta buscar gems en rubygems.org y el sandbox no tiene red (Socket::ResolutionError). Es el caso previsto "brew ausente" del plan → el lint estático de la fórmula se difiere al checkpoint del Plan 66-04 (máquina con red). Los 5 greps deterministas de la fórmula pasan localmente.

## User Setup Required
None - no external service configuration required en este plan. El registro real del tap (`kintsugi-lab/homebrew-kodo`), el tag de release, el sha256 y el ciclo `brew services` se abordan en el spike del Plan 66-04.

## Next Phase Readiness
- Pilar 1 shippable a nivel de código: `kodo up`/`stop`/`status` expuestos por CLI y la fórmula lista para publicar.
- Bloqueador pendiente para cerrar la fase: checkpoint:human-verify del Plan 66-04 (install real + `brew services` en macOS, validando `opt_bin` por arquitectura y el PATH mínimo de launchd) + fijar tag/sha256 y bump de package.json a v0.15.

## Self-Check: PASSED

- FOUND: src/cli.js
- FOUND: packaging/homebrew/Formula/kodo.rb
- FOUND: .planning/phases/66-kodo-up-stop-status-unificados-homebrew/66-03-SUMMARY.md
- FOUND commit: 69503b7 (Task 1)
- FOUND commit: bbd03e4 (Task 2)

---
*Phase: 66-kodo-up-stop-status-unificados-homebrew*
*Completed: 2026-07-02*
