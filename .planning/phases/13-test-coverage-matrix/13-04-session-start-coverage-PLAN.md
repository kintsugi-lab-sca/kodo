---
phase: 13-test-coverage-matrix
plan: 04
type: execute
wave: 1
depends_on: []
files_modified:
  - test/session-start.test.js
autonomous: true
requirements: [QUICK-08]
threat_model: "N/A — test coverage only, no production code changes"

must_haves:
  truths:
    - "test/session-start.test.js cubre la rama quick de buildGsdContext: inyecta /gsd-quick \"<safe-title>\" + omite /gsd-plan-phase, /gsd-execute-phase, /gsd-verify-work, /gsd-new-project"
    - "test/session-start.test.js cubre el escape de comillas en title (Phase 12 D-04): summary 'TASK-X \"with quotes\"' produce '/gsd-quick \"TASK-X 'with quotes'\"'"
    - "test/session-start.test.js cubre quick + brief: brief renderiza FIRST, comando AFTER (Phase 12 D-03 simétrico con D-11 Phase 9)"
    - "test/session-start.test.js source-hygiene rechaza inline `session.gsd_mode || 'full'` (Phase 13 D-09)"
    - "test/session-start.test.js source-hygiene rechaza acceso directo `.gsd_mode` en session-start.js (Phase 13 D-10) — debe usar getSessionMode"
    - "node --test test/session-start.test.js corre sin fallos"
  artifacts:
    - path: "test/session-start.test.js"
      provides: "Cobertura behavior buildGsdContext rama quick"
      contains: "describe('QUICK-08 — quick mode buildGsdContext')"
    - path: "test/session-start.test.js"
      provides: "Source-hygiene anti-inline + anti-acceso directo"
      contains: "/session\\\\.gsd_mode\\\\s\\*\\\\|\\\\|"
  key_links:
    - from: "test/session-start.test.js"
      to: "src/hooks/session-start.js:83-122 (buildGsdContext rama mode === 'quick')"
      via: "import { buildGsdContext } from '../src/hooks/session-start.js'"
      pattern: "buildGsdContext.*gsd_mode.*quick"
    - from: "test source-hygiene QUICK-08"
      to: "src/hooks/session-start.js (regex sobre source)"
      via: "readFileSync(SOURCE_PATH)"
      pattern: "getSessionMode"
---

<objective>
Cubrir con tests automatizados la rama `mode === 'quick'` de `buildGsdContext` en `src/hooks/session-start.js` (líneas 96-121) — la nueva sección Phase 12 — más dos invariantes source-hygiene (Phase 13 D-09, D-10) que protegen contra regresiones DRY donde alguien lea `gsd_mode` inline en vez de usar el helper `getSessionMode`. Cierra el success criterion 4 del ROADMAP Phase 13.

Purpose: Phase 12 introdujo el branch quick que (1) inyecta `/gsd-quick "<safe-title>"` con escape de comillas dobles → simples (D-04), (2) renderiza brief FIRST cuando existe (D-03), (3) añade frase de cierre "Run the slash command and finish — no plan/execute/verify cycle." (D-05), (4) tiene prioridad sobre `phase_id` residual (D-06). Hoy `test/session-start.test.js` sólo cubre la firma vieja y el comportamiento Phase 9 — sin estos tests, una regresión que rompa el branch quick (e.g., olvidar el escape de quotes, o invertir el orden brief/comando) pasaría sin detectar.

Output: Un nuevo describe `'QUICK-08 — quick mode buildGsdContext'` con tests behavior, más extensión del describe `'session-start.js — source invariants'` (líneas 99-185) con 2 tests source-hygiene QUICK-08.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/13-test-coverage-matrix/13-CONTEXT.md
@.planning/phases/12-hook-orchestrator-bifurcation/12-CONTEXT.md
@.planning/codebase/TESTING.md

<interfaces>
<!-- Firma + ramas exactas de buildGsdContext (de src/hooks/session-start.js, leído en planning) -->

From src/hooks/session-start.js (líneas 83-155):
```javascript
export function buildGsdContext(session, opts = {}) {
  const lines = [
    `# kodo ${session.task_ref} — GSD Mode`,
    '',
    `You are working on **${session.task_ref}: ${session.summary}**`,
    // ... header común ...
    '## GSD Workflow',
    '',
  ];

  const mode = getSessionMode(session);  // <-- Phase 12: usa el helper
  if (mode === 'quick') {
    if (opts.brief) {
      lines.push(opts.brief, '');
    }
    const safeTitle = session.summary.replace(/"/g, "'");  // <-- D-04 escape
    lines.push(
      'This is a one-shot GSD session.',
      '',
      'Execute the slash command:',
      '',
      `1. \`/gsd-quick "${safeTitle}"\``,
      '',
      'Run the slash command and finish — no plan/execute/verify cycle.',  // <-- D-05 cierre
    );
  } else if (session.phase_id) {
    // rama full + match
  } else {
    // rama full + bootstrap
  }
  return lines.join('\n');
}
```

From test/session-start.test.js (líneas 1-29, fixture existente makeSession):
```javascript
import { buildSessionContext } from '../src/hooks/session-start.js';  // <-- HAY que añadir buildGsdContext

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
```

From test/session-start.test.js líneas 99-185 (describe 'source invariants' a extender con D-09, D-10):
- Patrón existente: `const source = readFileSync(SOURCE_PATH, 'utf-8');` a nivel describe
- Test referencia con mensaje de fallo: línea 127 "Hardcoded 'Plane' found in non-comment line: ..." (modelo para el wording de los nuevos)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Añadir describe('QUICK-08 — quick mode buildGsdContext') con behavior tests (cadena + escape + brief order)</name>
  <files>test/session-start.test.js</files>

  <read_first>
    - test/session-start.test.js (estado actual: import sólo de buildSessionContext línea 7, fixture makeSession líneas 15-29; hay que extender import)
    - src/hooks/session-start.js líneas 83-155 (firma `buildGsdContext(session, opts = {})`, branch quick líneas 96-121)
    - .planning/phases/13-test-coverage-matrix/13-CONTEXT.md (D-08 behavior dominante; D-13 nuevo bloque QUICK-08; D-14 prefijo; <specifics> párrafo 2 fixture exacto del escape)
    - .planning/phases/12-hook-orchestrator-bifurcation/12-CONTEXT.md (D-03 brief FIRST, D-04 escape, D-05 cierre, D-06 prioridad mode sobre phase_id)
  </read_first>

  <behavior>
    - Test 1 (renders quick command, omits full chain): session con `gsd:true, gsd_mode:'quick', summary:'TASK-X'` → output contiene `/gsd-quick "TASK-X"` Y NO contiene `/gsd-plan-phase`, `/gsd-execute-phase`, `/gsd-verify-work`, `/gsd-new-project`
    - Test 2 (closing line D-05): mismo input → output contiene `Run the slash command and finish — no plan/execute/verify cycle.`
    - Test 3 (escape de quotes D-04): `summary: 'TASK-X "with quotes"'` → output contiene literal `/gsd-quick "TASK-X 'with quotes'"` (comillas dobles internas → simples)
    - Test 4 (brief FIRST D-03): session quick + `opts: {brief: '## Project Brief\n\nFoo'}` → output tiene la posición del brief ANTES de la posición de `/gsd-quick`
    - Test 5 (no brief sin opts.brief): session quick sin opts.brief → output NO contiene `## Project Brief` ni renderiza bloque vacío
    - Test 6 (header común D-01): output contiene `# kodo TASK-X — GSD Mode` (mismo header que ramas full)
    - Test 7 (D-06: quick wins over phase_id residual): session con `gsd:true, gsd_mode:'quick', phase_id:'9', summary:'TASK-X'` → output contiene `/gsd-quick "TASK-X"` Y NO contiene `/gsd-plan-phase 9`
  </behavior>

  <action>
    1. Modificar el import en línea 7 de `test/session-start.test.js` para incluir `buildGsdContext`:
       ```javascript
       import { buildSessionContext, buildGsdContext } from '../src/hooks/session-start.js';
       ```

    2. Antes del describe `'session-start.js — source invariants'` (línea 99) — es decir, después del cierre del describe `'session-start.js — buildSessionContext'` (línea 97 `});`) — AÑADIR un nuevo describe (D-13: nuevo bloque aislado para escenario nuevo Phase 12):

       ```javascript

       describe('QUICK-08 — quick mode buildGsdContext', () => {
         it('QUICK-08: renders /gsd-quick "<title>" and omits /gsd-plan-phase, /gsd-execute-phase, /gsd-verify-work, /gsd-new-project', () => {
           const session = makeSession({
             gsd: true,
             gsd_mode: 'quick',
             summary: 'TASK-X',
             task_ref: 'KL-42',
           });
           const output = buildGsdContext(session, {});
           assert.match(output, /\/gsd-quick "TASK-X"/);
           assert.ok(!output.includes('/gsd-plan-phase'), 'quick branch must not inject /gsd-plan-phase');
           assert.ok(!output.includes('/gsd-execute-phase'), 'quick branch must not inject /gsd-execute-phase');
           assert.ok(!output.includes('/gsd-verify-work'), 'quick branch must not inject /gsd-verify-work');
           assert.ok(!output.includes('/gsd-new-project'), 'quick branch must not inject /gsd-new-project (bootstrap is full-only)');
         });

         it('QUICK-08: includes closing line "Run the slash command and finish — no plan/execute/verify cycle." (Phase 12 D-05)', () => {
           const session = makeSession({ gsd: true, gsd_mode: 'quick', summary: 'TASK-X' });
           const output = buildGsdContext(session, {});
           assert.match(
             output,
             /Run the slash command and finish — no plan\/execute\/verify cycle\./,
             'D-05 closing line must justify why quick block has a single command',
           );
         });

         it('QUICK-08: escapes double-quotes in title — \'TASK-X "with quotes"\' produces /gsd-quick "TASK-X \'with quotes\'" (Phase 12 D-04)', () => {
           // Phase 12 D-04: title.replace(/"/g, "'"). Plane titles raramente usan
           // quotes estratégicamente; el slash-command parser de Claude Code
           // interpreta backslash escapes inconsistentemente, así que reemplazo
           // simple es la elección predecible.
           const session = makeSession({
             gsd: true,
             gsd_mode: 'quick',
             summary: 'TASK-X "with quotes"',
           });
           const output = buildGsdContext(session, {});
           assert.ok(
             output.includes(`/gsd-quick "TASK-X 'with quotes'"`),
             `output must contain literal /gsd-quick "TASK-X 'with quotes'" — got fragment: ${output.slice(output.indexOf('/gsd-quick'), output.indexOf('/gsd-quick') + 60)}`,
           );
         });

         it('QUICK-08: when opts.brief present, brief renders FIRST and slash command AFTER (Phase 12 D-03 simétrico con D-11 Phase 9)', () => {
           const session = makeSession({ gsd: true, gsd_mode: 'quick', summary: 'TASK-X' });
           const brief = '## Project Brief\n\nFoo bar baz';
           const output = buildGsdContext(session, { brief });
           const briefIdx = output.indexOf('## Project Brief');
           const cmdIdx = output.indexOf('/gsd-quick');
           assert.ok(briefIdx >= 0, 'brief must be rendered when opts.brief is provided');
           assert.ok(cmdIdx >= 0, 'slash command must be rendered');
           assert.ok(briefIdx < cmdIdx, 'brief must come BEFORE slash command (Phase 12 D-03)');
         });

         it('QUICK-08: when opts.brief absent, no brief block is rendered (no blank section)', () => {
           const session = makeSession({ gsd: true, gsd_mode: 'quick', summary: 'TASK-X' });
           const output = buildGsdContext(session, {});
           assert.ok(!output.includes('## Project Brief'), 'no brief block when opts.brief is undefined');
           assert.match(output, /\/gsd-quick/, 'slash command still rendered');
         });

         it('QUICK-08: header is unified "# kodo TASK-X — GSD Mode" (Phase 12 D-01: same as full branches)', () => {
           const session = makeSession({ gsd: true, gsd_mode: 'quick', summary: 'TASK-X', task_ref: 'KL-99' });
           const output = buildGsdContext(session, {});
           assert.match(output, /# kodo KL-99 — GSD Mode/, 'header must be unified across all GSD branches');
         });

         it('QUICK-08: quick wins over residual phase_id (Phase 12 D-06: defense in depth)', () => {
           // Una sesión quick NO debería tener phase_id (dispatcher lo descarta
           // por Phase 11 D-03). Si por error/legacy aparece, el branch quick
           // debe ignorarlo y NO degradar a la rama full+match.
           const session = makeSession({
             gsd: true,
             gsd_mode: 'quick',
             phase_id: '9',  // residual — should be ignored
             summary: 'TASK-X',
           });
           const output = buildGsdContext(session, {});
           assert.match(output, /\/gsd-quick "TASK-X"/, 'quick command rendered despite residual phase_id');
           assert.ok(!output.includes('/gsd-plan-phase 9'), 'must not fall through to full+phase branch');
         });
       });
       ```
  </action>

  <verify>
    <automated>node --test test/session-start.test.js</automated>
  </verify>

  <acceptance_criteria>
    - `grep -E "import \\{ buildSessionContext, buildGsdContext \\} from '../src/hooks/session-start.js'" test/session-start.test.js` produce match
    - `grep -E "describe\(['\"]QUICK-08 — quick mode buildGsdContext['\"]" test/session-start.test.js` produce match
    - `grep -E "/gsd-quick \"TASK-X\"" test/session-start.test.js` produce match (Test 1)
    - `grep -E "Run the slash command and finish" test/session-start.test.js` produce match (Test 2 — D-05)
    - `grep -E "TASK-X 'with quotes'" test/session-start.test.js` produce match (Test 3 — escape D-04)
    - `grep -E "briefIdx < cmdIdx" test/session-start.test.js` produce match (Test 4 — orden D-03)
    - `grep -E "kodo KL-99 — GSD Mode" test/session-start.test.js` produce match (Test 6 — header D-01)
    - `grep -E "residual phase_id" test/session-start.test.js` produce match (Test 7 — D-06)
    - El nuevo describe contiene exactamente 7 tests
    - `node --test test/session-start.test.js` exit code 0
  </acceptance_criteria>

  <done>El describe `'QUICK-08 — quick mode buildGsdContext'` existe con 7 tests passing. El import incluye `buildGsdContext`. Cubre cadena de comandos omitida, escape de quotes, orden brief/comando, header unificado, y prioridad mode sobre phase_id residual.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Extender describe('session-start.js — source invariants') con 2 tests source-hygiene D-09 + D-10</name>
  <files>test/session-start.test.js</files>

  <read_first>
    - test/session-start.test.js líneas 99-185 (describe 'session-start.js — source invariants', patrón readFileSync(SOURCE_PATH) a nivel describe — replicar el estilo de los 5 tests existentes)
    - src/hooks/session-start.js (línea 96 `const mode = getSessionMode(session);` — esto es lo que el regex debe encontrar; la rama quick lee `mode === 'quick'`, NUNCA `session.gsd_mode` directamente)
    - .planning/phases/13-test-coverage-matrix/13-CONTEXT.md (D-09 anti-inline `|| 'full'`; D-10 anti-acceso directo `.gsd_mode`; <specifics> párrafo 4 mensaje de fallo concreto con excepción documentada)
  </read_first>

  <behavior>
    - Test source-hygiene 1 (D-09 anti-inline): regex `/session\.gsd_mode\s*\|\|\s*['"]full['"]/` no debe matchear en `src/hooks/session-start.js` (forzar uso de getSessionMode)
    - Test source-hygiene 2 (D-10 anti-acceso directo): regex `/\.gsd_mode\b/` no debe matchear en `src/hooks/session-start.js` (excepto en comentarios). El helper `getSessionMode` vive en `src/labels.js` y es la única ventana legítima al campo.
  </behavior>

  <action>
    Localizar el cierre del describe `'session-start.js — source invariants'` (alrededor de línea 185 — el último `});` del archivo). Justo antes de ese cierre, AÑADIR los 2 nuevos tests:

    ```javascript

      it('QUICK-08: no inline `session.gsd_mode || "full"` (Phase 13 D-09 anti-inline)', () => {
        // Phase 11 <specifics>: el helper getSessionMode aplica la regla
        // "legacy gsd:true sin gsd_mode == full" (D-08). Inline `session.gsd_mode || 'full'`
        // es una micro-violación de DRY que duplica la regla en cada callsite.
        // Si esta regex matchea, el refactor Phase 12 D-09 se está erosionando.
        assert.ok(
          !/session\.gsd_mode\s*\|\|\s*['"]full['"]/.test(source),
          'session-start.js must use getSessionMode(session), not inline `session.gsd_mode || "full"` (Phase 13 D-09 — single source of legacy preservation)',
        );
      });

      it('QUICK-08: no direct access to `.gsd_mode` field — must use getSessionMode helper (Phase 13 D-10)', () => {
        // Phase 13 D-10: el campo session.gsd_mode SOLO debe leerse vía
        // getSessionMode (definido en src/labels.js). Cualquier acceso directo
        // .gsd_mode en session-start.js (consumer) es una violación del helper boundary.
        // Excepción documentada: src/labels.js:84 lee el campo legítimamente
        // dentro de getSessionMode — pero este archivo NO es src/labels.js.
        //
        // Strip comments para evitar false positives (la rama quick puede tener
        // un comentario que mencione gsd_mode como referencia documental).
        const stripped = source
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .split('\n')
          .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
          .join('\n');
        assert.ok(
          !/\.gsd_mode\b/.test(stripped),
          'src/hooks/session-start.js must not access .gsd_mode directly. Use `getSessionMode(session)` from src/labels.js. Direct access to session.gsd_mode is allowed only inside getSessionMode itself (src/labels.js).',
        );
      });
    ```

    Nota: el patrón existente del describe (líneas 99-185) ya usa `const source = readFileSync(SOURCE_PATH, 'utf-8');` a nivel describe (línea 100). Los 2 nuevos tests reusan esa variable `source` directamente (no hay que redeclararla).
  </action>

  <verify>
    <automated>node --test test/session-start.test.js</automated>
  </verify>

  <acceptance_criteria>
    - `grep -E "QUICK-08: no inline .session\\\\.gsd_mode" test/session-start.test.js` produce match
    - `grep -E "QUICK-08: no direct access to .\\\\.gsd_mode" test/session-start.test.js` produce match
    - `grep -E "session\\\\\\\\\\.gsd_mode\\\\\\\\s\\*\\\\\\\\\\|\\\\\\\\\\|\\\\\\\\s\\*\\\\\\\\\\['\"\\]" test/session-start.test.js` produce match (regex anti-inline en el test source)
    - `grep -q "Phase 13 D-09" test/session-start.test.js` (referencia explícita a la decisión)
    - `grep -q "Phase 13 D-10" test/session-start.test.js` (referencia explícita a la decisión)
    - `grep -q "Use .getSessionMode" test/session-start.test.js` (mensaje de fallo apunta al fix)
    - Los 2 nuevos tests viven DENTRO del describe `'session-start.js — source invariants'` (no en describe nuevo)
    - `node --test test/session-start.test.js` exit code 0 — implica que `src/hooks/session-start.js` ya cumple ambos invariantes (es source-hygiene sobre código ya shipped en Phase 12)
  </acceptance_criteria>

  <done>El describe `'session-start.js — source invariants'` contiene los 5 tests originales (Plane, plane_id, plane_identifier, gsd.phase.resolved, gsd.bootstrap, signature) + 2 tests nuevos QUICK-08 D-09 + D-10. Todos passing.</done>
</task>

</tasks>

<threat_model>
N/A — Phase 13 toca exclusivamente archivos de test (`test/session-start.test.js`). No hay código productivo modificado, no hay nuevas trust boundaries, no hay nuevos endpoints ni inputs externos. El threat surface se mantiene idéntico al estado pre-Phase 13.
</threat_model>

<verification>
- `node --test test/session-start.test.js` → exit 0, todos los tests passing (existentes + 7 behavior + 2 source-hygiene)
- El nuevo describe `'QUICK-08 — quick mode buildGsdContext'` tiene 7 tests
- El describe `'session-start.js — source invariants'` ahora tiene 7 tests (5 originales + 2 nuevos QUICK-08)
- `npm test` global → exit 0
</verification>

<success_criteria>
ROADMAP Phase 13 success criterion 4: ✅ `test/session-start.test.js` cubre la rama quick de `buildGsdContext` (inyecta `/gsd-quick "<title>"` y omite la cadena plan/execute/verify); incluye source-hygiene anti-inline `|| 'full'` y anti-acceso directo a `session.gsd_mode`.
</success_criteria>

<output>
After completion, create `.planning/phases/13-test-coverage-matrix/13-04-SUMMARY.md`
</output>
