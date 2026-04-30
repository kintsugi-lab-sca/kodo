# Phase 12: Hook & Orchestrator Bifurcation — Pattern Map

**Mapped:** 2026-04-28
**Files analyzed:** 4 modification sites (3 .js, 1 .md)
**Analogs found:** 4 / 4 (100% — todos los analogs existen en el repo)

> Phase 12 NO crea archivos nuevos: bifurca 3 callsites existentes y añade 1 párrafo a `prompt.md`. Las referencias canónicas son los propios archivos a modificar (Phase 10/9) y los commits Phase 11 (`7cd4b2d`, `e935a3d`, `2f65f71`) que muestran cómo `getSessionMode`/`getGsdMode` se introducen y consumen.

---

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `src/hooks/session-start.js` | hook (Claude Code SessionStart) | request-response (stdin → stdout JSON) | self (Phase 9 D-11 bootstrap branch) | exact (mismo file, mismo function) |
| `src/hooks/stop.js` | hook (Claude Code Stop) | event-driven (stop event → cmux nudge) | self (Phase 10 D-04 GSD branch) + `src/triggers/dispatcher.js:153` (switch) | exact (función) + role-match (switch) |
| `src/orchestrator/launch.js` | orchestrator launcher | transform (sessions → text summary) | self (`buildContextSummary` ternary actual) | exact (refactor inline en mismo file) |
| `src/orchestrator/prompt.md` | template (orquestador prompt) | transform (template → prompt resolved) | self (sección `## Sesiones GSD` Phase 10) | exact (mismo h2, párrafo extra) |

**Helper compartido (no se modifica, sólo se consume):**

| File | Role | Notes |
|------|------|-------|
| `src/labels.js:82` | utility (`getSessionMode`) | Phase 11 D-09 lo creó. Phase 12 es el **primer consumer**: 3 imports nuevos. |

---

## Pattern Assignments

### Site 1 — `src/hooks/session-start.js` (hook, request-response)

**Function:** `buildGsdContext(session, opts = {})` (líneas 82–128)
**Decisions:** D-01..D-06 (CONTEXT.md)

**Imports actuales** (líneas 8–10):
```js
import { fileURLToPath } from 'node:url';
import { findSession } from '../session/state.js';
import { loadConfig } from '../config.js';
```

**Import a añadir** (línea ≈11, agrupado con los otros imports relativos):
```js
import { getSessionMode } from '../labels.js';
```
> El archivo NO importa de `../labels.js` hoy. Patrón Phase 11 commit `e935a3d`: `import { parseKodoLabels, getGsdMode } from '../labels.js';` (en `manager.js:5`). Aquí basta el named import único `getSessionMode`.

**Cuerpo actual de `buildGsdContext`** (líneas 82–128, transcripción literal):
```js
export function buildGsdContext(session, opts = {}) {
  const lines = [
    `# kodo ${session.task_ref} — GSD Mode`,
    '',
    `You are working on **${session.task_ref}: ${session.summary}**`,
    `- Project path: ${session.project_path}`,
    `- Session ID: ${session.session_id}`,
    `- Work item ID: ${session.task_id} | Project ID: ${session.project_id}`,
    '',
    '## GSD Workflow',
    '',
  ];

  if (session.phase_id) {
    // Phase known — inject plan/execute/verify sequence (D-01)
    lines.push(
      `This is a GSD session for **phase ${session.phase_id}**.`,
      '',
      'Execute the following commands in order:',
      '',
      `1. \`/gsd-plan-phase ${session.phase_id}\``,
      `2. \`/gsd-execute-phase ${session.phase_id}\``,
      `3. \`/gsd-verify-work\``,
      '',
      'Do NOT comment your plan manually or move the task state — GSD manages the full cycle.',
    );
  } else {
    // No phase — bootstrap mode (D-01 fallback).
    // D-11: brief FIRST, commands AFTER. Claude reads the brief, then executes
    // the bootstrap command. If brief is absent (legacy sessions or non-GSD
    // bootstrap paths), skip the brief block entirely — never render a blank section.
    if (opts.brief) {
      lines.push(opts.brief, '');
    }
    lines.push(
      'No `.planning/` directory detected or no phase resolved for this task.',
      '',
      'Run the bootstrap command:',
      '',
      '1. `/gsd-new-project`',
      '',
      'This will initialize the project planning structure using the task description as brief.',
    );
  }

  return lines.join('\n');
}
```

**Patrón "brief FIRST, comando AFTER" (D-11 Phase 9 — para replicar en quick branch)** (líneas 113–115 verbatim):
```js
if (opts.brief) {
  lines.push(opts.brief, '');
}
```
> Phase 12 D-03: el branch quick replica este patrón cuando `session.brief` existe (caso quick+bootstrap). En quick+match, `session.brief` no se persistió (dispatcher lo descarta) — el bloque `if (opts.brief)` simplemente no ejecuta y se cae directo al comando.

**Estructura objetivo del switch** (CONTEXT.md D-06 — el branch quick gana sobre `phase_id`):
```js
const mode = getSessionMode(session);
if (mode === 'quick') {
  // D-03: brief FIRST si existe (quick+bootstrap), comando AFTER.
  if (opts.brief) {
    lines.push(opts.brief, '');
  }
  // D-04: safe-title con replace simple " → ' antes de envolver.
  const safeTitle = session.summary.replace(/"/g, "'");
  lines.push(
    'This is a one-shot GSD session.',
    '',
    'Execute the slash command:',
    '',
    `1. \`/gsd-quick "${safeTitle}"\``,
    '',
    // D-05: cierre que justifica el bloque de un solo comando.
    'This is a one-shot GSD session. Run the slash command and finish — no plan/execute/verify cycle.',
  );
} else if (session.phase_id) {
  // … bloque actual líneas 96–107 sin cambios …
} else {
  // … bloque actual líneas 109–124 sin cambios (incluye opts.brief existente) …
}
```
> El planner debe respetar la D-05: la frase de cierre va **dentro** del array `lines.push(...)` del case quick, no fuera. Idioma EN preservado (D-04 Phase 8).

**Punto de inserción exacto:** entre línea 93 (cierre del array `lines = [...]`) y línea 95 (`if (session.phase_id) {`). El `const mode = getSessionMode(session);` va justo antes del primer `if` de la cadena.

**Llamada existente desde `main()`** (líneas 157–159, no se toca — `getSessionMode(session)` recibe la session entera y aplica la regla legacy internamente):
```js
const context = session.gsd
  ? buildGsdContext(session, { brief: session.brief })
  : buildSessionContext(session, loadConfig());
```

---

### Site 2 — `src/hooks/stop.js` (hook, event-driven)

**Function:** `buildStopNudgeText(session)` (líneas 39–46)
**Decisions:** D-07, D-08, D-09, D-10 (CONTEXT.md)

**Imports actuales** (líneas 12–16):
```js
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { findSession, removeSession } from '../session/state.js';
import * as cmux from '../cmux/client.js';
import { colorForStatus } from '../cmux/colors.js';
```

**Import a añadir** (línea ≈14, NO existe import previo de `../labels.js` en este archivo):
```js
import { getSessionMode } from '../labels.js';
```
> Primer consumer de `labels.js` desde `stop.js` — confirma D-12 Phase 8 ("helper en labels.js + consumer downstream"). Pegado al grupo de imports relativos `../`.

**Cuerpo actual de `buildStopNudgeText`** (líneas 39–46, transcripción literal):
```js
export function buildStopNudgeText(session) {
  const base = `La sesión ${session.task_ref} (${session.summary}) ha terminado y está en Review.`;
  if (session.gsd) {
    const phaseLabel = session.phase_id ? `fase ${session.phase_id}` : 'bootstrap';
    return `${base} Es una sesión GSD (${phaseLabel}). Ejecuta \`kodo gsd verify ${session.session_id}\` y actúa según el verdict.\\n`;
  }
  return `${base} Revisa el resultado y decide si pasa a Done o necesita más trabajo.\\n`;
}
```

**Analog de switch en codebase — `src/triggers/dispatcher.js:153`** (estructura a imitar):
```js
switch (resolverVerdict.action) {
  case 'phase':
    // … rama 1 …
    break;
  case 'bootstrap':
    // … rama 2 …
    break;
  case 'error':
    // … rama 3 …
    break;
}
```
> Patrón también visible en `src/cli/gsd-verify.js:92`, `src/cli/gsd-inspect.js:127`, `src/gsd/verify.js:303,342` y `src/session/health.js:102`. **Convención del codebase**: switch sobre string discriminator, cada case termina con `break`, sin `default` explícito cuando los cases agotan el dominio. En Phase 12 D-07, el dominio incluye `null` (no-GSD) → **sí** se necesita `default`.

**Estructura objetivo del switch** (D-07: switch exhaustivo sobre `getSessionMode(session)`):
```js
export function buildStopNudgeText(session) {
  const base = `La sesión ${session.task_ref} (${session.summary}) ha terminado y está en Review.`;
  switch (getSessionMode(session)) {
    case 'quick':
      // D-08: texto ES, sin sugerir verify. Preserva escape literal `\\n` (D-04 Phase 10 + Phase 12 <specifics>).
      return `${base} Es una sesión GSD quick (one-shot, sin VERIFICATION.md). Revísala manualmente como cualquier sesión no-GSD.\\n`;
    case 'full': {
      // Texto Phase 10 D-04 preservado literal.
      const phaseLabel = session.phase_id ? `fase ${session.phase_id}` : 'bootstrap';
      return `${base} Es una sesión GSD (${phaseLabel}). Ejecuta \`kodo gsd verify ${session.session_id}\` y actúa según el verdict.\\n`;
    }
    default:
      // null → sesión no-GSD. Texto original preservado.
      return `${base} Revisa el resultado y decide si pasa a Done o necesita más trabajo.\\n`;
  }
}
```
> **Pitfall**: el escape `\\n` final es **literal** (dos caracteres: `\` + `n`). `cmux.send` lo interpreta para enviar Enter. NO cambiar a `\n` (newline real) — patrón establecido en stop.js Phase 10 D-04 y replicado en `launch.js:54,90`.

**Lock release queda inalterado** (líneas 127–134, **NO TOCAR**):
```js
if (session.gsd) {
  try {
    const { releaseGsdLock } = await import('../gsd/lock.js');
    releaseGsdLock(session.project_path, session.session_id);
  } catch (err) {
    console.error(`[kodo:stop] Error releasing GSD lock: ${err.message}`);
  }
}
```
> D-10: `session.gsd === true` para ambos modos (quick y full) por D-04 Phase 11. La condición sigue cubriendo quick correctamente sin cambios.

---

### Site 3 — `src/orchestrator/launch.js` (orchestrator, transform)

**Function:** `buildContextSummary(sessions, config)` (líneas 108–129), específicamente el cómputo del `gsdTag` en línea 122.
**Decisions:** D-11, D-12, D-13 (CONTEXT.md)

**Imports actuales** (líneas 1–8):
```js
// @ts-check
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../config.js';
import { listSessions } from '../session/state.js';
import * as cmux from '../cmux/client.js';
```

**Import a añadir** (línea ≈8, NO existe import previo de `../labels.js`):
```js
import { getSessionMode } from '../labels.js';
```
> Primer consumer de `labels.js` desde `orchestrator/launch.js`. Pegado al grupo de imports relativos.

**Bloque actual del `gsdTag`** (líneas 117–125, transcripción literal):
```js
} else {
  lines.push('');
  for (const s of running) {
    const elapsed = Math.floor((Date.now() - new Date(s.started_at).getTime()) / 60_000);
    // Phase 10 D-19: taggear sesiones GSD para que el orquestador las identifique.
    // Pitfall #4: phase_id puede estar ausente en modo bootstrap (Phase 9 D-11).
    const gsdTag = s.gsd ? ` \`[GSD ${s.phase_id ? `phase ${s.phase_id}` : 'bootstrap'}]\`` : '';
    lines.push(`- **${s.task_ref}**${gsdTag}: ${s.summary}`);
    lines.push(`  Workspace: ${s.workspace_ref} | ${elapsed}min | ${s.project_path}`);
  }
}
```

**Línea 122 verbatim — la única que cambia:**
```js
const gsdTag = s.gsd ? ` \`[GSD ${s.phase_id ? `phase ${s.phase_id}` : 'bootstrap'}]\`` : '';
```

**Reemplazo objetivo (D-11 — mode-first con `inner` local, inline, sin extraer helper per D-12):**
```js
// Phase 12 D-11: prioridad mode-first. Una sesión quick con phase_id residual
// (defensa en profundidad — el dispatcher ya descarta phase_id en quick por
// D-03 Phase 11) renderiza [GSD quick], no [GSD phase N].
let gsdTag = '';
if (s.gsd) {
  const mode = getSessionMode(s);
  const inner = mode === 'quick' ? 'quick' : (s.phase_id ? `phase ${s.phase_id}` : 'bootstrap');
  gsdTag = ` \`[GSD ${inner}]\``;
}
```
> D-13: sesiones no-GSD (`s.gsd` falsy) siguen sin tag (`gsdTag = ''` inicial). Status quo Phase 10 D-19 preservado. NO se introduce `[no-GSD]`.

**El comentario "Phase 10 D-19" + "Pitfall #4" sobre el `gsdTag` (líneas 120–121) debe actualizarse** para citar D-11 Phase 12 + nota sobre defensa en profundidad. Decisión de redacción al planner.

---

### Site 4 — `src/orchestrator/prompt.md` (template, transform)

**File:** `src/orchestrator/prompt.md` — sección `## Sesiones GSD` (líneas 75–88).
**Decisions:** D-14, D-15, D-16, D-17 (CONTEXT.md)

**Sección actual completa** (líneas 75–88, transcripción literal):
```markdown
## Sesiones GSD

Las sesiones con `gsd: true` en `state.json` siguen un flujo estructurado de fase (`PROJECT.md` + `ROADMAP.md` + `PLAN.md` + `VERIFICATION.md`). Cuando una sesión GSD termina y entra a Review:

1. **Lee los artefactos** — `PROJECT.md`, `ROADMAP.md` y `phases/<n>/PLAN.md` del `project_path` de la sesión (usa la tool `Read` directamente).
2. **Ejecuta el gate** — `kodo gsd verify <session-id>`. El CLI lee el frontmatter de `VERIFICATION.md`, computa el verdict y postea el comentario en {{provider_name}}.
3. **Actúa según el verdict del stdout:**
   - `pass` — continúa con tu ronda normal. El CLI ya comentó la tarea y la transicionó a Review.
   - `fail` — el CLI ya comentó el motivo (gaps, must-haves incompletos, o status=failed). Espera a que el humano corrija `VERIFICATION.md` y re-dispare.
   - `missing` — el CLI ya comentó pidiendo que se ejecute `/gsd-verify-work`. No hagas nada manual.
   - `malformed` — el CLI ya comentó con el detalle del error del frontmatter. Espera corrección humana.
4. **Debugging previo al verify:** si dudas de la resolución de fase, puedes correr `kodo gsd inspect <task-id>` (dry-run del resolver).

**No dupliques el gate en comentarios manuales.** Todo el lifecycle GSD se orquesta desde el CLI; tu rol es leer los artefactos, ejecutar el verify y continuar con la siguiente ronda de supervisión.
```

**Anchor de inserción (D-15):** después de la línea 88 (cierre `…ronda de supervisión.`) y antes del EOF (no hay más secciones después).

**Párrafo a insertar (D-16, contenido verbatim per CONTEXT.md):**
```markdown

**Sesiones quick.** Las sesiones lanzadas por `kodo:gsd-quick` aparecen en la pizarra como `[GSD quick]`. Son one-shot (sin `VERIFICATION.md`), por eso **NO ejecutes `kodo gsd verify`** sobre ellas — el CLI no las soporta. Revísalas manualmente como cualquier sesión no-GSD: lee el comentario final del agente, valida en {{provider_name}} y decide si pasa a Done o necesita más trabajo.
```
> **Pre-condición**: línea en blanco entre el párrafo "**No dupliques el gate…**" (línea 88) y "**Sesiones quick.**" para que Markdown renderice como párrafo separado, no como continuación. El bloque de arriba ya empieza con línea en blanco.
>
> **D-17**: el placeholder `{{provider_name}}` ya lo resuelve `resolvePromptTemplate` en `launch.js:21–29`. **NO** se introducen placeholders nuevos.
>
> **D-15 sobre tipografía**: negrita sólo en `**Sesiones quick.**` y en `**NO ejecutes \`kodo gsd verify\`**` — preserva la economía visual del resto de la sección donde sólo `**No dupliques…**` lleva negrita.

**Diff conceptual (referencia visual para el planner):**
- Líneas 1–88: literal, **sin un cambio**.
- Línea 89 (nueva): blanco.
- Línea 90 (nueva): el párrafo D-16.
- EOF (sin trailing newline extra — preservar lo que `prompt.md` ya tiene).

---

## Shared Patterns

### S1 — "Helper en `labels.js` + consumer downstream"

**Source:** `src/labels.js:82` (`getSessionMode`)
**Phase 11 commit:** `7cd4b2d` (`feat(labels): add getGsdMode + getSessionMode helpers (11-01)`)
**Apply to:** Sites 1, 2, 3 (los 3 archivos `.js` modificados).

**Definición canónica del helper** (`src/labels.js:82–85`, verbatim):
```js
export function getSessionMode(session) {
  if (!session?.gsd) return null;
  return session.gsd_mode || 'full';
}
```

**Patrón de import** — visto en `src/triggers/dispatcher.js:5` (Phase 11 commit `2f65f71`):
```js
import { parseKodoLabels, getGsdMode } from '../labels.js';
```
y en `src/session/manager.js:5` (Phase 11 commit `e935a3d`):
```js
import { parseKodoLabels, getGsdMode } from '../labels.js';
```
> Phase 12 imports son named imports puros, agrupados con los demás `../` relativos. Sites 2 y 3 (stop.js, launch.js) **introducen** el primer import desde `labels.js` en esos archivos — no hay grupo previo.

**Anti-patrón explícitamente prohibido (Phase 12 `<specifics>`):** inline `session.gsd_mode || 'full'` en cualquier callsite. Phase 11 D-09/D-10 lo prohibió específicamente. Siempre `getSessionMode(session)`.

---

### S2 — "Brief FIRST, comando AFTER en bootstrap" (D-11 Phase 9)

**Source:** `src/hooks/session-start.js:113–115` (bootstrap branch actual)
**Apply to:** Site 1 sólo (rama quick de `buildGsdContext`).

**Excerpt verbatim:**
```js
if (opts.brief) {
  lines.push(opts.brief, '');
}
lines.push(
  // … comando aquí …
);
```
> Phase 12 D-03: replicar este orden literal en el case `mode === 'quick'`. La frase de cierre D-05 va al final del `lines.push(...)` del comando, no entre `brief` y el comando.

---

### S3 — "Idioma EN para hooks que escribe el agente; ES para texto humano"

**Source:** D-04 Phase 8 + D-16 Phase 10 + D-04 Phase 12.

| File | Idioma | Texto a añadir Phase 12 |
|------|--------|------------------------|
| `src/hooks/session-start.js` | EN (Claude lo lee) | EN — `"This is a one-shot GSD session…"` (D-05) |
| `src/hooks/stop.js` | ES (orquestador humano) | ES — `"Es una sesión GSD quick (one-shot, sin VERIFICATION.md). Revísala manualmente…"` (D-08) |
| `src/orchestrator/prompt.md` | ES (orquestador) | ES — `"**Sesiones quick.** Las sesiones lanzadas por \`kodo:gsd-quick\`…"` (D-16) |
| `src/orchestrator/launch.js` (tag) | EN (`[GSD quick]` literal) | EN — palabra `quick` dentro del tag, sin frase (D-11) |

---

### S4 — "Switch exhaustivo sobre helper de modo" (patrón nuevo D-07 Phase 12)

**Source canonical:** se introduce en Site 2 (`stop.js`).
**Analog estructural existente:** `src/triggers/dispatcher.js:153` (switch sobre `resolverVerdict.action`).

**Forma canónica:**
```js
switch (getSessionMode(session)) {
  case 'quick':
    return /* … */;
  case 'full':
    return /* … */;
  default:
    return /* null → no-GSD */;
}
```
> Phase 13 (test coverage matrix) **probará los 4 estados** sobre este patrón: legacy `gsd:true` sin `gsd_mode`, `gsd:true + gsd_mode:'full'`, `gsd:true + gsd_mode:'quick'`, `gsd:false`. La regla "ausente == full" la aplica el helper, no el switch.

---

### S5 — "Inline computation hasta que YAGNI exija extracción" (D-12 Phase 12)

**Source:** D-12 Phase 12.
**Apply to:** Site 3 (`launch.js`, cómputo del `gsdTag`).

**Implicación práctica:** `let gsdTag = ''; if (s.gsd) { const mode = …; const inner = …; gsdTag = …; }` queda **inline** dentro de `buildContextSummary`. NO se extrae a `buildGsdTag(session)` exportable. Si Phase 13 necesita testearlo aislado, se extrae entonces — un solo callsite hoy.

---

### S6 — Escape literal `\\n` en `cmux.send` text

**Source:** `src/hooks/stop.js:43` y `src/hooks/stop.js:45` (Phase 10 D-04).
**Apply to:** Site 2 (case `quick` en `buildStopNudgeText` debe terminar igual).

**Excerpt verbatim:**
```js
return `${base} … y actúa según el verdict.\\n`;
```
> El doble-backslash es **literal en el código fuente** (= un solo `\` real en runtime + `n`). `cmux.send` interpreta `\n` como Enter. Otros callsites del mismo patrón: `src/orchestrator/launch.js:54` (`'Revisa el estado actual…\\n'`) y `:90` (`claudeCmd + '\\n'`). NO normalizar a `\n` (template literal real) — rompería el envío.

---

## No Analog Found

Ninguno. Los 4 modification sites tienen analogs en el propio archivo o en `src/triggers/dispatcher.js` (switch). No se introducen archivos nuevos ni patrones sin precedente en el repo.

---

## Reference Commits (Phase 11)

Estos commits muestran cómo se introdujeron `getGsdMode` y `getSessionMode` y cómo se consumen en `manager.js`/`dispatcher.js`. Phase 12 replica el mismo patrón de import + consumo en hooks/orchestrator.

| Commit  | Resumen | Lección para Phase 12 |
|---------|---------|----------------------|
| `7cd4b2d` | `feat(labels): add getGsdMode + getSessionMode helpers (11-01)` | Define el helper. Phase 12 sólo lo importa, no lo modifica. |
| `e935a3d` | `feat(session): persist gsd_mode and unify skipPerms via getGsdMode (11-02)` | Patrón de import desde `labels.js` + uso del helper para derivar localmente sin crecer firmas. |
| `2f65f71` | `feat(dispatcher): emit mode field on GSD telemetry + lift gsd.bootstrap (11-03)` | El switch sobre `resolverVerdict.action` (`dispatcher.js:153`) sirve de analog estructural para el switch nuevo en `stop.js`. |

---

## Metadata

**Analog search scope:** `src/hooks/`, `src/orchestrator/`, `src/triggers/`, `src/session/`, `src/cli/`, `src/labels.js`, `src/gsd/`
**Files scanned:** 5 archivos a modificar leídos completos + `dispatcher.js` (switch analog) + `manager.js` (helper consumer analog)
**Pattern extraction date:** 2026-04-28
**Granularidad sugerida (no vinculante per CONTEXT.md `<discretion>`):** 4 plans (uno por modification site) o 2 plans (`hooks-bifurcation` agrupando sites 1+2, `orchestrator-visibility` agrupando sites 3+4). El planner decide en `/gsd-plan-phase 12` siguiendo dependencias: site 4 depende implícitamente de site 3 (el párrafo cita el tag `[GSD quick]`), pero ambos pueden entregarse en commits separados sin romper invariantes.
