# Phase 10: Orchestrator Verification Gate — Pattern Map

**Mapped:** 2026-04-22
**Files analyzed:** 8 (3 NEW código + 3 NEW tests + 4 MODIFY)
**Analogs found:** 8 / 8 (100% cobertura de analogías; zero novedad estructural)

---

## File Classification

| Archivo (NEW/MODIFY) | Rol | Flujo de datos | Analogía | Calidad |
|---|---|---|---|---|
| `src/gsd/verification.js` (NEW) | pure module | transform (YAML → verdict) | `src/gsd/roadmap.js` + `src/gsd/brief.js` | exact |
| `src/gsd/verify.js` (NEW) | orchestration module | request-response (I/O + provider) | `src/cli/gsd-inspect.js` (orquestación sin launch) + `src/triggers/dispatcher.js` (DI pattern) | role-match |
| `src/cli/gsd-verify.js` (NEW) | thin cli handler | request-response | `src/cli/gsd-inspect.js` | exact |
| `test/gsd-verification.test.js` (NEW) | test (pure parser) | n/a | `test/gsd-roadmap.test.js` + `test/gsd-brief.test.js` | exact |
| `test/gsd-verify-cli.test.js` (NEW) | test (CLI + DI mocks) | n/a | `test/gsd-inspect-cli.test.js` | exact |
| `test/gsd-verify-integration.test.js` (NEW) | test (integración tmp dir) | n/a | `test/gsd-concurrency.test.js` patrones filesystem | role-match |
| `src/cli.js` (MODIFY, líneas ~242-258) | cli router | — | Registro existente `gsd inspect` | exact |
| `src/orchestrator/prompt.md` (MODIFY, append) | orchestrator prompt | — | Secciones `##` existentes del propio archivo | exact |
| `src/orchestrator/launch.js` (MODIFY, línea 108-126 `buildContextSummary`) | orchestrator bootstrapping | — | Propia función | exact |
| `src/hooks/stop.js` (MODIFY, líneas 116-125) | hook handler (nudge text) | — | Propio bloque `cmux.send` existente | exact |

---

## Pattern Assignments

### 1. `src/gsd/verification.js` — pure module (NEW)

**Analogías primarias:**
- `src/gsd/roadmap.js` (parser puro con regex, retorna estructura tipada)
- `src/gsd/brief.js` (builder puro determinista)
- `src/gsd/resolver.js` (discriminated union `ResolveResult`)

**Header + JSDoc shape** (copiar de `src/gsd/roadmap.js:1-16` y `src/gsd/resolver.js:5-32`):
```javascript
// @ts-check

/**
 * GSD VERIFICATION.md parser + verdict computer.
 *
 * Implements CONTEXT §D-05 .. §D-10:
 *   - D-05: parses ONLY frontmatter YAML (ignores must-haves table prose).
 *   - D-06: required fields = status, must_haves_total, must_haves_verified, gaps_count.
 *   - D-07: pass = status==='passed' AND must_haves_verified===must_haves_total AND gaps_count===0.
 *   - D-09: status mapping → passed→pass, gaps_found|failed→fail, otros→malformed.
 *   - D-10: retorna discriminated union sobre `action` (pass|fail|missing|malformed).
 *
 * Pure function — zero I/O, solo regex + JSON.parse post-normalización.
 * Zero runtime deps (sin js-yaml): parser hand-rolled para 4 campos escalares.
 *
 * @typedef {{ status: string, must_haves_total: number, must_haves_verified: number, gaps_count: number }} ParsedFrontmatter
 * @typedef {{ action: 'pass', phase_id: string, must_haves: number }} PassVerdict
 * @typedef {{ action: 'fail', phase_id: string, reason: 'gaps-found'|'must-haves-incomplete'|'status-failed', detail: string }} FailVerdict
 * @typedef {{ action: 'missing', phase_id: string }} MissingVerdict
 * @typedef {{ action: 'malformed', phase_id: string, detail: string }} MalformedVerdict
 * @typedef {PassVerdict | FailVerdict | MissingVerdict | MalformedVerdict} Verdict
 */
```

**Parser shape** (excerpt referencia, `src/gsd/roadmap.js:18-44`):
```javascript
export function parseRoadmap(md) {
  const result = { phases: [] };
  if (typeof md !== 'string' || md.length === 0) return result;
  const lines = md.split('\n');
  const re = /^(#{2,3})\s+Phase\s+(\d+(?:\.\d+)?)(?::\s*|\s+-\s+)(.+)$/;
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    result.phases.push({ n: m[2], title: m[3].trim(), heading: lines[i], line: i + 1 });
  }
  return result;
}
```

**Verdict shape + exhaustive switch** (excerpt, `src/gsd/resolver.js:40-80`):
```javascript
export function resolvePhase({ projectPath, task }) {
  const projectMd = join(projectPath, '.planning', 'PROJECT.md');
  if (!existsSync(projectMd)) {
    return { action: 'bootstrap', reason: 'no-planning-dir' };
  }
  // ... fail-closed returns:
  if (matches.length === 0) return { action: 'error', code: 'no-match' };
  if (matches.length > 1) return { action: 'error', code: 'multi-match', matches: [...] };
  return { action: 'phase', phase_id: hit.n, match_heading: hit.heading, match_reason: '...' };
}
```

**Exports obligatorios:**
- `parseVerificationFrontmatter(md: string): ParsedFrontmatter | { error: string }` — lee solo el bloque entre `---` / `---` inicial, extrae 4 campos escalares, normaliza números (`parseInt`). Acepta `clave: valor`, `clave: "valor"`, `clave: 0`.
- `computeVerdict(parsed, phaseId: string): Verdict` — aplica la tabla de D-07/D-09.

**Pitfalls visibles en los análogos:**
- Guard contra input no-string al inicio (`roadmap.js:20`).
- Frontmatter malformado → NUNCA lanzar; retornar discriminated union `{ error: '...' }` que `computeVerdict` convierte en `{ action: 'malformed', detail }`.
- No usar `JSON.parse` directo sobre el bloque: extraer línea a línea (4 campos fijos) — evita ambigüedad con cadenas no comilladas.

---

### 2. `src/gsd/verify.js` — orchestration module (NEW)

**Analogía primaria:** `src/cli/gsd-inspect.js` (mismo esqueleto: DI deps + getProvider + resolve + render) — pero adaptada para **posteo efectivo a Plane** en lugar de dry-run.

**Analogía secundaria:** `src/triggers/dispatcher.js:40-50` (DI pattern con fallbacks para `getProviderFn`, `listSessionsFn`, etc).

**Imports pattern** (mezcla de `gsd-inspect.js:19-26` + `dispatcher.js:1-11`):
```javascript
// @ts-check
//
// src/gsd/verify.js — Orquestación del verification gate (CONTEXT §D-01..§D-17).
//
// Responsabilidades:
//   1. findSession({ sessionId }) → SessionRecord (task_id, task_ref, project_path, phase_id, project_id).
//   2. Leer .planning/phases/<padded>-<slug>/<padded>-VERIFICATION.md del repo destino.
//   3. computeVerdict(parsed, phase_id).
//   4. provider.getTask(task_ref) → TaskItem → addComment(task, markdown) → (si pass) updateTaskState(task, config.states.review).
//   5. orchestratorReview(logger, { phase_id, verdict, reason }).
//
// Fail-open sobre Plane (D-17): si addComment/updateTaskState tira, el verdict igual se
// emite en NDJSON (la decisión local sobrevive aunque el POST falle).

import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { findSession } from '../session/state.js';
import { loadConfig } from '../config.js';
import { initRegistry, getProvider } from '../providers/registry.js';
import { parseVerificationFrontmatter, computeVerdict } from './verification.js';
import { orchestratorReview } from '../logger-events.js';
import { createLogger } from '../logger.js';
```

**DI + fallback pattern** (copiar de `src/cli/gsd-inspect.js:50-62`):
```javascript
export async function runVerify(opts, deps = {}) {
  const getProviderFn = deps.getProviderFn || (async () => {
    await initRegistry();
    return getProvider(/** @type {any} */ (undefined));
  });
  const findSessionFn = deps.findSessionFn || findSession;
  const readFileFn = deps.readFileFn || ((p) => readFileSync(p, 'utf-8'));
  const existsFn = deps.existsFn || existsSync;
  const loggerFactory = deps.loggerFactory || ((sessionId) =>
    createLogger({ sessionId, minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info') })
      .child({ component: 'gsd' }));
  // ...
}
```

**Lectura `config.states.review` (PITFALL)** — NO existe `config.states.review` como top-level. Vive bajo `config.providers[providerName].states.review`. Patrón a copiar de `src/hooks/session-start.js:23-27`:
```javascript
const config = loadConfig();
const providerName = session.provider || config.provider;
const providerCfg = (config.providers && config.providers[providerName]) || {};
const reviewState = providerCfg.states?.review || 'In review';
```

**Resolución de la ruta VERIFICATION.md** (convención: `<padded>-<slug>/<padded>-VERIFICATION.md`, p.ej. `09-phase-resolver-bootstrap/09-VERIFICATION.md`):
```javascript
// session.phase_id = "10" → pad → "10"
// necesita descubrir el slug. Dos estrategias:
//   (a) glob-like scan de .planning/phases/<padded>-*/<padded>-VERIFICATION.md con readdirSync
//   (b) leer session.phase_id y asumir slug ya persistido (no está en SessionRecord hoy).
// Recomendación pattern-mapper: estrategia (a), similar a cómo resolver.js parsea ROADMAP.md.
// readdirSync sobre .planning/phases/ y match del prefijo padded → único directorio.
```

**Provider consumption** (`src/providers/plane/provider.js:162-185` — ya implementado, solo consumir):
```javascript
// updateTaskState espera (task, stateName)
// addComment espera (task, markdownText) — internamente convierte \n → <br>
// task debe ser el TaskItem COMPLETO (no solo ref) — se obtiene con getTask(ref).
const provider = await getProviderFn();
const task = await provider.getTask(session.task_ref);
await provider.addComment(task, commentMarkdown);
if (verdict.action === 'pass') {
  await provider.updateTaskState(task, reviewState);
}
```

**Logger evento `orchestrator.review`** — PITFALL CRÍTICO:

El helper actual (`src/logger-events.js:124-137`) exige `verdict: 'approved' | 'blocked'` (firma Phase 7 D-09), mientras que el CONTEXT de Phase 10 D-10 define `action: pass|fail|missing|malformed`. Hay dos opciones que el planner DEBE elegir explícitamente:

- **Opción A (recomendada, zero-cambio al helper):** mapear `verdict.action==='pass'` → `'approved'` y el resto → `'blocked'` al invocar. El `reason` del helper recibe el `verdict.reason` (fail) o `verdict.detail` (malformed) o literal `'missing'`.
- **Opción B:** extender la firma del helper para aceptar el verdict completo en un campo `detail`. Requiere tocar `src/logger-events.js` y actualizar tests Phase 7.

**Invocación pattern (Opción A):**
```javascript
const log = loggerFactory(session.session_id);
const verdictForLog = verdict.action === 'pass' ? 'approved' : 'blocked';
const reasonForLog = verdict.action === 'pass'
  ? 'gate-passed'
  : verdict.action === 'fail' ? verdict.reason
  : verdict.action;  // 'missing' | 'malformed'
orchestratorReview(log, { phase_id: verdict.phase_id, verdict: verdictForLog, reason: reasonForLog });
```

**Exports obligatorios:**
- `runVerify({ sessionId }, deps?): Promise<{ verdict: Verdict, plane: { commented: boolean, transitioned: boolean }, exitCode: number }>`
- Optional: helpers `renderPassComment(verdict, phaseName)`, `renderFailComment(verdict, phaseName)`, `renderMissingComment(phaseName)`, `renderMalformedComment(verdict)` — mismo patrón determinista que `buildBriefFromTask` (joined array de strings).

**Pitfalls:**
- **Idempotencia:** no deduplicar comentarios (CONTEXT §Deferred lo difiere). Aceptamos duplicados si el orquestador re-invoca.
- **Fail-open sobre Plane:** envolver `addComment`/`updateTaskState` en try/catch individuales; SIEMPRE emitir `orchestratorReview` aunque la API falle (D-17). Loggear el error con `log.error('plane.api.call.failed', { error })` para forensics.
- **El evento `plane.api.call` ya lo emite el cliente Plane internamente** — no duplicarlo aquí.

---

### 3. `src/cli/gsd-verify.js` — thin cli handler (NEW, clon de `gsd-inspect.js`)

**Analogía primaria:** `src/cli/gsd-inspect.js` (estructura calcada byte-a-byte, ajustar semántica).

**Header + export** (copiar de `gsd-inspect.js:1-50`, reemplazando responsabilidades):
```javascript
// @ts-check
//
// src/cli/gsd-verify.js — Action handler de `kodo gsd verify <session-id>`.
//
// Responsabilidades (CONTEXT §D-20, §D-21, Claude's Discretion exit codes):
//   1. findSession({ sessionId }) — delega al módulo verify.js.
//   2. Emitir verdict human-readable (default) o JSON (--json).
//   3. Exit codes (Claude's Discretion, opción A recomendada):
//        0 = gate corrió entregando cualquier verdict (pass/fail/missing/malformed).
//        1 = error interno (state.json no legible, session-id no encontrado).
//        2 = provider fetch failure (paralelo a gsd-inspect.js D-19).
//
// Read-only CLI contract: runVerify() SÍ tiene side-effects (Plane POST + NDJSON),
// pero el CLI en sí no lee filesystem fuera de lo que verify.js orquesta.

import { runVerify } from '../gsd/verify.js';

/**
 * @typedef {{ sessionId: string, json?: boolean }} RunGsdVerifyOpts
 * @typedef {{ runVerifyFn?: typeof runVerify, writeFn?: (s: string) => void, errFn?: (s: string) => void }} RunGsdVerifyDeps
 */

/**
 * @param {RunGsdVerifyOpts} opts
 * @param {RunGsdVerifyDeps} [deps]
 * @returns {Promise<number>}
 */
export async function runGsdVerify(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));
  const runVerifyFn = deps.runVerifyFn || runVerify;

  let result;
  try {
    result = await runVerifyFn({ sessionId: opts.sessionId });
  } catch (e) {
    err(`Error verifying session ${opts.sessionId}: ${/** @type {Error} */ (e).message}\n`);
    return /** conforme al mapeo de errores interno vs transient */ 1;
  }

  if (opts.json) {
    write(JSON.stringify(result, null, 2) + '\n');
  } else {
    renderHuman(result, write);
  }
  return 0;
}
```

**Human render pattern** (copiar de `gsd-inspect.js:116-164`, mismo `switch(verdict.action)` exhaustivo):
```javascript
function renderHuman(result, write) {
  const { verdict, plane } = result;
  write(`Verdict:\n`);
  switch (verdict.action) {
    case 'pass':
      write(`  action:      pass\n`);
      write(`  phase_id:    ${verdict.phase_id}\n`);
      write(`  must_haves:  ${verdict.must_haves}\n`);
      break;
    case 'fail':
      write(`  action:      fail\n`);
      write(`  reason:      ${verdict.reason}\n`);
      write(`  detail:      ${verdict.detail}\n`);
      break;
    case 'missing':
      write(`  action:      missing\n`);
      write(`  phase_id:    ${verdict.phase_id}\n`);
      break;
    case 'malformed':
      write(`  action:      malformed\n`);
      write(`  detail:      ${verdict.detail}\n`);
      break;
  }
  write(`\nPlane: commented=${plane.commented} transitioned=${plane.transitioned}\n`);
}
```

**Pitfalls:**
- **Exit code semantics:** CONTEXT Claude's Discretion ofrece dos opciones; pattern-mapper recomienda Opción A (`0=cualquier verdict, 1=error interno, 2=transient`) para alineación con `gsd-inspect.js`. El planner debe decidir con una tabla de tests y documentarla en la descripción del comando Commander.
- **Mantener el CLI thin:** toda la lógica vive en `src/gsd/verify.js`; esta capa solo es argv → delegación → render.

---

### 4. `src/cli.js` — MODIFY (registro del subcomando, líneas 242-258)

**Patrón a clonar:** ya existe el sub-grupo `gsd` en `src/cli.js:242`. Solo añadir un segundo `.command(...)` en paralelo.

**Excerpt actual** (`src/cli.js:242-258`):
```javascript
// --- kodo gsd <subcommand> ---
const gsd = program.command('gsd').description('GSD subcommands (inspect resolver, etc.)');

gsd
  .command('inspect <task-id>')
  .description('Dry-run the phase resolver for a task (read-only, no lock/state/cmux)')
  .option('--json', 'Emit structured verdict as JSON (scriptable)')
  .action(async (taskId, opts) => {
    try {
      await ensureConfig();
      const { runGsdInspect } = await import('./cli/gsd-inspect.js');
      const code = await runGsdInspect({ taskId, json: opts.json || false });
      process.exit(code);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
```

**Adición requerida (append justo después de la última línea del bloque `gsd inspect`):**
```javascript
gsd
  .command('verify <session-id>')
  .description('Verify phase closure: parses VERIFICATION.md and posts verdict to provider')
  .option('--json', 'Emit structured verdict as JSON (scriptable)')
  .action(async (sessionId, opts) => {
    try {
      await ensureConfig();
      const { runGsdVerify } = await import('./cli/gsd-verify.js');
      const code = await runGsdVerify({ sessionId, json: opts.json || false });
      process.exit(code);
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exit(1);
    }
  });
```

**Pitfall:** `program.parse()` está en `src/cli.js:260`. Cualquier comando debe registrarse ANTES de esa línea. La inserción propuesta está en línea ~258, correcta.

---

### 5. `src/orchestrator/prompt.md` — MODIFY (append sección GSD condicional)

**Analogía:** secciones `## Responsabilidades` (líneas 10-29) y `## Reglas` (47-54) del propio archivo — mismo tono imperativo español, viñetas, uso de placeholder `{{provider_name}}`.

**Excerpt actual relevante** (`src/orchestrator/prompt.md:26-45`):
```markdown
### 4. Gestionar ciclo de vida
- Cuando una sesión termina exitosamente, verifica el resultado
- Actualiza {{provider_name}} con comentarios sobre el progreso
- Descompón tareas complejas en subtareas si es necesario

## Ciclo de supervisión

Mientras haya sesiones activas, ejecuta rondas de supervisión:

1. **Leer state.json** — ver qué sesiones están corriendo
2. **Por cada sesión activa**: `cmux read-screen --workspace <ref> --lines 15`
...
6. **Revisar tareas en Review**: leer comentarios, decidir si pasan a Done
```

**Adición requerida** (después de la línea 72, al final del archivo — una sección `## Sesiones GSD` nueva, no mezclar con la tabla actual de "Responsabilidades" para mantener la sección condicional visible y auditable):
```markdown

## Sesiones GSD

Las sesiones con `gsd: true` en `state.json` siguen un flujo estructurado de fase (PROJECT.md + ROADMAP.md + PLAN.md + VERIFICATION.md). Cuando una sesión GSD termina:

1. **Lee el artefacto** — `PROJECT.md`, `ROADMAP.md` y `phases/<n>/PLAN.md` del `project_path` (usa la tool `Read` directamente).
2. **Ejecuta el gate** — `kodo gsd verify <session-id>`. El CLI lee el frontmatter de `VERIFICATION.md`, computa el verdict y postea el comentario en {{provider_name}}.
3. **Actúa según el verdict del stdout:**
   - `pass` — continúa con tu ronda normal. El CLI ya comentó y transicionó la tarea al estado Review.
   - `fail` / `missing` / `malformed` — no hagas nada manual. El CLI ya comentó el motivo estructurado. Espera a que el humano corrija `VERIFICATION.md` y re-dispare.
4. **Debugging previo al verify:** si dudas de la resolución de fase, puedes correr `kodo gsd inspect <task-id>` (dry-run del resolver).

**No dupliques el gate en comentarios manuales.** Todo el lifecycle GSD se orquesta desde el CLI; tu rol es leer los artefactos, ejecutar el verify y continuar.
```

**Pitfalls:**
- El prompt se renderiza con `resolvePromptTemplate` (`launch.js:21-29`) que sólo reemplaza `{{provider}}`, `{{provider_name}}`, `{{mcp_tool}}`. No introducir placeholders nuevos; reusar los existentes donde se mencione el sistema de tareas.
- Todo en español (consistente con el resto del prompt, D-16 de Phase 10).
- No condicionar en markdown (el prompt no tiene control flow). La sección es "condicional" en el sentido semántico: solo aplica si hay sesión con `session.gsd === true`, y el primer párrafo lo declara explícitamente.

---

### 6. `src/orchestrator/launch.js` — MODIFY (`buildContextSummary`, líneas 108-126)

**Analogía:** la propia función. Modificación quirúrgica.

**Excerpt actual** (`src/orchestrator/launch.js:103-126`):
```javascript
/**
 * Build a text summary of current state for the orchestrator
 * @param {import('../session/state.js').Session[]} sessions
 * @param {ReturnType<import('../config.js').loadConfig>} config
 */
function buildContextSummary(sessions, config) {
  const lines = [];
  const running = sessions.filter((s) => s.status === 'running');
  lines.push(`Sesiones activas: ${running.length}/${config.claude.max_parallel}`);

  if (running.length === 0) {
    lines.push('No hay sesiones corriendo.');
  } else {
    lines.push('');
    for (const s of running) {
      const elapsed = Math.floor((Date.now() - new Date(s.started_at).getTime()) / 60_000);
      lines.push(`- **${s.task_ref}**: ${s.summary}`);
      lines.push(`  Workspace: ${s.workspace_ref} | ${elapsed}min | ${s.project_path}`);
    }
  }
  return lines.join('\n');
}
```

**Patrón de modificación** — inyectar `[GSD phase N]` junto al `task_ref` cuando `session.gsd === true`:
```javascript
for (const s of running) {
  const elapsed = Math.floor((Date.now() - new Date(s.started_at).getTime()) / 60_000);
  const gsdTag = s.gsd ? ` \`[GSD phase ${s.phase_id || '?'}]\`` : '';
  lines.push(`- **${s.task_ref}**${gsdTag}: ${s.summary}`);
  lines.push(`  Workspace: ${s.workspace_ref} | ${elapsed}min | ${s.project_path}`);
}
```

**Pitfalls:**
- `s.phase_id` puede estar ausente para sesiones GSD en modo bootstrap (D-11 de Phase 9 lo omite cuando no hay phase). Usar fallback `'?'` o `'bootstrap'` según elección del planner.
- Session typedef (`src/session/state.js:12-28`) ya tiene `gsd?: boolean` y `phase_id?: string` (Phase 8 D-10 + Phase 9 D-11). Sin migración necesaria.

---

### 7. `src/hooks/stop.js` — MODIFY (nudge text, líneas 116-125)

**Analogía:** el propio bloque `cmux.send` existente. Modificación textual.

**Excerpt actual** (`src/hooks/stop.js:115-125`):
```javascript
    // Notify orchestrator if running
    try {
      const workspaces = await cmux.listWorkspaces();
      const orchMatch = workspaces.match(/(workspace:\d+)\s+kodo-orchestrator/);
      if (orchMatch) {
        await cmux.send({
          workspace: orchMatch[1],
          text: `La sesión ${session.task_ref} (${session.summary}) ha terminado y está en Review. Revisa el resultado y decide si pasa a Done o necesita más trabajo.\\n`,
        });
      }
    } catch {}
```

**Patrón de modificación** — condicionar el texto sobre `session.gsd` y nombrar el CLI:
```javascript
    // Notify orchestrator if running
    try {
      const workspaces = await cmux.listWorkspaces();
      const orchMatch = workspaces.match(/(workspace:\d+)\s+kodo-orchestrator/);
      if (orchMatch) {
        const baseText = `La sesión ${session.task_ref} (${session.summary}) ha terminado y está en Review.`;
        const actionText = session.gsd
          ? ` Es una sesión GSD (fase ${session.phase_id || 'bootstrap'}). Ejecuta \`kodo gsd verify ${session.session_id}\` y actúa según el verdict.`
          : ` Revisa el resultado y decide si pasa a Done o necesita más trabajo.`;
        await cmux.send({
          workspace: orchMatch[1],
          text: baseText + actionText + '\\n',
        });
      }
    } catch {}
```

**Pitfalls:**
- `session.gsd` es `boolean | undefined` (optional). Usar truthy check (sí lo hace).
- `session.phase_id` puede faltar (bootstrap) — mismo fallback que en launch.js.
- NO cambiar la lógica del hook. El CLI `kodo gsd verify` es el que emite el evento `orchestrator.review` y toca Plane — el hook solo menciona el comando.
- El `\\n` al final es literal (ya está así en el código existente, se manda por cmux que lo interpreta).

---

### 8. `test/gsd-verification.test.js` — test puro (NEW)

**Analogía primaria:** `test/gsd-roadmap.test.js` (parser puro con fixtures string inline).

**Analogía secundaria:** `test/gsd-brief.test.js` (rendering determinista, assert.equal sobre strings esperados).

**Setup pattern** (copiar de `test/gsd-roadmap.test.js:1-7`):
```javascript
// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parseVerificationFrontmatter, computeVerdict } from '../src/gsd/verification.js';

describe('parseVerificationFrontmatter', () => {
  it('extrae los 4 campos obligatorios de un frontmatter válido', () => {
    const md = [
      '---',
      'status: passed',
      'must_haves_total: 8',
      'must_haves_verified: 8',
      'gaps_count: 0',
      '---',
      '',
      '# cuerpo ignorado',
    ].join('\n');
    const out = parseVerificationFrontmatter(md);
    assert.equal(out.status, 'passed');
    assert.equal(out.must_haves_total, 8);
    assert.equal(out.must_haves_verified, 8);
    assert.equal(out.gaps_count, 0);
  });

  it('ignora campos extra (requirements, human_verification_needed, re_verification)', () => { /* ... */ });
  it('devuelve { error } si falta uno de los 4 campos obligatorios', () => { /* ... */ });
  it('acepta valores entrecomillados ("passed")', () => { /* ... */ });
  it('devuelve { error } si el frontmatter está ausente (no hay --- inicial)', () => { /* ... */ });
});

describe('computeVerdict', () => {
  it('retorna pass cuando status=passed, verified===total, gaps=0', () => { /* ... */ });
  it('retorna fail con reason=gaps-found cuando gaps_count > 0', () => { /* ... */ });
  it('retorna fail con reason=must-haves-incomplete cuando verified < total', () => { /* ... */ });
  it('retorna fail con reason=status-failed cuando status=failed', () => { /* ... */ });
  it('retorna malformed cuando status es desconocido', () => { /* ... */ });
});
```

**Fixture real disponible** (copiar de `.planning/phases/09-phase-resolver-bootstrap/09-VERIFICATION.md:1-25`):
```yaml
---
status: passed
phase: 09-phase-resolver-bootstrap
verified_at: 2026-04-21T12:52:00Z
re_verification: true
must_haves_total: 8
must_haves_verified: 8
overrides_applied: 0
requirements:
  - { id: GSD-02, status: verified }
gaps_count: 0
human_verification_needed: 0
previous_verification:
  previous_status: gaps_found
---
```
→ Este fixture SIRVE como test del caso "pass con campos extra": el parser debe tolerar `phase`, `verified_at`, `requirements[]`, etc. sin fallar.

**Pitfalls:**
- Node test runner nativo — no `describe.each` ni `test.fixture`; inline arrays/strings.
- `node --test` se ejecuta con `npm test` (ver `package.json`); archivos `test/*.test.js` se descubren automáticamente.

---

### 9. `test/gsd-verify-cli.test.js` — test CLI + DI mocks (NEW)

**Analogía primaria:** `test/gsd-inspect-cli.test.js` (espejo exacto de la estructura: `makeStdoutStub`, `deps` con funciones mock, assertions sobre stdout).

**Stdout stub pattern** (copiar de `test/gsd-inspect-cli.test.js:9-15`):
```javascript
function makeStdoutStub() {
  let buf = '';
  return {
    write: (s) => { buf += s; },
    get: () => buf,
  };
}
```

**Test shape** (copiar de `test/gsd-inspect-cli.test.js:45-70`, ajustando a `runGsdVerify`):
```javascript
describe('runGsdVerify — side-effect CLI (D-10 discriminated union)', () => {
  it('exits 0 y postea comentario + transition en verdict pass', async () => {
    const stdout = makeStdoutStub();
    const addCommentCalls = [];
    const updateStateCalls = [];
    const deps = {
      runVerifyFn: async ({ sessionId }) => ({
        verdict: { action: 'pass', phase_id: '10', must_haves: 8 },
        plane: { commented: true, transitioned: true },
      }),
      writeFn: stdout.write,
      errFn: () => {},
    };
    const code = await runGsdVerify({ sessionId: 'abc-123' }, deps);
    assert.equal(code, 0);
    assert.ok(stdout.get().includes('action:      pass'));
    assert.ok(stdout.get().includes('phase_id:    10'));
  });

  it('exits 0 y NO transitiona en verdict fail (D-12)', async () => { /* ... */ });
  it('exits 0 y NO transitiona en verdict missing/malformed', async () => { /* ... */ });
  it('--json emite estructura verdict + plane', async () => { /* ... */ });
  it('exits 1 cuando runVerify lanza (session not found)', async () => { /* ... */ });
});
```

**Nivel de aislamiento extra (recomendado)** — un test dedicado análogo al D-18 invariant de `test/gsd-inspect-cli.test.js:180+` que verifica:
- `updateTaskState` SOLO se llama en pass.
- `addComment` se llama SIEMPRE (pass + fail + missing + malformed, D-14).
- `orchestratorReview` se emite UNA sola vez, en todas las ramas.

---

### 10. `test/gsd-verify-integration.test.js` — test integración tmp (NEW)

**Analogía:** tests de `test/gsd-concurrency.test.js` o `test/gsd-lock.test.js` que crean tmp dirs con `mkdtempSync` y limpian al final.

**Setup pattern:**
```javascript
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('verify — integración con state.json + .planning sintético', () => {
  let tmpRoot;
  beforeEach(() => {
    tmpRoot = mkdtempSync(join(tmpdir(), 'kodo-verify-'));
    mkdirSync(join(tmpRoot, '.planning', 'phases', '10-foo'), { recursive: true });
    writeFileSync(
      join(tmpRoot, '.planning', 'phases', '10-foo', '10-VERIFICATION.md'),
      '---\nstatus: passed\nmust_haves_total: 3\nmust_haves_verified: 3\ngaps_count: 0\n---\n',
    );
  });
  afterEach(() => rmSync(tmpRoot, { recursive: true, force: true }));

  it('E2E: pass → addComment + updateTaskState + orchestratorReview(approved)', async () => {
    // Construir SessionRecord sintético en state.json temp, o mockear findSessionFn.
    // Mock TaskProvider con addComment/updateTaskState spies.
    // Capturar NDJSON con logger mock.
    // ...
  });

  it('E2E: missing (archivo no existe) → comentario missing + NO transition', async () => { /* ... */ });
});
```

**Pitfall:**
- Si escribes en `~/.kodo/state.json` real, contaminas el entorno del dev. Mejor inyectar `findSessionFn` mock y no tocar filesystem de `state.json`. Solo el árbol `.planning/` se persiste en tmp.
- Usa `node:test` beforeEach/afterEach, NO Jest/Mocha.

---

## Shared Patterns

### Shared 1: DI + Fallback Pattern (deps mocking)

**Fuente:** `src/cli/gsd-inspect.js:50-62` y `src/triggers/dispatcher.js:40-50`.

**Aplicable a:** `src/gsd/verify.js`, `src/cli/gsd-verify.js`.

```javascript
export async function fn(opts, deps = {}) {
  const getFooFn = deps.getFooFn || defaultGetFoo;
  const loggerFn = deps.loggerFn || defaultLogger;
  const writeFn = deps.writeFn || ((s) => process.stdout.write(s));
  // ... use *Fn exclusively, never the imported defaults directly.
}
```

**Por qué:** permite tests 100% determinísticos sin tocar provider real ni stdout (ver `test/gsd-inspect-cli.test.js` para 7 casos con deps inyectadas).

---

### Shared 2: Logger DI por `.child({ component })`

**Fuente:** `src/triggers/dispatcher.js:163-167`, `src/providers/plane/provider.js:25`.

**Aplicable a:** `src/gsd/verify.js`.

```javascript
const log = createLogger({
  sessionId: session.session_id,
  minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
}).child({ component: 'gsd', task_id: session.task_id });
```

- Para Phase 10 el `component` debe ser `'gsd'` (consistencia con Phase 7 D-15 + Phase 9 ya lo usa en dispatcher para eventos GSD).
- El logger hijo propaga `task_id` automáticamente a todas las entradas NDJSON.

---

### Shared 3: Fail-closed / Fail-open Error Handling

**Fail-closed (archivo ausente, frontmatter malformado):**
- `src/gsd/resolver.js:49-53` — PROJECT.md existe pero ROADMAP.md no → `{ action: 'error', code: 'roadmap-missing' }`.
- Aplicar a Phase 10: archivo VERIFICATION.md ausente → `{ action: 'missing', phase_id }`. Nunca auto-generar ni lanzar.

**Fail-open sobre I/O externo (Plane API):**
- `src/hooks/stop.js:74-80` — notify envuelto en try-catch silencioso.
- `src/triggers/dispatcher.js:156-176` — lock release + logger emit envueltos en try/catch.
- Aplicar a Phase 10: `addComment` y `updateTaskState` en try/catch individuales; el `orchestratorReview` emit siempre se ejecuta al final.

---

### Shared 4: Discriminated Union + Exhaustive Switch

**Fuente:** `src/cli/gsd-inspect.js:127-143`, `src/gsd/resolver.js:27-31`.

**Aplicable a:** `src/gsd/verification.js` (definir Verdict) + `src/gsd/verify.js` (consumir) + `src/cli/gsd-verify.js` (renderizar).

```javascript
switch (verdict.action) {
  case 'pass':      /* ... */ break;
  case 'fail':      /* ... */ break;
  case 'missing':   /* ... */ break;
  case 'malformed': /* ... */ break;
}
```

**Pitfall:** el compilador TS con `// @ts-check` detecta ramas no cubiertas. Mantener los 4 casos en los 3 consumidores. Si el planner amplía los `reason` de `fail`, ajustar el typedef.

---

### Shared 5: Zero Runtime Deps / Hand-rolled Parsers

**Principio** (PROJECT.md + CONTEXT §Implementation Decisions): solo dependencias stdlib Node.

**Evidencia:** `src/gsd/roadmap.js` — regex a mano, no micromark/remark. `src/config.js:12-28` — parser `.env` de 20 líneas, no dotenv.

**Aplicar a `src/gsd/verification.js`:** 4 campos escalares → regex simple `/^(\w+):\s*"?(.*?)"?\s*$/` línea a línea dentro del bloque `---...---`. NO incluir `js-yaml`.

---

### Shared 6: Español en prompts/comentarios, Inglés en buildGsdContext

**Fuente:** CONTEXT §D-16, Phase 8 D-04.

- `src/orchestrator/prompt.md` — español.
- `src/hooks/stop.js` notify + nudge — español.
- Comentario Plane (Phase 10 D-16) — español.
- `src/hooks/session-start.js:buildGsdContext` — inglés (Phase 8 D-04, no cambia).

**Aplicable a:**
- La sección GSD del prompt.md.
- Las plantillas de comentario en `src/gsd/verify.js` (pass/fail/missing/malformed).

---

## No Analog Found

| Archivo | Rol | Razón |
|---|---|---|
| — | — | N/A — 100% de los archivos Phase 10 tienen analogías directas en Phase 7–9. |

---

## Metadata

**Analog search scope:**
- `src/gsd/` (resolver, brief, roadmap, lock)
- `src/cli/` (gsd-inspect)
- `src/triggers/` (dispatcher)
- `src/orchestrator/` (launch, prompt)
- `src/hooks/` (stop, session-start)
- `src/session/` (state, manager)
- `src/providers/` (registry, plane/provider)
- `src/logger-events.js`, `src/config.js`, `src/interface.js`, `src/cli.js`
- `test/gsd-*.test.js`
- `.planning/phases/09-phase-resolver-bootstrap/09-VERIFICATION.md` (fixture real)

**Files scanned:** 22

**Pattern extraction date:** 2026-04-22

**Known pitfalls flagged for the planner (deben resolverse explícitamente en PLAN.md):**

1. **[PITFALL-1]** `config.states.review` NO existe como top-level. Usar `config.providers[session.provider].states?.review`, patrón de `session-start.js:23-27`.
2. **[PITFALL-2]** El helper `orchestratorReview` existente exige `verdict: 'approved' | 'blocked'` (Phase 7 D-09), no el discriminated union Phase 10. Elegir entre Opción A (map) u Opción B (extender helper). Recomendación: A.
3. **[PITFALL-3]** Ruta VERIFICATION.md requiere descubrir el **slug** del directorio (`<padded>-<slug>/<padded>-VERIFICATION.md`). `session.phase_id` solo trae el número. Usar `readdirSync(.planning/phases/)` + match prefijo padded.
4. **[PITFALL-4]** `session.phase_id` puede estar ausente en sesiones GSD en modo bootstrap (Phase 9 D-11 lo omite). Las modificaciones de `launch.js` y `stop.js` necesitan fallback.
5. **[PITFALL-5]** El evento `plane.api.call` lo emite el cliente Plane internamente. NO duplicarlo en verify.js.
6. **[PITFALL-6]** Exit codes del nuevo CLI — CONTEXT Claude's Discretion ofrece dos opciones. Recomendación pattern-mapper: Opción A (alineada con `gsd-inspect.js` D-19).
7. **[PITFALL-7]** Idempotencia del comentario Plane deferida (CONTEXT §Deferred). Aceptar duplicados si el orquestador re-invoca tras error.
