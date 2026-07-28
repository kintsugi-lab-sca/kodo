# Phase 85: Saneo de deuda + Nyquist retroactivo - Pattern Map

**Mapped:** 2026-07-27
**Files analyzed:** 6 ficheros de código/test modificados + 6 `VALIDATION.md` archivados
**Analogs found:** 5 / 6 (uno declarado sin analog por trivialidad, ver §No Analog Found)

> **Esta fase no crea ningún fichero nuevo.** Todo es modificación in-place de ficheros existentes. El valor del pattern-mapping está concentrado en 4 puntos: el guard source-grep de D-09, el test DI de D-08, el caso RED de D-06 y el molde de los 6 backfills NYQ. Lo demás se declara explícitamente sin analog en vez de rellenarse.

---

## File Classification

| Fichero modificado | Rol | Data flow | Analog más cercano | Match |
|--------------------|-----|-----------|--------------------|-------|
| `src/session/state.js` (~`:53`) | model / typedef JSDoc | — (comment-only) | *(ninguno — ver §No Analog Found)* | n/a |
| `src/cli/dashboard/select.js` (`deriveAnyNext`, `:258-260`) | utility (capa derive TUI) | transform (puro, síncrono) | `src/cli/dashboard/format.js` → `nextCell` (`:264`) + el propio `deriveAnyProgress` (`:241-243`) | exact |
| `src/check.js` (piggyback, `:156-166`) | controller / orquestación CLI | event-driven fail-open | las 3 líneas hermanas del mismo bloque (`:158`, `:161`, `:165`) | exact (self-analog) |
| `test/dashboard-select.test.js` (~`:471`) | test (unit puro) | transform | el propio `describe` LIVE-05 (`:471-499`) | exact |
| `test/check.test.js` (~`:439`) | test (unit con DI) | request-response | `describe('check.js — runCheckAndAct sidebar doctor piggyback (ORCH-07)')` (`:321-440`) | exact |
| `test/check-isolation.test.js` (guard nuevo) | test (source-hygiene guard) | file-I/O + grep | `test/skill-sync.test.js:815-842` (guard D-08b, Phase 84) + `stripComments` de `test/dispatcher-isolation.test.js:24-30` | exact |
| 6 × `.planning/milestones/v0.1{6,8}-phases/**/{N}-VALIDATION.md` | artefacto de planificación | doc backfill | `.planning/milestones/v0.10-phases/41-…/41-VALIDATION.md` | exact |

---

## Pattern Assignments

### 1. `test/check-isolation.test.js` — guard source-grep de D-09 (WR-03)

**Analog primario:** `test/skill-sync.test.js:815-842` (guard *source-hygiene* de Phase 84).
**Analog secundario:** `test/dispatcher-isolation.test.js:24-30` (copia canónica de `stripComments`).

#### 1a. `stripComments` — copiar VERBATIM con línea de procedencia

Vive verbatim en **9 ficheros de test**. `test/helpers/` existe pero aloja fixtures y procesos hijo, **no** helpers de aserción — el repo ya tomó esta decisión 9 veces. Copiar tal cual, incluida la línea de procedencia (`test/skill-sync.test.js:113-121`):

```js
// stripComments verbatim de test/dispatcher-isolation.test.js:24-30 — filtra
// comentarios para asserts source-hygiene sobre código (no documentación).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}
```

> **Sin este filtro el guard sale ROJO a HEAD con 13 falsos positivos**, 5 de ellos apuntando literalmente a `../logger.js` — todos imports de TIPO en JSDoc, borrados en runtime (RESEARCH §1c). Debilitar el assert después para greenearlos está prohibido por el constraint anti-greenear.

#### 1b. Forma del guard — molde de `skill-sync.test.js:815-842`

Los elementos a replicar, en este orden:

1. **Comentario de cabecera largo** que explica *por qué existe el guard* y qué regresión impide (`:816-830`).
2. **Regex CONSTANTE declarada dentro del `it`, nunca compilada desde input** — en `skill-sync` es `const REGISTRY_IMPORT_RE = /…/;` (`:831-832`).
3. **Bucle sobre la lista de ficheros**, leyendo con `readFileSync(..., 'utf-8')` y pasándolo por `stripComments` **antes** del `.test()`.
4. **`assert.equal(RE.test(stripped), false, mensaje-que-explica-la-invariante)`** — negativo explícito, no `assert.ok`.

```js
// Analog literal a copiar (test/skill-sync.test.js:831-841):
const REGISTRY_IMPORT_RE =
  /import\s*(?:\{[^}]*\bKODO_SKILLS\b[^}]*\}|\*\s+as\s+\w+)\s*from\s*['"][^'"]*skill-sync\.js['"]/;

for (const rel of [['src', 'orchestrator', 'launch.js'], ['src', 'hooks', 'stop.js']]) {
  const stripped = stripComments(readFileSync(join(REPO, ...rel), 'utf-8'));
  assert.equal(
    REGISTRY_IMPORT_RE.test(stripped),
    false,
    `${rel.join('/')} no debe importar el registro de src/cli/skill-sync.js — sigue siendo single-skill por D-08b`,
  );
}
```

**Adaptación para D-09** — la única diferencia estructural es que la lista de ficheros **no se hardcodea**: sale de `walkImports(join(SRC, 'check.js'))`, que ya existe en el mismo fichero (`:40-52`). Regex admisible ya verificada por RESEARCH §1d (1 hit, en allowlist ⇒ GREEN):

```js
const DYNAMIC_LOGGER_IMPORT_RE = /\bimport\s*\(\s*['"]([^'"]*logger[^'"]*\.js)['"]/g;
const LOGGER_ALLOWLIST_RE = /logger-events\.js$|logger-noop\.js$/;
```

**`walkImports` NO se modifica.** Seguir aristas dinámicas dentro del walker pone ROJOS dos guards existentes (`github/provider.js` `:113-121` y `github/normalize.js` `:123-131`) — RESEARCH §Pitfall 1.

#### 1c. Mensajes de assert — molde del fichero destino

Los asserts de `check-isolation.test.js` **imprimen el grafo completo** en el mensaje de fallo (`:82-87`). Replicarlo: un fallo de LOG-12 debe decir por qué camino entra.

```js
// test/check-isolation.test.js:82-87
assert.deepEqual(
  violators,
  [],
  `check.js transitively imports src/logger.js via:\n  ${relViolators.join('\n  ')}\n` +
    `Full graph from check.js:\n  ${relGraph.join('\n  ')}`,
);
```

#### 1d. Comentario mentiroso a corregir (`:14` y `:33-34`)

Texto actual, ambas ocurrencias — es la premisa falsa que WR-03 denuncia:

```js
// :14
// No cubre `import()` dinámico — el repo no lo usa (verificado en 06-RESEARCH A3).
// :33-34
 * No sigue dynamic `import()` (el repo no los usa — verificado por grep en 06-RESEARCH A3).
```

El comentario nuevo debe decir dos cosas (RESEARCH §1f): (a) el repo **sí** usa `import()` dinámico (`src/providers/registry.js:27,28,57,58`); (b) los guards son sobre el grafo de **MODULE-LOAD**, no una afirmación de alcanzabilidad en runtime.

---

### 2. `test/check.test.js` — nuevo Test F de D-08 (WR-01 + WR-02)

**Analog:** el `describe` de `test/check.test.js:321-440` (el mismo bloque). Ubicación del test nuevo: **después del Test E** (`:439`), dentro del mismo `describe`.

**Helpers ya existentes en el bloque** (`:322-336`) — el test nuevo **no** los usa (necesita un report sucio), pero debe respetar su forma de fixture-factory:

```js
/** SidebarReport limpio (sin acciones ni advisories). */
function cleanReport() {
  return {
    missing_group: [], loose_workspace: [], empty_group: [],
    protected: { sessions: [] },
    hasActions: false, hasAdvisories: false,
  };
}
/** SidebarResult vacío (0 acciones). */
function emptyResult() {
  return { created: 0, added: 0, ungrouped: 0, errors: [] };
}
```

**Shape DI canónica — las 6 inyecciones SIEMPRE, en este orden** (`test/check.test.js:341-348`, Test A):

```js
await runCheckAndAct({
  runCheckFn: async () => ({ needsOrchestrator: true, reasons: ['x'], summary: 's' }),
  scanFn: async () => { order.push('scan'); return cleanReport(); },
  executeFn: async (_deps, opts) => { order.push('execute'); execArgs = opts; return emptyResult(); },
  launchFn: async () => { order.push('launch'); },
  logFn: () => {},
  errorFn: () => {},
});
```

**Patrón de captura de output — el delta del test nuevo.** Los 6 casos existentes descartan el output (`logFn: () => {}`). El analog de captura por array no existe en este `describe`; el más cercano es el patrón `order.push(...)` de los Tests A/B/C (`:339`, `:358`, `:372`): array `const` declarado antes del `await`, alimentado desde la lambda inyectada. El test nuevo aplica ese mismo patrón a **dos arrays separados**, `logs` y `errs` — **nunca uno mezclado** (UI-SPEC: el orden cross-canal no es contractual y un assert de secuencia sería flaky por construcción).

**Naming del `it`:** el bloque usa `'Test X: <resumen> (<ref de decisión>)'` — `'Test A: gate ON — executeFn recibe { fix: true } y corre ANTES de launchFn (orden D-05)'`. El nuevo sigue siendo `Test F` con refs `(WR-01/WR-02)`.

**Literales de assert:** exactos, tomados de `src/check.js:158,161` verbatim, más el nuevo de UI-SPEC §S-2:

```
[kodo:check] Sidebar: 3 acción(es) aplicadas
[kodo:check] Sidebar advisories: 1 (acción de operador)
[kodo:check] Sidebar: 2 acción(es) fallida(s) (fail-open)
```

**Doble mitad del assert de canal** (sin ella una regresión de canal pasa en verde): pertenencia en `errs[]` **y** ausencia de `fallida` en `logs[]`.

---

### 3. `src/check.js` — la línea nueva de D-07

**Analog:** el propio bloque `:156-166`. El código nuevo se coloca **inmediatamente después** del `logFn` de aplicadas y **antes** de la rama `hasAdvisories` — las dos líneas derivadas de `r` (execute) quedan juntas.

Estilo a igualar (defensive `|| 0` / `|| []`, template literal, prefijo `[kodo:*]`, texto plano sin color):

```js
const applied = (r.added || 0) + (r.ungrouped || 0);
logFn(`[kodo:check] Sidebar: ${applied} acción(es) aplicadas`);
```

Forma prescrita del delta (UI-SPEC §S-2, literal contractual):

```js
const failed = (r.errors || []).length;
if (failed > 0) {
  errorFn(`[kodo:check] Sidebar: ${failed} acción(es) fallida(s) (fail-open)`);
}
```

`errorFn`, **no** `logFn` (D-07 LOCKED). Sin ramificación singular/plural: `acción(es) fallida(s)` con paréntesis, igual que la hermana `acción(es) aplicadas`.

---

### 4. `test/dashboard-select.test.js` — caso RED de D-06

**Analog:** el `describe` LIVE-05 existente (`:471-499`). El caso nuevo va **dentro** del mismo `describe`; los 5 `it` existentes **no se tocan**.

Estilo de assert del bloque — one-liner `assert.equal(deriveAnyNext(<literal inline>), <bool>)`, sin fixture externo, con `// @ts-expect-error` cuando se modela dato malformado:

```js
it('Test 2: false cuando NINGUNA fila tiene next no-vacío', () => {
  assert.equal(deriveAnyNext([{ next: null }, {}]), false);
  assert.equal(deriveAnyNext([{ next: '' }, { next: undefined }]), false);
  assert.equal(deriveAnyNext([]), false);
});

it('Test 3: un next no-string (número/objeto) NO cuenta', () => {
  // @ts-expect-error modelamos dato malformado
  assert.equal(deriveAnyNext([{ next: 42 }, { next: {} }]), false);
});
```

Los 3 casos RED (RESEARCH §2e): `'   '`, `'\n\t'`, `' \r\n '` → `false`. Convención de naming del bloque: `'Test N: …'` o `'<REF>: <descripción>'` (ver `'RESEARCH Pitfall 4: …'`, `:488`).

---

### 5. `src/cli/dashboard/select.js` — la delegación de D-04

**Analog:** `src/cli/dashboard/format.js:25` (el único import del módulo destino, la razón por la que la delegación es segura) y el hermano `deriveAnyProgress` (`:241-243`, one-liner `rows.some(...)`).

Estado actual (`:258-260`) — el docblock de 12 líneas **se conserva**, solo cambia el predicado:

```js
export function deriveAnyNext(rows) {
  return rows.some((r) => typeof r.next === 'string' && r.next.length > 0);
}
```

Forma destino (D-04 LOCKED): `rows.some((r) => nextCell(r).length > 0)`, con `import { nextCell } from './format.js';`.

**Dónde colocar el import:** el fichero hoy tiene **cero imports de runtime**; su cabecera termina con el bloque de comentarios de color-isolation (`:26-27`) seguido del `@typedef {import('./format.js').EnrichedSession}` (`:30-32`). El import va **después** de ese bloque de comentarios y **antes** del `@typedef`, que ya referencia el mismo módulo.

**Comentario de color-isolation a preservar intacto** (`:26-27`) — es la invariante que el guard §TUI-04 custodia:

```js
// Color-isolation (invariante D-12 Phase 34): este módulo NO importa `picocolors` ni
// `src/cli/format.js`. test/format-isolation.test.js lo verifica vía walker automático.
```

El docblock de `deriveAnyNext` debe además dejar de prometer `next.length > 0` sobre el crudo: la nueva línea de contrato es «un `next` que colapsa a vacío NO enciende la columna», con referencia a `nextCell` como fuente única del colapso.

---

### 6. Los 6 `{N}-VALIDATION.md` — molde del backfill NYQ

**Analog primario:** `.planning/milestones/v0.10-phases/41-doctor-m-dulo-puro-de-saneo-cli/41-VALIDATION.md` (89 líneas, backfill Phase 47).
**Analog secundario:** `.planning/milestones/v0.11-phases/44-…/44-VALIDATION.md` (fórmula de cita en inglés).

#### 6a. Frontmatter

`41` usa `status: approved`; **D-14 manda `validated`**. Y **hay que conservar los dos comentarios de lifecycle que 79/80/81 ya traen** (69/71/72 no los traen — no se les añaden):

```yaml
---
phase: 79
slug: sidebar-doctor
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: validated
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-23
---
```

`created` **no se toca** (es la fecha original de la fase). `wave_0_complete` solo pasa a `true` si el backfill puede citarlo; ante duda se deja como está.

#### 6b. Blockquote de cabecera — 3 líneas, wording literal a adaptar

`41-VALIDATION.md:12-14`, verbatim salvo los números de fase/NYQ y el conteo de SUMMARY:

```markdown
> Per-phase validation contract reconstruido retroactivamente (backfill Nyquist Phase 47, NYQ-01).
> Cobertura **citada** de `41-VERIFICATION.md` (passed 9/9 must-haves) + los 3 SUMMARY de plan.
> **Sin re-ejecutar la suite** — cada dimensión referencia el resultado empírico ya registrado.
```

Sustituciones: `Phase 47` → `Phase 85`; `NYQ-01` → `NYQ-01` (79/80/81) o `NYQ-02` (69/71/72); `9/9` → el score real del `{N}-VERIFICATION.md`; `3 SUMMARY` → el `plan_count` real (79:4 · 80:2 · 81:3 · 69:4 · 71:5 · 72:5).

Variante inglesa de `44-VALIDATION.md:13`, por si el fichero destino está en inglés: `«… No suite re-run — coverage is cited from the empirical evidence already on disk.»`

#### 6c. `## Test Infrastructure` — la fila que hay que AÑADIR

La tabla ya existe en los 6 (aunque 72 la trae como plantilla sin rellenar). El delta del backfill es la última fila (`41-VALIDATION.md:26`):

```markdown
| **Evidencia citada** | `41-VERIFICATION.md` (2026-06-04, status passed, score 9/9) |
```

#### 6d. `## Sampling Rate` — 3 bullets (`41-VALIDATION.md:32-34`)

```markdown
- **Evidencia primaria:** `41-VERIFICATION.md` — verificación inicial passed, 9/9 observable truths + 7/7 artifacts + 6/6 key-links verificados.
- **Política Nyquist (backfill):** la cobertura ES la cita a la evidencia preexistente; no se re-corre la suite (D-03 / D-05).
- **UAT humano bloqueante:** completado durante la ejecución (Plan 03, Task 2) — 18/18 aserciones en sandbox aislado `/tmp/kodo-doctor-uat.sh`.
```

En Phase 85 la ref de decisión del segundo bullet es **D-12** (no D-03/D-05). El tercer bullet solo aplica donde hay UAT real (71 y 72 traen `UAT.md`).

#### 6e. `## Per-Task Verification Map` — cabecera y leyenda exactas

`41-VALIDATION.md:38-47`. La columna clave es la sexta, **«Evidencia citada (fichero + resultado)»**:

```markdown
## Per-Task Verification Map (dimensión → cobertura citada)

| Requirement | Plan | Dimensión / Secure Behavior | Test Type | Automated Command | Evidencia citada (fichero + resultado) | Status |
|-------------|------|-----------------------------|-----------|-------------------|----------------------------------------|--------|
| DOCTOR-01 | 41-03 | … | unit (CLI) | `node --test test/gsd-doctor-cli.test.js` | `41-VERIFICATION.md` Behavioral Spot-Checks → **13 pass / 0 fail**; Observable Truth #1 ✓ VERIFIED | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky / manual-only*
```

**Convención de la celda de evidencia** (lo que el executor debe reproducir 6 veces): `` `{N}-VERIFICATION.md` `` + sección citada + **conteo en negrita** `**X pass / 0 fail**` + el `Truth #N ✓ VERIFIED` correspondiente. Nunca una afirmación sin fichero:sección detrás.

#### 6f. Secciones restantes

| Sección | Molde | Nota |
|---------|-------|------|
| `## Wave 0 Requirements` | `41:53` | Prosa de una frase: infra nativa suficiente |
| `## Manual-Only Verifications` | `41:59-61` | Columnas `Behavior \| Requirement \| Why Manual \| Evidencia` — **aquí caen las filas de D-12** si el auditor ve un gap |
| `## Validation Sign-Off` | `41:67-74` | 6 checkboxes marcados + `**Approval:** validated {fecha} (backfill Phase 85, NYQ-0X)` — `validated`, no `approved` |
| `## Reconstruction Audit {fecha} (Phase 85 NYQ-0X)` | `41:78-89` | Tabla de 6 métricas + párrafo final **Nota Nyquist** cerrando con «Fase declarada **nyquist-compliant**» |

---

## Shared Patterns

### Regex constante de módulo (anti-ReDoS)

**Fuente:** `test/check-isolation.test.js:15-16`, `test/skill-sync.test.js:831`.
**Aplica a:** el guard de D-09.

```js
const IMPORT_FROM_RE = /^\s*(?:import|export)\s+[\s\S]*?from\s+['"]([^'"]+)['"]/gm;
const IMPORT_BARE_RE = /^\s*import\s+['"]([^'"]+)['"]/gm;
```

Declaradas como `const` en scope de módulo o de `it`, **jamás** compiladas desde input externo.

### Comentario-de-porqué sobre cada guard

**Fuente:** `test/check-isolation.test.js:167-176` (guard D-13) y `:196-204` (guard D-02).
**Aplica a:** el guard nuevo de D-09.

Estructura constante: `// Phase NN D-XX: <qué invariante>` → párrafo `// Por qué existe este guard y no basta con la disciplina: <la regresión concreta que entraría en silencio>`. Es la convención que hace auditables los guards de este fichero; el guard de D-09 sin ese párrafo desentona.

### Anclaje de asserts al patrón, nunca al identificador suelto

**Fuente:** `test/skill-sync.test.js:828-830` (comentario literal).
**Aplica a:** el guard de D-09 y al Test F.

> «El assert está anclado al PATRÓN DE IMPORT, nunca al identificador suelto: un comentario que documente la regla (como este) no puede poner roja la suite — lección explícita de 83-02 y 83-05.»

Es exactamente el mismo fallo que `stripComments` previene en D-09: prosa que menciona `logger.js` no puede poner rojo el guard.

### Convención de prefijo de salida CLI

**Fuente:** `src/check.js:158,161,165` + `.planning/codebase/CONVENTIONS.md`.
**Aplica a:** la línea nueva de D-07.

`[kodo:check] ` + sustantivo + `: ` + conteo + sustantivo con `(es)`/`(s)` parentético. Texto plano, sin color, sin emoji.

---

## No Analog Found

| Fichero | Rol | Razón |
|---------|-----|-------|
| `src/session/state.js` (~`:53`) | typedef JSDoc | Reescritura de **una** línea de comentario. El analog es el propio fichero, 350 líneas más abajo: `:405-410` ya contiene la tabla correcta del contrato tres-estados (`non-empty string → OVERWRITE` / `` `null` (explicit) → CLEAR `` / `field ABSENT/undefined → PRESERVE`) y `:425` su prosa. **El texto nuevo del typedef debe ser coherente con esos dos, no inventar formulación propia.** No hay más patrón que extraer: RESEARCH §4b confirma que `:427-430` ya es correcto y no se toca. |

---

## Metadata

**Analog search scope:** `src/`, `test/`, `.planning/milestones/v0.1{0,1,6,8}-phases/`
**Ficheros leídos en este pase:** 8 (`check-isolation.test.js` completo · `skill-sync.test.js` ×2 rangos · `check.test.js:300-445` · `dashboard-select.test.js:460-508` · `41-VALIDATION.md` completo · `44-VALIDATION.md:1-30` · `79-VALIDATION.md:1-25` · excerpts de `select.js`/`format.js`/`state.js`/`check.js`)
**Pattern extraction date:** 2026-07-27
