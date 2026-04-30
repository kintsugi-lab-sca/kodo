---
phase: 13-test-coverage-matrix
plan: 05
type: execute
wave: 1
depends_on: []
files_modified:
  - test/stop.test.js
  - test/orchestrator-gsd.test.js
autonomous: true
requirements: [QUICK-08]
threat_model: "N/A — test coverage only, no production code changes"

must_haves:
  truths:
    - "test/stop.test.js cubre los 3 cases del switch buildStopNudgeText: case 'quick' (sin kodo gsd verify, idioma ES), case 'full' (con kodo gsd verify <session-id> + ternary phase_id/bootstrap), default (texto no-GSD)"
    - "test/stop.test.js source-hygiene D-11: el bloque del case 'quick' en src/hooks/stop.js NO contiene 'kodo gsd verify'"
    - "test/stop.test.js source-hygiene D-09/D-10: stop.js NO contiene `session.gsd_mode || 'full'` ni acceso directo `.gsd_mode`"
    - "test/orchestrator-gsd.test.js cubre las 3 etiquetas gsdTag: [GSD quick], [GSD phase N], [GSD bootstrap]"
    - "test/orchestrator-gsd.test.js cubre el caso defensivo Phase 12 D-11: sesión quick con phase_id residual sigue rindiendo [GSD quick] (no [GSD phase N])"
    - "test/orchestrator-gsd.test.js source-hygiene D-09/D-10 sobre src/orchestrator/launch.js: anti-inline + anti-acceso directo"
    - "node --test exits 0 en ambos archivos"
  artifacts:
    - path: "test/stop.test.js"
      provides: "Cobertura behavior buildStopNudgeText 3-case switch + source-hygiene"
      contains: "describe('QUICK-08 — buildStopNudgeText switch')"
    - path: "test/orchestrator-gsd.test.js"
      provides: "Cobertura buildContextSummary gsdTag con 3 etiquetas + caso defensivo"
      contains: "describe('QUICK-08 — buildContextSummary gsdTag')"
  key_links:
    - from: "test/stop.test.js QUICK-08 describe"
      to: "src/hooks/stop.js:41-56 (buildStopNudgeText switch)"
      via: "import { buildStopNudgeText } from '../src/hooks/stop.js'"
      pattern: "case 'quick'|case 'full'|default"
    - from: "test/orchestrator-gsd.test.js QUICK-08 describe"
      to: "src/orchestrator/launch.js:122-131 (gsdTag inline computation)"
      via: "import { buildContextSummary } from '../src/orchestrator/launch.js'"
      pattern: "\\[GSD quick\\]|\\[GSD phase|\\[GSD bootstrap\\]"
---

<objective>
Cerrar la cobertura de los dos sitios complementarios que Phase 12 introdujo y Phase 11/12 dejaron deferred a Phase 13: (a) `buildStopNudgeText` switch exhaustivo de 3 cases en `src/hooks/stop.js` (success criterion 7), y (b) `buildContextSummary` gsdTag mode-first en `src/orchestrator/launch.js` (success criterion 8). Ambos sitios son cortos, comparten el patrón "switch sobre `getSessionMode`", y testean side branches simétricas de Phase 12 — cohesión natural en un mismo plan.

Purpose: El test existente en `test/orchestrator-gsd.test.js` (líneas 48-167) cubre el cómputo Phase 10 (sólo `[GSD phase N]` y `[GSD bootstrap]`) y `buildStopNudgeText` Phase 10 (sólo `gsd:true`/`false`). Phase 12 amplió ambos: gsdTag tiene 3 ramas (mode-first), buildStopNudgeText pasó a switch exhaustivo. Sin la cobertura del 3er case (`[GSD quick]` / `case 'quick'`), una regresión que omita o reordene el branch quick pasaría sin detectar.

Output: Un nuevo describe en cada archivo (D-13: bloque QUICK-08 nuevo aislado) con tests behavior + source-hygiene D-09/D-10/D-11.
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
<!-- Firmas exactas de los dos sitios a testear (de archivos leídos en planning) -->

From src/hooks/stop.js (líneas 41-56, buildStopNudgeText 3-case switch):
```javascript
export function buildStopNudgeText(session) {
  const base = `La sesión ${session.task_ref} (${session.summary}) ha terminado y está en Review.`;
  switch (getSessionMode(session)) {
    case 'quick':
      return `${base} Es una sesión GSD quick (one-shot, sin VERIFICATION.md). Revísala manualmente como cualquier sesión no-GSD.\\n`;
    case 'full': {
      const phaseLabel = session.phase_id ? `fase ${session.phase_id}` : 'bootstrap';
      return `${base} Es una sesión GSD (${phaseLabel}). Ejecuta \`kodo gsd verify ${session.session_id}\` y actúa según el verdict.\\n`;
    }
    default:
      return `${base} Revisa el resultado y decide si pasa a Done o necesita más trabajo.\\n`;
  }
}
```

From src/orchestrator/launch.js (líneas 122-131, gsdTag mode-first):
```javascript
let gsdTag = '';
if (s.gsd) {
  const mode = getSessionMode(s);
  const inner = mode === 'quick' ? 'quick' : (s.phase_id ? `phase ${s.phase_id}` : 'bootstrap');
  gsdTag = ` \`[GSD ${inner}]\``;
}
```

From test/stop.test.js (estado actual):
- 7 tests source-hygiene en describe `'stop.js source hygiene'` (líneas 11-51)
- NO hay test behavior de buildStopNudgeText — Phase 13 lo añade.
- Importa nada de stop.js excepto como source path. Hay que añadir `import { buildStopNudgeText } from '../src/hooks/stop.js';`

From test/orchestrator-gsd.test.js (estado actual):
- describe `'buildContextSummary — Phase 10 GSD tagging'` (líneas 48-107) — cubre `[GSD phase N]`, `[GSD bootstrap]`, no-GSD. NO cubre `[GSD quick]`.
- describe `'buildStopNudgeText — Phase 10 nudge condicional GSD'` (líneas 109-167) — cubre `gsd:true` con/sin phase_id y `gsd:false`. NO cubre `gsd_mode:'quick'`. Phase 13 añade describe nuevo (D-13: bloque QUICK-08 propio para escenario nuevo).
- baseSession ya definido en línea 49 (reusable)
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Extender test/stop.test.js con describe('QUICK-08 — buildStopNudgeText switch') (3 cases) + source-hygiene D-09/D-10/D-11</name>
  <files>test/stop.test.js</files>

  <read_first>
    - test/stop.test.js (estado actual: 7 tests source-hygiene, NO importa buildStopNudgeText, hay que añadir import)
    - src/hooks/stop.js líneas 41-56 (switch exhaustivo 3 cases — el código exacto a testear)
    - .planning/phases/13-test-coverage-matrix/13-CONTEXT.md (D-05 3 cases con assertions concretas; D-09/D-10 source-hygiene; D-11 anti `kodo gsd verify` en case quick; <specifics> párrafo 1 forma exacta del nudge quick con `\\n`)
    - .planning/phases/12-hook-orchestrator-bifurcation/12-CONTEXT.md (D-08 texto exacto del case quick en ES; D-07 patrón switch)
  </read_first>

  <behavior>
    - Test 1 (case 'quick'): session con `gsd:true, gsd_mode:'quick'` → text NO contiene `kodo gsd verify`, contiene `sin VERIFICATION.md`, contiene `Revísala manualmente`, idioma ES, termina en `\\n` literal
    - Test 2 (case 'full' con phase_id): session con `gsd:true, gsd_mode:'full', phase_id:'10'` → text contiene `kodo gsd verify <session-id>`, contiene `fase 10`, idioma ES (preserva Phase 10 D-04)
    - Test 3 (case 'full' sin phase_id — bootstrap): session con `gsd:true, gsd_mode:'full'`, sin phase_id → text contiene `kodo gsd verify`, contiene `bootstrap` (fallback ternary)
    - Test 4 (case 'full' legacy sin gsd_mode — Phase 11 D-08): session con `gsd:true`, sin gsd_mode, con phase_id:'5' → text contiene `kodo gsd verify`, contiene `fase 5` (legacy se lee como 'full' por getSessionMode)
    - Test 5 (default no-GSD): session con `gsd:false` → text contiene `Revisa el resultado y decide si pasa a Done`, NO contiene `kodo gsd verify`, NO contiene `quick`
    - Test source-hygiene D-11: regex sobre `src/hooks/stop.js` source — la subcadena `kodo gsd verify` aparece en `case 'full'` pero NO en `case 'quick'` (capturando el bloque case quick por regex)
    - Test source-hygiene D-09: stop.js NO contiene `session.gsd_mode || 'full'`
    - Test source-hygiene D-10: stop.js NO contiene `.gsd_mode` directo (usa getSessionMode)
  </behavior>

  <action>
    1. Modificar el bloque de imports en `test/stop.test.js` para añadir buildStopNudgeText (al final del bloque de imports, ~línea 6):
       ```javascript
       import { buildStopNudgeText } from '../src/hooks/stop.js';
       ```

    2. Después del cierre del describe `'stop.js source hygiene'` (último `});` del archivo, alrededor de línea 51), AÑADIR un nuevo describe `'QUICK-08 — buildStopNudgeText switch'` con tests behavior:

       ```javascript

       describe('QUICK-08 — buildStopNudgeText switch', () => {
         function makeQuickSession(overrides = {}) {
           return {
             workspace_ref: 'workspace:1',
             session_id: 'sess-quick-123',
             task_id: 'tid',
             task_ref: 'KL-42',
             provider: 'plane',
             project_id: 'p1',
             summary: 'Quick task',
             status: 'review',
             started_at: '2026-04-29T00:00:00.000Z',
             project_path: '/tmp/proj',
             ...overrides,
           };
         }

         it('QUICK-08: case "quick" — text omits `kodo gsd verify`, mentions sin VERIFICATION.md, asks manual review, idioma ES (Phase 12 D-08)', () => {
           const text = buildStopNudgeText(makeQuickSession({ gsd: true, gsd_mode: 'quick' }));
           assert.ok(!text.includes('kodo gsd verify'), 'quick case must NOT mention `kodo gsd verify` (CLI does not support quick)');
           assert.match(text, /sin VERIFICATION\.md/, 'quick case must mention sin VERIFICATION.md');
           assert.match(text, /Revísala manualmente/, 'quick case must ask for manual review');
           assert.match(text, /La sesión KL-42/, 'preserves base sentence opener');
           assert.match(text, /Es una sesión GSD quick/, 'identifies session as GSD quick');
           // Idioma ES (D-16 Phase 10 carry-forward)
           assert.ok(!/\bplease\b|\byou must\b/i.test(text), 'must be Spanish, no English keywords');
           // Phase 10 \\n literal preservado (cmux.send interpreta como Enter)
           assert.ok(text.endsWith('\\n'), 'must end with literal \\\\n (cmux Enter)');
         });

         it('QUICK-08: case "full" with phase_id — includes `kodo gsd verify <session-id>` and `fase N` (Phase 10 D-04 preserved)', () => {
           const text = buildStopNudgeText(makeQuickSession({ gsd: true, gsd_mode: 'full', phase_id: '10' }));
           assert.match(text, /kodo gsd verify sess-quick-123/, 'must include session-id in verify command');
           assert.match(text, /fase 10/, 'phase_id renders as "fase N"');
           assert.match(text, /actúa según el verdict/, 'instructive ES text preserved');
         });

         it('QUICK-08: case "full" without phase_id (bootstrap) — verify command + "bootstrap" fallback', () => {
           const text = buildStopNudgeText(makeQuickSession({ gsd: true, gsd_mode: 'full' }));
           assert.match(text, /kodo gsd verify sess-quick-123/);
           assert.match(text, /\(bootstrap\)/, 'phase_label fallback "bootstrap" when phase_id absent');
         });

         it('QUICK-08: legacy gsd:true without gsd_mode reads as full (Phase 11 D-08) — verify nudge present', () => {
           // Sesión v0.3 legacy persistida en state.json antes de Phase 11.
           // getSessionMode aplica la regla "ausente == full" → cae en case 'full'.
           const text = buildStopNudgeText(makeQuickSession({ gsd: true, phase_id: '5' /* sin gsd_mode */ }));
           assert.match(text, /kodo gsd verify sess-quick-123/, 'legacy session reads as full → verify nudge');
           assert.match(text, /fase 5/);
         });

         it('QUICK-08: default (non-GSD) — original Phase 10 text, no verify, no quick mention', () => {
           const text = buildStopNudgeText(makeQuickSession({ gsd: false }));
           assert.match(text, /Revisa el resultado y decide si pasa a Done/);
           assert.ok(!text.includes('kodo gsd verify'), 'non-GSD must not suggest verify');
           assert.ok(!text.includes('quick'), 'non-GSD must not mention quick');
         });
       });
       ```

    3. Dentro del describe existente `'stop.js source hygiene'` (justo antes de su cierre, línea 51), AÑADIR los 3 tests source-hygiene QUICK-08 (D-09, D-10, D-11):

       ```javascript

         it('QUICK-08: no inline `session.gsd_mode || "full"` (Phase 13 D-09 anti-inline)', () => {
           const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
           assert.ok(
             !/session\.gsd_mode\s*\|\|\s*['"]full['"]/.test(source),
             'stop.js must use getSessionMode(session), not inline `session.gsd_mode || "full"` (Phase 13 D-09)',
           );
         });

         it('QUICK-08: no direct access to `.gsd_mode` field — must use getSessionMode helper (Phase 13 D-10)', () => {
           const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
           const stripped = source
             .replace(/\/\*[\s\S]*?\*\//g, '')
             .split('\n')
             .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
             .join('\n');
           assert.ok(
             !/\.gsd_mode\b/.test(stripped),
             'src/hooks/stop.js must not access .gsd_mode directly. Use `getSessionMode(session)` from src/labels.js. Direct access to session.gsd_mode is allowed only inside getSessionMode itself (src/labels.js).',
           );
         });

         it('QUICK-08: case "quick" block in source does NOT contain `kodo gsd verify` (Phase 13 D-11 source guard complementing behavior test)', () => {
           // Captura el bloque del case 'quick' por regex y verifica que no
           // contiene la subcadena `kodo gsd verify`. Si alguien refactoriza
           // el switch y reintroduce el verify nudge en quick, este test
           // falla además del behavior test.
           const source = readFileSync(STOP_SOURCE_PATH, 'utf-8');
           const quickCaseMatch = source.match(/case\s+['"]quick['"]:[\s\S]*?(?=case\s+['"]full['"]|case\s+['"]default['"]|\bdefault\s*:)/);
           assert.ok(quickCaseMatch, 'must find case "quick" block in source');
           assert.ok(
             !quickCaseMatch[0].includes('kodo gsd verify'),
             'case "quick" block must NOT contain `kodo gsd verify` (CLI does not support quick mode)',
           );
         });
       ```
  </action>

  <verify>
    <automated>node --test test/stop.test.js</automated>
  </verify>

  <acceptance_criteria>
    - `grep -E "import \\{ buildStopNudgeText \\} from '../src/hooks/stop.js'" test/stop.test.js` produce match
    - `grep -E "describe\(['\"]QUICK-08 — buildStopNudgeText switch['\"]" test/stop.test.js` produce match
    - `grep -E "QUICK-08: case \"quick\"" test/stop.test.js` produce match (Test 1)
    - `grep -E "Es una sesión GSD quick" test/stop.test.js` produce match
    - `grep -E "Revísala manualmente" test/stop.test.js` produce match
    - `grep -E "QUICK-08: case \"full\" with phase_id" test/stop.test.js` produce match (Test 2)
    - `grep -E "QUICK-08: legacy gsd:true without gsd_mode" test/stop.test.js` produce match (Test 4 — D-08 carry-forward)
    - `grep -E "QUICK-08: default \\(non-GSD\\)" test/stop.test.js` produce match (Test 5)
    - `grep -q "Phase 13 D-09" test/stop.test.js` (source-hygiene D-09)
    - `grep -q "Phase 13 D-10" test/stop.test.js` (source-hygiene D-10)
    - `grep -q "Phase 13 D-11" test/stop.test.js` (source-hygiene D-11)
    - `grep -E "case \\\\\\\\s\\+\\['\"]quick" test/stop.test.js` produce match (regex que captura el bloque case quick en source)
    - El nuevo describe contiene 5 tests behavior; los 3 nuevos source-hygiene viven dentro del describe existente
    - `node --test test/stop.test.js` exit code 0
  </acceptance_criteria>

  <done>El archivo `test/stop.test.js` ahora contiene: import de `buildStopNudgeText`, describe `'QUICK-08 — buildStopNudgeText switch'` con 5 tests behavior, y describe `'stop.js source hygiene'` ampliado con 3 tests QUICK-08 D-09/D-10/D-11. Todos passing.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Extender test/orchestrator-gsd.test.js con describe('QUICK-08 — buildContextSummary gsdTag') (3 etiquetas + caso defensivo D-11) + source-hygiene D-09/D-10</name>
  <files>test/orchestrator-gsd.test.js</files>

  <read_first>
    - test/orchestrator-gsd.test.js (estado actual: ya importa buildContextSummary línea 46 y buildStopNudgeText línea 109; describe Phase 10 cubre [GSD phase N] y [GSD bootstrap], NO [GSD quick] ni el caso defensivo D-11)
    - src/orchestrator/launch.js líneas 122-131 (cómputo gsdTag mode-first, prioridad mode sobre phase_id)
    - .planning/phases/13-test-coverage-matrix/13-CONTEXT.md (D-06 caso defensivo D-11 Phase 12 con phase_id residual; <specifics> párrafo 3 con detalle)
    - .planning/phases/12-hook-orchestrator-bifurcation/12-CONTEXT.md (D-11 mode-first inline; D-13 sesiones no-GSD sin tag preservado)
  </read_first>

  <behavior>
    - Test 1 ([GSD quick]): session con `gsd:true, gsd_mode:'quick'` → output contiene `[GSD quick]`, NO contiene `[GSD phase`, NO contiene `[GSD bootstrap]`
    - Test 2 ([GSD phase N]): session con `gsd:true, gsd_mode:'full', phase_id:'9'` → output contiene `[GSD phase 9]`
    - Test 3 ([GSD bootstrap]): session con `gsd:true, gsd_mode:'full'`, sin phase_id → output contiene `[GSD bootstrap]`
    - Test 4 (defensivo D-11 Phase 12): session con `gsd:true, gsd_mode:'quick', phase_id:'9'` (residual no debería existir, dispatcher lo descarta) → output contiene `[GSD quick]`, NO contiene `[GSD phase 9]` (mode wins over phase_id)
    - Test 5 (legacy gsd:true sin gsd_mode): session con `gsd:true, phase_id:'5'`, sin gsd_mode → output contiene `[GSD phase 5]` (getSessionMode lee como 'full' → fallthrough a phase_id)
    - Test source-hygiene D-09: launch.js NO contiene `session.gsd_mode || 'full'` ni `s.gsd_mode || 'full'`
    - Test source-hygiene D-10: launch.js NO contiene acceso directo `.gsd_mode` (usa getSessionMode)
  </behavior>

  <action>
    1. Después del cierre del describe `'buildStopNudgeText — Phase 10 nudge condicional GSD'` (último `});` del archivo, alrededor de línea 167), AÑADIR un nuevo describe (D-13: bloque nuevo aislado):

       ```javascript

       describe('QUICK-08 — buildContextSummary gsdTag', () => {
         const baseSession = {
           workspace_ref: 'workspace:1',
           session_id: 's1',
           task_id: 'tid',
           task_ref: 'KL-42',
           provider: 'plane',
           project_id: 'p1',
           summary: 'Do work',
           status: 'running',
           started_at: new Date().toISOString(),
           project_path: '/tmp/proj',
         };
         const config = { claude: { max_parallel: 3 } };

         it('QUICK-08: gsd_mode:"quick" → tag [GSD quick]', () => {
           const sessions = [{ ...baseSession, gsd: true, gsd_mode: 'quick' }];
           const out = buildContextSummary(sessions, config);
           assert.match(out, /KL-42\*\*\s*`\[GSD quick\]`/, 'must render [GSD quick] tag');
           assert.ok(!out.includes('[GSD phase'), 'must not render [GSD phase ...] for quick session');
           assert.ok(!out.includes('[GSD bootstrap]'), 'must not render [GSD bootstrap] for quick session');
         });

         it('QUICK-08: gsd_mode:"full" + phase_id → tag [GSD phase N] (Phase 10 D-19 preserved)', () => {
           const sessions = [{ ...baseSession, gsd: true, gsd_mode: 'full', phase_id: '9' }];
           const out = buildContextSummary(sessions, config);
           assert.match(out, /KL-42\*\*\s*`\[GSD phase 9\]`/);
         });

         it('QUICK-08: gsd_mode:"full" without phase_id → tag [GSD bootstrap]', () => {
           const sessions = [{ ...baseSession, gsd: true, gsd_mode: 'full' }];
           const out = buildContextSummary(sessions, config);
           assert.match(out, /KL-42\*\*\s*`\[GSD bootstrap\]`/);
         });

         it('QUICK-08: defensive — quick session with residual phase_id renders [GSD quick] (mode wins over phase_id, Phase 12 D-11)', () => {
           // Phase 12 D-11: defensa en profundidad. Dispatcher descarta phase_id
           // en quick (Phase 11 D-03), así que esta combinación no debería
           // existir en producción. Si por bug/legacy aparece, mode-first
           // garantiza que el tag respeta la intención del modo.
           const sessions = [{ ...baseSession, gsd: true, gsd_mode: 'quick', phase_id: '9' }];
           const out = buildContextSummary(sessions, config);
           assert.match(out, /KL-42\*\*\s*`\[GSD quick\]`/, 'mode wins over residual phase_id');
           assert.ok(!out.includes('[GSD phase 9]'), 'must not fall through to phase_id branch');
         });

         it('QUICK-08: legacy gsd:true without gsd_mode + phase_id reads as full (Phase 11 D-08) → [GSD phase N]', () => {
           // Sesión v0.3 legacy: getSessionMode devuelve 'full' (regla ausente == full).
           // El cómputo `mode === 'quick' ? 'quick' : (s.phase_id ? 'phase N' : 'bootstrap')`
           // cae al ternary phase_id → '[GSD phase 5]'.
           const sessions = [{ ...baseSession, gsd: true, phase_id: '5' /* no gsd_mode */ }];
           const out = buildContextSummary(sessions, config);
           assert.match(out, /KL-42\*\*\s*`\[GSD phase 5\]`/, 'legacy session reads as full → phase tag');
         });

         it('QUICK-08: mix of all 3 GSD tag flavors renders correctly per session', () => {
           const sessions = [
             { ...baseSession, task_ref: 'KL-Q', gsd: true, gsd_mode: 'quick' },
             { ...baseSession, task_ref: 'KL-P', gsd: true, gsd_mode: 'full', phase_id: '7' },
             { ...baseSession, task_ref: 'KL-B', gsd: true, gsd_mode: 'full' },
             { ...baseSession, task_ref: 'KL-N', gsd: false },
           ];
           const out = buildContextSummary(sessions, config);
           assert.match(out, /KL-Q\*\*\s*`\[GSD quick\]`/);
           assert.match(out, /KL-P\*\*\s*`\[GSD phase 7\]`/);
           assert.match(out, /KL-B\*\*\s*`\[GSD bootstrap\]`/);
           assert.ok(!/KL-N\*\*.*\[GSD/.test(out), 'non-GSD session must not have any GSD tag');
         });
       });

       describe('QUICK-08 — launch.js source hygiene', () => {
         const LAUNCH_SOURCE_PATH = 'src/orchestrator/launch.js';

         it('QUICK-08: no inline `s.gsd_mode || "full"` or `session.gsd_mode || "full"` (Phase 13 D-09)', () => {
           const source = readFileSync(LAUNCH_SOURCE_PATH, 'utf-8');
           assert.ok(
             !/\b(s|session)\.gsd_mode\s*\|\|\s*['"]full['"]/.test(source),
             'launch.js must use getSessionMode(s), not inline `s.gsd_mode || "full"` (Phase 13 D-09)',
           );
         });

         it('QUICK-08: no direct access to `.gsd_mode` field — must use getSessionMode helper (Phase 13 D-10)', () => {
           const source = readFileSync(LAUNCH_SOURCE_PATH, 'utf-8');
           const stripped = source
             .replace(/\/\*[\s\S]*?\*\//g, '')
             .split('\n')
             .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
             .join('\n');
           assert.ok(
             !/\.gsd_mode\b/.test(stripped),
             'src/orchestrator/launch.js must not access .gsd_mode directly. Use `getSessionMode(s)` from src/labels.js. Direct access to session.gsd_mode is allowed only inside getSessionMode itself (src/labels.js).',
           );
         });

         it('QUICK-08: imports getSessionMode from labels.js (Phase 12 D-11 contract)', () => {
           const source = readFileSync(LAUNCH_SOURCE_PATH, 'utf-8');
           assert.match(
             source,
             /import\s*\{[^}]*getSessionMode[^}]*\}\s*from\s*['"]\.\.\/labels\.js['"]/,
             'launch.js must import getSessionMode from ../labels.js',
           );
         });
       });
       ```

    Nota: `readFileSync` ya está importado en línea 4 del archivo (existing). No hay que añadirlo de nuevo.
  </action>

  <verify>
    <automated>node --test test/orchestrator-gsd.test.js</automated>
  </verify>

  <acceptance_criteria>
    - `grep -E "describe\(['\"]QUICK-08 — buildContextSummary gsdTag['\"]" test/orchestrator-gsd.test.js` produce match
    - `grep -E "describe\(['\"]QUICK-08 — launch\\.js source hygiene['\"]" test/orchestrator-gsd.test.js` produce match
    - `grep -E "\\[GSD quick\\]" test/orchestrator-gsd.test.js` produce match (Test 1)
    - `grep -E "QUICK-08: defensive — quick session with residual phase_id" test/orchestrator-gsd.test.js` produce match (Test 4 — D-11 defensivo)
    - `grep -E "QUICK-08: legacy gsd:true without gsd_mode" test/orchestrator-gsd.test.js` produce match (Test 5 — D-08 carry-forward)
    - `grep -E "QUICK-08: mix of all 3 GSD tag flavors" test/orchestrator-gsd.test.js` produce match (Test 6)
    - `grep -q "Phase 13 D-09" test/orchestrator-gsd.test.js` (source-hygiene D-09)
    - `grep -q "Phase 13 D-10" test/orchestrator-gsd.test.js` (source-hygiene D-10)
    - `grep -q "import.*getSessionMode" test/orchestrator-gsd.test.js` (verifica el import en source)
    - El primer nuevo describe contiene exactamente 6 tests behavior; el segundo describe contiene 3 tests source-hygiene
    - `node --test test/orchestrator-gsd.test.js` exit code 0
  </acceptance_criteria>

  <done>El archivo `test/orchestrator-gsd.test.js` ahora contiene 2 nuevos describes: `'QUICK-08 — buildContextSummary gsdTag'` (6 tests cubriendo las 3 etiquetas + caso defensivo D-11 + legacy D-08 + mix) y `'QUICK-08 — launch.js source hygiene'` (3 tests D-09/D-10 + import). Todos passing.</done>
</task>

</tasks>

<threat_model>
N/A — Phase 13 toca exclusivamente archivos de test (`test/stop.test.js`, `test/orchestrator-gsd.test.js`). No hay código productivo modificado, no hay nuevas trust boundaries, no hay nuevos endpoints ni inputs externos. El threat surface se mantiene idéntico al estado pre-Phase 13.
</threat_model>

<verification>
- `node --test test/stop.test.js` → exit 0
- `node --test test/orchestrator-gsd.test.js` → exit 0
- `test/stop.test.js` ahora tiene: 7 tests source-hygiene originales + 3 source-hygiene QUICK-08 + 5 behavior QUICK-08 = 15 tests
- `test/orchestrator-gsd.test.js` ahora tiene: tests originales (PM1-PM7, L1-L6, S1-S7) + 6 behavior QUICK-08 + 3 source-hygiene QUICK-08
- `npm test` global → exit 0 (gate Phase 13 success criterion 5)
</verification>

<success_criteria>
ROADMAP Phase 13 success criterion 7: ✅ `test/stop.test.js` cubre los 3 cases del switch exhaustivo de `buildStopNudgeText` (`quick` sin `kodo gsd verify`, `full` con verify nudge, `default` no-GSD); source-hygiene assert que el bloque del case quick no contiene `kodo gsd verify` en el source.
ROADMAP Phase 13 success criterion 8: ✅ `test/orchestrator-gsd.test.js` cubre las 3 etiquetas de `buildContextSummary` gsdTag (`[GSD quick]`, `[GSD phase N]`, `[GSD bootstrap]`) más el caso defensivo Phase 12 D-11 (sesión quick con phase_id residual sigue rindiendo `[GSD quick]`).
</success_criteria>

<output>
After completion, create `.planning/phases/13-test-coverage-matrix/13-05-SUMMARY.md`
</output>
