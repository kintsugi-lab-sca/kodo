# Phase 72: Higiene, DX y verdad documental - Research

**Researched:** 2026-07-13
**Domain:** Mechanical hardening / dead-code removal / hook lifecycle refactor / documentation reconciliation (no new capabilities)
**Confidence:** HIGH — every audit finding re-verified by reading the code at HEAD this session (D-03 mandate satisfied)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** El contrato del batch de BAJAS es **REQUIREMENTS.md HYG-06**: `B1, B2, B3, B4, B8, B9, B12 + M12`. La PROPUESTA omitía B2/B8 — REQUIREMENTS los añade y **gana**.
- **D-02:** **B12 «Otros»** = grab-bag de 4 sub-items independientes → 4 micro-diffs. Si alguno excede ~5 líneas, se **difiere con nota** en el SUMMARY (no se fuerza).
- **D-03 [CRÍTICO]:** Los file:line del audit (2026-07-03) tienen ~10 días de deriva. Re-verificar que cada hallazgo B*/M* **sigue reproduciéndose en HEAD** antes de planificar su fix; los cerrados de rebote se marcan N/A con evidencia. **→ Esta research lo hace: ver §Re-verificación de hallazgos contra HEAD.**
- **D-04:** HYG-08 es **pasada DELTA de verificación, no reescritura**. El README fue reescrito y auditado contra el CLI real el 2026-07-10 (commit `cb98a6d`).
- **D-05:** La pasada delta HYG-08 va **al FINAL de la fase** (último plan), porque HYG-04 cambia el comportamiento que el README describe.
- **D-06:** El gate `KODO_ORCHESTRATOR=1` cubre **todo el bloque** de auto-commit (add + commit). Sin la variable → **skip silencioso con log** (no error).
- **D-07:** La variable se **inyecta en `launchOrchestrator`** como parte del entorno/comando del claude lanzado. Pathspec completo en AMBOS pasos: `git add -- .claude/skills/kodo-orchestrate/` y `git commit -- .claude/skills/kodo-orchestrate/`.
- **D-08:** Los tres efectos (color review, notify, nudge) se ejecutan **DESPUÉS del backstop de transición de estado** que Phase 71 (DELIV-04) ordenó en `SessionEnd`; cada uno never-throws individual.
- **D-09:** `Stop` conserva lo que no es efecto-de-cierre (guards de re-entrada/idempotencia, mark de estado ligero). Mapear el reparto exacto Stop↔SessionEnd sin romper `test/hooks/stop-idempotency.test.js`.
- **D-10:** B7 (deep-merge + validación en `loadConfig`) se implementa como **warn-and-fallback, nunca crash**. Reutilizar `src/config-validate.js` existente, no duplicar.
- **D-11:** M3 (rechazar `__proto__|constructor|prototype`), M5 (chmod 0600 del `.env` con `*_secret`) y M14 (`split`+`join` del resto) siguen la dirección literal del audit. B5 (strip de comillas en `.env`) se aplica como strip, no solo doc.

### Claude's Discretion
- Orden interno de los planes (batches paralelizables); agrupación de BAJAS en 1 plan vs 2; ubicación exacta del strip `\x1b` (HYG-07/M4); wording de los warns NDJSON nuevos.

### Deferred Ideas (OUT OF SCOPE)
- **B11** (`follow.js` re-emisión de líneas duplicadas) — NO está en HYG-06; fuera salvo cambio de REQUIREMENTS.
- **B6/B10** (path traversal en `kodo logs`, 500 con `err.message` crudo) — eran de Ola 1; si aparecen sin cerrar → backlog, no esta fase. **NOTA: ambos ya están cerrados por Phase 69 (NET-04/NET-05) — ver §Re-verificación.**
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| HYG-01 | Gate `KODO_ORCHESTRATOR=1` + pathspec `.claude/skills/kodo-orchestrate/` en auto-commit | §HYG-01 — inyección vía `cmux.send` command string en `launchOrchestrator`, no spawn env |
| HYG-02 | Eliminar `kodo up --url` (código muerto) | §HYG-02 — quitar option `cli.js:75` + arg `{url}` `cli.js:83`; NO tocar `--url` de `dashboard` (`cli.js:381`) |
| HYG-03 | Eliminar `startHealthLoop` + README deja de prometerlo | §HYG-03 — solo `startHealthLoop`/`stopHealthLoop`/`runHealthCheck` son dead; `checkHealth`/`actOnHealth` los usa `check.js` — NO borrar el fichero entero |
| HYG-04 | Mover color/notify/nudge de `Stop` a `SessionEnd` | §HYG-04 — reparto exacto Stop↔SessionEnd, efectos DESPUÉS del backstop DELIV-04 |
| HYG-05 | Batch config: M3 + M5 + M14 + B5 + B7 | §HYG-05 — 5 puntos de fix con file:line verificados |
| HYG-06 | Batch BAJAS: B1, B2, B3, B4, B8, B9, B12 + M12 | §HYG-06 — tabla con file:line verificados en HEAD |
| HYG-07 | Strip `\x1b` en contenido externo del dashboard (M4) | §HYG-07 — punto de inyección: `App.js:1696-1699` (proyección de comentarios de Plane) |
| HYG-08 | Pasada DELTA del README | §HYG-08 — checklist de claims a verificar POST-72 |
</phase_requirements>

## Summary

Esta es una fase de **higiene mecánica y refactor de bajo riesgo** — cero capacidades nuevas, cero dependencias npm (invariante cross-milestone). El trabajo real de research NO es descubrir librerías, sino **re-verificar que cada hallazgo del audit adversarial (2026-07-03) sigue reproduciéndose en HEAD** tras ~10 días de deriva (Phases 69-71 + reescritura del README). Lo he hecho leyendo el código en cada file:line: **todos los hallazgos B*/M* del scope de HYG-05/HYG-06 siguen vivos**, con dos file:line desplazados y **B6/B10 ya cerrados por Phase 69** (confirma la nota de Deferred del CONTEXT).

Dos descubrimientos arquitectónicos cambian cómo se planifican HYG-01 y HYG-03: (1) `launchOrchestrator` **no hace `spawn`** — envía el comando `claude` como texto a un workspace cmux vía `cmux.send`, así que `KODO_ORCHESTRATOR=1` se inyecta **prefijando el string del comando** (`KODO_ORCHESTRATOR=1 claude …`), no como opción de entorno de un `child_process`. (2) `startHealthLoop` es dead code (cero importadores) pero `checkHealth`/`actOnHealth` del **mismo fichero** los consume `check.js` — HYG-03 borra solo el loop, NO el fichero.

La secuenciación LOCKED (Ola 4 al final) existe porque HYG-04 toca `SessionEnd`, el mismo hook que DELIV-04 (Phase 71) ya reordenó. `session-end.js:89-94` incluso deja un comentario explícito reservando sitio para el movimiento de HYG-04 (Pitfall #7). Los efectos cosméticos van DESPUÉS del backstop, cada uno con su propio `catch`.

**Primary recommendation:** Trata cada hallazgo como un micro-diff quirúrgico con test por hallazgo (patrón de las Olas 1-3). Empieza por los batches paralelizables (HYG-05, HYG-06, HYG-07) y los borrados (HYG-02, HYG-03); haz HYG-04 y HYG-01 con cuidado (tocan hooks con guardrails de test existentes); cierra con la pasada DELTA HYG-08 al final.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Auto-commit gate (HYG-01) | Hook process (`stop.js`) | Orchestrator launch (`launch.js`) | El gate se lee en el hook; la variable se inyecta al lanzar el workspace orquestador |
| Dead-code removal (HYG-02/03) | CLI (`cli.js`, `cli/up.js`) + session (`health.js`) | — | Superficie CLI + módulo de sesión |
| Hook lifecycle split (HYG-04) | Hook processes (`stop.js` → `session-end.js`) | cmux host (`cmux/client.js`) | Efectos de cierre pertenecen al cierre real (SessionEnd), no al fin-de-turno (Stop) |
| Config hardening (HYG-05) | Config layer (`config.js`) + CLI edge (`cli.js`) | `config-validate.js` | Parser `.env` + `loadConfig` + `--set` edge de CLI |
| Provider/CLI BAJAS (HYG-06) | Providers, GSD, labels, hooks/install | — | Diffs dispersos de 1-5 líneas por subsistema |
| Terminal-injection strip (HYG-07) | Dashboard render (`cli/dashboard/App.js`) | `cli/format.js` | El contenido externo (comentarios de Plane) entra al render en la proyección de líneas |
| Documentation truth (HYG-08) | Docs (`README.md`) | — | Verificación DELTA contra el estado POST-72 |

## Standard Stack

**No aplica ninguna librería nueva.** Invariante cross-milestone (STATE.md): **Cero nuevas dependencias npm**. Todo se resuelve con `node:*` built-ins ya en uso (`node:fs`, `node:child_process`, `node:crypto`) y los patrones establecidos del repo.

| Herramienta existente | Uso en esta fase | Por qué |
|-----------------------|------------------|---------|
| `node --test` (built-in) | Runner de tests (`package.json`: `node --test $(find test -name '*.test.js')`) | Ya es el runner; cada hallazgo lleva su test |
| Logger NDJSON (`src/logger.js` + `logger-events.js`) | Warns de HYG-05 (B7 warn-and-fallback), eventos never-throws de HYG-04 | Patrón establecido warn-and-continue |
| `src/config-validate.js` | Reutilizar para B7 (D-10) — NO duplicar validación | Ya tiene `validatePositiveInt`, `validateModel`, `validateNonEmpty`, `validateCmuxColor`, `getByPath`/`setByPath` |
| `chmodSync` + tmp+rename (`config.js:writeEnvVar`) | Patrón espejo para M5 (chmod 0600 del `.env`) | `writeEnvVar` (config.js:412-458) ya hace chmod 0600 PRE-rename — reusar la técnica |

**Installation:** N/A — sin instalación.

## Package Legitimacy Audit

**N/A — esta fase NO instala paquetes externos.** El invariante "Cero nuevas dependencias npm" (STATE.md §Critical Invariants) lo prohíbe explícitamente. No hay tabla de legitimidad porque no hay paquetes que auditar.

## Re-verificación de hallazgos contra HEAD (D-03 — CRÍTICO)

> Leído el código en cada file:line **hoy (2026-07-13)**. Estado: ✅ reproduce · ⚠️ file:line desplazado · ❌ ya cerrado (N/A).

| Código | Audit file:line | Estado en HEAD | file:line real (HEAD) | Evidencia |
|--------|-----------------|----------------|-----------------------|-----------|
| **A8/HYG-01** | `stop.js:132-135,265-299` | ✅ reproduce | `stop.js:132-135` (heurística cwd), `stop.js:265-299` (`handleOrchestratorStop`), `stop.js:285` (commit sin pathspec, add de `.claude/skills/` entero) | `execSync('git … add .claude/skills/ && … commit -m …')` sin gate ni pathspec |
| **A9/HYG-02** | `cli.js:82-83`, `up.js:151,190` | ✅ reproduce | `cli.js:75` (option `--url`), `cli.js:83` (`runUp({ url: opts.url })`), `up.js:runUp(deps={})` nunca lee `deps.url` | `runUp` computa `baseUrl` vía `resolveBaseUrlFn`; `deps.url` es swallowed |
| **M18/HYG-03** | `session/health.js` (todo) | ⚠️ parcial | `health.js:157` (`startHealthLoop`), `:167` (`stopHealthLoop`), `:174` (`runHealthCheck`) son dead; `checkHealth`/`actOnHealth` **NO** (los usa `check.js:11,71,77`) | grep: `startHealthLoop` cero importadores; `checkHealth`/`actOnHealth` importados por `check.js` |
| **M19/HYG-04** | `stop.js:157,166,235-242` | ✅ reproduce | `stop.js:157` (`setColor`), `:166` (`notify`), `:234-243` (nudge `send`) | Los tres efectos disparan por turno en `runStopHook` |
| **M3/HYG-05** | `cli.js:547-555` | ⚠️ desplazado | `cli.js:42` (callsite `setNestedValue`), `cli.js:551-559` (def) | `setNestedValue` camina keys sin rechazar `__proto__`/`constructor`/`prototype` |
| **M5/HYG-05** | `config.js:99-103` | ✅ reproduce (contexto) | `config.js:100-104` (`writeFileAtomic` sin chmod), `loadEnvFile` `:12-28` (el `.env` puede quedar 0644) | `writeFileAtomic` no hace chmod; `writeEnvVar` (`:412`) sí es 0600 pero es otro camino |
| **M14/HYG-05** | `cli.js:36,49` | ✅ reproduce | `cli.js:36` (`opts.set.split('=')`), `cli.js:49` (`opts.mapProject.split(':')`) | `[key,value] = split('=')` trunca `token=a=b=c` a `a`. **Ver Pitfall #2 (discrepancia CONTEXT D-11).** |
| **B5/HYG-05** | `config.js:12-28` | ✅ reproduce | `config.js:19-22` (`loadEnvFile`) | `value = trimmed.slice(eq+1).trim()` — no hace strip de comillas: `KEY="x"` guarda `"x"` |
| **B7/HYG-05** | `config.js:155-164` | ✅ reproduce | `config.js:161-170` (`loadConfig`) | Devuelve `parsed`/`migrateConfigIfNeeded(parsed)` verbatim; sin deep-merge ni validación |
| **B1/HYG-06** | `labels.js:29-33` | ✅ reproduce | `labels.js:29` (`['sonnet','haiku'].includes(tag)`) | `opus` cae a `flags` (inerte). Latente: `default_model` YA es `'opus'` (`config.js:58`) → **más que latente** |
| **B2/HYG-06** | `plane/client.js:8,10,14` | ✅ reproduce | `plane/client.js:8` (`config.plane.base_url`), `:10` (`config.plane.workspace_slug`), `:14` (`config.plane.api_key_env`) | Referencia schema v1 eliminado; `config.plane.*` es `undefined` tras migración |
| **B3/HYG-06** | `gsd/verification.js:213-241` | ✅ reproduce | `gsd/verification.js:~213` (`must_haves_verified < must_haves_total`) | Condición `<` en vez de `!==` → `99/3` pasa |
| **B4/HYG-06** | `gsd/verify.js:136-181` | ✅ reproduce | `verify.js:137` (`padStart(2,'0')`), `:177` (`startsWith(\`${padded}-\`)`), `:463` (helper padded) | Match acoplado a zero-pad de 2 dígitos |
| **B8/HYG-06** | `plane/client.js:290` (`parseRef`) | ⚠️ nombre/línea | `plane/client.js:~289` (`resolveIdentifier`, regex `/^([A-Z]+)-(\d+)$/i`) | El `/i` no salva `K2-42`: `[A-Za-z]+` no puede contener el dígito. Fix: `^([A-Za-z][A-Za-z0-9]*)-(\d+)$`. **Re-grep `parseRef` por si hay 2 sitios** |
| **B9/HYG-06** | `hooks/install.js:82,111` | ✅ reproduce | `install.js:82` (uninstall `command?.includes('kodo')`), `:111` (install exists check) | Match por substring `'kodo'`, no por ruta canónica |
| **B12a/HYG-06** | verification YAML inline comments | ✅ reproduce | `gsd/verification.js:118` (`body.split('\n')`) parser fail-closed | Parser naive de YAML sin manejo de `#` inline |
| **B12b/HYG-06** | `plane/client.js` throttle epoch | ✅ reproduce | `plane/client.js:37` (`waitMs = this._rateReset * 1000 - Date.now()`), `:57` (`x-ratelimit-reset`) | Asume `reset` es epoch-segundos; si Plane devuelve delta, el cálculo es basura |
| **B12c/HYG-06** | `createLabel` 409 amplio | ✅ reproduce (mitigado) | `plane/client.js:263-264` (`isNameConflict409`: `msg.includes('already exists') \|\| msg.includes('labels/')`) | El `\|\| labels/` es demasiado amplio: cualquier 409 con `labels/` en el path se traga |
| **B12d/HYG-06** | factory GitHub sin bloque → TypeError | ✅ reproduce | `registry.js:66,71` (`config.providers?.github` → `createGitHubProvider(undefined)`) | Optional chaining pasa `undefined` al constructor → `TypeError` críptico en vez del mensaje canónico |
| **M12/HYG-06** | `gsd/roadmap.js:31` | ✅ reproduce | `roadmap.js:31` (regex `(?::\s*\|\s+-\s+)`) | Solo `:` o `-` ASCII; `## Phase 6 — Foundation` (em-dash) no matchea. Fix: aceptar `[-–—]` |
| **M4/HYG-07** | `SessionTable.js` render | ⚠️ desplazado | `App.js:1696-1699` (proyección `comments.map` → líneas) es el punto de entrada real; `SessionTable.js:234` renderiza líneas ya proyectadas | Sin strip de control chars; el CSI-strip de `format.js:57` **NO** cubre OSC (`\x1b]`) |
| **B6** (Deferred) | `logs/reader.js:66` | ❌ cerrado | Phase 69 NET-05 (allowlist `/^[A-Za-z0-9_-]+/`) | Confirma nota Deferred del CONTEXT → NO tocar |
| **B10** (Deferred) | `server.js:584` | ❌ cerrado | Phase 69 NET-04 (500 neutro) | Confirma nota Deferred del CONTEXT → NO tocar |

**Resumen:** 0 hallazgos del scope cerrados de rebote (los 2 cerrados — B6/B10 — ya estaban en Deferred). 3 file:line desplazados (M3, B8, M4) — corregidos arriba. Todos los demás reproducen tal cual.

## Architecture Patterns

### System Architecture Diagram — reparto Stop ↔ SessionEnd (HYG-04)

```
Claude Code (sesión de trabajo en workspace cmux)
   │
   ├── fin de CADA turno ──────────────► Stop hook (stop.js :runStopHook)
   │                                      │  DESPUÉS de HYG-04 conserva SOLO:
   │                                      │   • guards idempotencia (source==='history')
   │                                      │   • markSessionStatus → 'idle' (estado ligero)
   │                                      │   • releaseGsdLock (si session.gsd)
   │                                      │  ELIMINA (mueve a SessionEnd):
   │                                      │   ✗ setColor(review)      :157
   │                                      │   ✗ notify("cerrada")     :166
   │                                      │   ✗ nudge send()          :234-243
   │
   └── cierre REAL (/exit) ────────────► SessionEnd hook (session-end.js :runSessionEndHook)
                                          │  ORDEN LOCKED (D-08):
                                          │   1. guards idempotencia
                                          │   2. runReviewBackstop (DELIV-04, load-bearing) :95-120
                                          │   3. sessionEnd typed event
                                          │   4. releaseGsdLock backstop
                                          │   5. performTerminalCleanup
                                          │   6. ◄── HYG-04: color/notify/nudge AQUÍ (cada uno never-throws)
                                          │        (DESPUÉS del backstop — Pitfall #7 reservó el sitio)
```

### Pattern 1: Micro-diff quirúrgico con test por hallazgo
**What:** Cada BAJA/MEDIA es un diff de 1-5 líneas con un test unitario que prueba el fix.
**When to use:** Todo HYG-05/HYG-06/HYG-07.
**Example (B1):**
```javascript
// labels.js:29 — antes:
if (['sonnet', 'haiku'].includes(tag)) {
// después:
if (['opus', 'sonnet', 'haiku'].includes(tag)) {
```

### Pattern 2: Efecto cmux never-throws individual (se conserva al mover)
**What:** Cada efecto cmux va en su propio `try/catch` para que un fallo no aborte los demás ni la transición.
**When to use:** HYG-04 al mover a SessionEnd (D-08).
**Example (patrón actual de stop.js:156-163, se preserva):**
```javascript
try {
  await cmuxClient.setColor({ workspace: session.workspace_ref, color: colorForStatus('review') });
} catch (err) {
  console.error(`[kodo] Error setting color: ${err.message}`);
}
```

### Pattern 3: Gate por variable de entorno inyectada en el command string (HYG-01)
**What:** `launchOrchestrator` NO hace `spawn` — envía el comando como texto vía `cmux.send`. Para que el hook (proceso hijo de `claude`) vea `KODO_ORCHESTRATOR=1`, se prefija al command string.
**Example (launch.js:250-258, punto de inyección):**
```javascript
// launch.js:250 — el claudeCmd se construye como array y se une con ' '
const claudeCmd = [
  'KODO_ORCHESTRATOR=1',   // ◄── inyección D-07 (prefijo de entorno del shell)
  'claude',
  '--model', config.claude.default_model,
  '--session-id', sessionId,
  ...config.claude.flags,
  `'${escapedPrompt}'`,
].join(' ');
await cmux.send({ workspace: workspaceRef, text: claudeCmd + '\\n' });
```
Y en `stop.js:handleOrchestratorStop`:
```javascript
if (process.env.KODO_ORCHESTRATOR !== '1') {
  console.error('[kodo] Stop: no es sesión orquestadora (KODO_ORCHESTRATOR ausente) — skip auto-commit');
  return;   // D-06: skip silencioso con log, cubre TODO el bloque (add+commit)
}
// … luego pathspec completo:
execSync('git -c commit.gpgsign=false add -- .claude/skills/kodo-orchestrate/ && git -c commit.gpgsign=false commit -- .claude/skills/kodo-orchestrate/ -m "…"', …);
```

### Anti-Patterns to Avoid
- **Borrar `health.js` entero (HYG-03):** `checkHealth`/`actOnHealth` los usa `check.js`. Borra SOLO `startHealthLoop`/`stopHealthLoop`/`runHealthCheck` + el `healthInterval` module-level.
- **Tocar `--url` de `dashboard` (HYG-02):** `cli.js:381` es el `--url` de `kodo dashboard` — `runDashboard` SÍ lo lee (`cli.js:386`). Solo se borra el de `kodo up` (`cli.js:75,83`).
- **Escapar en vez de rechazar (M3):** prototype pollution se **rechaza** (`__proto__|constructor|prototype`), no se sanea.
- **Reescribir el README (HYG-08):** es DELTA, no reescritura (D-04). Tocar solo claims que queden falsos POST-72.
- **Mover efectos de HYG-04 ANTES del backstop:** rompe el orden load-bearing DELIV-04 (D-08). Van al FINAL.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Validar config (B7) | Un validador nuevo en `config.js` | `src/config-validate.js` (`validatePositiveInt`, etc.) | D-10 lo manda; ya existe y es puro/never-throws |
| chmod 0600 atómico del `.env` (M5) | Lógica nueva de perms | Patrón `writeEnvVar` (`config.js:448-453`): `writeFileSync(tmp,{mode:0o600})` → `chmodSync(tmp,0o600)` → `renameSync` | Ya resuelto en el mismo módulo |
| Strip de control chars (HYG-07) | Extender el regex CSI de `format.js:57` | Un helper nuevo que elimine TODO `\x1b` (incluye OSC `\x1b]`) | El regex existente `\x1b\[[\d;]*[A-Za-z]` solo cubre CSI, NO el OSC-52 que es el vector de M4 |
| Parse-merge del `.env` (B5) | Un parser nuevo | El parser naive de `loadEnvFile` (config.js:16-26) — añadir strip conservador de comillas emparejadas | Coherencia con el round-trip parse→write→parse |

**Key insight:** Casi todo lo que esta fase necesita YA existe en el repo. El riesgo no es construir mal, es **duplicar** (B7 reinventando validación) o **borrar de más** (health.js entero, `--url` de dashboard).

## Runtime State Inventory

> Esta fase es principalmente code-only, pero HYG-01 introduce una env var runtime nueva.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | Ninguno — verificado: HYG-06/HYG-05 no renombran keys de datastore, colecciones ni user_ids | None |
| Live service config | Ninguno — no se tocan workflows n8n, dashboards ni ACLs | None |
| OS-registered state | Los hooks de Claude Code (`settings.json`) referencian `stop.js`/`session-end.js` por RUTA (install.js:20-23). HYG-04 **no cambia rutas** (solo el reparto interno de efectos) → sin re-registro. B9 endurece el match de uninstall pero no re-registra | None para HYG-04; B9 solo cambia el predicado de match |
| Secrets/env vars | **NUEVA env var `KODO_ORCHESTRATOR=1`** (HYG-01, D-07). No es secreto — es un marcador de rol. Se inyecta en el command string de `launchOrchestrator`, se lee en `stop.js`. No persiste en disco ni en `/status`/logs | Documentar en README como parte de HYG-08 (marcador de sesión orquestadora) si aplica |
| Build artifacts | Ninguno — no hay rename de `pyproject.toml`/`package.json` name ni egg-info | None |

**Canonical question — «tras actualizar cada fichero, qué runtime tiene el estado viejo cacheado»:** El único estado runtime nuevo es `KODO_ORCHESTRATOR` en el entorno del proceso `claude` orquestador. Una sesión orquestadora **ya lanzada** antes del deploy NO tendría la variable → su próximo auto-commit haría skip (comportamiento seguro por diseño D-06). No requiere migración.

## Common Pitfalls

### Pitfall 1: Discrepancia CONTEXT D-11 vs audit sobre la ubicación de M14
**What goes wrong:** CONTEXT D-11 dice «M14 (`split` con `join` del resto en el **parser `.env`**)». El audit ubica M14 en `cli.js:36,49` (`--set`/`--map-project`), NO en el `.env`.
**Why it happens:** El parser `.env` (`loadEnvFile`, config.js:19) YA usa `indexOf('=')`+`slice` — es correcto. El bug real de `split('=')`/`split(':')` está en el edge de CLI.
**How to avoid:** Aplicar el fix `slice(1).join(sep)` en `cli.js:36` (`--set`) y `cli.js:49` (`--map-project`). El parser `.env` NO necesita el fix de M14 (sí el de B5, que es strip de comillas). Flag `[ASSUMED]` — el planner debe confirmar contra el audit literal.

### Pitfall 2: B8 puede tener dos sitios (`parseRef` vs `resolveIdentifier`)
**What goes wrong:** El audit cita `parseRef` en `plane/client.js:290`; en HEAD encontré `resolveIdentifier` con la misma regex a ~:289. Puede que ambos existan o que se renombrara.
**How to avoid:** `grep -n "A-Z.*\\d" src/providers/plane/client.js` para localizar TODAS las regex de identificador antes de fijar el diff.

### Pitfall 3: El nudge de HYG-04 usa `buildStopNudgeText` (texto "ha terminado y está en Review")
**What goes wrong:** El texto del nudge (`stop.js:41-56`) dice literalmente «ha terminado y está en Review» — correcto en SessionEnd (cierre real) pero era mentira en Stop (per-turn). Al mover, el texto pasa a ser verdadero.
**How to avoid:** Mover `buildStopNudgeText` + su callsite (`stop.js:234-243`) juntos a SessionEnd. Verificar que `session.status`/`session.summary` siguen disponibles en el punto de SessionEnd (lo están: `session` se resuelve igual).

### Pitfall 4: `stop-idempotency.test.js` y `session-end.test.js` son guardrails vivos
**What goes wrong:** Mover efectos entre hooks puede romper aserciones que esperan `setColor`/`notify`/`send` en Stop (o su ausencia en SessionEnd).
**How to avoid:** Leer ambos tests ANTES de mover; actualizar las expectativas en el MISMO commit que el movimiento. Tests relevantes: `test/hooks/stop-idempotency.test.js`, `test/hooks/session-end.test.js`, `test/stop.test.js`, `test/stop-state-transition.test.js`.

### Pitfall 5: `session-end.js:89-94` ya reservó sitio para HYG-04
**What goes wrong:** El bloque backstop de DELIV-04 tiene un comentario: «No se entrelaza con esos pasos para dejar sitio al movimiento de HYG-04 en Fase 72 (Pitfall #7)».
**How to avoid:** Insertar los efectos DESPUÉS de `performTerminalCleanup` (o tras el backstop, según D-08 «al final»). El comentario confirma que el diseño de Phase 71 ya anticipó este movimiento.

### Pitfall 6: B12 es un grab-bag — presupuesto de 5 líneas por sub-item
**What goes wrong:** Forzar un sub-item de B12 que requiere >5 líneas rompe el criterio de éxito #4.
**How to avoid:** D-02 lo permite: si un sub-item excede el presupuesto, **diferir con nota** en el SUMMARY. Los 4 sub-items: (a) YAML inline `verification.js:118`, (b) throttle epoch `client.js:37`, (c) `createLabel` 409 `client.js:263`, (d) factory GitHub `registry.js:66-71`. (d) probablemente cabe en <5; (b) puede requerir detección epoch-vs-delta (candidato a diferir).

## Code Examples

### M3 — rechazar prototype pollution (cli.js:551 setNestedValue)
```javascript
// Source: código HEAD src/cli.js:551 + dirección audit M3
const FORBIDDEN_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
function setNestedValue(obj, path, value) {
  const keys = path.split('.');
  for (const k of keys) {
    if (FORBIDDEN_KEYS.has(k)) {
      throw new Error(`Clave de config prohibida: ${k}`);
    }
  }
  let current = obj;
  for (let i = 0; i < keys.length - 1; i++) {
    if (!(keys[i] in current)) current[keys[i]] = {};
    current = current[keys[i]];
  }
  current[keys[keys.length - 1]] = value;
}
```

### M14 — split+join del resto (cli.js:36)
```javascript
// Source: código HEAD src/cli.js:36 + dirección audit M14
// antes:  const [key, value] = opts.set.split('=');
// después:
const eq = opts.set.indexOf('=');
const key = eq === -1 ? opts.set : opts.set.slice(0, eq);
const value = eq === -1 ? undefined : opts.set.slice(eq + 1);
// idem para --map-project con indexOf(':')
```

### M12 — aceptar en/em-dash en el roadmap parser (roadmap.js:31)
```javascript
// Source: código HEAD src/gsd/roadmap.js:31 + dirección audit M12
// antes:  /^(#{2,3})\s+Phase\s+(\d+(?:\.\d+)?)(?::\s*|\s+-\s+)(.+)$/
// después: aceptar [-–—] (hyphen, en-dash, em-dash)
const re = /^(#{2,3})\s+Phase\s+(\d+(?:\.\d+)?)(?::\s*|\s+[-–—]\s+)(.+)$/;
```

### B5 — strip conservador de comillas en el parser .env (config.js:22)
```javascript
// Source: código HEAD src/config.js:19-22 + dirección audit B5
let value = trimmed.slice(eq + 1).trim();
// strip conservador: solo comillas emparejadas al inicio Y fin
if (value.length >= 2 &&
    ((value[0] === '"' && value.at(-1) === '"') ||
     (value[0] === "'" && value.at(-1) === "'"))) {
  value = value.slice(1, -1);
}
```

### HYG-07 — strip de todo \x1b en contenido externo (App.js:1696-1699)
```javascript
// Source: código HEAD src/cli/dashboard/App.js:1696-1699 (proyección de comentarios)
// El regex CSI de format.js:57 NO cubre OSC; strip amplio de C0/C1 + \x1b:
function stripControlChars(s) {
  // elimina ESC (\x1b) y bytes de control salvo \n\t; cubre OSC-52 (M4)
  return String(s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}
lines = comments.map((c) => {
  const body = c.body ?? c.text ?? c.message;
  if (body == null) return stripControlChars(JSON.stringify(c));
  return stripControlChars(c.author ? `${c.author}: ${body}` : String(body));
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Stop hook dispara efectos de cierre per-turn | Efectos en SessionEnd (cierre real) | Phase 72 HYG-04 | El README describe el comportamiento nuevo → HYG-08 delta |
| Transición a Review la hace solo el LLM | Backstop mecánico en SessionEnd | Phase 71 DELIV-04 (ya aterrizado) | HYG-04 se inserta DESPUÉS de este backstop |
| Auto-commit por heurística de cwd | Gate explícito `KODO_ORCHESTRATOR=1` | Phase 72 HYG-01 | Fin de commits fantasma en sesiones normales del repo |

**Deprecated/outdated:**
- `startHealthLoop`/`stopHealthLoop`/`runHealthCheck` (`health.js:157-184`): dead code, se borran (HYG-03). El README prometía «health check cada 60s» — mentira, se corrige en HYG-08.
- `kodo up --url` (`cli.js:75,83`): flag muerto, se borra (HYG-02).
- `config.plane.*` (schema v1) en `plane/client.js:8,10,14`: schema eliminado, se migra a `config.providers.plane.*` (B2).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | M14 se arregla en `cli.js:36,49` (`--set`/`--map-project`), NO en el parser `.env` — CONTEXT D-11 lo mislabela como «parser .env» | §Re-verificación, Pitfall #1 | Si el planner sigue D-11 literal, arregla el sitio equivocado (el `.env` ya usa `indexOf`, no `split`). Confirmar contra audit M14 literal (`cli.js:36,49`) |
| A2 | La inyección de `KODO_ORCHESTRATOR=1` vía prefijo del command string funciona porque el shell del workspace cmux exporta la var al proceso `claude` y sus hijos (hooks) | §HYG-01, Pattern 3 | Si cmux `send` no ejecuta en un shell que herede el prefijo `VAR=val cmd`, la var no llega. **Verificar empíricamente**: lanzar orquestador, comprobar `process.env.KODO_ORCHESTRATOR` en el hook. Alternativa: escribir un marcador a `~/.kodo/orchestrator.json` (ya existe `persistOrchestratorRef`) y que el hook lo lea |
| A3 | B8 tiene un solo sitio (`resolveIdentifier`); el audit citaba `parseRef` | §Re-verificación, Pitfall #2 | Si hay 2 regex de identificador, arreglar una deja la otra rota. Re-grep antes de fijar |
| A4 | Los 4 sub-items de B12 caben en diffs de ~5 líneas salvo (b) throttle epoch-vs-delta | Pitfall #6 | Si (b) requiere detección de formato de header, difiere con nota (D-02 lo permite) |
| A5 | HYG-04 no cambia rutas de hooks en `settings.json` → sin re-registro | §Runtime State Inventory | Si el movimiento implica renombrar/eliminar un hook file, habría que re-registrar. NO es el caso: solo se mueve código ENTRE `stop.js` y `session-end.js`, ambos ya registrados |

## Open Questions

1. **¿`cmux.send` con prefijo `KODO_ORCHESTRATOR=1 claude …` propaga la env var al hook?**
   - What we know: `launchOrchestrator` envía el comando como texto a un shell del workspace vía `cmux.send`; los hooks son procesos hijos de `claude`.
   - What's unclear: si el shell interpreta el prefijo `VAR=val cmd` como asignación de entorno inline (bash/zsh sí; otros shells no).
   - Recommendation: verificar empíricamente en el primer plan de HYG-01 (checkpoint). Fallback robusto: marcador en fichero (`~/.kodo/orchestrator.json` ya existe) leído por `stop.js`.

2. **¿B12(b) throttle epoch-vs-delta cabe en 5 líneas?**
   - What we know: `client.js:37` asume `_rateReset` es epoch-segundos.
   - What's unclear: si Plane self-hosted devuelve epoch o delta (Open Question #4 del audit, sin responder).
   - Recommendation: si no se puede confirmar el formato barato, difiere B12(b) con nota (D-02) en vez de adivinar.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node `node:test` runner | Tests de la fase | ✓ | built-in | — |
| `git` | HYG-01 auto-commit path + tests | ✓ (repo git) | — | — |
| cmux binary | Verificación empírica de HYG-01 (A2) / HYG-04 | ✓ (dev machine) | — | Tests con `cmux` stubeado (patrón existente en hooks tests) |

**Missing dependencies with no fallback:** Ninguna.
**Missing dependencies with fallback:** La verificación E2E de A2 (propagación de env var) requiere cmux+claude reales; el fallback es el marcador-en-fichero, testeable sin cmux.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (Node built-in) |
| Config file | none — `package.json` script `"test": "node --test $(find test -name '*.test.js' -type f)"` |
| Quick run command | `node --test test/hooks/stop-idempotency.test.js test/hooks/session-end.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HYG-01 | Auto-commit solo con `KODO_ORCHESTRATOR=1` + pathspec | unit | `node --test test/hooks/stop-idempotency.test.js` (extender) | ✅ (extender) |
| HYG-02 | `runUp` sin `--url`; `kodo up --help` no lo lista | unit | `node --test test/cli/*up*.test.js` | ❌ Wave 0 (verificar cobertura de `up`) |
| HYG-03 | `startHealthLoop` no existe; `checkHealth` intacto | unit | `node --test test/cli/health-wait.test.js` (+ nuevo grep-test de ausencia) | ✅ parcial + Wave 0 |
| HYG-04 | color/notify/nudge en SessionEnd, NO en Stop | unit | `node --test test/hooks/session-end.test.js test/stop.test.js` | ✅ (actualizar expectativas) |
| HYG-05 | M3 rechaza `__proto__`; M14 preserva `=`; B5 strip comillas; B7 deep-merge/valida; M5 chmod 0600 | unit | `node --test test/config*.test.js` (verificar/crear) | ❌ Wave 0 |
| HYG-06 | B1 opus; B2 providers.plane; B3 `!==`; B4 pad; B8 `K2-42`; B9 ruta; B12; M12 dash | unit | `node --test test/labels.test.js` + tests por subsistema | ✅ parcial + Wave 0 |
| HYG-07 | Strip `\x1b`/OSC en comentarios | unit | test nuevo de `stripControlChars` | ❌ Wave 0 |
| HYG-08 | Claims del README verdaderos POST-72 | manual-only | verificación manual del checklist (delta) | N/A |

### Sampling Rate
- **Per task commit:** `node --test <fichero del hallazgo>.test.js`
- **Per wave merge:** `npm test` (suite completa)
- **Phase gate:** Full suite green antes de `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/config-hardening.test.js` — cubre M3, M14, B5, B7, M5 (HYG-05) si no hay cobertura existente
- [ ] Grep-test de ausencia de `startHealthLoop` (HYG-03) — patrón de `labels-hygiene.test.js`
- [ ] Grep-test de ausencia de `--url` en el comando `up` (HYG-02)
- [ ] Test de `stripControlChars` con payload OSC-52 `\x1b]52;c;…\x07` (HYG-07)
- [ ] Tests por subsistema para B2/B3/B4/B8/B9/B12/M12 (algunos ya cubiertos por `labels.test.js` para B1)

## Security Domain

> `security_enforcement` no está explícitamente `false` → incluido. Esta fase es material de seguridad: cierra prototype pollution, endurece perms de secretos, y neutraliza inyección de terminal.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — (no toca auth; el bearer de Ola 1 ya está) |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | **yes** | M3 (rechazar `__proto__|constructor|prototype`), M14 (parsing correcto de `=`/`:`), B5 (strip comillas `.env`), B7 (validar config vía `config-validate.js`), M12 (parsing robusto de dash) |
| V6 Cryptography | no | — (no se hace cripto; M5 es file perms, no cripto) |
| V7 Error Handling / Logging | **yes** | Warns NDJSON never-throws (B7 warn-and-fallback); no filtrar contenido de usuario en logs (patrón DELIV-04) |
| V12 Files / Resources | **yes** | M5 (chmod 0600 del `.env` con `*_secret`) — boundary PERSIST-04 |
| V14 Config | **yes** | HYG-05 completo: endurecimiento del pipeline de config |

### Known Threat Patterns for kodo (Node CLI + hooks + Ink dashboard)

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prototype pollution vía `config --set __proto__.x=y` (M3) | Tampering | Rechazar claves `__proto__`/`constructor`/`prototype` — nunca escapar |
| Secreto `*_secret` en `.env`/`config.json` world-readable (M5) | Info Disclosure | chmod 0600 PRE-rename (patrón `writeEnvVar`); boundary PERSIST-04 |
| OSC-52 clipboard injection vía comentario de Plane (M4/HYG-07) | Tampering | Strip de `\x1b`/C1 antes de `<Text>` (ink preserva OSC) |
| Auto-commit fantasma que arrastra staged del dev (A8/HYG-01) | Tampering / Repudiation | Gate `KODO_ORCHESTRATOR=1` + pathspec `-- .claude/skills/kodo-orchestrate/` |
| Config parcial maliciosa (`max_parallel:-5`) sin validar (B7) | DoS | deep-merge sobre `DEFAULT_CONFIG` + warn-and-fallback |

## Sources

### Primary (HIGH confidence)
- Lectura directa del código HEAD (2026-07-13): `src/hooks/stop.js`, `src/hooks/session-end.js`, `src/session/health.js`, `src/config.js`, `src/config-validate.js`, `src/labels.js`, `src/orchestrator/launch.js`, `src/cli.js`, `src/cli/up.js`, `src/providers/plane/client.js`, `src/providers/registry.js`, `src/gsd/verification.js`, `src/gsd/verify.js`, `src/gsd/roadmap.js`, `src/hooks/install.js`, `src/cli/dashboard/App.js`, `src/cli/dashboard/SessionTable.js`, `src/cli/format.js`
- `.compound/AUDITORIA-ADVERSARIAL-2026-07-03.md` — fuente canónica de A8/A9, M3/M4/M5/M12/M14/M18/M19, B1-B12
- `.planning/REQUIREMENTS.md` §HYG-01..08 — contrato definitivo del batch (D-01)
- `.planning/phases/72-.../72-CONTEXT.md` — decisiones D-01..D-11
- grep de importadores (`checkHealth`/`actOnHealth`/`startHealthLoop`, `KODO_ORCHESTRATOR`, `--url`)

### Secondary (MEDIUM confidence)
- `.planning/STATE.md` — invariantes cross-milestone (cero deps npm, PERSIST-04, boundaries)

### Tertiary (LOW confidence)
- Ninguna — no se usó WebSearch (fase 100% interna, sin dominio externo que investigar)

## Metadata

**Confidence breakdown:**
- Re-verificación de hallazgos: HIGH — cada file:line leído en HEAD hoy
- Reparto Stop↔SessionEnd (HYG-04): HIGH — código + comentario reservado de Phase 71 confirman el diseño
- Inyección de `KODO_ORCHESTRATOR` (HYG-01): MEDIUM — el punto de inyección es claro, pero la propagación shell→hook necesita verificación empírica (A2/Open Question #1)
- Ubicación de M14 (parser .env vs cli.js): MEDIUM — el audit y el código apuntan a `cli.js:36,49`, pero CONTEXT D-11 lo mislabela (A1)

**Research date:** 2026-07-13
**Valid until:** 2026-07-27 (14 días — código interno estable, pero file:line derivan con cada fase; re-verificar si Phase 71 recibe más commits antes de planificar)
