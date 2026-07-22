---
phase: 74
slug: handoff-acumulativo-al-cierre
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-21
---

# Phase 74 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| stdin (Claude Code) → hook SessionEnd | `input.reason` no confiable cruza a `buildHandoffBlock`; validado contra enum cerrado (`normalizeReason`, desconocido → `other`) | Razón de cierre |
| provider (Plane/GitHub) → `buildPlanHeader` | `session.summary`/`task_ref` cruzan al markdown del plan; `sanitizeInline` colapsa CR/LF y trunca a 120 — nunca se interpolan en la ruta | Metadatos de tarea |
| LLM → `~/.kodo/plans/<task_id>.md` | El LLM escribe texto libre en el markdown local de su propia tarea; `findSessionBlock` solo reconoce marcadores en headings `## Handoff ` | Contenido de handoff |
| hook → `~/.kodo/state.json` | Toda escritura de `state.tasks` vía `withStateLock` (carga fresca dentro del lock); `reconcileTick` sigue único escritor de `alive` | Puntero al plan + `NEXT:` (truncado a 200) |
| `session.task_id` → filesystem | `isSafeTaskId` (`String.includes` sobre `/`, `\`, `..`, nunca RegExp) como primera sentencia de `writeHandoff`; ruta construida con `join`, jamás derivada | Nombre de fichero del plan |
| operador → `~/.claude/settings.json` | Única mutación de la fase (Plan 74-08): vía instalador idempotente `installHooks`/`addHook` (aditivo, sin clobber), corrido desde el repo canónico | Entrada de hook SessionEnd |
| `~/.claude/settings.json` → `kodo doctor` | Lectura never-throws (`defaultReadSettings` → null en fallo); el render no imprime commands ni contenido del operador, solo `{event, file}` canónicos y veredicto | Estado de registro de hooks |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-74-01 | Tampering | `isSafeTaskId` / ruta del plan en `writeHandoff` | high | mitigate | Guard `String.includes` sobre `/`, `\`, `..` como primera sentencia; ruta con `join(plansDir, taskId + '.md')`. Presente en `handoff.js` y `session-end.js` | closed |
| T-74-02 | Tampering | `buildHandoffBlock` ← `input.reason` | medium | mitigate | `normalizeReason` valida enum cerrado antes de interpolar (D-03) | closed |
| T-74-03 | Tampering | `buildPlanHeader` ← `summary`/`task_ref` | medium | mitigate | `sanitizeInline` (CR/LF → espacio, trunca 120) + `findSessionBlock` solo mira headings `## Handoff ` | closed |
| T-74-04 | Tampering | RMW del plan (cierres simultáneos) | high | mitigate | `withFileLock` sobre `<plan>.md.lock`, `fn` síncrono, tmp+rename con nombre único; verificado cross-process (Plan 74-05) | closed |
| T-74-05 | Tampering | `state.json` | high | mitigate | Escritura exclusiva vía `withStateLock` (9 refs en `state.js`); mutator toca solo `state.tasks`, jamás `alive` | closed |
| T-74-06 | DoS | Lock ocupado (plan o state) | medium | mitigate | `{ok:false}` → `warn` → return; peor caso ~320 ms; el cierre jamás se bloquea (D-06) | closed |
| T-74-07 | DoS | `writeHandoff` lanzando bloquea el cierre | high | mitigate | try/catch propio en el seam de `session-end.js` además del outer never-throws; asserted con stub EACCES | closed |
| T-74-08 | Information Disclosure | Telemetría del handoff | low | mitigate | `handoff_saved`/`handoff_failed` llevan solo `{task_id, reason}` (`state.js:458,463`); el `next` nunca se loguea | closed |
| T-74-09 | DoS | `findSessionBlock`/`extractNext` ← markdown LLM | low | mitigate | Solo operaciones String, cero RegExp → sin backtracking catastrófico | closed |
| T-74-10 | Tampering | Pérdida de `state.tasks` en migración | medium | mitigate | Aditivo sin bump de schema; tests v3 + regresión anti-drop sobre `reconcileTick` | closed |
| T-74-11 | Tampering | Ruta del plan en la instrucción del prompt | medium | mitigate | Ruta resuelta con `join(KODO_DIR, ...)`, nunca literal templated; el hook reconstruye y valida la suya (asserted `gsd-context.test.js`) | closed |
| T-74-12 | Tampering | Contenido del bloque escrito por el LLM | low | accept | Markdown local del operador; no es HTML ni shell; `next` truncado a 200 antes de `state.json`. Ver Accepted Risks | closed |
| T-74-13 | Tampering | Marcador forjado con `session_id` ajeno | low | accept | Sin cruce de privilegio: afecta solo a la autoría de su propia tarea (peor caso, bloque mecánico redundante). Ver Accepted Risks | closed |
| T-74-14 | Tampering | Lock robado por TTL en escritura larga | low | mitigate | `fn` síncrono y corto (~ms) vs TTL 10 s; tmp único por escritor limita el daño | closed |
| T-74-15 | Information Disclosure | Suite escribiendo en `~/.kodo` real | medium | mitigate | `plansDir`/`stateWriterFn` inyectables; harness con `HOME` sandbox + dynamic import post-HOME | closed |
| T-74-16 | Tampering (TOCTOU) | `upsertTaskHandoff` — lectura del `prev` | medium | mitigate | `prev` leído del `state` del mutator (carga fresca dentro del lock); grep 0 `loadState` añadidos + `handoff-concurrency.test.js` verde | closed |
| T-74-17 | DoS | Doctor sobre settings malformado/ausente | medium | mitigate | `defaultReadSettings` try/catch → null; `checkHookRegistration` never-throws, malformado → «ausente» (8 casos de test) | closed |
| T-74-18 | Information Disclosure | Render del doctor sobre settings.json | low | mitigate | Solo imprime `{event, file}` canónicos y veredicto; ningún command/token del operador a stdout ni `--json` | closed |
| T-74-19 | Spoofing (falso verde) | Match laxo de hook | medium | mitigate | Chequeo por-EVENTO y por-FILE (`commandMatchesFile` contra `KODO_HOOKS[event]`); wrong-event/file ajeno no cuentan (raíz de G-74-4 fijada en tests) | closed |
| T-74-20 | Tampering | Ruta del command SessionEnd registrado | high | mitigate | Instalador corrido desde el repo canónico; verificado en vivo post-checkpoint: command contiene `/Users/alex/dev/klab/kodo/src/hooks/session-end.js` | closed |
| T-74-21 | Tampering | Clobber de hooks ajenos en settings.json | medium | mitigate | `addHook` exists-check + push aditivo; Tests 3/4/6/6b no-clobber; verificado en vivo (SessionStart/Stop + hooks ajenos intactos) | closed |
| T-74-22 | Repudiation | «Se registró pero no funciona» | high | mitigate | Verificación de doble superficie en vivo: `state.tasks` poblado por cierre real + telemetría `handoff_saved` con session_id real (74-08-SUMMARY, verifier passed) | closed |
| T-74-SC | Tampering | npm/pip/cargo installs | high | mitigate | Cero paquetes instalados en toda la fase: `git diff --stat package.json package-lock.json` vacío desde `88bcf72^` a HEAD | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-74-01 | T-74-12 | El LLM escribe texto libre en un markdown local de su propia tarea; opera ya con permisos de escritura sobre el repo — defanging fuera de alcance | Plan 74-03 (discuss-phase) | 2026-07-15 |
| AR-74-02 | T-74-13 | Un `session_id` forjado solo afecta a la detección de autoría de la propia tarea; sin cruce de privilegio | Plan 74-03 (discuss-phase) | 2026-07-15 |

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-21 | 23 | 23 | 0 | secure-phase L1 (orchestrator, short-circuit: register plan-time + threats_open 0 + ASVS 1) |

Notas del audit 2026-07-21:
- Registro consolidado de los 8 PLANs (todos con `<threat_model>` parseable → `register_authored_at_plan_time: true`).
- Threat Flags de 74-03/74-06 SUMMARYs: «Ninguno» en ambos; T-74-16 verificada por grep + test de concurrencia.
- T-74-20/21/22 verificadas EN VIVO en el checkpoint humano del Plan 74-08 (2026-07-21), no solo por artefactos.
- Suite completa del día: 2284 pass / 0 fail / 1 skipped.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
