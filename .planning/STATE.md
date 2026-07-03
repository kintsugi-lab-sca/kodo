---
gsd_state_version: 1.0
milestone: v0.15
milestone_name: «kodo up» — ACTIVE
current_phase: 68
current_phase_name: dashboard-setup-mode-cfgf-03-first-run
status: executing
stopped_at: Phase 68 completa — GATE MANUAL UAT aprobado (2026-07-03)
last_updated: "2026-07-03T00:00:00.000Z"
last_activity: 2026-07-03
last_activity_desc: Phase 68 cerrada — GATE MANUAL clean-machine first-run UAT aprobado (6/6)
progress:
  total_phases: 4
  completed_phases: 3
  total_plans: 15
  completed_plans: 17
  percent: 75
---

# Project State

**Project:** kodo
**Active milestone:** **v0.15 «kodo up» — arranque unificado + onboarding dashboard-first** (iniciado 2026-07-01, roadmap creado 2026-07-02). kodo se pone a andar con un solo comando (`kodo up`): arranca el daemon **desacoplado** (server + polling compuestos en un proceso) en background y engancha el dashboard como **visor**; distribuible por Homebrew (`brew install` + `brew services`), y configurable de principio a fin desde el dashboard (incluida la API key enmascarada, con el boundary PERSIST-04). 4 phases (65-68), 14/14 requirements mapeados, 100% cobertura, 0 duplicados. Dos pilares con dependencia estricta: **Pilar 1** (UP + DIST, shippable solo) **antes de** **Pilar 2** (SETUP, requiere Pilar 1).

## Project Reference

See: `.planning/PROJECT.md` (updated 2026-07-01 — Current Milestone: v0.15 «kodo up»).

**Core value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. **Empíricamente validado en v0.7** (cross-provider contract matrix Plane + GitHub). v0.9 añadió observabilidad en terminal (`kodo dashboard`); v0.10 la promovió a gestión (dismiss); v0.11 abrió la ventana al plan; v0.12 profundizó desde la fila; v0.13 cerró el puente inverso `sesión → tarea`; v0.14 promovió el dashboard a superficie de configuración. **v0.15 unifica el arranque (`kodo up`), lo distribuye por Homebrew y cierra el onboarding dashboard-first.**

**Current focus:** Phase 68 — dashboard-setup-mode-cfgf-03-first-run

## Current Position

Phase: 68 (dashboard-setup-mode-cfgf-03-first-run) — COMPLETE (3/3 planes)
Plan: 3 of 3 — cerrado (SETUP-05 + GATE MANUAL aprobado)
Status: Phase 68 complete — GATE MANUAL UAT aprobado 2026-07-03. v0.15 lista para `/gsd-complete-milestone`.
Last activity: 2026-07-03 — GATE MANUAL clean-machine first-run UAT aprobado (6/6 pasos)

## Roadmap v0.15 (active)

Build order (risk-graded, LOCKED): **Pilar 1 (UP + DIST) ANTES de Pilar 2 (SETUP)**. Dentro de Pilar 1: **fundación del daemon (65, mayor riesgo de integración) → `kodo up` + brew (66, cierra Pilar 1 shippable)**. Dentro de Pilar 2: **secrets writer + masked input (67, boundary en aislamiento) → setup mode + first-run (68, cierra el milestone)**. Numeración **continua** desde Phase 64 (v0.14) → primera fase **Phase 65** (NO reset). **Cero nuevas dependencias npm** (todo se construye sobre primitivos ya enviados de `polling.js`/`polling-daemon.js` + el text-input de Phase 63).

| Phase | Goal | Requirements | Riesgo |
|-------|------|--------------|--------|
| 65. Daemon Lifecycle Foundation | `src/daemon/` (lifecycle + `kodo daemon run` foreground) + refactor `startServer({managed})` sin `process.exit`/PID propio + handler EADDRINUSE; `kodo start` legacy intacto; `~/.kodo/kodo.pid` unificado | UP-04, UP-06 (2) | **mayor** (refactor `startServer` managed — la integración más riesgosa; va primera) |
| 66. `kodo up` + Stop/Status + Homebrew | `kodo up` (daemon desacoplado + attach dashboard, idempotente) + `stop`/`status` unificados (`--json`) + `brew install`/`brew services` (plist → `kodo daemon run`) + Windows fallback | UP-01, UP-02, UP-03, UP-05, DIST-01, DIST-02, DIST-03 (7) | **medio-alto** (GATE MANUAL: ciclo real `brew services` en macOS no unit-testable) |
| 67. Secrets Writer + Masked Input | `writeEnvVar` (atómico + chmod 0600 pre-rename + merge) + campo enmascarado (extiende text-input de Phase 63) + grep de higiene + indicador "configurado" (presencia sin revelar) | SETUP-03, SETUP-04 (2) | **medio** (boundary de seguridad PERSIST-04 — testeado en aislamiento antes de tocar render) |
| 68. Setup Mode + CFGF-03 + First-Run | Primer arranque sin config → dashboard en modo setup (sin `exit(1)`) + edición provider/base_url/workspace_slug → `config.json` + `kodo config` rewired al mismo writer; aviso de reinicio | SETUP-01, SETUP-02, SETUP-05 (3) | **alto UX** (GATE MANUAL: UAT en máquina limpia sin config.json ni .env) |

- **Pilar 1 shippable sin Pilar 2:** Phases 65+66 entregan `kodo up`/stop/status/brew funcionales. Si el tiempo aprieta, Pilar 2 (67+68) puede diferirse a v0.15.1.
- **Phase 65 primero** porque el refactor `startServer(managed)` (quitar `process.exit(1)` + PID propio + handler `'error'`) es la integración de mayor riesgo — hacerla primera protege todo lo que viene después Y habilita el setup mode de Phase 68 (sin ese refactor, el daemon muere con `exit(1)` antes de servir el dashboard).
- **Phase 66 cierra Pilar 1** con el gate de brew: el plist DEBE invocar `kodo daemon run` (foreground), **NUNCA `kodo up`** (self-detach) — si no, launchd entra en crash-loop cada 10s (Pitfall 6). No unit-testable → spike de install real obligatorio.
- **Phase 67 antes de 68** para testear el writer de `.env` y el boundary PERSIST-04 en aislamiento (grep de higiene) antes de que el valor del key toque el árbol de render.
- **Phase 68 depende de 65+66+67** — el first-run modifica el comportamiento de `kodo up` y requiere el managed mode de 65, el `kodo up` de 66 y el masked input/`writeEnvVar` de 67.

## Most recent shipped milestone

**v0.14 Configuración editable desde el dashboard** — shipped 2026-06-30 (2 phases 63-64, 7 plans, UAT 4/4). El dashboard TUI pasó de observar+gestionar a también **configurar kodo**: editor de ajustes comunes (Phase 63: model/max_parallel, states, server thresholds, cmux colors → `config.json`) y editor de proyectos (Phase 64: `listProjects()` en vivo + mapear/editar/quitar ruta + módulos → `projects.json`, degradación never-throws). Base reusable: text-input editable in-house en ink + validadores puros + escritura local atómica (`writeFileAtomic`). Cero endpoints nuevos, API keys intactas en `~/.kodo/.env`.

- Roadmap archive: `milestones/v0.14-ROADMAP.md`
- Requirements archive: `milestones/v0.14-REQUIREMENTS.md`

## Deferred Items

Reset al baseline de v0.15. v0.14 cerró con UAT 4/4 y sin deuda viva heredada que bloquee v0.15. No hay items diferidos abiertos.

| Categoría | Item | Estado | Diferido en |
|-----------|------|--------|-------------|
| — | (ninguno abierto al iniciar v0.15) | — | — |

## Accumulated Context

### Decisions (Roadmap v0.15)

- **Numeración continua (NO reset):** v0.15 continúa desde Phase 64 (v0.14) → primera fase es **Phase 65**.
- **4 phases (no 2-3) pese a granularidad `coarse`:** la granularidad `coarse` sugiere 2-4; se elige el borde superior (4) porque cada fase es una frontera de riesgo LOCKED distinta, no un relleno. Phase 65 aísla el refactor managed de mayor riesgo; Phase 66 aísla el gate manual de brew; Phase 67 aísla el boundary de seguridad PERSIST-04 para testearlo antes de que el key toque el render; Phase 68 aísla el UAT de máquina limpia. Ninguna es una fase-mantenimiento fina.
- **Pilar 1 ANTES de Pilar 2 (LOCKED):** UP + DIST (65+66) deben ser shippable standalone antes de tocar SETUP (67+68). El first-run de Pilar 2 depende de que `kodo up` exista (Phase 66) Y del refactor managed de `startServer` (Phase 65).
- **`startServer(managed)` primero (Phase 65) por ser la integración de mayor riesgo:** quitar `process.exit(1)` (server.js:405-408) + PID propio (server.js:581) + añadir handler `'error'` para EADDRINUSE. Se valida `kodo start` legacy intacto antes de construir encima. Habilita además el chicken-and-egg del first-run (sin `exit(1)`, el daemon sirve el setup mode).
- **El plist de brew invoca `kodo daemon run` (foreground), NUNCA `kodo up` (LOCKED):** si launchd corre `kodo up` (self-detach) + KeepAlive, el padre sale inmediatamente → crash-loop cada 10s (Pitfall 6). Modo dual del daemon: self-detach para `kodo up` bare, foreground-supervised para launchd/brew.
- **Boundary PERSIST-04 (LOCKED):** el valor de la API key vive exclusivamente en `~/.kodo/.env` (0600), nunca se renderiza de vuelta ni cruza a `config.json`/`/status`/logs/argv. Un único sink `writeEnvVar` (en-proceso, chmod pre-rename, merge sin clobber) + grep test de higiene de los 5 vectores de fuga (Pitfall 11). El dashboard solo muestra **presencia** (`[configurado]`), nunca el valor.
- **Cero endpoints nuevos + cero deps npm nuevas (invariantes LOCKED preservados):** el daemon **compone** `startServer`/`startPolling` existentes; el masked input **extiende** (render-only) el text-input de Phase 63; la detección de puerto usa `node:net` (built-in). No pm2/forever/detect-port/ink-text-input.

### Roadmap Evolution

- **v0.15 roadmap creado (2026-07-02):** 4 phases (65-68), numeración continua desde v0.14 (NO reset). Estructura tomada del research SUMMARY (65 foundation → 66 up+brew → 67 secrets → 68 setup) con orden risk-graded LOCKED. 14/14 requirements mapeados, 100% cobertura, 0 duplicados. Granularidad `coarse` (borde superior justificado por 4 fronteras de riesgo distintas). GATES MANUALES señalados en 66 (spike brew macOS) y 68 (UAT máquina limpia).
- **v0.14 roadmap creado (2026-06-29):** 2 phases (63-64), numeración continua desde v0.13. Fundación+ajustes comunes (local) → editor de proyectos (`listProjects()` en vivo).
- **v0.13 roadmap creado (2026-06-15):** 7 phases base (52-58) → expandido a 11 (52-62). Arquitectura "una fontanería, tres consumidores".

### Open Blockers

Ninguno. v0.14 cerró con UAT 4/4 sin deuda viva heredada que bloquee v0.15.

### Open Questions (research SUMMARY — se resuelven al planificar cada fase, no bloquean el roadmap)

- **Phase 65:** ¿El daemon siempre corre polling, o `startPolling` condicional en `providerUsesPolling(config)` (Plane webhook vs GitHub polling)? Confirmar antes de planificar.
- **Phase 66:** Ubicación del tap Homebrew (`kintsugi-lab/homebrew-kodo` vs `alexnunez/homebrew-tap`). Validar durante el spike que el `opt_bin` absoluto es correcto en Apple Silicon (`/opt/homebrew`) vs Intel (`/usr/local`). ¿`kodo stop`/`status` deprecan `polling start` standalone? (Mantener legacy, revisar deprecación en fase futura.)
- **Phase 68 (punto de diseño abierto):** transición setup→running (Pitfall 15) — restart nudge honesto + leer el valor recién escrito directamente del archivo (no vía `loadEnvFile` no-override). Diseño fino durante discuss/plan de la fase.

### Critical Invariants to Preserve (cross-milestone, must survive this milestone)

- **Modelo daemon PERSISTENTE (LOCKED):** el daemon sobrevive al cierre del dashboard (`q`/Ctrl-C); solo `kodo stop` lo tumba. El dashboard es un **visor**, no el dueño del proceso. NO semántica compose-style (Ctrl-C mata daemon).
- **`kodo start` legacy intacto:** `up` es comando NUEVO, no reemplaza a `kodo start` (server foreground) ni a `polling start`. El refactor managed no puede regresionar el legacy.
- **El plist launchd invoca `kodo daemon run` (foreground), NUNCA `kodo up`** — evita el crash-loop de launchd (Pitfall 6).
- **Boundary PERSIST-04:** API key solo en `~/.kodo/.env` (0600); nunca renderizada/logueada/en `/status`/en argv. Solo se muestra presencia.
- **Cero endpoints nuevos en `src/server.js` (desde v0.10):** el daemon compone `startServer`/`startPolling`; no gestor de procesos/secretos genérico.
- **Cero nuevas dependencias npm:** primitivos built-in (`node:net`, `node:child_process`) + reuso de código enviado.
- **TaskProvider contract FROZEN en 9** (`TASK_PROVIDER_METHODS`) + getTaskState/createTask opcionales · **TUI never-throws** · **Color isolation** (`picocolors` solo desde `src/cli/format.js`; ink usa color de `<Text>`) · **`--json` byte-determinismo** (DX-06) · **Escritura no-corruptiva** (temp+rename atómico) · **Todo lo cmux-específico entra por `HostProvider`** · **LOG-12 guard** · **Worktree always-on**. v0.15 no rompe estos carriles.

## Session Continuity

**Resume file:** .planning/phases/68-dashboard-setup-mode-cfgf-03-first-run/68-CONTEXT.md

- **Last session:** 2026-07-03T00:00:00.000Z
- **Stopped at:** Phase 68 completa — GATE MANUAL UAT aprobado (2026-07-03)
- **Next action:** `/gsd-complete-milestone` — las 4 phases de v0.15 (65-68) están completas y el GATE MANUAL LOCKED de Phase 68 fue aprobado. Archivar v0.15 y preparar el siguiente milestone.
- **Files of record:**
  - `.planning/PROJECT.md` (Current Milestone: v0.15 «kodo up»)
  - `.planning/ROADMAP.md` (v0.15 activo Phases 65-68; v0.10-v0.14 colapsados/archivados)
  - `.planning/REQUIREMENTS.md` (v0.15, traceability 14/14 → Phases 65-68)
  - `.planning/research/SUMMARY.md` (síntesis de research — estructura de 4 fases + pitfalls + research/UAT flags)
  - `.planning/MILESTONES.md` (entrada v0.14 completa)

## Operator Next Steps

- `/gsd-complete-milestone` — Phase 68 cerrada (GATE MANUAL aprobado 2026-07-03), las 4 phases de v0.15 completas. Archivar el milestone v0.15.

## Performance Metrics

| Phase | Plan | Duration | Notes |
|-------|------|----------|-------|
| — | — | — | (sin planes ejecutados aún en v0.15) |
| Phase 65 P01 | 3 min | 2 tasks | 4 files |
| Phase 65 P02 | 12 min | 2 tasks | 3 files |
| Phase 65 P03 | 5min | 2 tasks | 4 files |
| Phase 65 P04 | ~2min | 2 tasks | 2 files |
| Phase 66 P01 | 8min | 3 tasks | 4 files |
| Phase 66 P02 | 4min | 2 tasks | 3 files |
| Phase 66 P03 | 7min | 2 tasks | 2 files |
| Phase 66 P05 | 15m | 2 tasks | 3 files |
| Phase 67 P01 | ~7min | 4 tasks | 2 files |
| Phase 67 P02 | 8min | 7 tasks | 4 files |
| Phase 67 P03 | 12min | 5 tasks | 2 files |
| Phase 68 P01 | 20 | 2 tasks | 4 files |
| Phase 68 P02 | 7min | 3 tasks | 4 files |
| Phase 68 P03 | ~11min | 2 tasks | 2 files |

## Decisions

- [Roadmap v0.15]: 4 phases (65-68) pese a granularidad `coarse` — cada fase es una frontera de riesgo LOCKED distinta (refactor managed / gate brew / boundary PERSIST-04 / UAT máquina limpia), no relleno.
- [Roadmap v0.15]: SETUP-04 (presencia "configurado" + aviso de reinicio) mapeado a Phase 67 junto a SETUP-03 — todo lo relativo a la KEY (write, mask, presencia, boundary) vive en una fase coherente; Phase 68 reusa el mecanismo de aviso para cambios de provider.
- [Roadmap v0.15]: GATES MANUALES señalados — Phase 66 (spike real `brew services` en macOS, no unit-testable) y Phase 68 (UAT en máquina limpia sin config.json ni .env).
- [Phase 65]: D-04: PID primitives take optional trailing name param (default 'polling') — kodo daemon uses 'kodo'->~/.kodo/kodo.pid, existing callers byte-identical
- [Phase 65]: D-06: providerUsesPolling allowlists github->true, plane/malformed->false (fail-safe, server keeps serving)
- [Phase 65]: Plan 65-02: startServer({managed}) throws KODO_SETUP_REQUIRED (no process.exit) + typed EADDRINUSE via server.on('error'); four points gated behind if(opts.managed), legacy byte-identical (UP-06 golden)
- [Phase 65]: Plan 65-02: managed returns { server, stopReconcile } + DI seam _loadConfig/_provider (mirror config.js:233) so managed path is unit-testable offline
- [Phase ?]: 65-04: kodo daemon run wired as a hidden commander subcommand (internal foreground entrypoint for Phase 66 kodo up/launchd); action awaits runDaemon with no process.exit (D-05 single-owner)
- [Phase ?]: 66-01: runUp compone las primitivas de Phase 65 detrás de seams DI, sin reimplementar spawn/PID; cero signal handlers hacia el daemon (UP-02 LOCKED).
- [Phase ?]: 66-02: kodo stop es daemon-first con fallback legacy server.pid (D-04) para no regresionar kodo start
- [Phase ?]: 66-02: kodo status reporta el estado del daemon (running/idle), no listSessions (D-04 LOCKED); --json byte-determinista con keys fijas {status, pid}
- [Phase ?]: kodo up NO llama ensureConfig ni process.exit (D-01); el daemon persiste en su propio process group
- [Phase ?]: kodo stop/status daemon-first (D-04); status reporta running/stopped en vez de listSessions
- [Phase ?]: Formula Homebrew: run [opt_bin/kodo,daemon,run] (Pitfall 6); sin variables de entorno en el plist (T-66-08)
- [Phase ?]: 66-07: kodo.pid = liveness del proceso, escrito antes del await de startServer; fail-path lo borra; mensaje distinto KODO_SETUP_REQUIRED
- [Phase 67]: 67-01: writeEnvVar NO reusa writeFileAtomic (sin chmod → fuga 0644); implementa su propia secuencia espejo de writePidFile con chmod 0600 pre-rename (Pitfall 13 LOAD-BEARING)
- [Phase 67]: 67-01: validación estricta (rechaza #, =, todo whitespace incl. \n/\r, y vacío) en vez de escapar (Pitfall 14); envPath por DI para aislar tests del .env real (Pitfall 21811); contrato dual throw-en-input/never-throws-en-I/O
- [Phase ?]: 67-03: grep de higiene source-level prueba que el VALOR del secreto no alcanza los 5 sinks; detector no-trivial (fixtures +/-) distingue VALOR de NOMBRE de la key
- [Phase ?]: 68-01: needsSetup() usa existsSync(CONFIG_PATH) como primera señal (Pitfall 12), nunca valores de loadConfig; runUp corre needsSetup pre-spawn y en first-run no arranca el daemon (D-02)
- [Phase 68]: El paso terminal 'complete' del modo setup es un sub-estado (no focusError) → aviso de reinicio honesto SETUP_COMPLETE_RESTART+SETUP_WEBHOOK_NOTE estable (D-08)
- [Phase 68]: SETUP_PROVIDERS exportado de App.js como fuente única del selector ['plane','github'] → mata el drift handler/render
- [Phase 68]: GATE MANUAL LOCKED (68-03, D5) APROBADO por humano el 2026-07-03 — UAT clean-machine first-run 6/6: `kodo up` sirvió el modo setup sin `exit(1)` ni daemon en first-run; el flujo guiado persistió config/proyecto a config.json y la key enmascarada a .env (0600); sin fuga del secreto a config.json/scrollback/ps; aviso de reinicio honesto; 2º arranque `KODO_DEV=1 kodo up` levantó el daemon + tabla viva; non-TTY degradó sin colgarse. La aprobación NO produjo cambios de código. Phase 68 y v0.15 cerradas → listas para `/gsd-complete-milestone`.
