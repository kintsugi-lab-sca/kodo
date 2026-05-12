# Phase 20: HOOK-01 Universal Anti-Push-Fantasma — Pattern Map

**Mapped:** 2026-05-12
**Files analyzed:** 3 (1 modify + 2 extend)
**Analogs found:** 3 / 3 (100% exact match — all in-tree precedents)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/hooks/session-start.js` (MODIFY) | hook / context-builder | transform (session → string) | self — bifurcation Phase 12 D-04 (`buildGsdContext` 3 ramas → convergen en `lines.join('\n')`) | exact (in-place edit on same file) |
| `test/session-start.test.js` (EXTEND) | unit-test | request-response (builder I/O) | self — Phase 13 QUICK-08 coverage matrix (4 fixtures × `assert.match`) | exact (same suite to extend) |
| `test/gsd-context.test.js` (EXTEND) | unit-test | request-response (builder I/O) | self — Phase 12 D-01 bifurcation tests (3 ramas GSD) | exact (same suite to extend) |

**Nota:** los 3 files-to-modify ya existen; Phase 20 NO crea archivos nuevos. La preferencia D-04b (inline en `session-start.js`) está confirmada por RESEARCH §"Decisión helper vs inline: inline confirmado". Por tanto NO se crea `src/hooks/anti-push.js` ni `test/anti-push-isolation.test.js`.

## Pattern Assignments

### `src/hooks/session-start.js` (hook / context-builder, transform)

**Analog:** self — el archivo se modifica in-place. El patrón a copiar está YA en el archivo (Phase 12 bifurcation + convergencia post-if/else).

**Imports pattern** — sin cambios (Phase 20 NO añade imports si se mantiene inline):

`src/hooks/session-start.js:8-11` (excerpt):
```javascript
import { fileURLToPath } from 'node:url';
import { findSession } from '../session/state.js';
import { loadConfig } from '../config.js';
import { getSessionMode } from '../labels.js';
```

**Pure-builder pattern (array `lines` + `join('\n')`)** — análogo directo a Phase 12 D-04 convergencia.

`src/hooks/session-start.js:29-67` (`buildSessionContext`, no-GSD ES):
```javascript
export function buildSessionContext(session, config) {
  const providerName = session.provider || config.provider;
  // ... derivaciones de providerCfg, mcpHint, reviewState ...
  return [
    `# kodo ${session.task_ref}`,
    '',
    `Estás trabajando en **${session.task_ref}: ${session.summary}**`,
    // ... resto del prompt ES ...
    'Si no puedes terminar (falta info, hay blocker, requiere decisión humana): comenta el estado actual con detalle, **no muevas a revisión**, y cierra con `/exit`. La tarea quedará visible en el dashboard para que el humano intervenga.',
  ].join('\n');
}
```

**Phase 20 cambio HOOK-01 ES** (append literal al final del array literal, ANTES del `].join('\n')` en L67) — bytes-preserving para HOOK-02 por construcción:
```javascript
    'Si no puedes terminar (falta info, hay blocker, requiere decisión humana): comenta el estado actual con detalle, **no muevas a revisión**, y cierra con `/exit`. La tarea quedará visible en el dashboard para que el humano intervenga.',
    '',
    '## Anti-push-fantasma',
    '',
    'kodo NO hace `git push` automático. Antes de afirmar deploy, publicación o cambios remotos, verifica con `git push` real, o redacta la afirmación en condicional ("una vez se haga push…").',
    '',
    'Ejemplos:',
    '- Bad: "Feature publicada en producción."',
    '- Good: "Feature commiteada localmente, pendiente de `git push` al remoto."',
    '- Bad: "Deploy hecho."',
    '- Good: "Deploy quedará efectivo una vez se haga `git push origin main`."',
  ].join('\n');
}
```

**Bifurcación 3-ramas + convergencia post-if/else (Phase 12 D-04)** — patrón clave para HOOK-01 EN (1 append común para 3 ramas).

`src/hooks/session-start.js:83-155` (`buildGsdContext`, GSD EN):
```javascript
export function buildGsdContext(session, opts = {}) {
  const lines = [
    `# kodo ${session.task_ref} — GSD Mode`,
    // ... cabecera común a 3 ramas (L84-94) ...
  ];

  const mode = getSessionMode(session);
  if (mode === 'quick') {
    // rama quick: opcional brief + comando /gsd-quick
    if (opts.brief) { lines.push(opts.brief, ''); }
    const safeTitle = session.summary.replace(/"/g, "'");
    lines.push(/* ... */);
  } else if (session.phase_id) {
    // rama full+phase: plan/execute/verify (L122-134)
    lines.push(/* ... */);
  } else {
    // rama bootstrap: opcional brief + /gsd-new-project (L135-152)
    if (opts.brief) { lines.push(opts.brief, ''); }
    lines.push(/* ... */);
  }

  return lines.join('\n');
}
```

**Phase 20 cambio HOOK-01 EN** (append común DESPUÉS del if/else `}` de L152, ANTES del `return lines.join('\n')` de L154) — D-04 confirmado en RESEARCH §"Sitio #2":
```javascript
    );
  }

  // HOOK-01: anti-push reminder común a las 3 ramas GSD (quick / phase / bootstrap).
  // Append puro al FINAL preserva golden bytes de los bloques anteriores (HOOK-02).
  lines.push(
    '',
    '## No automatic push',
    '',
    'kodo does NOT push automatically. Before claiming a deploy, release, or any remote change, verify with a real `git push`, or phrase the claim conditionally ("once pushed…").',
    '',
    'Examples:',
    '- Bad: "Feature deployed to production."',
    '- Good: "Feature committed locally, pending `git push` to remote."',
    '- Bad: "Deploy done."',
    '- Good: "Deploy will be live once `git push origin main` runs."',
  );

  return lines.join('\n');
}
```

**JSDoc-comment style** — el patrón existente comenta cambios decisión-driven inline:

`src/hooks/session-start.js:97-110` (Phase 12 D-04/D-06 inline comments):
```javascript
    // Phase 12 D-06: quick wins over phase_id (defense in depth — dispatcher
    // already strips phase_id in quick mode per Phase 11 D-03).
    // D-03: brief FIRST when present (quick+bootstrap), command AFTER.
    // ...
    const safeTitle = session.summary.replace(/"/g, "'");
```

**Aplicar a Phase 20:** los 2 comentarios sobre el `lines.push()` del bloque EN (HOOK-01 / HOOK-02 justification) siguen este mismo estilo (`// Phase 20 HOOK-01: ...`). Mantener concisos (2 líneas).

**Sitios NO modificados** (asegurar):
- `src/hooks/session-start.js:184-186` (`main()` ternario despacho) — sin cambios.
- `src/orchestrator/launch.js:128-157` (`buildContextSummary`) — sin cambios (D-05).
- `src/orchestrator/prompt.md` — sin cambios (D-05).
- `.claude/skills/kodo-orchestrate/skill.md` — sin cambios (D-05).
- `src/labels.js` (`getSessionMode`) — sin cambios (bloque común a 3 ramas, no requiere discriminar mode).

---

### `test/session-start.test.js` (unit-test, request-response)

**Analog:** self — extender suite existente con bloques `describe('HOOK-01 ...')`. Patrón uniforme de `describe`/`it` + `node:assert/strict`.

**Imports pattern** (lines 1-10) — ya presente, NO añadir:
```javascript
// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { buildSessionContext, buildGsdContext } from '../src/hooks/session-start.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const SOURCE_PATH = join(__dirname, '..', 'src', 'hooks', 'session-start.js');
```

**Fixture pattern (`makeSession()` + `makeConfig()`)** — reusar verbatim, NO crear nuevas fixtures.

`test/session-start.test.js:15-39`:
```javascript
function makeSession(overrides = {}) {
  return {
    workspace_ref: 'KL-42',
    session_id: 'sess-abc',
    task_id: 'uuid-123',
    task_ref: 'KL-42',
    provider: 'plane',
    project_id: 'proj-1',
    summary: 'Fix bug',
    status: 'running',
    started_at: '2026-04-10T00:00:00.000Z',
    project_path: '/tmp/kl-42',
    ...overrides,
  };
}

function makeConfig(overrides = {}) {
  return {
    provider: 'plane',
    providers: { plane: { mcp_hint: 'MCP de Plane' } },
    ...overrides,
  };
}
```

**Modos cubiertos por sobrescritura directa** (RESEARCH L116-122):
- **no-GSD ES:** `makeSession()` (default sin `gsd`).
- **GSD quick:** `makeSession({ gsd: true, gsd_mode: 'quick' })` — ya existente en este archivo (L101-106 QUICK-08).

**Assert pattern uniforme** — `assert.match(ctx, /regex/)` + `assert.ok(!ctx.includes(...))`.

`test/session-start.test.js:42-46` (Test 1 canonical):
```javascript
it('Test 1: output contains session.task_ref (not session.plane_identifier)', () => {
  const session = makeSession({ task_ref: 'KL-99' });
  const context = buildSessionContext(session, makeConfig());
  assert.match(context, /KL-99/);
});
```

**QUICK-08 multi-assert pattern** (rama quick con varios checks):

`test/session-start.test.js:100-113`:
```javascript
it('QUICK-08: renders /gsd-quick "<title>" and omits /gsd-plan-phase, ...', () => {
  const session = makeSession({
    gsd: true,
    gsd_mode: 'quick',
    summary: 'TASK-X',
    task_ref: 'KL-42',
  });
  const output = buildGsdContext(session, {});
  assert.match(output, /\/gsd-quick "TASK-X"/);
  assert.ok(!output.includes('/gsd-plan-phase'), 'quick branch must not inject /gsd-plan-phase');
  // ... más asserts negativos ...
});
```

**Phase 20 nuevos tests HOOK-01 ES (no-GSD)** — añadir nuevo `describe('HOOK-01 — anti-push reminder, no-GSD ES')` tras la suite "buildSessionContext" (después de L97). Esqueleto:
```javascript
describe('HOOK-01 — anti-push reminder, no-GSD ES', () => {
  it('HOOK-01: bloque "Anti-push-fantasma" presente con header H2', () => {
    const ctx = buildSessionContext(makeSession(), makeConfig());
    assert.match(ctx, /## Anti-push-fantasma/);
  });

  it('HOOK-01: statement y ejemplo Bad/Good presentes (D-02)', () => {
    const ctx = buildSessionContext(makeSession(), makeConfig());
    assert.match(ctx, /kodo NO hace `git push` automático/);
    assert.match(ctx, /Bad:.*Feature publicada/);
    assert.match(ctx, /Good:.*pendiente de `git push`/);
  });

  it('HOOK-02: bloque al FINAL — prefix bytes intactos (opción B)', () => {
    const ctx = buildSessionContext(makeSession(), makeConfig());
    const HEADER = '## Anti-push-fantasma';
    const idx = ctx.lastIndexOf(HEADER);
    assert.ok(idx > 0, `header "${HEADER}" must be present`);
    const tail = ctx.slice(idx);
    assert.ok(tail.startsWith(HEADER), 'header must start the final block');
    const prefix = ctx.slice(0, idx);
    assert.ok(prefix.endsWith('\n\n'), 'prefix must end with blank line separator');
  });

  it('HOOK-03: idempotencia — re-emitir produce mismos bytes', () => {
    const session = makeSession();
    const a = buildSessionContext(session, makeConfig());
    const b = buildSessionContext(session, makeConfig());
    assert.equal(a, b);
  });
});
```

**Phase 20 extensión QUICK-08 EN** — añadir tests dentro de la suite existente `describe('QUICK-08 — quick mode buildGsdContext')` (tras L179):
```javascript
  it('HOOK-01 (quick): bloque "No automatic push" EN presente', () => {
    const session = makeSession({ gsd: true, gsd_mode: 'quick', summary: 'TASK-X' });
    const ctx = buildGsdContext(session, {});
    assert.match(ctx, /## No automatic push/);
    assert.match(ctx, /kodo does NOT push automatically/);
    assert.match(ctx, /Bad:.*Feature deployed/);
  });

  it('HOOK-02 (quick): bloque al FINAL — prefix bytes intactos', () => {
    const session = makeSession({ gsd: true, gsd_mode: 'quick', summary: 'TASK-X' });
    const ctx = buildGsdContext(session, {});
    const HEADER = '## No automatic push';
    const idx = ctx.lastIndexOf(HEADER);
    assert.ok(idx > 0);
    assert.ok(ctx.slice(0, idx).endsWith('\n\n'));
  });
```

---

### `test/gsd-context.test.js` (unit-test, request-response)

**Analog:** self — patrón idéntico a `test/session-start.test.js` pero con fixture `gsd: true` por defecto. Cubre las ramas full+phase y bootstrap.

**Imports pattern** (lines 1-4) — ya presente, NO añadir:
```javascript
// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { buildGsdContext } from '../src/hooks/session-start.js';
```

**Fixture GSD-default** — reusar verbatim:

`test/gsd-context.test.js:10-25`:
```javascript
function makeSession(overrides = {}) {
  return {
    workspace_ref: 'KL-42',
    // ... resto ...
    project_path: '/tmp/kl-42',
    gsd: true,  // default true en este archivo
    ...overrides,
  };
}
```

**Modos cubiertos por sobrescritura directa** (RESEARCH L116-122):
- **GSD full+phase:** `makeSession({ phase_id: '08' })` — ya existente (L41).
- **GSD bootstrap:** `makeSession({ phase_id: undefined })` — ya existente (L55).

**Assert pattern por rama** — `assert.match` para confirmar comando + `assert.ok(!includes)` para asegurar exclusiones.

`test/gsd-context.test.js:40-45` (rama phase canonical):
```javascript
it('includes GSD command sequence when phase_id is present (D-01)', () => {
  const ctx = buildGsdContext(makeSession({ phase_id: '08' }));
  assert.match(ctx, /\/gsd-plan-phase 08/);
  assert.match(ctx, /\/gsd-execute-phase 08/);
  assert.match(ctx, /\/gsd-verify-work/);
});
```

`test/gsd-context.test.js:54-58` (rama bootstrap canonical):
```javascript
it('includes bootstrap instructions when phase_id is absent (D-01 fallback)', () => {
  const ctx = buildGsdContext(makeSession({ phase_id: undefined }));
  assert.match(ctx, /\/gsd-new-project/);
  assert.ok(!ctx.includes('/gsd-plan-phase'), 'should not include plan command without phase_id');
});
```

**Phase 20 nuevos tests HOOK-01 EN (GSD)** — añadir suite `describe('HOOK-01 — anti-push reminder, GSD EN')` al final del archivo (tras L110). Esqueleto que cubre las 2 ramas residentes en este archivo (phase + bootstrap) + invariancia común:
```javascript
describe('HOOK-01 — anti-push reminder, GSD EN', () => {
  it('HOOK-01 (phase): bloque "No automatic push" presente', () => {
    const ctx = buildGsdContext(makeSession({ phase_id: '08' }));
    assert.match(ctx, /## No automatic push/);
    assert.match(ctx, /kodo does NOT push automatically/);
  });

  it('HOOK-01 (bootstrap): bloque "No automatic push" presente', () => {
    const ctx = buildGsdContext(makeSession({ phase_id: undefined }));
    assert.match(ctx, /## No automatic push/);
  });

  it('HOOK-02 (phase): bloque al FINAL — prefix bytes intactos', () => {
    const ctx = buildGsdContext(makeSession({ phase_id: '08' }));
    const HEADER = '## No automatic push';
    const idx = ctx.lastIndexOf(HEADER);
    assert.ok(idx > 0);
    assert.ok(ctx.slice(0, idx).endsWith('\n\n'));
    assert.ok(ctx.slice(idx).startsWith(HEADER));
  });

  it('HOOK-02 (bootstrap): bloque al FINAL — prefix bytes intactos', () => {
    const ctx = buildGsdContext(makeSession({ phase_id: undefined }));
    const HEADER = '## No automatic push';
    const idx = ctx.lastIndexOf(HEADER);
    assert.ok(idx > 0);
    assert.ok(ctx.slice(0, idx).endsWith('\n\n'));
  });

  it('D-04: bloque EN es bytes-idéntico en las 3 ramas GSD (common-block invariance)', () => {
    const HEADER = '## No automatic push';
    const ctxQuick = buildGsdContext(makeSession({ gsd_mode: 'quick', summary: 'TASK-X' }));
    const ctxPhase = buildGsdContext(makeSession({ phase_id: '08' }));
    const ctxBoot = buildGsdContext(makeSession({ phase_id: undefined }));
    const tail = (s) => s.slice(s.lastIndexOf(HEADER));
    assert.equal(tail(ctxQuick), tail(ctxPhase));
    assert.equal(tail(ctxPhase), tail(ctxBoot));
  });

  it('HOOK-03: idempotencia — re-emitir produce mismos bytes (phase)', () => {
    const session = makeSession({ phase_id: '08' });
    const a = buildGsdContext(session);
    const b = buildGsdContext(session);
    assert.equal(a, b);
  });
});
```

---

## Shared Patterns

### Idioma split (D-01 invariante, Phase 8 D-04 + Phase 12 QUICK-07)

**Source:** Phase 12 D-04 + Phase 8 D-04 (precedente canónico).
**Apply to:** `buildSessionContext` (ES) y `buildGsdContext` (EN) — sin cambios al contrato.

**Excerpt** — `src/hooks/session-start.js:39` (ES humano-facing):
```javascript
`Tú gestionas el ciclo completo de esta tarea: trabajar → documentar → mover a "${reviewState}" → cerrar sesión. Usa ${mcpHint} para todas las interacciones con ${providerName}.`,
```

**Excerpt** — `src/hooks/session-start.js:125-127` (EN agente-facing):
```javascript
`This is a GSD session for **phase ${session.phase_id}**.`,
'',
'Execute the following commands in order:',
```

**Test enforcement** — `test/gsd-context.test.js:66-71` (lock idiomático):
```javascript
it('context is in English (D-04)', () => {
  const ctx = buildGsdContext(makeSession({ phase_id: '05' }));
  assert.match(ctx, /Execute the following commands/);
  assert.ok(!ctx.includes('Estás trabajando'), 'must not contain Spanish instructions');
  assert.ok(!ctx.includes('Tu responsabilidad'), 'must not contain Spanish headers');
});
```

**Aplica a Phase 20:** el bloque ES vive en `buildSessionContext`, el bloque EN vive en `buildGsdContext`. NO mezclar idiomas. El test `context is in English (D-04)` seguirá pasando porque el bloque EN nuevo está enteramente en inglés.

---

### Append puro al final del array `lines` (D-03 + HOOK-02 satisfied-by-construction)

**Source:** `src/hooks/session-start.js:66-67` (`buildSessionContext` cierre actual) y `src/hooks/session-start.js:152-155` (`buildGsdContext` convergencia post-if/else).
**Apply to:** AMBOS builders. El append va DESPUÉS del último item existente y ANTES del `return ...join('\n')`.

**Justificación:** los bytes 0..N-pre-header quedan idénticos por construcción. No requiere snapshot files (Opción C descartada en RESEARCH §"Golden Bytes Verification Strategy") ni hash hardcoded (Opción A descartada).

**Excerpt** — patrón a copiar para el verifier HOOK-02 (opción B, RESEARCH L162-174):
```javascript
const HEADER = '## Anti-push-fantasma';
const idx = ctx.lastIndexOf(HEADER);
assert.ok(idx > 0, `header "${HEADER}" must be present`);
const tail = ctx.slice(idx);
assert.ok(tail.startsWith(HEADER), 'header must start the final block');
const prefix = ctx.slice(0, idx);
assert.ok(prefix.endsWith('\n\n'), 'prefix must end with blank line separator before HOOK-01 block');
```

---

### Pure-builder idempotencia (SC#3 del ROADMAP)

**Source:** convención implícita — los 2 builders son puros sin I/O ni state.
**Apply to:** AMBOS builders en sus 4 modos.

**Excerpt** — patrón canonical (RESEARCH L351-358):
```javascript
it('HOOK-03: idempotente — re-emitir produce mismos bytes', () => {
  const session = makeSession({ /* ... */ });
  const a = buildXxxContext(session);
  const b = buildXxxContext(session);
  assert.equal(a, b);
  assert.equal(a.length, b.length);
});
```

**Coste:** 2 tests (1 por builder), ~6 LOC totales.

---

### Source-hygiene grep + stripComments (Phase 13 + Phase 16) — APLICA SOLO SI helper se extrae

**Source:** `test/dispatcher-isolation.test.js:24-30` (canonical) y `test/session-start.test.js:228-232 + 289-293`.
**Apply to:** Phase 20 **NO** aplica este patrón porque RESEARCH confirma "inline" (D-04b preferencia + decisión §"Decisión helper vs inline: inline confirmado"). El patrón queda documentado por si el planner decide extraer `src/hooks/anti-push.js` (NO recomendado).

**Excerpt** — `test/dispatcher-isolation.test.js:24-30`:
```javascript
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}
```

**Excerpt** — `test/session-start.test.js:228-237` (uso en `gsdPhaseResolved` anti-invocation):
```javascript
const invocationRe = /gsdPhaseResolved\s*\(/;
const stripped = source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .split('\n')
  .filter((line) => !line.trim().startsWith('//'))
  .join('\n');
assert.ok(
  !invocationRe.test(stripped),
  'src/hooks/session-start.js must NOT invoke gsdPhaseResolved — ...',
);
```

**Aplica a Phase 20 SOLO SI:** el planner crea `src/hooks/anti-push.js` con `buildAntiPushReminder(lang)`. Entonces se añade `test/anti-push-isolation.test.js` que grepea:
- `'## Anti-push-fantasma'` en `session-start.js` con `stripComments` → debe ser 0 ocurrencias (solo en helper).
- `'## No automatic push'` ídem.
- `import { buildAntiPushReminder }` en `session-start.js` → debe estar presente.

**Recomendación firme:** mantener inline. Source-hygiene NO se crea en Phase 20.

---

### Comment-style en source (Phase 12 D-NN inline tags)

**Source:** `src/hooks/session-start.js:97-110` (Phase 12 D-06 / D-03 / D-04 inline tags).
**Apply to:** los 2 sitios de Phase 20 — añadir comentario corto `// Phase 20 HOOK-01: ...` antes del append para trazabilidad.

**Excerpt** — `src/hooks/session-start.js:97-99`:
```javascript
    // Phase 12 D-06: quick wins over phase_id (defense in depth — dispatcher
    // already strips phase_id in quick mode per Phase 11 D-03).
    // D-03: brief FIRST when present (quick+bootstrap), command AFTER.
```

**Phase 20 equivalente** (en `buildGsdContext` post-if/else):
```javascript
  // Phase 20 HOOK-01: anti-push reminder común a las 3 ramas GSD (quick / phase / bootstrap).
  // HOOK-02 satisfied-by-construction: append puro al FINAL preserva bytes anteriores.
  lines.push(
    '',
    '## No automatic push',
    // ...
  );
```

---

## No Analog Found

*(none)* — Phase 20 reusa íntegramente patrones existentes del archivo `src/hooks/session-start.js` y de las 2 suites de tests. No hay rol/data-flow nuevo. Todas las 3 modificaciones tienen analog exacto en-tree.

## Metadata

**Analog search scope:**
- `src/hooks/session-start.js` (sitio principal — leído completo).
- `test/session-start.test.js` (suite no-GSD + QUICK-08 — leído completo).
- `test/gsd-context.test.js` (suite GSD phase + bootstrap — leído completo).
- `test/dispatcher-isolation.test.js` (patrón source-hygiene comment-aware — leído completo; aplicable SOLO si se extrae helper).
- `test/format-isolation.test.js` (referencia mencionada en CONTEXT — NO aplicable en Phase 20 según RESEARCH §"Alternatives Considered": helper inline elimina necesidad de walker/grep).

**Files scanned:** 4 (3 archivos a modificar/extender + 1 referencia comment-aware grep).

**Patrón clave reusado:**
1. **Bifurcación 3-ramas con convergencia post-if/else** (Phase 12 D-04) → 1 append común para 3 ramas GSD (D-04 de Phase 20).
2. **Pure-builder con array `lines` + `.join('\n')`** → append literal de strings al final.
3. **Fixture builder `makeSession()` con sobrescrituras** → 4 modos sin nuevas fixtures.
4. **Asserts inline `assert.match` + `assert.ok(!includes)`** → no snapshot files.
5. **Opción B golden-bytes (split-on-header + prefix-invariant)** → bytes-preserving sin hash hardcoded.

**Pattern extraction date:** 2026-05-12
