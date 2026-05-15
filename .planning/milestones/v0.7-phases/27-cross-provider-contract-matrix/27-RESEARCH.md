# Phase 27: Cross-Provider Contract Matrix - Research

**Researched:** 2026-05-14
**Domain:** Test-only — provider-agnostic contract matrix sobre `['plane', 'github']`
**Confidence:** HIGH

## Summary

Phase 27 ship es un único archivo de test (`test/providers/contract.test.js`) más, posiblemente, un módulo de helpers/asserts compartidos. **Cero cambios en código de producción.** El test demuestra empíricamente el invariante v0.2 — "cambiar de provider no requiere reescribir lógica" — iterando una misma batería de asserts contra `createPlaneProvider(...)` y `createGitHubProvider(...)` con clientes mock.

El research confirma que **toda la infraestructura ya existe**: factories `createPlaneProvider`/`createGitHubProvider` aceptan inyección DI (Plane vía `globalThis.fetch` stub; GitHub vía `opts.client`), `TASK_PROVIDER_METHODS` define los 9 nombres canonical, `TaskItem` queda fijado a 11 campos por D-18 leak guard de Phase 24, y existen 7+ fixtures GitHub + 3 fixtures Plane offline. El reto es **eliminar la divergencia de instanciación** entre ambos providers (Plane usa `globalThis.fetch` mutation; GitHub usa `opts.client` injection) sin tocar los providers — la solución es un helper `instantiateProvider(name)` por test que normalice la setup.

**Primary recommendation:** Estructura tipo Jest table-driven en `node:test` — un `describe.each`-style loop con `for (const providerName of ['plane', 'github'])` rodeando un `describe(`${providerName} contract`, ...)`. Cada `describe` setupea un cliente fake idéntico en shape (lookup-table per-provider porque las APIs raw difieren) y ejecuta los mismos N asserts contra `provider.getTask(refValido)`, `provider.listProjects()`, `provider.listPendingTasks()`, `provider.parseTriggerEvent({})`, `provider.verifySignature('',{})`, plus shape assertion sobre `TaskItem`. Asserts shared se extraen a `test/providers/contract-helpers.js` para que el shape canónico sea single-source-of-truth.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Test orchestration (matrix loop) | Test harness — `test/providers/contract.test.js` | — | `node:test` runner ya es estándar del repo (`package.json` script único) |
| Provider instantiation per-row | Helpers/fixtures tier | — | Cada provider necesita setup distinto (Plane→`globalThis.fetch` stub; GitHub→`opts.client`); helper aísla la divergencia |
| Shape assertions (TaskItem 11 fields) | Assertions tier — `test/providers/contract-helpers.js` | — | Single-source-of-truth del shape canonical — reutilizable Phase 28+ si entra un 3er adapter |
| Fixture provision | Fixtures tier — `test/fixtures/{github,plane-*}.json` | — | Fixtures por-provider existentes — el matrix NO crea fixtures cross-provider compartidos (las payloads raw difieren estructuralmente) |
| Error-shape assertions (`not_found`, etc.) | Assertions tier — contract-helpers | — | Único punto que valida la simetría de error contract entre adapters |

## File Inventory

### CREATE

| Path | Purpose |
|------|---------|
| `test/providers/contract.test.js` | Matrix runner — itera `['plane', 'github']` × N asserts; ÚNICO test file de la phase |
| `test/providers/contract-helpers.js` *(opcional)* | Asserts compartidos (`assertTaskItemShape`, `assertProviderContract`, `CANONICAL_TASK_ITEM_KEYS`, `instantiateProvider(name)`) — separar HELPS readability si LOC test >300 |

### MODIFY

**Ninguno.** Phase 27 es test-only (TEST-03 — ROADMAP SC#1-3, REQUIREMENTS.md L37-38). Cero touch a:

- `src/interface.js` — `TASK_PROVIDER_METHODS` y `TaskItem` typedef permanecen idénticos
- `src/providers/plane/**`, `src/providers/github/**` — adapters intactos
- `src/providers/registry.js` — factory wiring intacto
- `src/labels.js` — `parseKodoLabels` invariante v0.2

### NOT CREATED (descartados por scope)

- `test/fixtures/plane-shared.json` / `test/fixtures/cross-provider.json` — **NO** crear fixtures shared. Plane y GitHub tienen payload shapes distintos (`description_html` vs `body`; `state` UUID vs `'open'`/`'closed'`); compartir fixtures forzaría una abstracción artificial. Cada provider mock devuelve su propio fixture; el matrix solo asserta el resultado post-normalize.

### Reorganization (DEFERRED — NOT in Phase 27 scope)

Existing `test/plane-provider.test.js` queda en su path actual. **NO reorganizar a `test/providers/plane/provider.test.js`** — la simetría visual con `test/providers/github/provider.test.js` sería bonita, pero introduce diff sin valor empírico (rompe `git blame`, fuerza touch de imports, no afecta el outcome de Phase 27). Defer a "Phase 28+ test re-org" si emerge necesidad.

## Code Examples

### Pattern 1: Provider-Iteration Loop (node:test style)

`node:test` no tiene `describe.each` (Jest); el equivalente idiomático es un `for...of` sobre `describe`:

```javascript
// test/providers/contract.test.js
import { describe, it, before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { TASK_PROVIDER_METHODS } from '../../src/interface.js';

const PROVIDERS = ['plane', 'github'];

for (const providerName of PROVIDERS) {
  describe(`TaskProvider contract — ${providerName}`, () => {
    /** @type {import('../../src/interface.js').TaskProvider} */
    let provider;

    beforeEach(async () => {
      provider = await instantiateProvider(providerName);
    });

    it('exposes all 9 TASK_PROVIDER_METHODS as functions', () => {
      for (const method of TASK_PROVIDER_METHODS) {
        assert.equal(typeof provider[method], 'function', `${providerName} missing: ${method}`);
      }
    });

    it('getTask returns canonical TaskItem with exactly 11 keys', async () => {
      const task = await provider.getTask(getValidRef(providerName));
      assertTaskItemShape(task, providerName);
    });

    // … N asserts más
  });
}
```

Test count derivado: `PROVIDERS.length × N_asserts_por_describe`. ROADMAP SC#3 garantiza visibilidad de la fórmula (no test count hardcoded).

### Pattern 2: Shape-Assertion Helper

Single-source-of-truth de los 11 fields canonical (anclado al D-18 leak guard de Phase 24):

```javascript
// test/providers/contract-helpers.js  (o inline en contract.test.js)
const CANONICAL_TASK_ITEM_KEYS = Object.freeze([
  'id', 'ref', 'title', 'description', 'labels',
  'projectId', 'projectName', 'groups', 'url',
  'priority', 'state',
]);

/**
 * Asserta que `task` tiene EXACTAMENTE los 11 campos canonical, ni uno más ni uno menos.
 * Mismo invariante que D-18 leak guard, aplicado cross-provider.
 *
 * @param {object} task
 * @param {string} providerName — para mensajes de error grep-friendly
 */
export function assertTaskItemShape(task, providerName) {
  const keys = Object.keys(task).sort();
  assert.deepEqual(
    keys,
    [...CANONICAL_TASK_ITEM_KEYS].sort(),
    `[${providerName}] TaskItem shape divergence: got ${JSON.stringify(keys)}`,
  );
  // Type assertions sobre cada campo (string|array|enum) — no provider-specific values.
  assert.equal(typeof task.id, 'string', `[${providerName}] id must be string`);
  assert.equal(typeof task.ref, 'string', `[${providerName}] ref must be string`);
  assert.ok(Array.isArray(task.labels), `[${providerName}] labels must be array`);
  assert.ok(Array.isArray(task.groups), `[${providerName}] groups must be array`);
  // priority: union urgent|high|medium|low|none|null — never undefined
  assert.ok(
    task.priority === null || ['urgent','high','medium','low','none'].includes(task.priority),
    `[${providerName}] priority must be null or valid enum value, got: ${task.priority}`,
  );
  // … resto
}
```

### Pattern 3: fakeClient Injection Per Provider

Cada adapter tiene un mecanismo DI distinto. El helper aisla la divergencia detrás de una API uniforme:

```javascript
// test/providers/contract-helpers.js
import { createPlaneProvider } from '../../src/providers/plane/provider.js';
import { createGitHubProvider } from '../../src/providers/github/provider.js';
import issueFixture from '../fixtures/github/issue.json' with { type: 'json' };

/**
 * Provider-agnostic instantiation. Devuelve un TaskProvider con cliente fake
 * que retorna shapes compatibles para el ref válido del provider.
 *
 * Divergencia oculta: Plane se mockea vía `globalThis.fetch` stub (sin DI nativo);
 * GitHub se mockea vía `opts.client` (DI Phase 24 D-36). El matrix NO debe saber.
 */
export async function instantiateProvider(name) {
  if (name === 'plane') {
    // Plane provider sin DI client → stub globalThis.fetch para esta describe.
    // Cleanup en after() — el caller debe restaurar.
    stubPlaneFetch();
    return createPlaneProvider({
      baseUrl: 'https://plane.test',
      apiKey: 'test-key',
      workspaceSlug: 'test',
      projects: [{ id: 'p-uuid', identifier: 'KL', name: 'Kodo Lab' }],
      states: { trigger: 'In Progress', review: 'In review', done: 'Done' },
      webhookSecret: 'test-secret',
    });
  }
  if (name === 'github') {
    return createGitHubProvider(
      {
        base_url: 'https://api.github.com',
        api_key_env: 'GITHUB_TOKEN',
        repos: [{ owner: 'octocat', repo: 'hello-world' }],
        states: { trigger: 'open', review: 'closed', done: 'closed' },
      },
      { client: makeFakeGitHubClient() },  // patrón de test/registry.test.js:41-67
    );
  }
  throw new Error(`Unknown provider in matrix: ${name}`);
}

export function getValidRef(name) {
  if (name === 'plane') return 'KL-42';
  if (name === 'github') return 'octocat/hello-world#42';
  throw new Error(`No ref mapping for: ${name}`);
}
```

### Pattern 4: Error-Shape Consistency Assert

`getTask(refInexistente)` debe lanzar **consistentemente** en ambos providers — error.message + el código canonical (donde aplique):

```javascript
it('getTask throws on not-found ref with consistent shape', async () => {
  // Mock retorna 404-equivalente para el ref de test
  const badRef = getInvalidRef(providerName);  // 'KL-9999' / 'octocat/hello-world#9999'
  await assert.rejects(
    () => provider.getTask(badRef),
    (err) => {
      assert.ok(err instanceof Error, `[${providerName}] must throw Error instance`);
      assert.equal(typeof err.message, 'string', `[${providerName}] err.message must be string`);
      // Plane lanza `Error('Work item KL-9999 not found')`; GitHub lanza el error con
      // .code='not_found' del client (client.js:54). El matrix asserta que AMBOS
      // throw, NO el mismo mensaje literal (los textos divergen — eso es por-provider).
      return true;
    },
  );
});

it('parseTriggerEvent returns null for empty/unrecognized payload', () => {
  // Plane: rawPayload.event !== 'issue' → null. GitHub: D-26 always-null.
  assert.equal(provider.parseTriggerEvent({}), null, `[${providerName}] parseTriggerEvent({}) must be null`);
});

it('verifySignature returns false without HMAC config / for invalid sig', () => {
  // Plane: missing 'x-plane-signature' header → false. GitHub: D-27 always-false.
  assert.equal(provider.verifySignature('body', {}), false, `[${providerName}] verifySignature must be false`);
});

it('listProjects returns array of {id, identifier, name} objects', async () => {
  const projects = await provider.listProjects();
  assert.ok(Array.isArray(projects), `[${providerName}] listProjects must return array`);
  assert.ok(projects.length >= 1, `[${providerName}] mock should return at least 1 project`);
  const p = projects[0];
  assert.equal(typeof p.id, 'string');
  assert.equal(typeof p.identifier, 'string');
  assert.equal(typeof p.name, 'string');
});
```

## Pitfalls

### Pitfall 1: Provider initialization divergence — Plane requiere init(), GitHub no
**What goes wrong:** Llamar `provider.getTask(...)` directo sin `await provider.init()` en Plane revienta porque `labelCache`/`stateByName` están vacíos (`getTask` necesita `stateCache.get(workItem.state)` para resolver el state name). GitHub es no-op por D-19 (init not required).
**Why it happens:** Asimetría natural del adapter — Plane tiene state real, GitHub embebe todo en cada payload.
**How to avoid:** Llamar `await provider.init()` en `beforeEach` ANTES de cualquier test method-level — siempre, en ambos providers. En GitHub es no-op (cero costo); en Plane es prerequisito. **El matrix asserta el contract `provider.init()` no lanza** en ambos, lo cual cubre TEST-03 simétricamente.
**Warning signs:** Test failure `stateCache.get(...) is undefined` o `Cannot read properties of undefined (reading 'identifier')` solo en `plane` describe.

### Pitfall 2: globalThis.fetch mutation cross-contaminating other tests
**What goes wrong:** El stub de `globalThis.fetch` para Plane (`test/plane-provider.test.js:62-77` pattern) si NO se restaura en `after()`/`afterEach()`, ROMPE los tests que corren después en la misma suite global (`npm test` ejecuta todos los `*.test.js` juntos via `node --test`).
**Why it happens:** `node:test` corre suites en serie por defecto pero comparte el mismo `globalThis`. Plane mock requiere mutation; si Phase 27 olvida cleanup, Phase 24 client tests (que también usan `globalThis.fetch` override) entran en estado indefinido.
**How to avoid:** Patrón `before/after` con captura+restore — exactamente como `test/providers/github/provider.test.js:40-49` con el leak guard. **OBLIGATORIO** en el describe `plane`. Considerar wrapper `withStubbedFetch(routes, fn)` que garantice restore aunque el test lance.
**Warning signs:** Test que pasa solo (`node --test test/providers/contract.test.js`) pero falla en suite global (`npm test`).

### Pitfall 3: Test count fragility — assert hardcoded count rompe a la mínima
**What goes wrong:** ROADMAP SC#3 dice "test count derivado `providers.length × asserts`". Si alguien hardcodea `assert.equal(suiteCount, 14)` o cambia los asserts en un sólo provider sin actualizar el matrix, la simetría queda silenciosa.
**Why it happens:** `node:test` no reporta el count programáticamente al test file; la "fórmula derivada" no es validable en runtime, solo se ve en el output (`ℹ tests 763`).
**How to avoid:** **No hardcodear conteos.** El matrix se autoderiva por construcción — la fórmula `N×K` es estructural (un loop sobre `PROVIDERS` con `it(...)` declarativos). Si alguien añade un `it()` solo dentro de un provider's describe, el plan-checker/CI debe detectarlo. **Plan task:** añadir un `it('matrix is symmetric: same number of tests per provider'...)` que NO se puede hacer en `node:test` runtime → reemplazar por convención + comentario al top del archivo + lint regex en CI (gprep para `_only_in_plane`/`_only_in_github` test bodies).
**Warning signs:** Suite count crece de forma asimétrica al añadir asserts.

### Pitfall 4: Fixture shape divergence — Plane y GitHub raw payloads no comparten campos
**What goes wrong:** Asumir que un fixture genérico funciona para ambos — Plane payload tiene `sequence_id`/`description_html`/`state` UUID; GitHub tiene `number`/`body`/`state` literal `'open'`/`'closed'`. Si el matrix intenta inyectar un payload "neutral" en ambos clients fake, uno de los normalizers fallará.
**Why it happens:** El contract es sobre el **output** (`TaskItem`), no el **input** (raw payload). El matrix valida que el output converge, no que el input es uniforme.
**How to avoid:** Cada lookup-table per-provider devuelve **su propio fixture raw** (existing: `test/fixtures/github/issue.json` y `test/fixtures/plane-workitem.json`). El assert post-normalize sí es uniforme (shape de TaskItem). **No crear fixtures cross-provider compartidos** — sería abstracción prematura.
**Warning signs:** Test passes con `assert.equal(task.title, 'Test issue')` pero falla en otro provider porque su fixture tiene un título distinto.

### Pitfall 5: Plane provider requires real config.projects to resolve refs
**What goes wrong:** `createPlaneProvider({ projects: [] })` y luego `provider.getTask('KL-42')` lanza `No configured project with identifier "KL"` antes de tocar el cliente. El matrix no puede usar `projects: []` ni un identifier arbitrario — debe matchear el fixture.
**Why it happens:** Plane resuelve `prefix` (`KL`) → `proj` desde `config.projects` para localizar el work-item (`provider.js:60-64`). GitHub no necesita ese mapping (el ref ya trae `owner/repo`).
**How to avoid:** El helper `instantiateProvider('plane')` debe pasar `projects: [{ id, identifier: 'KL', name: 'Kodo Lab' }]` que coincida con el fixture `test/fixtures/plane-workitem.json` (identifier `KL`, sequence_id `42`). Documentar el coupling con un comentario explícito.
**Warning signs:** `Error: No configured project with identifier "KL"` lanzado desde el helper, no desde el assert.

### Pitfall 6: `parseTriggerEvent`/`verifySignature` asimetría semántica
**What goes wrong:** Asertar que `parseTriggerEvent(unPayloadValido)` retorna un `TriggerEvent` truthy en ambos providers fallaría en GitHub — D-26 lo deja **deterministically null** (polling-only en v0.7). Lo mismo `verifySignature` (D-27 always-false).
**Why it happens:** El contract `TaskProvider` exige que ambos métodos **existan** (signature), pero su comportamiento es legítimamente provider-specific (Plane usa webhook + HMAC; GitHub usa polling sin secret). TEST-03 valida **shape de error/return**, no behavior idéntico.
**How to avoid:** El matrix asserta el **contract negativo simétrico**: `parseTriggerEvent({})` returns `null | TriggerEvent` (nunca throw, nunca undefined); `verifySignature('', {})` returns `boolean` (nunca throw). Los positivos (signature válida en Plane) **NO** son matrix tests — siguen viviendo en `test/plane-provider.test.js`. Documentar esto en el comentario top del archivo.
**Warning signs:** Test `parseTriggerEvent returns TriggerEvent for valid payload` solo es verde en `plane`, skip/fail en `github` — eso es divergencia legítima, NO matrix concern.

### Pitfall 7: Live fetch leak desde Plane describe
**What goes wrong:** Si el Plane stub solo intercepta algunos endpoints y el provider llama otro (`/modules/`, `/labels/`), el `globalThis.fetch` original hace una request real a `https://plane.test` (DNS fail) o peor, a un host real si los URL son construidos dinámicamente.
**Why it happens:** Plane `init()` (provider.js:88-122) llama 3 endpoints en ciclos (labels, states, modules) por proyecto. Olvidar uno provoca live fetch.
**How to avoid:** Adoptar la guard de Phase 24 (D-37 live-fetch leak guard) al **nivel global del archivo** — `before()` override `globalThis.fetch = () => throw 'live fetch leak'` y luego el stub Plane se monta on-top para los endpoints que sí necesita. Cualquier fetch a un path no-stubbeado revienta loud.
**Warning signs:** Test wall-time > 1s, network errors en CI offline, mensaje `ENOTFOUND plane.test`.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in, sin deps) |
| Config file | `package.json` script: `"test": "node --test $(find test -name '*.test.js' -type f)"` |
| Quick run command | `node --test test/providers/contract.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| TEST-03 | Matrix itera `['plane','github']` ejecutando los mismos asserts | matrix-unit | `node --test test/providers/contract.test.js` | ❌ Wave 1 |
| TEST-03 | `TaskItem` shape exact-11-fields ambos providers | shape-assertion | (same file, `assertTaskItemShape`) | ❌ Wave 1 |
| TEST-03 | Error contract (`getTask(badRef)` throws en ambos) | rejection-assertion | (same file) | ❌ Wave 1 |
| TEST-03 | `parseTriggerEvent({})` returns `null` o `TriggerEvent` (nunca throw) en ambos | nullable-assertion | (same file) | ❌ Wave 1 |
| TEST-03 | `verifySignature('',{})` returns `false` (nunca throw) en ambos | boolean-assertion | (same file) | ❌ Wave 1 |
| TEST-03 | `listProjects()` returns `Array<{id,identifier,name}>` en ambos | shape-assertion | (same file) | ❌ Wave 1 |
| TEST-03 | Zero live API calls — fixtures offline + fetch leak guard | runtime-assertion | (same file, `before()` guard) | ❌ Wave 1 |
| TEST-03 | Suite global ≥ 763+N pass, zero new skip | suite-baseline | `npm test \| grep -E "^ℹ (tests\|pass\|skipped\|fail)"` | ✅ (baseline 763/1/0) |

### Sampling Rate
- **Per task commit:** `node --test test/providers/contract.test.js` (debe ser <2s)
- **Per wave merge:** `npm test` (full suite, ~7.5s en baseline)
- **Phase gate:** Full suite green (763 + N pass, 1 skipped pre-existing, 0 fail) antes de `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/providers/contract.test.js` — matrix runner (CREATE — REQ TEST-03)
- [ ] `test/providers/contract-helpers.js` *(opcional)* — `assertTaskItemShape`, `instantiateProvider`, `CANONICAL_TASK_ITEM_KEYS` (CREATE si LOC justifica split)
- Framework install: **None** — `node:test` built-in, ningún paquete nuevo
- Pre-existing infrastructure cubre:
  - Fixtures GitHub: 15 fixtures en `test/fixtures/github/` (issue.json, issue-with-priority.json, issues-list.json, not-found-404.json, etc.)
  - Fixtures Plane: `test/fixtures/plane-workitem.json` + `plane-labels.json` + `plane-webhook.json`
  - Patterns: live-fetch leak guard (Phase 24 D-37), fakeClient injection (Phase 24 D-36), stubFetch routes (`test/plane-provider.test.js:62-77`)

## Open Questions (RESOLVED)

1. **RESOLVED: ¿Qué asserts exactos van en el contract suite?**
   - **Decision:** N = 7-9 asserts core, ejecutados en ambos providers:
     1. Contract — los 9 `TASK_PROVIDER_METHODS` son funciones
     2. `getTask(refValido)` → `TaskItem` con shape exact-11-fields
     3. `getTask(refInvalido)` → throws Error
     4. `listProjects()` → `Array<{id,identifier,name}>`
     5. `listPendingTasks()` → `Array<TaskItem>` (cada item con shape canonical)
     6. `parseTriggerEvent({})` → `null | TriggerEvent` (nunca throw, nunca undefined)
     7. `verifySignature('',{})` → `boolean === false` (nunca throw)
     8. `addComment(task, 'md')` → resolves (no return shape assertion, solo no-throw)
     9. `updateTaskState(task, validState)` → resolves
   - **Rationale:** Cubre los 9 métodos del contrato + el shape canonical + el error contract. N = 9 da test count `9 × 2 = 18` matrix tests añadidos. Suite total `763 + 18 = 781`. El planner puede ajustar N hacia arriba (más sub-cases) o hacia abajo (collapsing asserts en un solo `it`) — el matrix sigue siendo derivado.

2. **RESOLVED: ¿Cómo se instancian los providers en el test?**
   - **Decision:** Helper `instantiateProvider(name)` que oculta la divergencia DI:
     - **plane:** `globalThis.fetch` stub (precedente: `test/plane-provider.test.js:62-77`) con `before/after` cleanup
     - **github:** `opts.client = makeFakeGitHubClient()` (precedente: `test/providers/github/provider.test.js:61-105`, `test/registry.test.js:41-67`)
   - **Rationale:** NO se llama `getProvider('github')` ni `getProvider('plane')` del registry — eso requiere `loadConfig()` real (`registry.js:34-43`) que crashea sin config v0.7 completo. Se llaman los factories directamente con configs mock.

3. **RESOLVED: ¿Fixtures shared cross-provider o per-provider?**
   - **Decision:** Per-provider. Cada lookup-table devuelve su fixture nativo (`issue.json` para GitHub; `plane-workitem.json` para Plane). El matrix valida convergencia del output (TaskItem), no uniformidad del input.
   - **Rationale:** Pitfall #4 — Plane y GitHub raw payloads no comparten estructura; abstraerlos sería over-engineering (Rule 2 simplicity).

4. **RESOLVED: ¿El matrix debe assertar error shapes (e.g., `getTask(missing)` lanza `not_found`)?**
   - **Decision:** Sí, pero **solo el contrato negativo simétrico** — ambos providers deben **throw Error con .message string**, no necesariamente el mismo `.code`. GitHub adapter usa `error.code = 'not_found'` del client (client.js:54-69); Plane lanza `Error('Work item KL-X not found')` sin `.code`. La divergencia es legítima — Phase 27 valida el contract negativo (ambos throw), no el contract positivo (mismo `.code`).
   - **Rationale:** REQUIREMENTS.md L37: "mismos error shapes" significa shape estructural (Error instance + message string), no equality de `.code`. Si en v0.8+ se decide unificar `error.code` cross-provider, ESA es una phase distinta.

5. **RESOLVED: ¿Dónde vive `test/providers/contract.test.js` y se reorganiza `test/plane-provider.test.js`?**
   - **Decision:** `test/providers/contract.test.js` (nuevo). **NO reorganizar** `test/plane-provider.test.js` → `test/providers/plane/provider.test.js`.
   - **Rationale:** La reorganización es cosmética (rompe `git blame`, fuerza touch sin valor empírico para TEST-03). El `git mv` pertenecería a una phase "test re-org" separada. Phase 27 sigue el principio surgical-changes — toca solo lo nuevo.

6. **RESOLVED: ¿El matrix corre dentro de `getProvider(name)` del registry o llama factories directo?**
   - **Decision:** Factories directos (`createPlaneProvider`, `createGitHubProvider`) con configs mock.
   - **Rationale:** `getProvider()` del registry pasa por `loadConfig()` que requiere `~/.kodo/config.json` real con ambos providers configurados — frágil en CI. `test/registry.test.js:97-152` ya validan que el registry-level wiring funciona (D-38 GH-04). Phase 27 valida el contrato del adapter, no el wiring del registry.

7. **RESOLVED: ¿Test count "derivado" se valida cómo si `node:test` no lo expone runtime?**
   - **Decision:** Por construcción + convención. Top-of-file comment: "Toda assert dentro de los `describe` debe replicarse en AMBOS providers — el matrix se autoderiva". Plan-checker valida con un grep que la estructura `for (const providerName of PROVIDERS) describe(...)` envuelve todos los `it(...)` del archivo (zero `it()` top-level).
   - **Rationale:** Pitfall #3 — runtime test count no es introspectable en `node:test`; la simetría es invariante estructural verificable por inspección estática.

## Sources

### Primary (HIGH confidence)
- `/Users/alex/dev/klab/kodo/src/interface.js:50-60` — `TASK_PROVIDER_METHODS` frozen array (los 9 métodos canonical)
- `/Users/alex/dev/klab/kodo/src/interface.js:11-24` — `TaskItem` typedef (11 fields + opcional state)
- `/Users/alex/dev/klab/kodo/src/providers/plane/provider.js:24-253` — `createPlaneProvider` factory + 9 métodos
- `/Users/alex/dev/klab/kodo/src/providers/github/provider.js:67-177` — `createGitHubProvider` factory + 9 métodos
- `/Users/alex/dev/klab/kodo/src/providers/github/normalize.js:83-105` — `normalizeIssue` → TaskItem canonical
- `/Users/alex/dev/klab/kodo/src/providers/plane/normalize.js:64-80` — `normalizeWorkItem` → TaskItem canonical
- `/Users/alex/dev/klab/kodo/src/providers/registry.js:91-110` — `getProvider` valida `TASK_PROVIDER_METHODS`
- `/Users/alex/dev/klab/kodo/test/providers/github/provider.test.js:40-105` — fakeClient injection + live-fetch leak guard pattern
- `/Users/alex/dev/klab/kodo/test/providers/github/provider.test.js:117-125` — contract loop sobre TASK_PROVIDER_METHODS (precedente directo)
- `/Users/alex/dev/klab/kodo/test/plane-provider.test.js:62-124` — stubFetch routes table pattern (precedente Plane)
- `/Users/alex/dev/klab/kodo/test/plane-provider.test.js:24-29` — `for (const method of TASK_PROVIDER_METHODS)` pattern usado en Plane
- `/Users/alex/dev/klab/kodo/test/registry.test.js:41-67` — `createFakeGitHubClient()` reusable helper
- `/Users/alex/dev/klab/kodo/test/registry.test.js:133-152` — D-38 registry-level contract validation (precedente)
- `/Users/alex/dev/klab/kodo/test/interface.test.js:11-22` — interface contract assertions (anchor 9 methods + 5 priorities)
- `/Users/alex/dev/klab/kodo/.planning/phases/24-githubprovider-normalizer-registry/24-01-SUMMARY.md` — D-18 canonical-keys leak guard (11 fields) anchor
- `/Users/alex/dev/klab/kodo/.planning/phases/24-githubprovider-normalizer-registry/24-02-SUMMARY.md` — Divergencias justificadas Plane vs GitHub (1 table)
- `/Users/alex/dev/klab/kodo/.planning/ROADMAP.md:79-87` — Phase 27 success criteria SC#1-3
- `/Users/alex/dev/klab/kodo/.planning/REQUIREMENTS.md:35-38` — TEST-03 verbatim
- `/Users/alex/dev/klab/kodo/.planning/STATE.md:66-78` — Critical Invariants v0.7
- `/Users/alex/dev/klab/kodo/test/fixtures/github/issue.json` + 14 fixtures GitHub offline
- `/Users/alex/dev/klab/kodo/test/fixtures/plane-workitem.json` + `plane-labels.json` + `plane-webhook.json`

### Secondary (MEDIUM confidence)
- `npm test` baseline ejecutado 2026-05-14: **763 pass / 1 skipped / 0 fail / 7.4s wall-time**. Phase 27 target ≥ 763+N (con N≈18 si planner opta por N=9 asserts × 2 providers).
- `node:test` built-in (Node 18+) — `describe`/`it`/`before`/`after`/`beforeEach` API estándar; no `describe.each` (precedente Jest no aplica). Iteración con `for (const x of ARR) describe(...)` es el patrón idiomático.

### Tertiary (LOW confidence)
- Ninguna. Toda la información clave viene de archivos del repo verificados directamente.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| TEST-03 | `test/providers/contract.test.js` — provider-agnostic matrix corriendo el mismo contract suite contra `plane` y `github`; valida `TaskProvider` se cumple idéntico (mismas signatures, mismos error shapes); demuestra invariante v0.2 con uso real ≠ Plane | (1) Patterns 1-4 establecen el shape del matrix; (2) Fixtures existentes + DI patterns Phase 24 cubren toda la setup; (3) Open Questions resolved cierran las 7 ambigüedades pre-blocker; (4) Pitfalls 1-7 documentan los modos de fallo conocidos del matrix testing cross-adapter |

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `node:test` built-in, sin deps nuevas, todos los patterns ya en uso en el repo (Phase 24, registry test, plane-provider test)
- Architecture: HIGH — Test-only phase, cero touch a producción; el matrix es una composición de patterns existentes (DI factory + fakeClient + contract loop)
- Pitfalls: HIGH — 7 pitfalls identificados, 4 con precedente verificable en commits Phase 24; el resto extrapolados del análisis de divergencias Plane/GitHub
- Open Questions: HIGH — 7 questions resolved con justificación citada; cero ambigüedad residual para el planner

**Research date:** 2026-05-14
**Valid until:** 2026-06-13 (30 days — stack estable, Node test runner sin churn esperado)

---

## RESEARCH COMPLETE

**Phase:** 27 — Cross-Provider Contract Matrix
**Confidence:** HIGH

### Key Findings
- **Test-only phase:** CREATE `test/providers/contract.test.js` + opcional `test/providers/contract-helpers.js`. Zero MODIFY de producción (`src/providers/**`, `src/interface.js`, `src/labels.js` invariantes).
- **Patterns reusables ya existen:** Phase 24 establecio (a) fakeClient injection vía `opts.client` (D-36), (b) live-fetch leak guard (D-37), (c) contract loop sobre `TASK_PROVIDER_METHODS`, (d) D-18 canonical-keys leak guard (11 fields). El matrix compone estos patterns, no inventa nuevos.
- **DI divergence aislada en helper:** Plane usa `globalThis.fetch` stub; GitHub usa `opts.client`. Un único `instantiateProvider(name)` oculta la asimetría — el matrix loop no sabe ni le importa.
- **Test count derivado por construcción:** `N asserts × 2 providers`, recomendado N=7-9 (suite total 763 + 14-18 → 777-781). NO hardcodear counts.
- **7 Pitfalls catalogados:** init() asymmetry, globalThis.fetch cross-contamination, hardcoded counts, fixture shape divergence, Plane config.projects coupling, parseTriggerEvent semantic asymmetry, live fetch leak — todos con prevention concreto.

### File Created
`/Users/alex/dev/klab/kodo/.planning/phases/27-cross-provider-contract-matrix/27-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Standard Stack | HIGH | `node:test` built-in; cero deps nuevas; todos patterns verificados en commits Phase 24 |
| Architecture | HIGH | Composición de patterns existentes; zero production code touched |
| Pitfalls | HIGH | 7 pitfalls con precedente verificable o derivación lógica clara |
| Open Questions | HIGH | 7/7 resolved con justificación citada (zero blockers para planner) |

### Open Questions
**Ninguna.** Las 7 preguntas surgidas durante research están resolved con `RESOLVED:` prefix en su sección — la phase está lista para `/gsd-plan-phase 27` sin necesidad de `/gsd-discuss-phase` adicional.

### Ready for Planning
Research complete. Planner puede crear PLAN.md directamente con la estructura recomendada (1 wave, 2-3 tasks: fixtures-wiring + matrix-test + helper-extraction opcional).
