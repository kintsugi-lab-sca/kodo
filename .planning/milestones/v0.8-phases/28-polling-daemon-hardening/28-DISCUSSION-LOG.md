# Phase 28: Polling/Daemon Hardening - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-18
**Phase:** 28-polling-daemon-hardening
**Areas discussed:** TaskItem timestamps (POLL-FIX-01), Semántica de --verbose, Shape del output por tick (DAEMON-01), Logfile lifecycle + rotación (DAEMON-02)

---

## Área 1 — TaskItem timestamps (POLL-FIX-01)

### Q1.1 — ¿Cómo cierras POLL-FIX-01 frente a D-18 y el contrato cross-provider?

| Option | Description | Selected |
|--------|-------------|----------|
| Extender el contrato a 13 campos | TaskItem canónico crece a 13: añade updated_at + created_at (ISO strings) en interface.js. Plane normalizer también los emite. D-18 se actualiza a '13 fields exactos'. Phase 27 contract matrix gana 2 asserts core. | ✓ |
| Opcionales solo donde aplican | interface.js documenta updated_at?/created_at? como OPCIONALES. GitHub los emite siempre, Plane los añade si los tiene. shouldDispatch maneja undefined defensivamente. | |
| Sidecar _meta envelope | TaskItem permanece en 11 fields canónicos. Añade campo opcional `_meta: {updated_at?, created_at?}` documentado como escape hatch. | |
| Pasar issue raw al dispatcher | No tocar TaskItem. shouldDispatch en el provider-only path recibe el `raw` de TriggerEvent. | |

**User's choice:** Extender el contrato a 13 campos
**Notes:** Es la opción más honesta — ambos providers (GitHub + Plane) ya los tienen y shouldDispatch los necesita para funcionar. La leak guard original (D-18 Phase 24) protegía contra campos GitHub-only, no contra campos cross-provider legítimos como timestamps. La extensión refuerza el contrato en vez de debilitarlo.

### Q1.2 — Null policy para timestamps

| Option | Description | Selected |
|--------|-------------|----------|
| Required — fail-loud | Ambos campos REQUIRED en TaskItem. Si un adapter no los tiene, falla en el contract matrix. shouldDispatch nunca ve undefined. | ✓ |
| Required con fallback documentado | REQUIRED + fallback a created_at = updated_at cuando solo uno está disponible. | |
| Nullable explicitamente | Tipo `string \| null` (NO undefined). shouldDispatch trata null como 'no info' → first-tick-skip semantics. | |

**User's choice:** Required — fail-loud
**Notes:** Empuja la responsabilidad al adapter — si un futuro provider no expone timestamps, lo descubrimos vía contract matrix antes de mergear, no en runtime.

---

## Área 2 — Semántica de --verbose

### Q2.1 — ¿Cómo se combina --verbose con --no-daemon / daemon?

| Option | Description | Selected |
|--------|-------------|----------|
| --verbose implica --no-daemon | `kodo polling start --verbose` arranca foreground automáticamente. Daemon nunca imprime por tick. | |
| Ortogonal — --verbose es independiente | `--verbose` activa output por tick en CUALQUIER modo: foreground → stdout, daemon → logfile. | ✓ |
| Solo afecta --no-daemon | `--verbose` se ignora silenciosamente en modo daemon. Logfile (AC#2) es always-on y separado. | |

**User's choice:** Ortogonal — --verbose es independiente
**Notes:** Permite `kodo polling start --verbose` daemon + `tail -f ~/.kodo/logs/polling-*.log` para observar arrancando real. No limita el flag a foreground, mayor flexibilidad sin coste.

---

## Área 3 — Shape del output por tick (DAEMON-01)

### Q3.1 — ¿Qué shape tiene la línea de --verbose por tick?

| Option | Description | Selected |
|--------|-------------|----------|
| Espejo de kodo logs (TTY human / no-TTY NDJSON) | Foreground TTY → columnar humano con colores via createFormatter. No-TTY o --json → NDJSON byte-deterministic. Daemon logfile → NDJSON siempre. | ✓ |
| Siempre NDJSON (machine-first) | Una línea NDJSON por tick con shape fijo. Cero colores, cero TTY-detect. | |
| Nuevo evento agregado polling.tick.summary | Hoy emitimos polling.tick PER-REPO. Añadimos un nuevo evento polling.tick.summary AL FINAL del tick. | |

**User's choice:** Espejo de kodo logs (TTY human / no-TTY NDJSON)
**Notes:** Aprovecha el helper format.js (Phase 14) y preserva DX-06 byte-determinismo. Consistente con AC#1 literal "formato consistente con kodo logs".

### Q3.2 — Granularidad del evento emitido

| Option | Description | Selected |
|--------|-------------|----------|
| Nuevo evento polling.tick.summary | Evento agregado AL FINAL del tick. polling.tick per-repo se preserva como debug. --verbose imprime solo el summary. | ✓ |
| Reusar polling.tick per-repo — una línea por repo | Una línea por (owner/repo) en cada tick. Sin nuevo evento. | |
| Eventos per-repo + summary final | Imprime tanto polling.tick per-repo como polling.tick.summary. | |

**User's choice:** Nuevo evento polling.tick.summary
**Notes:** Separa concerns — summary = una línea agregada para observabilidad operacional; eventos per-repo = drill-down telemetry. AC#1 menciona `repos_polled` (count agregado), que solo el summary captura cleanly.

---

## Área 4 — Logfile lifecycle + rotación (DAEMON-02)

### Q4.1 — ¿Cómo capturar stdout/stderr al logfile?

| Option | Description | Selected |
|--------|-------------|----------|
| fd redirect en el spawn (padre) | El padre abre logfile via openSync(path, 'a', 0o600) y lo pasa como stdio:['ignore', logFd, logFd] al hijo. Cero código en el hijo. | ✓ |
| Handlers en el hijo (process.on uncaught) | El hijo registra process.on('uncaughtException')/('unhandledRejection') que escriben síncrono al archivo. | |
| Combinación: fd redirect + handlers | Defense-in-depth. fd redirect cubre catástrofe, handlers dan formato estructurado a errores esperados. | |

**User's choice:** fd redirect en el spawn (padre)
**Notes:** Simple, robusto, cubre el caso crítico (SIGSEGV antes de poder ejecutar handlers). Si emerge necesidad de errores estructurados, futura phase puede añadir handlers ADEMÁS.

### Q4.2 — Estrategia de rotación

| Option | Description | Selected |
|--------|-------------|----------|
| Daily-by-name + retention 7 días | Filename polling-YYYY-MM-DD.log. Al iniciar, borra archivos con mtime > 7 días. Sin rotation mid-process. | ✓ |
| Daily-by-name + roll a medianoche | Timer interno que cierra/abre fd cuando cambia el día. | |
| Per-process file polling-{started_at}.log | Único por proceso. Viola la letra de AC#2. | |
| Size-cap rolling (logrotate-style) | Único polling.log con cap 10MB → polling.log.1 → .2 ... | |

**User's choice:** Daily-by-name + retention 7 días
**Notes:** Trade-off aceptado: daemon largo se queda en archivo del día de inicio. Operador puede stop+start manual si quiere rotar. Cumple AC#2 literal sin complejidad de timers internos.

### Q4.3 — Contenido del logfile y interacción con logger NDJSON

| Option | Description | Selected |
|--------|-------------|----------|
| Logger continúa al sink raíz | NDJSON sink raíz se preserva. Logfile solo captura stdout/stderr crudo (stack traces, console.error, verbose). | ✓ |
| Logger tee a logfile + sink raíz | Logger emite a AMBOS. Una sola fuente para 'qué pasó'. Mayor I/O. | |
| Solo logfile (durante daemon), sink raíz off | Logger desvía toda la salida al logfile. Rompe `kodo logs --follow`. | |

**User's choice:** Logger continúa al sink raíz
**Notes:** Separation of concerns: NDJSON = telemetría estructurada (queryable via `kodo logs`); logfile = troubleshooting humano del daemon (crashes + verbose). `kodo logs --follow` sigue funcionando sin cambios.

---

## Claude's Discretion

- Estructura interna del módulo nuevo para logfile path resolver + retention sweep (probablemente `src/cli/polling-logfile.js` espejando `polling-daemon.js`).
- Test seams para fd redirect (DI de `openSyncFn` o test integration con spawn real).
- Test seams para retention sweep (DI de Date.now / mtimes mockeables).
- Documentación inline del override de D-18 Phase 24 en `interface.js` y archive de Phase 24 (cross-reference no destructivo).

## Deferred Ideas

- Log rolling mid-process a medianoche → rechazado por simplicidad
- Size-cap rolling (logrotate-style) → viola AC#2 literal
- Per-process file → viola AC#2 literal
- Logger tee a logfile → rechazado por separation of concerns
- process.on('uncaughtException') handlers en el hijo → no necesario con fd redirect; defer si emerge necesidad
- TaskItem.assignees / milestone / reactions → fuera de scope; D-18 reformulado sigue siendo guard
