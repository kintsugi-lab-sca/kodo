# Phase 1: Interface + State Schema - Research

**Researched:** 2026-04-07
**Domain:** JSDoc typedefs, JSON schema migration, Node.js ESM pure JS
**Confidence:** HIGH

## Summary

Esta fase es puramente definitoria: no hay llamadas a APIs externas, no hay nuevas dependencias, no hay lógica de negocio nueva. Se trata de crear el contrato de datos en `src/interface.js` (typedefs JSDoc) y migrar `state.json` + `config.json` al nuevo schema provider-agnostic.

El codebase ya usa `@ts-check` y `@typedef` de forma consistente — el patrón está establecido. La migración de state es mecánica: renombrar dos campos, añadir dos nuevos, incrementar `schema_version`. La migración de config es igualmente mecánica: mover `plane.*` bajo `providers.plane.*` y añadir `provider: "plane"` en raíz.

El riesgo real no está en la implementación sino en la completitud del contrato: si `TaskProvider` o `TaskItem` quedan mal definidos en esta fase, las fases 2-4 heredarán el error. El CONTEXT.md ya resolvió todos los campos y métodos — la investigación confirma que esas decisiones son correctas y suficientes.

**Primary recommendation:** Un único `src/interface.js` con todos los typedefs. Mantener `state.js` y `config.js` con sus APIs públicas intactas, añadiendo solo la función `migrateIfNeeded()` internamente.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**TaskItem shape canónica:**
- `description` en Markdown — el adapter convierte desde el formato del provider
- `groups: string[]` — array de strings para soportar tareas en múltiples agrupaciones
- `url: string` — obligatorio, siempre presente
- `priority: string|null` — valores normalizados: urgent, high, medium, low, none
- `labels: string[]` — nombres de labels como strings (no UUIDs)
- Shape completa: `{ id, ref, title, description (markdown), labels (string[]), projectId, projectName, groups (string[]), url, priority }`

**TaskProvider API — 7 métodos + init:**
- `init()` — fail-fast asíncrono, valida credenciales y conexión
- `getTask(ref)` — obtiene tarea por referencia (ref = "KL-42", "#42", etc.)
- `updateTaskState(task, stateName)` — actualiza estado lógico por nombre
- `addComment(task, markdownText)` — añade comentario en Markdown
- `listPendingTasks()` — lista tareas pendientes con label kodo
- `parseTriggerEvent(rawPayload)` — parsea payload → TriggerEvent
- `verifySignature(rawBody, headers)` — verifica firma HMAC
- `resolveRef(humanRef)` — parsea ref de formato humano al ref canónico

**State migration:**
- Migración automática con backup (.bak) al detectar schema viejo
- Sesiones activas existentes se limpian durante migración
- `schema_version: 2` en el nuevo schema
- Campos: `plane_id` → `task_id`, `plane_identifier` → `task_ref`, nuevo campo `provider`

**Config migration (adelantada de Fase 5):**
- `plane.*` se mueve a `providers.plane.*`
- Nuevo campo raíz `provider: "plane"`
- Mapeo de estados: `providers.plane.states: { trigger: "In Progress", review: "In review", done: "Done" }`

### Claude's Discretion
- Estructura interna del archivo `interface.js` (un archivo vs múltiples)
- Orden de los campos en las typedefs
- Nombres exactos de las funciones helper de migración
- Formato del backup (.bak vs timestamp)

### Deferred Ideas (OUT OF SCOPE)
None — discussion stayed within phase scope
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|-----------------|
| INTF-01 | `TaskProvider` interfaz definida con 7 métodos via JSDoc `@typedef` | Contrato completo definido en CONTEXT.md; patrón JSDoc ya establecido en codebase |
| INTF-02 | `TaskItem` shape canónica definida | Campos completos decididos en CONTEXT.md; mapeo desde shape Plane actual documentado abajo |
| INTF-03 | `TriggerEvent` shape normalizada definida (taskRef, action, provider, raw) | Shape derivada del webhook payload actual de `server.js` |
| STAT-01 | Campos renombrados: `plane_id` → `task_id`, `plane_identifier` → `task_ref` | Impacto completo documentado: 6 archivos afectados |
| STAT-02 | Campo `provider` añadido a cada sesión en state.json | Valor literal `"plane"` para sesiones migradas |
| STAT-03 | `schema_version` en state.json para migraciones futuras | Schema actual NO tiene versión — se añade como campo raíz |
| STAT-04 | Migración automática de state.json existente al nuevo schema | Patrón de migración con backup documentado abajo |
| TEST-03 | Tests para state migration (old schema → new schema) | Framework: `node:test` (ya usado en test/). Patrón en test/state.test.js |
</phase_requirements>

---

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:fs` | Node 20+ built-in | Lectura/escritura de JSON files | Ya usado en config.js y state.js |
| `node:path` | Node 20+ built-in | Construcción de rutas | Patrón establecido en todo el codebase |
| `node:test` | Node 18+ built-in | Framework de testing | Ya usado en test/labels.test.js y test/state.test.js |
| `node:assert/strict` | Node 20+ built-in | Assertions en tests | Ya usado en todos los tests existentes |

### No hay dependencias nuevas
Esta fase no requiere ningún `npm install`. Todo se resuelve con Node built-ins y el patrón JSDoc `@typedef` ya establecido.

**Verification:** `package.json` tiene exactamente un dependency (`commander`). Esta fase no añade ninguno.

---

## Architecture Patterns

### Estructura de archivos a crear/modificar

```
src/
├── interface.js          ← NUEVO: todos los typedefs (TaskProvider, TaskItem, TriggerEvent)
├── config.js             ← MODIFICAR: DEFAULT_CONFIG nuevo schema + migrateConfigIfNeeded()
├── session/
│   └── state.js          ← MODIFICAR: typedef Session actualizada + migrateStateIfNeeded()
test/
└── migration.test.js     ← NUEVO: tests para STAT-01..04 (TEST-03)
```

### Patrón 1: JSDoc @typedef para interfaces (INTF-01, INTF-02, INTF-03)

**What:** Un archivo `src/interface.js` con los tres typedefs principales usando `@callback` para el contrato del provider.

**When to use:** Siempre que se defina una "interfaz" en JS puro sin TypeScript.

**Ejemplo basado en patrón existente del codebase:**
```javascript
// src/interface.js
// @ts-check

/**
 * Canonical task item — provider-agnostic representation of a task.
 *
 * @typedef {{
 *   id: string,
 *   ref: string,
 *   title: string,
 *   description: string,
 *   labels: string[],
 *   projectId: string,
 *   projectName: string,
 *   groups: string[],
 *   url: string,
 *   priority: 'urgent'|'high'|'medium'|'low'|'none'|null,
 * }} TaskItem
 */

/**
 * Normalized trigger event from any provider channel.
 *
 * @typedef {{
 *   taskRef: string,
 *   action: string,
 *   provider: string,
 *   raw: object,
 * }} TriggerEvent
 */

/**
 * @typedef {{
 *   init: () => Promise<void>,
 *   getTask: (ref: string) => Promise<TaskItem>,
 *   updateTaskState: (task: TaskItem, stateName: string) => Promise<void>,
 *   addComment: (task: TaskItem, markdownText: string) => Promise<void>,
 *   listPendingTasks: () => Promise<TaskItem[]>,
 *   parseTriggerEvent: (rawPayload: object) => TriggerEvent|null,
 *   verifySignature: (rawBody: string, headers: object) => boolean,
 *   resolveRef: (humanRef: string) => Promise<string>,
 * }} TaskProvider
 */
```

**Nota:** `@callback` es alternativa válida pero `@typedef` con función literal es más conciso y más común en el codebase actual.

### Patrón 2: Migración automática con backup (STAT-04)

**What:** `migrateStateIfNeeded()` se llama al inicio de `loadState()`. Detecta schema viejo por ausencia de `schema_version`, hace backup `.bak`, escribe nuevo schema.

**When to use:** Al arrancar cualquier operación que lee state.

```javascript
// Dentro de state.js — patrón de migración
function migrateStateIfNeeded() {
  if (!existsSync(STATE_PATH)) return;

  const raw = JSON.parse(readFileSync(STATE_PATH, 'utf-8'));

  // Ya migrado
  if (raw.schema_version === 2) return;

  // Backup antes de migrar
  writeFileSync(STATE_PATH + '.bak', JSON.stringify(raw, null, 2) + '\n');

  // Migrar: limpiar sesiones activas (asumimos 0 al upgradar)
  const newState = {
    schema_version: 2,
    sessions: {},
  };

  writeFileSync(STATE_PATH, JSON.stringify(newState, null, 2) + '\n');
  console.log('[kodo] State migrated to schema_version 2 (backup: state.json.bak)');
}
```

**Decisión de diseño (CONTEXT.md):** Las sesiones activas se limpian durante la migración. Esto es correcto porque al upgradar kodo no hay sesiones reales activas que se puedan recuperar (el workspace ref ya no es válido).

### Patrón 3: Config migration (adelantada de Fase 5)

**New DEFAULT_CONFIG shape:**
```javascript
const DEFAULT_CONFIG = {
  provider: 'plane',                    // ← nuevo campo raíz
  providers: {
    plane: {
      base_url: 'https://tasks.kintsugi-lab.com',
      api_key_env: 'PLANE_API_KEY',
      workspace_slug: 'k-lab',
      projects: [],
      states: {                          // ← estados configurables (antes trigger_state, etc.)
        trigger: 'In Progress',
        review: 'In review',
        done: 'Done',
      },
    },
  },
  cmux: { ... },      // sin cambios
  claude: { ... },    // sin cambios
  server: { ... },    // sin cambios
};
```

**La función `migrateConfigIfNeeded()`** detecta config viejo por presencia de `config.plane` (sin `providers`):
```javascript
function migrateConfigIfNeeded(config) {
  if (config.providers) return config; // ya migrado

  // Backup
  writeFileSync(CONFIG_PATH + '.bak', JSON.stringify(config, null, 2) + '\n');

  const planeOld = config.plane || {};
  return {
    ...config,
    provider: 'plane',
    providers: {
      plane: {
        base_url: planeOld.base_url,
        api_key_env: planeOld.api_key_env,
        workspace_slug: planeOld.workspace_slug,
        projects: planeOld.projects || [],
        states: {
          trigger: planeOld.trigger_state || 'In Progress',
          review: planeOld.review_state || 'In review',
          done: planeOld.done_state || 'Done',
        },
      },
    },
    // Eliminar plane.* viejo
    plane: undefined,
  };
}
```

### Anti-Patterns to Avoid

- **No cambiar las firmas públicas de `loadState()` / `saveState()` / `loadConfig()`**: Estos son importados por 6+ archivos. La migración debe ser transparente — ocurre dentro de `loadState()`/`loadConfig()` sin cambiar su API.
- **No migrar `state.json` in-place sin backup**: Hay datos reales en `~/.kodo/state.json` (confirmado: ROMAN-1 en review). El backup `.bak` es obligatorio.
- **No usar `@callback` para TaskProvider**: El typedef inline es más legible y consistente con el estilo del codebase.
- **No exportar la función `migrateStateIfNeeded` como pública**: Es un detalle de implementación interno, llamado desde `loadState()`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Schema version check | Parser personalizado | Campo `schema_version` en JSON + check al cargar | Simple y suficiente para un JSON file store |
| File backup | Rotación compleja con timestamps | `.bak` suffix simple | Migración ocurre una vez; simplicidad > robustez aquí |
| Interface validation runtime | Validador de schemas (ajv, zod) | JSDoc `@typedef` + `@ts-check` | Out of scope (ver REQUIREMENTS.md — TypeScript migration out of scope) |

**Key insight:** Este proyecto usa JSON files como store por diseño ("JSON files suficiente para el volumen actual"). No hay necesidad de introducir validación runtime ni schemas formales (JSONSchema, Zod). Los typedefs son para el tooling del editor.

---

## Common Pitfalls

### Pitfall 1: Romper los importadores de `state.js`
**What goes wrong:** Cambiar el nombre del campo `plane_id` en la typedef Session sin actualizar todos los consumers. `health.js`, `server.js`, `manager.js`, `stop.js`, `session-start.js`, `check.js` usan `plane_id` o `plane_identifier` directamente.

**Why it happens:** La typedef se actualiza pero los consumers siguen usando los nombres viejos — `@ts-check` detectará warnings pero no errores fatales en runtime.

**How to avoid:** Fase 1 solo define el nuevo schema en `state.js`. Los consumers se actualizan en Fase 3 (REWI-*). Mientras tanto, mantener compatibilidad: la nueva typedef usa `task_id`/`task_ref` pero los archivos de datos migrados también son correctos.

**Warning signs:** `@ts-check` emite warnings sobre `session.plane_id` siendo `undefined` — esperado y correcto en Fase 1.

### Pitfall 2: Config migration rompe `getPlaneApiKey()`
**What goes wrong:** `getPlaneApiKey()` en `config.js` accede a `config.plane.api_key_env`. Si se migra la config a `providers.plane.api_key_env`, esta función falla hasta que se actualice.

**How to avoid:** Actualizar `getPlaneApiKey()` en el mismo commit que se cambia `DEFAULT_CONFIG`. Es una función pequeña y local a `config.js`.

### Pitfall 3: State.json existente tiene sesión real (ROMAN-1)
**What goes wrong:** El state actual tiene `"9946d660..."` con `status: "review"`. La migración limpia las sesiones — si el usuario no sabe esto, puede sorprenderse.

**How to avoid:** El backup `.bak` protege los datos. El console.log de migración es suficiente aviso. Documentar en el commit message que las sesiones en review se pierden.

### Pitfall 4: `migrateConfigIfNeeded` devuelve config con `plane: undefined`
**What goes wrong:** `JSON.stringify` de un objeto con `key: undefined` omite la clave — correcto. Pero `{ ...config, plane: undefined }` en JavaScript sí incluye `plane` en el spread result; solo se omite en `JSON.stringify`.

**How to avoid:** Usar destructuring para eliminar `plane` explícitamente:
```javascript
const { plane: _removed, ...rest } = config;
return { ...rest, provider: 'plane', providers: { ... } };
```

---

## Code Examples

### Estructura completa del nuevo Session typedef

```javascript
// src/session/state.js — typedef actualizada (STAT-01, STAT-02, STAT-03)

/**
 * @typedef {{
 *   workspace_ref: string,
 *   session_id: string,
 *   task_id: string,        // antes: plane_id
 *   task_ref: string,       // antes: plane_identifier (e.g. "KL-42")
 *   provider: string,       // nuevo: "plane", "github", etc.
 *   project_id: string,
 *   summary: string,
 *   status: 'running'|'done'|'error'|'review',
 *   started_at: string,
 *   project_path: string,
 * }} Session
 *
 * @typedef {{
 *   schema_version: number,
 *   sessions: Record<string, Session>
 * }} State
 */
```

### Test pattern para state migration (TEST-03)

```javascript
// test/migration.test.js — patrón basado en test/state.test.js existente
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_DIR = join(tmpdir(), `kodo-migration-test-${Date.now()}`);
const TEST_STATE = join(TEST_DIR, 'state.json');

describe('state migration', () => {
  beforeEach(() => {
    mkdirSync(TEST_DIR, { recursive: true });
  });

  it('migrates old schema (no schema_version) to v2', () => {
    // Schema viejo: tiene plane_id y plane_identifier
    const oldState = {
      sessions: {
        'uuid-123': {
          workspace_ref: 'workspace:1',
          plane_id: 'uuid-123',
          plane_identifier: 'KL-42',
          project_id: 'proj-1',
          status: 'running',
        },
      },
    };
    writeFileSync(TEST_STATE, JSON.stringify(oldState));

    // Llamar a la función de migración (importando con path override o inyectando path)
    const result = migrateState(oldState);

    assert.equal(result.schema_version, 2);
    assert.deepEqual(result.sessions, {}); // sesiones limpiadas
  });

  it('creates .bak file before migrating', () => {
    const oldState = { sessions: {} };
    writeFileSync(TEST_STATE, JSON.stringify(oldState));

    performMigrationWithBackup(TEST_STATE);

    assert.ok(existsSync(TEST_STATE + '.bak'));
  });

  it('skips migration if schema_version === 2', () => {
    const newState = { schema_version: 2, sessions: {} };
    writeFileSync(TEST_STATE, JSON.stringify(newState));

    const result = loadAndMigrateState(TEST_STATE);

    assert.equal(result.schema_version, 2);
    assert.ok(!existsSync(TEST_STATE + '.bak')); // no backup si no migra
  });
});
```

**Nota de implementación:** Para que los tests sean aislados (no depender de `~/.kodo/`), la función de migración debe aceptar el path como parámetro, o los tests deben hacer mock del `STATE_PATH`. El patrón recomendado es extraer la lógica pura de migración a una función que recibe el objeto state y devuelve el nuevo state (testable sin filesystem), separada de la función que hace el I/O con backup.

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `plane_id` como key del record | `task_id` como campo interno + key sigue siendo `task_id` | Phase 1 | `sessions[task_id]` — la key del Record también cambia de semántica (era plane UUID, sigue siendo el task UUID del provider) |
| `config.plane.trigger_state` (string) | `config.providers.plane.states.trigger` (objeto) | Phase 1 | Permite múltiples providers con estados distintos |
| Sin `schema_version` | `schema_version: 2` | Phase 1 | Habilita migraciones futuras |

**Key insight sobre la key del sessions Record:** En el schema actual, `sessions["9946d660-..."]` usa el Plane UUID como key. En el nuevo schema, esa misma key será el `task_id` del provider activo. Para Plane sigue siendo un UUID. Para GitHub sería el issue number como string. Esto es correcto — la key es opaca para el store, lo importante es que sea única por sesión.

---

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (Node 20+ built-in) |
| Config file | ninguno — invocado directamente |
| Quick run command | `node --test test/migration.test.js` |
| Full suite command | `node --test test/**/*.test.js` |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| INTF-01 | TaskProvider typedef tiene 8 métodos exactos | unit (estructura) | `node --test test/interface.test.js` | ❌ Wave 0 |
| INTF-02 | TaskItem typedef tiene todos los campos requeridos | unit (estructura) | `node --test test/interface.test.js` | ❌ Wave 0 |
| INTF-03 | TriggerEvent typedef tiene taskRef, action, provider, raw | unit (estructura) | `node --test test/interface.test.js` | ❌ Wave 0 |
| STAT-01 | `migrateState()` renombra plane_id → task_id y plane_identifier → task_ref | unit | `node --test test/migration.test.js` | ❌ Wave 0 |
| STAT-02 | `migrateState()` añade campo provider: "plane" | unit | `node --test test/migration.test.js` | ❌ Wave 0 |
| STAT-03 | Estado migrado tiene schema_version: 2 | unit | `node --test test/migration.test.js` | ❌ Wave 0 |
| STAT-04 | Migración crea .bak y limpia sesiones | unit | `node --test test/migration.test.js` | ❌ Wave 0 |
| TEST-03 | (mismo que STAT-01..04) | unit | `node --test test/migration.test.js` | ❌ Wave 0 |

**Nota sobre INTF-01/02/03:** Los typedefs JSDoc no son testeables en runtime de forma directa (no existen en runtime). Los tests de interfaz verifican que el objeto exportado `TASK_PROVIDER_METHODS` o similar tenga la lista correcta, o simplemente que el archivo `interface.js` exporta los nombres esperados. Alternativa más pragmática: test de integración que construye un objeto vacío y verifica con JSDoc. En la práctica, estos tests son de documentación — el valor real viene del type-checking del editor.

**Recomendación:** Para INTF-*, los tests verifican que las constantes de ayuda (si se crean, e.g. `TASK_PROVIDER_METHODS = ['init', 'getTask', ...]`) tienen exactamente los métodos correctos. Si no se crean constantes de ayuda, los tests de interfaz se omiten o son smoke tests de importación.

### Sampling Rate
- **Per task commit:** `node --test test/migration.test.js`
- **Per wave merge:** `node --test test/**/*.test.js`
- **Phase gate:** Full suite green (15 tests existentes + nuevos) antes de `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/migration.test.js` — cubre STAT-01, STAT-02, STAT-03, STAT-04 (TEST-03)
- [ ] `test/interface.test.js` — cubre INTF-01, INTF-02, INTF-03 (smoke tests de importación y constantes)

---

## Impact Analysis: Files Touched

Esta es la lista completa de archivos que Phase 1 CREA o MODIFICA. Crítico para el planner:

**Archivos NUEVOS:**
- `src/interface.js` — typedefs TaskProvider, TaskItem, TriggerEvent
- `test/migration.test.js` — tests de migración

**Archivos MODIFICADOS:**
- `src/session/state.js` — typedef Session actualizada + `migrateStateIfNeeded()` añadida
- `src/config.js` — `DEFAULT_CONFIG` nuevo schema + `migrateConfigIfNeeded()` + `getPlaneApiKey()` actualizada

**Archivos NO modificados en Phase 1** (se actualizan en Fase 3):
- `src/server.js` — sigue usando `config.plane.*` (será REWI-04 en Fase 4)
- `src/session/manager.js` — sigue usando `plane_id`, `plane_identifier` (REWI-03)
- `src/hooks/stop.js` — sigue usando `session.plane_id` (REWI-02)
- `src/hooks/session-start.js` — sigue usando `session.plane_identifier`, `session.plane_id` (REWI-05)
- `src/check.js` — sigue usando `config.plane.projects` (REWI-01)
- `src/session/health.js` — sigue usando `session.plane_identifier` como `identifier`

**Consecuencia:** Tras Phase 1, el codebase tendrá un periodo de inconsistencia temporal — la typedef dice `task_id` pero los consumers usan `plane_id`. `@ts-check` emitirá warnings. Esto es esperado y se resuelve en Fase 3.

---

## Open Questions

1. **¿`interface.js` debe exportar algo en runtime?**
   - What we know: Los typedefs JSDoc no existen en runtime — son solo para el editor
   - What's unclear: ¿Necesitamos exportar constantes de ayuda (`TASK_PROVIDER_METHODS`, `VALID_PRIORITIES`) para los tests o para validación en adapters?
   - Recommendation: Sí, exportar al menos `VALID_PRIORITIES = ['urgent', 'high', 'medium', 'low', 'none']` para que los adapters puedan validar sin duplicar la lista. Facilita también los tests.

2. **¿La key del `sessions` Record cambia?**
   - What we know: Actualmente la key es el `plane_id` (UUID de Plane). El nuevo campo se llama `task_id`.
   - What's unclear: Si la key sigue siendo el `task_id` del provider (UUID para Plane, issue number para GitHub), los consumers que hacen `addSession(workItem.id, session)` siguen funcionando sin cambios.
   - Recommendation: La key sigue siendo el task ID opaco del provider. No hay cambio de semántica — solo el nombre del campo dentro del objeto Session.

3. **¿`migrateConfigIfNeeded()` es pública o privada?**
   - What we know: Debe llamarse dentro de `loadConfig()` para ser transparente
   - Recommendation: Privada (no exportada). Misma decisión que para state.

---

## Sources

### Primary (HIGH confidence)
- Codebase directo — `src/session/state.js`, `src/config.js`, `src/labels.js`, `src/plane/client.js` leídos y analizados
- `~/.kodo/state.json` — estado real en producción (schema v1 con sesión ROMAN-1)
- `test/state.test.js`, `test/labels.test.js` — patrones de testing existentes
- `package.json` — Node 20+, `node:test` disponible

### Secondary (MEDIUM confidence)
- CONTEXT.md — decisiones de diseño del usuario ya tomadas (source of truth para esta fase)
- REQUIREMENTS.md — IDs y descripciones de requirements

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — sin dependencias nuevas, todo Node built-ins
- Architecture: HIGH — código existente leído directamente, patrones confirmados
- Pitfalls: HIGH — derivados de análisis de código real + state.json de producción
- Test patterns: HIGH — basados en tests existentes que ya pasan

**Research date:** 2026-04-07
**Valid until:** Estable — no hay dependencias externas que cambien
