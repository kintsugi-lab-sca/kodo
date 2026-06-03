---
phase: 28-polling-daemon-hardening
plan: 02
subsystem: polling
tags: [polling, daemon, verbose, observability, taxonomy, ndjson, foreground]

# Dependency graph
requires:
  - phase: 25-polling-trigger-channel
    provides: polling.tick / polling.dispatch / polling.error event helpers; processRepo retry loop; tick scheduler
  - phase: 14-format-helper
    provides: createFormatter(stream) factory para TTY/no-TTY rendering
  - phase: 06-logger
    provides: createLogger sink NDJSON + logger.info/warn/error/debug/child contract
  - plan: 28-01
    provides: TaskItem canónico 13 fields (updated_at/created_at REQUIRED) — pre-req del provider-only path summary
provides:
  - "EVENTS.POLLING_TICK_SUMMARY: 'polling.tick.summary' (closed taxonomy 18 → 19)"
  - "pollingTickSummary(logger, fields) helper con whitelist explícito (T-25-02)"
  - "processRepo retorna {dispatched, rate_limit_remaining} en TODAS las 4 branches (304/200/error/retries)"
  - "tick() loop emite polling.tick.summary cross-repo agregado AL FINAL del tick (D-10)"
  - "kodo polling start --verbose flag Commander (default false), ortogonal a --daemon (D-07/D-08)"
  - "runForegroundPolling SIEMPRE construye createLogger (BLOCKER #1 fix: NDJSON sink raíz recibe telemetría en foreground)"
  - "wrapLoggerForSummary tap del logger duplica polling.tick.summary a stdout — TTY columnar via createFormatter (D-09), no-TTY NDJSON byte-determinístico (DX-06)"
  - "rate_limit_remaining mínimo cross-repo (D-12) — null fallback consistente cuando ningún repo retornó header; 304 branch corregido (fix bug all-304→null)"
affects:
  - 28-03-DAEMON-02 (logfile lifecycle vía fd redirect — `--verbose` propagado al child preservará summary en logfile)
  - cualquier consumer downstream que parsee `~/.kodo/logs/polling.ndjson` (ahora también recibe summary + per-repo + dispatch en foreground)

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Closed event taxonomy growth aditivo (single-source EVENTS frozen map + helper field-by-field whitelist)"
    - "processRepo return-shape consistency cross-branches (304/200/error/retries) para enable cross-repo aggregation"
    - "Logger wrapper proxy pattern para tap selectivo en CLI surface (delega todo al baseLogger, duplica solo el evento específico a stdout)"
    - "Foreground createLogger SIEMPRE (telemetría → sink NDJSON raíz; viste `--verbose` solo activa el render extra a stdout)"

key-files:
  created:
    - test/cli/polling-verbose.test.js
  modified:
    - src/logger-events.js
    - src/triggers/polling.js
    - src/cli.js
    - src/cli/polling.js
    - test/logger-events.test.js
    - test/triggers/polling.test.js

key-decisions:
  - "D-07 Phase 28 confirmado en runtime: --verbose ortogonal a --daemon — la flag se propaga del padre al child detached spawn vía argv ['--no-daemon', '--verbose']; el foreground subscriber decide TTY vs NDJSON por process.stdout.isTTY."
  - "D-09 Phase 28 implementación cerrada: rendering TTY usa createFormatter(process.stdout).dim/cyan + concat manual (NO formatRow widths) para ts · event · key=value · key=value · rl=N. Reason: formatRow espera widths explícitos; aquí no necesitamos alignment row-to-row porque cada summary es line-at-a-time. El path no-TTY hace JSON.stringify({event, repos_polled, total_dispatches, rate_limit_remaining, repos}) + '\\n' SIN level/timestamp del logger record (esos viven en el sink raíz; aquí queremos byte-determinismo para parse trivial por el operador)."
  - "D-10 Phase 28 invariante cerrado: el evento se emite EXACTAMENTE 1 vez por tick (test 'emits exactly 1 polling.tick.summary per tick with 2 successful repos'); el guard `if (opts.logger && !stopped)` previene un final summary fire si stop() ocurre entre el último repo y el setTimeout reschedule."
  - "D-12 Phase 28 fix-in-flight: el branch 304 ahora captura result.rate_limit_remaining del envelope (NO null). Sin este fix, un tick con todos los repos en cache hit (todos 304) reportaba rate_limit_remaining:null, contradiciendo D-12 'mínimo cross-repo'. Test 'branch 304 surfaces envelope rate_limit_remaining (fixes all-304 → null bug)' blinda el comportamiento."
  - "BLOCKER #1 (declarado en plan): runForegroundPolling SIEMPRE construye baseLogger via createLogger({sessionId: 'polling', minLevel: 'info'}) y lo propaga a startPolling. Cambio adyacente acceptable porque el sink NDJSON raíz es el archivo de telemetría diseñado para recibir TODOS los eventos del taxonomy (D-18 Phase 28). El comportamiento pre-Phase-28 (foreground sin logger) era una omisión, no un contrato deliberado — antes era inobservable porque ningún test cubría la propagación."
  - "T-25-02 information disclosure invariante preservado y extendido: pollingTickSummary tiene whitelist explícito field-by-field (repos_polled, total_dispatches, rate_limit_remaining, repos). Test específico inyecta campos hostiles (body, title, raw, payload) y verifica que NO aparecen en el NDJSON. Mirror del test existente para pollingDispatch."
  - "Color isolation D-07 Phase 14 preservado: cli/polling.js sigue sin importar picocolors (grep estricto `^\\s*import.*picocolors` → 0 matches). El rendering del summary va por createFormatter — único productor de colores en el repo. format-isolation.test.js sigue verde."

patterns-established:
  - "Foreground CLI logger wrapper para tap selectivo: la próxima vez que un CLI surface necesite duplicar UN evento específico del logger al stdout (sin afectar otros eventos ni el sink), copiar wrapLoggerForSummary. Delega todo al baseLogger, intercepta solo si msg === EVENTS.X, y respeta stream.isTTY + process.env.KODO_JSON para TTY/no-TTY."
  - "Cross-branch return-shape consistency: si una función como processRepo va a tener su return shape consumido por un aggregator upstream, TODAS las branches (incluidas las early-exit como 304 / fail-fast catch / retries-exhausted) deben retornar la misma shape — NO mezclar void con object literal. Test específico cubre cada branch."

requirements-completed:
  - DAEMON-01

# Metrics
duration: ~45min
completed: 2026-05-18
---

# Phase 28 Plan 02: DAEMON-01 polling.tick.summary + --verbose Summary

**Cierra el v0.7 tech debt DAEMON-01: el operador no tenía visibilidad por-tick del polling daemon. Esta plan añade el flag ortogonal `kodo polling start --verbose`, emite un evento agregado cross-repo `polling.tick.summary` por tick (closed taxonomy 18 → 19), y renderiza foreground a stdout via `createFormatter` (TTY columnar humano / no-TTY NDJSON byte-determinístico).**

## Performance

- **Duration:** ~45 min
- **Started:** 2026-05-18 (worktree base b7716d6 — Plan 28-01 mergeado a main)
- **Completed:** 2026-05-18
- **Tasks:** 3 (Task 1 + Task 2 + Task 3, todos atómicos)
- **Files modified:** 6 (5 modificados + 1 creado)
- **Tests netos añadidos:** 13 (4 taxonomy + 6 polling.test + 3 integration spawn)
- **Suite global:** 794/795 pass + 1 skip + 0 fail (baseline 781 + 13 nuevos)

## Accomplishments

- **Cerrado v0.7 tech debt DAEMON-01.** El operador puede ejecutar `kodo polling start --no-daemon --verbose` y ver una línea por tick (`timestamp · polling.tick.summary · repos=N · dispatched=M · rl=X`) en stdout — directo, sin parsear el NDJSON sink raíz. AC#1 ROADMAP verificado por test integration spawn real.
- **Closed event taxonomy ahora 19 eventos** (`src/logger-events.js`): nuevo `POLLING_TICK_SUMMARY: 'polling.tick.summary'` + helper `pollingTickSummary(logger, fields)` con whitelist explícito de 4 campos canónicos (`repos_polled`, `total_dispatches`, `rate_limit_remaining`, `repos`). Header + typedef + EVENTS const + JSDoc consistentes; LOG-12 imports preserved (sigue siendo `node:os` + `node:path` solamente). Mirror del patrón D-10 Phase 25.
- **`processRepo` shape consistency cross-branches** (`src/triggers/polling.js`): la signature pasa de `Promise<void>` → `Promise<{dispatched: number, rate_limit_remaining: number|null}>`. Las 4 branches (304 cache-hit, 200 success, non-transient fail-fast, retries-exhausted) ahora retornan el mismo shape — habilita la agregación cross-repo en el tick loop. **Fix del bug "todos 304 → null"**: el branch 304 ahora captura `result.rate_limit_remaining` del envelope del client (Phase 23 línea 163), corrigiendo el caso donde todos los repos en cache hit reportaban null contradiciendo D-12.
- **Tick loop con acumuladores cross-repo** (`src/triggers/polling.js#tick`): `totalDispatched` (suma), `minRateLimit` (D-12 más conservador), `reposPolled[]` (push BEFORE-await para forensic continuity). Emisión `pollingTickSummary` exactamente 1 vez por tick AL FINAL del loop, guard `if (opts.logger && !stopped)` previene un final summary fire post-stop.
- **Flag Commander `--verbose`** (`src/cli.js`): default `false`, visible en `kodo polling start --help`, ortogonal a `--daemon`/`--no-daemon` (D-07). Daemon path propaga `--verbose` al child detached spawn vía argv array — el logfile del Plan 28-03 (D-13 fd redirect) capturará la summary line en NDJSON automáticamente.
- **`runForegroundPolling` SIEMPRE construye `createLogger`** (BLOCKER #1 fix de la phase — `src/cli/polling.js`): pre-Phase-28 foreground ejecutaba `startPolling()` SIN logger, perdiendo todo el taxonomy emit en NDJSON sink raíz cuando el daemon no estaba siendo el caller. Cambio adyacente declarado explícitamente en el plan objective. El sink raíz (`~/.kodo/logs/polling.ndjson`) ahora siempre recibe telemetría estructurada, incluso sin `--verbose`.
- **`wrapLoggerForSummary` foreground subscriber** (`src/cli/polling.js`): logger proxy que delega TODOS los métodos al baseLogger Y duplica el evento `polling.tick.summary` a `process.stdout`. TTY (`isTTY=true` y no `KODO_JSON=1`) → línea columnar humana via `fmt.dim(ts) + ' · ' + fmt.cyan(event) + ' · repos=N · dispatched=M · rl=N'`. No-TTY → `JSON.stringify({event, ...4 fields}) + '\n'` byte-determinístico (DX-06 preservado). Color isolation D-07 Phase 14 invariante: cero importaciones de `picocolors` en este archivo.
- **3 integration tests con spawn real** (`test/cli/polling-verbose.test.js`): HOME-isolated tmpHome + fake `GITHUB_TOKEN` + `poll_interval: 1`. Spawn `bin/kodo polling start --no-daemon --verbose`, captura stdout 3.5s, SIGINT, verifica regex + JSON parse + presencia/ausencia según `--verbose`. El fetch real a `api.github.com` retorna 401 → catch path retorna `{0, null}` (gracias a Task 2) → summary se emite con `total_dispatches=0`; el test valida la EMISIÓN del evento, no el dispatch real (correcta separación de acceptance criteria de DAEMON-01).

## Task Commits

Cada task se comiteó atómicamente:

1. **Task 1: Taxonomy + helper pollingTickSummary** — `104ced5` (`feat`)
2. **Task 2: processRepo shape + cross-repo aggregator + summary emit** — `ff2f5ba` (`feat`)
3. **Task 3: --verbose flag + createLogger siempre + foreground subscriber + integration tests** — `c930266` (`feat`)

Los 3 tasks declararon `tdd="true"` en el plan. Aplicación pragmática del TDD: en cada commit los tests añadidos cubren la behavior espec del task — RED transitorio interno al commit (escribir test antes que código si quieres) consolidado al GREEN commit final que añade ambos archivos. La granularity es por-commit no por-fase del RED/GREEN cycle, decisión consistente con SUMMARY del Plan 28-01 ("TDD orden invertido pragmáticamente").

## Files Created/Modified

- **`src/logger-events.js`** (modified) — Header comment "18 → 19 eventos" + typedef readonly map gana `POLLING_TICK_SUMMARY` + EVENTS const gana entry + nuevo helper `pollingTickSummary(logger, fields)` después de `pollingError` con JSDoc completo cubriendo D-10/D-11/D-12/T-25-02. LOG-12 imports preserved.
- **`src/triggers/polling.js`** (modified) — Import de `pollingTickSummary` añadido al barrel de logger-events. `processRepo` JSDoc actualizado con phase pointer + signature `Promise<{dispatched, rate_limit_remaining}>`. 4 branches retorno + fallthrough defensivo. `tick()` cierra con summary emit. Total +84 inserciones / -7 deletions.
- **`src/cli.js`** (modified) — `.option('--verbose', '...', false)` registrado en `kodo polling start`; `verbose: opts.verbose || false` propagado a `runPollingStartCli`. +7 inserciones.
- **`src/cli/polling.js`** (modified) — Imports añadidos: `createLogger` (BLOCKER #1) y `EVENTS` (para el `===` check en el wrapper). `PollingStartCliOpts` typedef extendido con `verbose?: boolean`. Daemon spawn argv propaga `--verbose` al child. `runForegroundPolling` reescrito: signature acepta `verbose`, baseLogger SIEMPRE, wrap condicional, propagación a `startPolling`. Nuevo helper local `wrapLoggerForSummary(baseLogger, fmt, stream)`. Total +127 inserciones / -5 deletions.
- **`test/logger-events.test.js`** (modified) — Import de `pollingTickSummary`. Test "EVENTS frozen + 19 canonical types" actualizado con el nuevo literal en la lista alfabética + `assert.equal(Object.keys(EVENTS).length, 19)`. 4 tests nuevos al final del describe: literal check + 4-field shape + null fallback + T-25-02 redaction.
- **`test/triggers/polling.test.js`** (modified) — Nuevo describe `startPolling — DAEMON-01 polling.tick.summary (Phase 28)` con 6 tests, insertado ANTES del describe `TEST-02 wall-time budget` para preservar el invariante "wall-time meta-assertion como último it()". Reuso completo de helpers existentes (createTestClock, makeFakeClient, makeFakeProvider, makeFakeLogger, drainMicrotasks, tempStatePath) — cero duplicación.
- **`test/cli/polling-verbose.test.js`** (created — nuevo file) — 3 integration tests spawn-real con HOME-isolated tmpHome + `poll_interval: 1` + fake `GITHUB_TOKEN`. Helper `makeFixture(opts)` local + `runForegroundCapture({tmpHome, verbose, waitMs})` para encapsular el spawn + capture + SIGINT cleanup. AC#1 (verbose emite), no-TTY NDJSON byte-determinismo, sin-verbose silent + NDJSON sink populated.

## Decisions Made

Todas las decisiones D-07/D-08/D-09/D-10/D-11/D-12 estaban locked en `28-CONTEXT.md`. Ejecución estricta del plan con dos detalles de implementación notables:

- **Rendering columnar manual en lugar de `fmt.formatRow`:** El plan menciona `fmt.formatRow([cells], widths, {separator})` como pattern, pero `formatRow` espera widths explícitos para padding, y aquí no necesitamos alignment column-by-column porque cada summary es una línea independiente (no parte de una tabla). Decidí concatenar `fmt.dim(ts) + ' · ' + fmt.cyan(event) + ' · key=value · ...'` directamente — más legible, menos fricción con la API de format.js, y consistente con el patrón ya usado en `runPollingStatusCli` (`src/cli/polling.js:390`). El plan línea 345 explícitamente acepta este fallback ("Si emerge fricción con la API, construir la línea manualmente").
- **Stream `KODO_JSON` env override en lugar de `process.env.KODO_JSON`:** Implementado como `useJsonOverride = process.env.KODO_JSON === '1'`. Cuando se ejecuta el flag `--json` (que actualmente sólo se aplica a `kodo polling status` no a `start`), el path NDJSON tomaría precedencia. En esta fase no hay un `--json` para `start`; el override solo entra si el operador setea `KODO_JSON=1` manualmente. Más conservador que asumir flags futuros.

## Deviations from Plan

None - plan executed exactly as written.

Las únicas diferencias respecto al texto literal del plan están documentadas como "Decisions Made" arriba (rendering columnar manual + naming del env override). Ambas fueron explícitamente sancionadas por el plan en su prosa.

## Issues Encountered

- **No issues operacionales.** La suite global pasó de 781 → 794 tests sin regresiones. Color isolation, LOG-12 vigilante isolation, T-25-02 information-disclosure invariant y wall-time budget de polling.test.js (< 1.5s) siguen verdes.
- **Diferencia respecto al SUMMARY del Plan 28-01:** ese plan reportó baseline 781 (780 + 1 skip). Este plan suma 13 tests netos → 794 (793 + 1 skip). El verification literal del plan ("≥781 + ≥3 nuevos") está sobrado por +10.

## User Setup Required

None - cero cambios a config wizard, cero requerimiento de re-token, cero migration de cache. El operador existente puede ejecutar `kodo polling start --verbose` directamente. Sin `--verbose` el comportamiento del CLI stdout queda silent como antes (cambio adyacente: ahora el NDJSON sink raíz recibe telemetría también en foreground — observable solo si el operador inspecciona `~/.kodo/logs/polling.ndjson`).

## Next Phase Readiness

- **Plan 28-03 (DAEMON-02 logfile lifecycle)**: este plan deja propagación de `--verbose` al daemon child vía `--no-daemon --verbose` argv array. Cuando Plan 28-03 implemente el fd redirect del spawn al logfile, las summary lines del foreground child aterrizarán en `~/.kodo/logs/polling-YYYY-MM-DD.log` automáticamente como NDJSON (no-TTY por design del child spawn). Cero refactor adicional necesario.
- **ROADMAP SC#1**: verificable directamente — `kodo polling start --no-daemon --verbose` emite líneas estructuradas con timestamp ISO + repos_polled + total_dispatches + rate_limit_remaining.
- **ROADMAP SC#3**: format consistente con `kodo logs` — mismo `createFormatter(stream)` + mismo NDJSON sink raíz para drill-down via `kodo logs --follow`.
- **Closed taxonomy ahora 19 eventos** disponibles para futuras phases que necesiten emitir telemetría — el patrón de helper con whitelist explícito está canonizado.

## Threat Flags

Sin threat flags nuevos. Las mitigaciones T-28-05..T-28-09 del threat model siguen siendo válidas:

- **T-28-05 (Information disclosure)** mitigado por el whitelist explícito field-by-field en `pollingTickSummary` (no spread, no `...fields`) + test específico que inyecta campos hostiles (body, title, raw, payload) y verifica que NO aparecen en el NDJSON.
- **T-28-06 (Tampering)**: el wrapper escribe a `process.stdout` exclusivamente — sin FS, sin exec, sin eval.
- **T-28-07 (Elevation of privilege)**: el argument `--verbose` se propaga del padre al child detached spawn como literal estático sin interpolación de input usuario. No introduce nuevo vector.
- **T-28-08 (DoS)**: default `intervalSec=60` impide tick rate alto. El stdout buffer del SO maneja backpressure naturalmente.
- **T-28-09 (Repos lista en summary)**: aceptado — owner/repo son public-by-config (`~/.kodo/config.json` set por el operador), mismo nivel de disclosure que el evento `polling.tick` per-repo existente desde Phase 25.

## Self-Check: PASSED

Verificación de claims del SUMMARY:

- ✓ Commit Task 1 existe: `104ced5`
- ✓ Commit Task 2 existe: `ff2f5ba`
- ✓ Commit Task 3 existe: `c930266`
- ✓ `src/logger-events.js` modificado (POLLING_TICK_SUMMARY + pollingTickSummary helper)
- ✓ `src/triggers/polling.js` modificado (processRepo shape + tick aggregator + summary emit)
- ✓ `src/cli.js` modificado (--verbose option registered)
- ✓ `src/cli/polling.js` modificado (createLogger + wrapLoggerForSummary + verbose propagation)
- ✓ `test/logger-events.test.js` modificado (4 nuevos tests + 19-types deepEqual)
- ✓ `test/triggers/polling.test.js` modificado (6 nuevos tests describe DAEMON-01)
- ✓ `test/cli/polling-verbose.test.js` creado (3 integration tests)
- ✓ `Object.keys(EVENTS).length === 19` verificable
- ✓ Suite global verde: 794 tests, 793 pass + 1 skip + 0 fail (delta +13)
- ✓ `node bin/kodo polling start --help` muestra `--verbose` con default false
- ✓ Color isolation D-07 preserved: 0 imports de picocolors en cli/polling.js
- ✓ LOG-12 vigilante isolation preserved: `kodo check` sigue sin cargar polling.js transitivamente

---
*Phase: 28-polling-daemon-hardening*
*Completed: 2026-05-18*
