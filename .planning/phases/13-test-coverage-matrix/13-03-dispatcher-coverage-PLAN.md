---
phase: 13-test-coverage-matrix
plan: 03
type: execute
wave: 1
depends_on: []
files_modified:
  - test/dispatcher.test.js
autonomous: true
requirements: [QUICK-08]
threat_model: "N/A — test coverage only, no production code changes"

must_haves:
  truths:
    - "test/dispatcher.test.js cubre quick + verdict phase: launchOpts.phase_id === undefined (descarta phase_id en quick)"
    - "test/dispatcher.test.js cubre quick + verdict error code:'no-match': resolver no aborta, dispatcher continúa al launch"
    - "test/dispatcher.test.js cubre quick + verdict error code:'roadmap-missing': fail-closed (action: 'resolver_failed'), lock liberado"
    - "node --test test/dispatcher.test.js corre sin fallos con el nuevo describe presente"
  artifacts:
    - path: "test/dispatcher.test.js"
      provides: "Cobertura de tolerancia resolver en modo quick + descarte phase_id"
      contains: "describe('QUICK-08 — quick mode resolver tolerance')"
  key_links:
    - from: "test/dispatcher.test.js QUICK-08 describe"
      to: "src/triggers/dispatcher.js líneas 153-227 (switch sobre resolverVerdict.action)"
      via: "makeDeps() factory + verdict injection vía resolvePhaseFn"
      pattern: "gsdMode === 'quick'"
    - from: "test quick + match"
      to: "launchCalledWith.phase_id === undefined (Phase 11 D-03 + dispatcher línea 157-159)"
      via: "deps._inspect()"
      pattern: "launchCalledWith\\.phase_id"
---

<objective>
Extender `test/dispatcher.test.js` con un nuevo describe que cubra los 3 escenarios resolver-específicos del modo quick: (a) `quick + match` descarta `phase_id` (Phase 11 D-03), (b) `quick + no-match` tolera y continúa al launch (Phase 11 D-06), (c) `quick + roadmap-missing` mantiene fail-closed (Phase 11 D-13 carry-forward). Cierra el success criterion 3 del ROADMAP Phase 13.

Purpose: El dispatcher es la ÚNICA fuente del switch de verdicts del resolver (D-14 Phase 9). El WIP de Phase 11 introdujo bifurcación por `gsdMode` en 3 puntos del switch (líneas 157-159 descarte phase_id, línea 169 tolerancia no-match, línea 196 fail-closed default). Hoy `test/dispatcher.test.js` `'Phase 9 resolver integration'` (líneas 516-638) cubre todos los caminos para `gsdMode === 'full'` pero NINGUNO para `quick`. Sin esta cobertura, una regresión que rompa la bifurcación quick (e.g., olvidar el `if (gsdMode === 'full')` antes de asignar `phase_id`) pasaría sin detectar.

Output: Un nuevo describe `'QUICK-08 — quick mode resolver tolerance'` con 3 tests, reusando el patrón `makeDeps()` + `_inspect()` ya establecido en líneas 532-555. La task con label `kodo:gsd-quick` (en vez de `kodo:gsd`) propaga `gsdMode === 'quick'` a través de `parseKodoLabels` → `getGsdMode`.
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
<!-- Patrón makeDeps + bifurcación quick existente (de los archivos leídos en planning) -->

From test/dispatcher.test.js (líneas 516-555, patrón a reusar):
```javascript
describe('dispatchTrigger — Phase 9 resolver integration', () => {
  const baseTask = {
    id: 'task-uuid-9-1',
    ref: 'KL-42',
    title: 'Phase Resolver + Bootstrap',
    description: 'Some description',
    labels: ['kodo', 'kodo:gsd'],  // <-- el nuevo describe usa ['kodo', 'kodo:gsd-quick']
    state: 'In Progress',
    projectId: 'proj-1',
    projectName: 'Test',
    groups: [],
    url: 'https://example.com/KL-42',
    priority: 'medium',
  };
  const baseEvent = { provider: 'test', taskRef: 'KL-42', action: 'state_change', raw: {} };

  function makeDeps({ verdict, acquireResult = { acquired: true }, launchResult = { session_id: 'sess-1' }, task = baseTask }) {
    const inspectState = { releaseCalled: false, launchCalledWith: null };
    return {
      getProviderFn: () => ({ getTask: async () => task, /* ... */ }),
      resolveProjectPathFn: () => '/tmp/fake-project',
      acquireGsdLockFn: () => acquireResult,
      releaseGsdLockFn: () => { inspectState.releaseCalled = true; },
      resolvePhaseFn: () => verdict,
      // ...
      launchWorkItemFn: async (_ref, opts) => { inspectState.launchCalledWith = opts; return launchResult; },
      _inspect: () => inspectState,
    };
  }
  // ...
});
```

From src/triggers/dispatcher.js (líneas 151-227, switch verdict crítico):
```javascript
if (gsdMode && gsdProjectPath) {
  resolverVerdict = resolvePhaseFn({ projectPath: gsdProjectPath, task });
  switch (resolverVerdict.action) {
    case 'phase':
      if (gsdMode === 'full') {              // <-- línea 157: solo full asigna phase_id
        gsdPhaseId = resolverVerdict.phase_id;
      }
      break;
    case 'bootstrap':
      gsdBrief = buildBriefFromTask(task);
      break;
    case 'error':
      if (gsdMode === 'quick' && resolverVerdict.code === 'no-match') {  // <-- línea 169: tolera
        // emite info log + break (continúa al launch)
        break;
      }
      // fail-closed: release lock + return resolver_failed
      // ...
      return { action: 'resolver_failed', code: resolverVerdict.code, ... };
  }
}
```
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Añadir describe('QUICK-08 — quick mode resolver tolerance') con 3 tests reusando el patrón makeDeps</name>
  <files>test/dispatcher.test.js</files>

  <read_first>
    - test/dispatcher.test.js líneas 516-638 (describe 'Phase 9 resolver integration' — el patrón makeDeps + _inspect a reusar verbatim ajustando la label)
    - src/triggers/dispatcher.js líneas 70-227 (gsdMode = getGsdMode(kodoConfig.flags) → switch verdict con 3 puntos de bifurcación quick)
    - .planning/phases/13-test-coverage-matrix/13-CONTEXT.md (D-01 matriz selectiva — sólo quick aquí; D-13 nuevo bloque QUICK-08 propio porque es escenario nuevo aislado; <specifics> párrafos 5-6 con detalles concretos de aserciones)
    - .planning/phases/11-quick-mode-recognition-persistence/11-CONTEXT.md (D-03 phase_id discard, D-06 no-match info log + tolerated, D-07 mode field en payload)
  </read_first>

  <behavior>
    - Test 1 (quick + match → descarta phase_id):
      * Input: task con `labels: ['kodo', 'kodo:gsd-quick']`, verdict `{action: 'phase', phase_id: '9', match_heading: '### Phase 9: Foo', match_reason: 'exact'}`
      * Expected: `result.action === 'launched'` Y `launchCalledWith.phase_id === undefined` (descarte) Y `launchCalledWith.brief === undefined` (no es bootstrap)
    - Test 2 (quick + no-match → tolera, continúa al launch):
      * Input: task quick + verdict `{action: 'error', code: 'no-match'}`
      * Expected: `result.action === 'launched'` (NO 'resolver_failed') Y `launchCalledWith` no es null (launch fue invocado) Y `launchCalledWith.phase_id === undefined` Y `releaseCalled === false` (lock NO se libera anticipadamente — sigue al launch)
    - Test 3 (quick + roadmap-missing → fail-closed):
      * Input: task quick + verdict `{action: 'error', code: 'roadmap-missing', detail: 'no .planning/'}`
      * Expected: `result.action === 'resolver_failed'` Y `result.code === 'roadmap-missing'` Y `launchCalledWith === null` (launch NO invocado) Y `releaseCalled === true` (lock liberado por D-13 fail-closed)
  </behavior>

  <action>
    Al final del archivo `test/dispatcher.test.js` (después del cierre del último describe en línea 638), AÑADIR un nuevo describe que reusa el patrón `makeDeps()` adaptando la label a `kodo:gsd-quick`:

    ```javascript

    describe('dispatchTrigger — QUICK-08 — quick mode resolver tolerance', () => {
      const baseTask = {
        id: 'task-uuid-quick-1',
        ref: 'KL-42',
        title: 'Quick mode test',
        description: 'Some description',
        labels: ['kodo', 'kodo:gsd-quick'],  // <-- propaga gsdMode === 'quick' vía parseKodoLabels + getGsdMode
        state: 'In Progress',
        projectId: 'proj-1',
        projectName: 'Test',
        groups: [],
        url: 'https://example.com/KL-42',
        priority: 'medium',
      };
      const baseEvent = { provider: 'test', taskRef: 'KL-42', action: 'state_change', raw: {} };

      function makeQuickDeps({ verdict, acquireResult = { acquired: true }, launchResult = { session_id: 'sess-quick' }, task = baseTask }) {
        const inspectState = { releaseCalled: false, launchCalledWith: null };
        return {
          getProviderFn: () => ({
            getTask: async () => task,
            init: async () => {},
            updateTaskState: async () => {},
            addComment: async () => {},
            listPendingTasks: async () => [],
            parseTriggerEvent: () => null,
            verifySignature: () => true,
            resolveRef: async () => '',
          }),
          resolveProjectPathFn: () => '/tmp/fake-project',
          acquireGsdLockFn: () => acquireResult,
          releaseGsdLockFn: () => { inspectState.releaseCalled = true; },
          resolvePhaseFn: () => verdict,
          listSessionsFn: () => [],
          listWorkspacesFn: async () => '',
          removeSessionFn: () => {},
          launchWorkItemFn: async (_ref, opts) => { inspectState.launchCalledWith = opts; return launchResult; },
          _inspect: () => inspectState,
        };
      }

      it('QUICK-08: quick + verdict phase → discards phase_id (Phase 11 D-03, dispatcher.js:157-159)', async () => {
        // Quick es phase-agnostic: aunque el resolver match, la sesión no se ata a la fase.
        // El dispatcher emite gsd.phase.resolved con phase_id (forense útil — D-05 Phase 11)
        // pero NO lo threadea a launchOpts.
        const deps = makeQuickDeps({
          verdict: { action: 'phase', phase_id: '9', match_heading: '### Phase 9: Foo', match_reason: 'exact' },
        });
        const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
        const result = await dispatchTrigger(baseEvent, {}, deps);
        assert.equal(result.action, 'launched');
        const { launchCalledWith } = deps._inspect();
        assert.ok(launchCalledWith, 'launch must have been invoked');
        assert.equal(
          launchCalledWith.phase_id,
          undefined,
          'quick mode discards phase_id even when resolver returned a phase match',
        );
        assert.equal(launchCalledWith.brief, undefined, 'no brief on quick + match path');
      });

      it('QUICK-08: quick + verdict error no-match → tolerated, continues to launch (Phase 11 D-06)', async () => {
        // Phase 11 D-06: quick + no-match no es error fatal. Dispatcher emite info log
        // gsd.phase.resolved {matched:false, code:'no-match', tolerated:true, mode:'quick'}
        // y continúa al launch. roadmap-missing y multi-match siguen fail-closed.
        const deps = makeQuickDeps({
          verdict: { action: 'error', code: 'no-match' },
        });
        const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
        const result = await dispatchTrigger(baseEvent, {}, deps);
        assert.equal(result.action, 'launched', 'quick + no-match must NOT abort — continues to launch');
        const { launchCalledWith, releaseCalled } = deps._inspect();
        assert.ok(launchCalledWith, 'launch must have been invoked despite no-match');
        assert.equal(launchCalledWith.phase_id, undefined, 'no phase_id when resolver did not match');
        assert.equal(launchCalledWith.brief, undefined, 'no brief on quick + no-match path');
        assert.equal(
          releaseCalled,
          false,
          'lock must NOT be released early — it stays held until session ends (Stop hook releases)',
        );
      });

      it('QUICK-08: quick + verdict error roadmap-missing → fail-closed, releases lock', async () => {
        // Phase 11 D-13 carry-forward: quick tolera SOLO no-match. roadmap-missing
        // y multi-match siguen siendo data-quality errors que abortan con lock release.
        const deps = makeQuickDeps({
          verdict: { action: 'error', code: 'roadmap-missing', detail: 'no .planning/ROADMAP.md' },
        });
        const { dispatchTrigger } = await import('../src/triggers/dispatcher.js');
        const result = await dispatchTrigger(baseEvent, {}, deps);
        assert.equal(result.action, 'resolver_failed');
        assert.equal(result.code, 'roadmap-missing');
        const { launchCalledWith, releaseCalled } = deps._inspect();
        assert.equal(launchCalledWith, null, 'launch must NOT be invoked on fail-closed verdict');
        assert.equal(releaseCalled, true, 'lock must be released on fail-closed (Phase 11 D-13)');
      });
    });
    ```

    Por D-13 (matriz selectiva): no se añade un caso `quick + bootstrap` aquí porque el comportamiento es idéntico a `full + bootstrap` (mismo brief render, mismo `/gsd-new-project`) — ya está cubierto por el test existente "threads brief to launchOpts when resolver returns action=bootstrap" (línea 569). No se añade `quick + multi-match` porque la rama fail-closed es el mismo código path que `roadmap-missing` (Test 3 lo cubre).
  </action>

  <verify>
    <automated>node --test test/dispatcher.test.js</automated>
  </verify>

  <acceptance_criteria>
    - `grep -E "describe\(['\"]dispatchTrigger — QUICK-08 — quick mode resolver tolerance['\"]" test/dispatcher.test.js` produce match
    - `grep -E "labels:\\s*\\[['\"]kodo['\"],\\s*['\"]kodo:gsd-quick['\"]\\]" test/dispatcher.test.js` produce match (label propaga modo quick)
    - `grep -E "QUICK-08: quick \\+ verdict phase" test/dispatcher.test.js` produce match (Test 1)
    - `grep -E "QUICK-08: quick \\+ verdict error no-match" test/dispatcher.test.js` produce match (Test 2)
    - `grep -E "QUICK-08: quick \\+ verdict error roadmap-missing" test/dispatcher.test.js` produce match (Test 3)
    - `grep -E "launchCalledWith\\.phase_id" test/dispatcher.test.js` produce >= 4 matches (3 nuevos + existentes)
    - `grep -q "phase-agnostic\\|discards phase_id" test/dispatcher.test.js` (comentario explica D-03 Phase 11)
    - `node --test test/dispatcher.test.js` exit code 0
    - El test runner reporta exactamente 3 tests nuevos en el bloque `QUICK-08 — quick mode resolver tolerance`
  </acceptance_criteria>

  <done>El describe `'dispatchTrigger — QUICK-08 — quick mode resolver tolerance'` existe al final de `test/dispatcher.test.js` con 3 tests passing, cubriendo: (1) phase_id discard en match, (2) tolerancia + continúa al launch en no-match, (3) fail-closed + lock release en roadmap-missing.</done>
</task>

</tasks>

<threat_model>
N/A — Phase 13 toca exclusivamente archivos de test (`test/dispatcher.test.js`). No hay código productivo modificado, no hay nuevas trust boundaries, no hay nuevos endpoints ni inputs externos. El threat surface se mantiene idéntico al estado pre-Phase 13.
</threat_model>

<verification>
- `node --test test/dispatcher.test.js` → exit 0, todos los tests passing (existentes + 3 nuevos)
- El nuevo describe `'dispatchTrigger — QUICK-08 — quick mode resolver tolerance'` tiene exactamente 3 tests
- Los describes existentes (`dispatchTrigger`, `'GSD lock guard (D-08)'`, `'CR-01 regression'`, `'Phase 9 resolver integration'`) siguen passing sin cambios
- `npm test` global → exit 0
</verification>

<success_criteria>
ROADMAP Phase 13 success criterion 3: ✅ `test/dispatcher.test.js` cubre la tolerancia del resolver en modo quick (`code: 'no-match'` continúa, `roadmap-missing` aborta) y el descarte de `phase_id` cuando hay match.
</success_criteria>

<output>
After completion, create `.planning/phases/13-test-coverage-matrix/13-03-SUMMARY.md`
</output>
