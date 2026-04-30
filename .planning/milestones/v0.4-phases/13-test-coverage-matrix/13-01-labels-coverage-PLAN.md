---
phase: 13-test-coverage-matrix
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - test/labels.test.js
autonomous: true
requirements: [QUICK-08]
threat_model: "N/A — test coverage only, no production code changes"

must_haves:
  truths:
    - "test/labels.test.js cubre los 4 estados de getGsdMode(flags): [] -> null, ['gsd'] -> 'full', ['gsd-quick'] -> 'quick', ['gsd','gsd-quick'] -> 'quick'"
    - "test/labels.test.js cubre los 4 estados de getSessionMode(session): gsd:false/missing -> null, gsd:true sin gsd_mode -> 'full' (legacy), gsd:true+gsd_mode:'full' -> 'full', gsd:true+gsd_mode:'quick' -> 'quick'"
    - "node --test test/labels.test.js corre sin fallos con los nuevos describes presentes"
    - "Los nuevos tests siguen el patrón QUICK-08 prefix (D-14) sólo donde aporta trazabilidad"
  artifacts:
    - path: "test/labels.test.js"
      provides: "Cobertura completa del helper de modo (getGsdMode + getSessionMode)"
      contains: "describe('QUICK-08 — getGsdMode 4-state matrix')"
    - path: "test/labels.test.js"
      provides: "Cobertura legacy preservation"
      contains: "describe('QUICK-08 — getSessionMode 4-state matrix')"
  key_links:
    - from: "test/labels.test.js"
      to: "src/labels.js"
      via: "import { parseKodoLabels, getGsdMode, getSessionMode } from '../src/labels.js'"
      pattern: "getGsdMode|getSessionMode"
    - from: "test/labels.test.js getSessionMode legacy case"
      to: "Phase 11 D-08 invariant (gsd:true sin gsd_mode == 'full')"
      via: "assert.equal(getSessionMode({gsd:true}), 'full')"
      pattern: "gsd:\\s*true.*'full'"
---

<objective>
Cubrir con tests automatizados los dos helpers de modo en `src/labels.js`: `getGsdMode(flags)` (4 estados de label) y `getSessionMode(session)` (4 estados de SessionRecord). Cierra los success criteria 1 y 6 del ROADMAP Phase 13.

Purpose: Phase 11 introdujo `getGsdMode` y `getSessionMode` como ÚNICA fuente de la regla de precedencia (`gsd-quick > gsd`) y de la regla legacy (`gsd:true` sin `gsd_mode` == `'full'`). Hoy `test/labels.test.js` sólo cubre `parseKodoLabels` — los dos helpers están sin tests directos. Sin esta cobertura, una regresión en la regla de precedencia o en la lectura de sesiones legacy v0.3 pasaría silenciosamente.

Output: 2 nuevos `describe` blocks añadidos al final de `test/labels.test.js` con ~10 tests entre ambos.
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
<!-- Firmas exactas de los helpers a testear (de src/labels.js, leídas en planning) -->

From src/labels.js:
```javascript
/**
 * @param {string[]} flags
 * @returns {'full'|'quick'|null}
 */
export function getGsdMode(flags) {
  if (!Array.isArray(flags)) return null;
  if (flags.includes('gsd-quick')) return 'quick';
  if (flags.includes('gsd')) return 'full';
  return null;
}

/**
 * @param {import('./session/state.js').Session | null | undefined} session
 * @returns {'full'|'quick'|null}
 */
export function getSessionMode(session) {
  if (!session?.gsd) return null;
  return session.gsd_mode || 'full';
}
```

From test/labels.test.js (current state):
- Imports: `import { parseKodoLabels } from '../src/labels.js';`  (línea 3, sólo parseKodoLabels)
- Estructura: un único `describe('parseKodoLabels', ...)` (líneas 5-67)
- Patrón: tests simples con `it(name, () => { assert.equal(...) })`, sin beforeEach
</interfaces>
</context>

<tasks>

<task type="auto" tdd="false">
  <name>Task 1: Extender import + añadir describe('QUICK-08 — getGsdMode 4-state matrix') con 4 tests + caso de array no válido</name>
  <files>test/labels.test.js</files>

  <read_first>
    - test/labels.test.js (estado actual: importa solo parseKodoLabels, un describe)
    - src/labels.js (firmas exactas de getGsdMode y getSessionMode, regla de precedencia 'gsd-quick > gsd')
    - .planning/phases/13-test-coverage-matrix/13-CONTEXT.md (D-01 matriz selectiva, D-02 enumeración inline, D-03 precedencia solo en labels, D-13 organización mezcla, D-14 prefijo QUICK-08, <specifics>)
    - .planning/phases/11-quick-mode-recognition-persistence/11-CONTEXT.md (D-09/D-10: helper exportado para ser testeado aislado)
  </read_first>

  <behavior>
    - Test 1: getGsdMode([]) === null  (none → null)
    - Test 2: getGsdMode(['gsd']) === 'full'  (gsd literal → full)
    - Test 3: getGsdMode(['gsd-quick']) === 'quick'  (quick → quick)
    - Test 4: getGsdMode(['gsd', 'gsd-quick']) === 'quick'  (precedencia gsd-quick > gsd, D-03)
    - Test 5: getGsdMode(null) === null y getGsdMode(undefined) === null  (defensivo, no-array)
  </behavior>

  <action>
    1. Modificar la línea 3 de `test/labels.test.js` para extender el import:
       ```javascript
       import { parseKodoLabels, getGsdMode, getSessionMode } from '../src/labels.js';
       ```

    2. Al final del archivo (después del cierre del describe `parseKodoLabels` en la línea 67), añadir un nuevo bloque describe (D-13: nuevo escenario aislado → bloque QUICK-08 propio):

       ```javascript

       describe('QUICK-08 — getGsdMode 4-state matrix', () => {
         it('QUICK-08: returns null when no GSD flags present', () => {
           assert.equal(getGsdMode([]), null);
         });

         it('QUICK-08: returns "full" for ["gsd"] only', () => {
           assert.equal(getGsdMode(['gsd']), 'full');
         });

         it('QUICK-08: returns "quick" for ["gsd-quick"] only', () => {
           assert.equal(getGsdMode(['gsd-quick']), 'quick');
         });

         it('QUICK-08: gsd-quick wins over gsd when both present (precedence rule, Phase 13 D-03)', () => {
           // Precedencia centralizada en getGsdMode — más específico gana.
           // Phase 11 D-09/D-10: única fuente de la regla; consumers no replican.
           assert.equal(getGsdMode(['gsd', 'gsd-quick']), 'quick');
           assert.equal(getGsdMode(['gsd-quick', 'gsd']), 'quick', 'order-independent');
         });

         it('QUICK-08: returns null defensively for non-array input', () => {
           assert.equal(getGsdMode(null), null);
           assert.equal(getGsdMode(undefined), null);
         });
       });
       ```

    3. Por D-02 (enumeración inline, sin helper compartido): cada test usa array literal, no se introduce un helper `LABEL_SCENARIOS`.
    4. Por D-14 (naming): prefijo `QUICK-08:` en cada test name (aporta trazabilidad explícita al requirement).
    5. Por D-08 (estilo dominante): behavior tests puros sobre el helper (no source-hygiene aquí — el helper está en src/labels.js que NO es consumer, es la fuente).
  </action>

  <verify>
    <automated>node --test test/labels.test.js</automated>
  </verify>

  <acceptance_criteria>
    - `grep -q "import { parseKodoLabels, getGsdMode, getSessionMode } from '../src/labels.js'" test/labels.test.js`
    - `grep -E "describe\(['\"]QUICK-08 — getGsdMode 4-state matrix['\"]" test/labels.test.js` produce match
    - `grep -E "assert\.equal\(getGsdMode\(\[\]\), null\)" test/labels.test.js` produce match (Test 1)
    - `grep -E "assert\.equal\(getGsdMode\(\['gsd'\]\), 'full'\)" test/labels.test.js` produce match (Test 2)
    - `grep -E "assert\.equal\(getGsdMode\(\['gsd-quick'\]\), 'quick'\)" test/labels.test.js` produce match (Test 3)
    - `grep -E "assert\.equal\(getGsdMode\(\['gsd', 'gsd-quick'\]\), 'quick'\)" test/labels.test.js` produce match (Test 4)
    - `node --test test/labels.test.js` exit code 0
    - El test runner reporta exactamente 5 tests nuevos en el bloque `QUICK-08 — getGsdMode 4-state matrix`
  </acceptance_criteria>

  <done>El bloque `describe('QUICK-08 — getGsdMode 4-state matrix')` existe con 5 tests, todos passing. El import extendido incluye `getGsdMode` y `getSessionMode`.</done>
</task>

<task type="auto" tdd="false">
  <name>Task 2: Añadir describe('QUICK-08 — getSessionMode 4-state matrix') con 4 estados de SessionRecord</name>
  <files>test/labels.test.js</files>

  <read_first>
    - test/labels.test.js (debe contener ya el bloque getGsdMode de Task 1)
    - src/labels.js líneas 60-85 (getSessionMode con regla legacy `gsd:true` sin `gsd_mode` == `'full'`)
    - .planning/phases/13-test-coverage-matrix/13-CONTEXT.md (D-04: 4 estados de SessionRecord, caso (b) crítico para regresión silenciosa)
    - .planning/phases/11-quick-mode-recognition-persistence/11-CONTEXT.md (D-08: legacy gsd:true == full; D-09/D-10: helper aislado testeable)
  </read_first>

  <behavior>
    - Test 1 (case a): `getSessionMode({gsd: false})` === null  (sesión no-GSD)
    - Test 1 bis: `getSessionMode({})` === null  (sin gsd field)
    - Test 1 ter: `getSessionMode(null)` === null y `getSessionMode(undefined)` === null  (defensivo)
    - Test 2 (case b — CRITICAL): `getSessionMode({gsd: true})` === 'full'  (legacy v0.3 preservation, Phase 11 D-08)
    - Test 3 (case c): `getSessionMode({gsd: true, gsd_mode: 'full'})` === 'full'  (post-v0.4 full)
    - Test 4 (case d): `getSessionMode({gsd: true, gsd_mode: 'quick'})` === 'quick'  (post-v0.4 quick)
  </behavior>

  <action>
    Después del bloque `describe('QUICK-08 — getGsdMode 4-state matrix')` añadido en Task 1, agregar un nuevo describe (D-13: nuevo bloque aislado por escenario nuevo):

    ```javascript

    describe('QUICK-08 — getSessionMode 4-state matrix', () => {
      it('QUICK-08: returns null for non-GSD session (gsd:false)', () => {
        assert.equal(getSessionMode({ gsd: false }), null);
      });

      it('QUICK-08: returns null when gsd field is missing', () => {
        assert.equal(getSessionMode({}), null);
      });

      it('QUICK-08: returns null defensively for null/undefined session', () => {
        assert.equal(getSessionMode(null), null);
        assert.equal(getSessionMode(undefined), null);
      });

      it('QUICK-08: legacy session (gsd:true, no gsd_mode) reads as "full" — Phase 11 D-08 invariant', () => {
        // CRITICAL: pre-v0.4 sessions persistidas con gsd:true SIEMPRE eran full.
        // Esta regla "ausente == full" se aplica internamente en getSessionMode
        // para que sesiones legacy en state.json se sigan leyendo sin migración
        // programática (REQUIREMENTS Out of Scope). Si esta regla cambia
        // silenciosamente, sesiones v0.3 viejas leen como null y rompen los
        // hooks (que asumen full|quick cuando gsd:true).
        assert.equal(getSessionMode({ gsd: true }), 'full');
      });

      it('QUICK-08: returns "full" for gsd:true + gsd_mode:"full" (post-v0.4 full)', () => {
        assert.equal(getSessionMode({ gsd: true, gsd_mode: 'full' }), 'full');
      });

      it('QUICK-08: returns "quick" for gsd:true + gsd_mode:"quick" (post-v0.4 quick)', () => {
        assert.equal(getSessionMode({ gsd: true, gsd_mode: 'quick' }), 'quick');
      });
    });
    ```
  </action>

  <verify>
    <automated>node --test test/labels.test.js</automated>
  </verify>

  <acceptance_criteria>
    - `grep -E "describe\(['\"]QUICK-08 — getSessionMode 4-state matrix['\"]" test/labels.test.js` produce match
    - `grep -E "assert\.equal\(getSessionMode\(\{ gsd: false \}\), null\)" test/labels.test.js` produce match (case a)
    - `grep -E "assert\.equal\(getSessionMode\(\{ gsd: true \}\), 'full'\)" test/labels.test.js` produce match (case b legacy)
    - `grep -E "assert\.equal\(getSessionMode\(\{ gsd: true, gsd_mode: 'full' \}\), 'full'\)" test/labels.test.js` produce match (case c)
    - `grep -E "assert\.equal\(getSessionMode\(\{ gsd: true, gsd_mode: 'quick' \}\), 'quick'\)" test/labels.test.js` produce match (case d)
    - `grep -q "Phase 11 D-08 invariant" test/labels.test.js` (comentario que documenta la regla legacy)
    - `node --test test/labels.test.js` exit code 0
    - El test runner reporta exactamente 6 tests nuevos en `QUICK-08 — getSessionMode 4-state matrix`
  </acceptance_criteria>

  <done>El bloque `describe('QUICK-08 — getSessionMode 4-state matrix')` existe con 6 tests cubriendo las 4 reglas (a, b, c, d) más casos defensivos null/undefined. Todos passing. El comentario sobre Phase 11 D-08 documenta el invariante legacy.</done>
</task>

</tasks>

<threat_model>
N/A — Phase 13 toca exclusivamente archivos de test (`test/labels.test.js`). No hay código productivo modificado, no hay nuevas trust boundaries, no hay nuevos endpoints ni inputs externos. El threat surface se mantiene idéntico al estado pre-Phase 13.
</threat_model>

<verification>
- `node --test test/labels.test.js` → exit 0, todos los tests passing
- Los 2 nuevos describe blocks (`QUICK-08 — getGsdMode 4-state matrix`, `QUICK-08 — getSessionMode 4-state matrix`) suman 11 tests nuevos
- El describe original `parseKodoLabels` sigue passing sin cambios
- `npm test` global → exit 0 (no rompe otros archivos)
</verification>

<success_criteria>
ROADMAP Phase 13 success criterion 1: ✅ `test/labels.test.js` cubre los 4 estados sobre `parseKodoLabels` (existente) y `getGsdMode` (nuevo: ['], ['gsd'], ['gsd-quick'], ['gsd','gsd-quick']).
ROADMAP Phase 13 success criterion 6: ✅ `test/labels.test.js` cubre los 4 estados de `getSessionMode(session)`.
</success_criteria>

<output>
After completion, create `.planning/phases/13-test-coverage-matrix/13-01-SUMMARY.md`
</output>
