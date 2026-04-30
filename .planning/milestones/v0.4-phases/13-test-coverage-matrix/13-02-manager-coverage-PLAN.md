---
phase: 13-test-coverage-matrix
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - test/manager.test.js
autonomous: true
requirements: [QUICK-08]
threat_model: "N/A — test coverage only, no production code changes"

must_haves:
  truths:
    - "El describe 'GSD flag propagation (D-12)' (líneas 83-118) cubre los 3 estados de flags relevantes para gsd_mode: ['gsd'] -> gsd_mode:'full', ['gsd-quick'] -> gsd_mode:'quick', ['gsd','gsd-quick'] -> gsd_mode:'quick' (precedencia derivada del helper)"
    - "El describe 'manager.js source hygiene' (líneas 271-322) verifica que gsd_mode se persiste vía getGsdMode(flags), no inline flags.includes('gsd-quick')"
    - "node --test test/manager.test.js corre sin fallos con las nuevas extensiones"
  artifacts:
    - path: "test/manager.test.js"
      provides: "Cobertura de gsd_mode en buildSessionFromTask + source-hygiene del flag derivation"
      contains: "gsd_mode: 'full'|'quick'"
    - path: "test/manager.test.js"
      provides: "Source-hygiene anti-inline para gsd_mode (Phase 13 D-12)"
      contains: "getGsdMode\\(flags\\)"
  key_links:
    - from: "test/manager.test.js"
      to: "src/session/manager.js:31 (gsdMode = getGsdMode(flags))"
      via: "import buildSessionFromTask + behavior assert sobre session.gsd_mode"
      pattern: "session\\.gsd_mode"
    - from: "test/manager.test.js source-hygiene"
      to: "src/session/manager.js (línea 31 + línea 50 spread)"
      via: "regex sobre el source con readFileSync"
      pattern: "getGsdMode\\(flags\\)"
---

<objective>
Extender los tests de `test/manager.test.js` para verificar que (1) `buildSessionFromTask` persiste `gsd_mode: 'full'|'quick'` correctamente derivado vía `getGsdMode(flags)` y (2) el source-hygiene block detecta cualquier futura regresión que reintroduzca derivación inline (`flags.includes('gsd-quick')`) en lugar del helper. Cierra el success criterion 2 del ROADMAP Phase 13.

Purpose: Hoy el describe `'GSD flag propagation (D-12)'` (líneas 83-118) sólo cubre `session.gsd === true` con `flags: ['gsd']`. Phase 11 amplió `buildSessionFromTask` para persistir `gsd_mode` derivado del helper centralizador `getGsdMode(flags)` (D-01/D-03 Phase 11). Sin tests directos, una regresión silenciosa donde alguien reintroduzca `flags.includes('gsd-quick') ? 'quick' : 'full'` inline o un cambio de campo (`gsd_mode` → `mode`) pasaría sin detectar. La cobertura se completa por behavior + source-hygiene paralelos al patrón existente para `skipPerms` (líneas 297-329).

Output: Extensión del describe existente `'GSD flag propagation (D-12)'` (D-13: extensión a describe existente, no bloque nuevo aislado) con 4 tests adicionales, más extensión del describe `'manager.js source hygiene'` con 1 test gemelo del existente para `skipPerms`.
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
@.planning/phases/11-quick-mode-recognition-persistence/11-CONTEXT.md
@.planning/codebase/TESTING.md

<interfaces>
<!-- Firmas y campos exactos a testear (de src/session/manager.js leído en planning) -->

From src/session/manager.js (líneas 27-57, buildSessionFromTask):
```javascript
export function buildSessionFromTask({ task, providerName, projectPath, workspaceRef, sessionId, flags, phaseId, brief }) {
  const gsdMode = getGsdMode(flags);  // línea 31 - LOCAL DERIVATION
  return {
    // ...
    ...(gsdMode ? { gsd: true, gsd_mode: gsdMode } : {}),  // línea 50 - SPREAD CONDICIONAL
    // ...
  };
}
```

From test/manager.test.js (líneas 83-118, describe existente):
```javascript
describe('GSD flag propagation (D-12)', () => {
  it('sets gsd: true when flags include gsd', () => { ... });
  it('omits gsd field when flags do not include gsd', () => { ... });
  it('omits gsd field when flags is undefined', () => { ... });
});
```

From test/manager.test.js (líneas 271-322, describe source-hygiene):
- Estructura: `describe('manager.js source hygiene', ...)` con tests que leen MANAGER_SOURCE_PATH
- Patrón gemelo a replicar: el test "cualquier modo GSD implica --dangerously-skip-permissions (Phase 11 D-01...)" (líneas 297-329) que valida la regex `/getGsdMode\(kodoFlags\)\s*!==\s*null/`
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Extender describe('GSD flag propagation (D-12)') con 4 tests para gsd_mode (full/quick/precedencia/none)</name>
  <files>test/manager.test.js</files>

  <read_first>
    - test/manager.test.js (estado actual: describe 'GSD flag propagation (D-12)' líneas 83-118 con 3 tests, hay que extender — D-13: extensión a describe existente)
    - src/session/manager.js líneas 27-57 (buildSessionFromTask, derivación gsdMode + spread condicional)
    - .planning/phases/13-test-coverage-matrix/13-CONTEXT.md (D-02 enumeración inline, D-13 extensión vs nuevo bloque, D-14 prefijo QUICK-08)
    - .planning/phases/11-quick-mode-recognition-persistence/11-CONTEXT.md (D-03/D-04: gsd_mode siempre persistido con valor explícito cuando gsd:true)
  </read_first>

  <behavior>
    - Test 1: `flags: ['gsd']` → `session.gsd === true` (existente preserved) **Y** `session.gsd_mode === 'full'`
    - Test 2: `flags: ['gsd-quick']` → `session.gsd === true` Y `session.gsd_mode === 'quick'`
    - Test 3: `flags: ['gsd', 'gsd-quick']` → `session.gsd_mode === 'quick'` (precedencia, D-03 derivada de getGsdMode)
    - Test 4: `flags: []` o ausente → `session.gsd === undefined` Y `session.gsd_mode === undefined` (no se persiste si no hay modo)
  </behavior>

  <action>
    Localizar el bloque `describe('GSD flag propagation (D-12)', () => { ... })` en `test/manager.test.js` (líneas 83-118 actualmente). Justo antes del cierre `});` de ese describe (línea 118), AÑADIR los siguientes 4 tests dentro del mismo describe (NO crear un describe nuevo — D-13: extensión a patrón existente):

    ```javascript

      it('QUICK-08: persists gsd_mode:"full" when flags include "gsd"', () => {
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/proj',
          workspaceRef: 'workspace:1',
          sessionId: 'sess-1',
          flags: ['gsd'],
        });
        assert.equal(session.gsd, true);
        assert.equal(session.gsd_mode, 'full');
      });

      it('QUICK-08: persists gsd_mode:"quick" when flags include "gsd-quick"', () => {
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/proj',
          workspaceRef: 'workspace:1',
          sessionId: 'sess-1',
          flags: ['gsd-quick'],
        });
        assert.equal(session.gsd, true);
        assert.equal(session.gsd_mode, 'quick');
      });

      it('QUICK-08: gsd-quick wins over gsd when both flags present (precedence via getGsdMode)', () => {
        // La regla de precedencia vive en getGsdMode (Phase 11 D-09).
        // buildSessionFromTask no la replica — sólo deriva localmente.
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/proj',
          workspaceRef: 'workspace:1',
          sessionId: 'sess-1',
          flags: ['gsd', 'gsd-quick'],
        });
        assert.equal(session.gsd, true);
        assert.equal(session.gsd_mode, 'quick');
      });

      it('QUICK-08: omits gsd_mode when flags include neither gsd nor gsd-quick', () => {
        // Phase 11 D-04: gsd_mode SIEMPRE acompaña a gsd:true; nunca se persiste
        // gsd_mode sin gsd:true y nunca gsd:true sin gsd_mode (post-v0.4).
        const session = buildSessionFromTask({
          task: makeTask(),
          providerName: 'test',
          projectPath: '/tmp/proj',
          workspaceRef: 'workspace:1',
          sessionId: 'sess-1',
          flags: ['yolo'],
        });
        assert.equal(session.gsd, undefined);
        assert.equal(session.gsd_mode, undefined);
      });
    ```

    Por D-02 (inline flags por test, no helper compartido) cada test repite el spread completo de `buildSessionFromTask` siguiendo el patrón de los 3 tests existentes en este describe.
  </action>

  <verify>
    <automated>node --test test/manager.test.js</automated>
  </verify>

  <acceptance_criteria>
    - `grep -E "QUICK-08: persists gsd_mode:\"full\"" test/manager.test.js` produce match
    - `grep -E "QUICK-08: persists gsd_mode:\"quick\"" test/manager.test.js` produce match
    - `grep -E "QUICK-08: gsd-quick wins over gsd" test/manager.test.js` produce match
    - `grep -E "QUICK-08: omits gsd_mode when flags include neither" test/manager.test.js` produce match
    - `grep -E "assert\.equal\(session\.gsd_mode, 'full'\)" test/manager.test.js` produce match
    - `grep -E "assert\.equal\(session\.gsd_mode, 'quick'\)" test/manager.test.js` produce match
    - `grep -E "assert\.equal\(session\.gsd_mode, undefined\)" test/manager.test.js` produce match
    - Los 4 nuevos tests viven DENTRO del describe `'GSD flag propagation (D-12)'` (no en un describe nuevo) — verificar que aparecen entre las líneas del describe existente y el siguiente describe `'launchWorkItem — opts.sessionId threading'`
    - `node --test test/manager.test.js` exit code 0
  </acceptance_criteria>

  <done>El describe `'GSD flag propagation (D-12)'` contiene los 3 tests originales + 4 tests nuevos QUICK-08, todos passing. Los nuevos tests cubren los 3 estados de label relevantes (full, quick, ambos → quick por precedencia, ninguno → undefined).</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Extender describe('manager.js source hygiene') con test gemelo D-12 anti-inline gsd_mode derivation</name>
  <files>test/manager.test.js</files>

  <read_first>
    - test/manager.test.js líneas 271-322 (describe 'manager.js source hygiene' con el patrón existente para skipPerms — D-12 Phase 13: replicar el patrón para gsd_mode)
    - src/session/manager.js línea 31 (forma exacta `const gsdMode = getGsdMode(flags);` — esto es lo que el regex debe encontrar)
    - .planning/phases/13-test-coverage-matrix/13-CONTEXT.md (D-12 source-hygiene #4: gsd_mode debe persistirse vía helper, no inline)
  </read_first>

  <behavior>
    - El test debe leer `src/session/manager.js` y verificar:
      1. La derivación local existe: regex `/const gsdMode = getGsdMode\(flags\)/` produce match
      2. La forma alternativa inline NO existe: regex `/flags\.includes\(['"]gsd-quick['"]\)\s*\?/` no produce match
      3. El campo se llama `gsd_mode` (no `mode` ni `gsdMode`) en el spread de retorno: `/gsd_mode:/` produce match en el body de `buildSessionFromTask`
  </behavior>

  <action>
    Localizar el final del describe `'manager.js source hygiene'` en `test/manager.test.js` (cierre `});` alrededor de la línea 330). Justo antes del cierre del último `});`, AÑADIR este test gemelo del existente para `skipPerms`:

    ```javascript

      it('QUICK-08: gsd_mode derivation uses getGsdMode helper, not inline includes (Phase 13 D-12)', () => {
        const source = readFileSync(MANAGER_SOURCE_PATH, 'utf-8');
        // Phase 11 D-03: buildSessionFromTask deriva gsdMode localmente vía
        // getGsdMode(flags). Si alguien reintroduce derivación inline tipo
        // `flags.includes('gsd-quick') ? 'quick' : 'full'`, la regla de
        // precedencia centralizada se duplica y diverge silenciosamente.
        // Single point of change: añadir un nuevo modo a getGsdMode() basta.
        assert.ok(
          /const gsdMode = getGsdMode\(flags\)/.test(source),
          'buildSessionFromTask debe derivar gsdMode vía `const gsdMode = getGsdMode(flags)` (Phase 11 D-03)',
        );
        // El literal alternativo NO debe estar presente — si vuelve, el refactor
        // D-03 fue revertido y la precedencia se duplica.
        assert.ok(
          !/flags\.includes\(['"]gsd-quick['"]\)\s*\?/.test(source),
          'la derivación inline `flags.includes("gsd-quick") ? ...` no debe existir — usa getGsdMode',
        );
        // El campo persistido se llama gsd_mode (no mode ni gsdMode) en el spread.
        // Sanity check: buildSessionFromTask spreaded el campo con ese nombre exacto.
        assert.ok(
          /gsd_mode:\s*gsdMode/.test(source),
          'el campo persistido debe ser `gsd_mode: gsdMode` (no renombrar a mode/gsdMode)',
        );
        // Sanity: el spread es condicional (sólo cuando hay modo) — Phase 11 D-04.
        assert.ok(
          /\.\.\.\(gsdMode\s*\?\s*\{\s*gsd:\s*true,\s*gsd_mode:\s*gsdMode\s*\}/.test(source),
          'gsd_mode debe persistirse SIEMPRE junto a gsd:true en el spread condicional (Phase 11 D-04)',
        );
      });
    ```
  </action>

  <verify>
    <automated>node --test test/manager.test.js</automated>
  </verify>

  <acceptance_criteria>
    - `grep -E "QUICK-08: gsd_mode derivation uses getGsdMode helper" test/manager.test.js` produce match
    - `grep -E "const gsdMode = getGsdMode\\\\\\(flags\\\\\\)" test/manager.test.js` produce match (regex escapado)
    - `grep -q "Phase 13 D-12" test/manager.test.js` (referencia explícita a la decisión)
    - `grep -E "gsd_mode:\\\\s\\*gsdMode" test/manager.test.js` produce match (regex spread)
    - El test vive DENTRO del describe `'manager.js source hygiene'` (no en describe propio nuevo)
    - `node --test test/manager.test.js` exit code 0
    - El test runner reporta que el test passing — implica que `src/session/manager.js` ya cumple las 4 aserciones (es source-hygiene sobre código ya shipped en Phase 11)
  </acceptance_criteria>

  <done>El test gemelo `'QUICK-08: gsd_mode derivation uses getGsdMode helper, not inline includes (Phase 13 D-12)'` existe dentro del describe `'manager.js source hygiene'`, passing, validando 4 invariantes sobre el source de `src/session/manager.js`.</done>
</task>

</tasks>

<threat_model>
N/A — Phase 13 toca exclusivamente archivos de test (`test/manager.test.js`). No hay código productivo modificado, no hay nuevas trust boundaries, no hay nuevos endpoints ni inputs externos. El threat surface se mantiene idéntico al estado pre-Phase 13.
</threat_model>

<verification>
- `node --test test/manager.test.js` → exit 0, todos los tests passing (incluidos los nuevos)
- El describe `'GSD flag propagation (D-12)'` ahora tiene 7 tests (3 originales + 4 nuevos QUICK-08)
- El describe `'manager.js source hygiene'` ahora tiene un test extra QUICK-08 D-12
- `npm test` global → exit 0
</verification>

<success_criteria>
ROADMAP Phase 13 success criterion 2: ✅ `test/manager.test.js` verifica que `buildSessionFromTask` emite `gsd_mode: 'quick'` para quick + `gsd_mode: 'full'` para full + omite cuando no hay modo. Source-hygiene del flag desde una sola fuente (`getGsdMode`). El contrato `--dangerously-skip-permissions` para quick ya está cubierto por el test existente líneas 297-329 (skipPerms via getGsdMode).
</success_criteria>

<output>
After completion, create `.planning/phases/13-test-coverage-matrix/13-02-SUMMARY.md`
</output>
