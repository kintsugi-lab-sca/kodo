# Phase 45: Inyección de plan ligero universal - Research

**Researched:** 2026-06-10
**Domain:** Node.js ESM, Claude Code SessionStart hook, prompt-string construction, golden-bytes test invariants
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** El plan ligero se persiste en `~/.kodo/plans/<task_id>.md` (kodo home, fuera del repo). Reusa la convención `~/.kodo/` (`src/config.js:6` `KODO_DIR = join(homedir(), '.kodo')`).
- **D-02:** Correlación por **`task_id`** (no `session_id`). El overlay (Phase 46) hará `~/.kodo/plans/${row.task_id}.md`.
- **D-03:** La creación del directorio `~/.kodo/plans/` la hace la **sesión** al escribir (el tool Write de Claude crea parents). El hook NO pre-crea el directorio — solo inyecta la instrucción con la ruta absoluta resuelta.
- **D-04:** Reciben la instrucción exactamente dos rutas de código: (a) `buildSessionContext` **entero** (non-GSD); (b) la rama `mode === 'quick'` de `buildGsdContext`. Las ramas **phase** y **bootstrap** se **excluyen**.
- **D-05:** Markdown simple, **sin frontmatter**. Una línea de objetivo + pasos previstos.
- **D-06:** Semántica **overwrite al empezar** (latest-wins). NO write-once, NO append.
- **D-07:** Tono **imperativo de una sola línea**, sin ceremonia.
- **D-08:** **Coherencia idiomática por bloque:** instrucción en `buildSessionContext` en **español**; instrucción en la rama quick de `buildGsdContext` en **inglés**.
- **D-09:** Redacción **complementaria, no duplicada** ("además"/"also") respecto al comentario-al-provider existente.
- **Golden-bytes (HOOK-02):** la adición DEBE ser **append al final** de cada array de líneas; las ramas non-quick de `buildGsdContext` deben quedar byte-idénticas.

### Claude's Discretion
- Posición exacta del bloque nuevo dentro de cada builder (debe ser append al final).
- Mecánica precisa de interpolar la ruta absoluta (`join(homedir(), '.kodo', 'plans', \`${session.task_id}.md\`)`).
- Microcopy exacta (longitud, mini-ejemplo de estructura) dentro de D-05/D-07/D-08/D-09.

### Deferred Ideas (OUT OF SCOPE)
- Limpieza / retención de `~/.kodo/plans/` (purga de artefactos viejos) — fuera de PLAN-03.
- Frontmatter con metadata verificable — descartado (D-05).
- Overlay que muestra el artefacto → Phase 46 (PLAN-04).
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLAN-03 | Toda sesión kodo que hoy no produce `PLAN.md` (quick y non-GSD) emite un plan ligero a ruta kodo-controlada estable, vía instrucción inyectada en `session-start.js`, correlacionada por `task_id`. Append preserva golden-bytes (HOOK-02). Mantiene quick ligero. | Builders puros identificados (`buildSessionContext`, `buildGsdContext` rama quick), `session.task_id` disponible en ambos, `homedir()` disponible vía `node:os`/`KODO_DIR`, patrón append-al-final documentado y testeado (HOOK-02). Tests golden-bytes existentes ubicados y verde-baseline confirmado (48/48). |
</phase_requirements>

## Summary

Esta fase es una edición quirúrgica de **un solo fichero** (`src/hooks/session-start.js`) más tests. No hay dependencias externas, ni paquetes nuevos, ni I/O en el código de producción: los dos builders afectados son **funciones puras** que devuelven un string vía `[...].join('\n')`. La instrucción nueva se añade como uno o dos elementos al final del array de cada builder afectado. El artefacto en sí (`~/.kodo/plans/<task_id>.md`) lo escribe la **sesión de Claude** cuando ejecuta su trabajo (D-03), no el hook — el hook solo inyecta texto.

Los dos sitios de edición son: (1) `buildSessionContext` (líneas 23-80, bloque ES non-GSD) — append justo después del bloque "## Anti-push-fantasma"; (2) la rama `mode === 'quick'` de `buildGsdContext` (líneas 109-133) — append **dentro de la rama quick**, ANTES del bloque común EN `## No automatic push` que las 3 ramas comparten (líneas 169-180). Este segundo punto es el único matiz no trivial: el bloque "## No automatic push" se appendea fuera del if/else y debe permanecer byte-idéntico en las 3 ramas (lo asegura el test `D-04 common-block invariance`, gsd-context.test.js:160). Por tanto la instrucción de plan quick va **dentro** del `if (mode === 'quick')`, no después del `.push` común.

**Primary recommendation:** Añadir la línea de instrucción ES al final del array de `buildSessionContext` (después de los ejemplos Bad/Good de Anti-push), e insertar la línea de instrucción EN dentro del `lines.push(...)` de la rama quick (después de `'Run the slash command and finish...'`), interpolando la ruta con `join(homedir(), '.kodo', 'plans', \`${session.task_id}.md\`)`. Importar `homedir` de `node:os` y `join` de `node:path` en `session-start.js` (hoy NO están importados ahí). Guardar `session.task_id` contra `undefined` con un fallback inocuo. Añadir tests que asserten: instrucción presente, ruta resuelta correcta (homedir expandido + task_id real), idioma correcto por bloque, y que las ramas phase/bootstrap quedan byte-idénticas.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Inyectar instrucción de plan (string building) | Hook builder (`session-start.js`, puro) | — | Los builders son funciones puras sin I/O; la instrucción es texto, no escritura |
| Resolver ruta absoluta del artefacto | Hook builder (interpolación) | `src/config.js` (`KODO_DIR` convención) | La ruta se computa e interpola dentro del builder manteniéndolo puro (D-Discretion) |
| Escribir el fichero `~/.kodo/plans/<task_id>.md` | Sesión de Claude (runtime, tool Write) | — | D-03: el hook NO escribe; la sesión crea parents y escribe el plan |
| Leer el artefacto (consumo) | Overlay `plan.js` (Phase 46, fuera de scope) | filesystem | PLAN-04, no entregable aquí; contrato de lectura informa el formato |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:os` (`homedir`) | builtin (Node ≥18) | Resolver `~` a path absoluto | Ya usado en `src/config.js:4`, `src/logger-events.js` — convención del repo |
| `node:path` (`join`) | builtin | Componer `~/.kodo/plans/<task_id>.md` | Ya usado en `src/config.js:3`, `src/session/state.js:3` |
| `node:test` + `node:assert/strict` | builtin | Framework de test del repo | `package.json` test script: `node --test $(find test -name '*.test.js')` |

**No se instalan paquetes externos.** Esta fase es 100% builtins de Node.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `import { homedir } from 'node:os'` directo en el hook | Reusar `KODO_DIR` de `src/config.js` y `join(KODO_DIR, 'plans', ...)` | `KODO_DIR` ya encapsula `join(homedir(), '.kodo')`. Reusarlo evita recomputar el prefijo y es DRY; pero `config.js` también ejecuta `loadEnvFile()` y define `loadConfig` con I/O — importar `KODO_DIR` no dispara esa I/O (es solo una const exportada). **Recomendación: importar `{ KODO_DIR }` de `../config.js` y hacer `join(KODO_DIR, 'plans', \`${session.task_id}.md\`)`.** Mantiene la pureza (KODO_DIR es una const computada al import, no I/O en runtime del builder) y reusa la convención. Ojo al landmine de caching de KODO_DIR (ver Pitfalls). |

**Installation:** N/A — sin paquetes.

## Package Legitimacy Audit

> No external packages installed. Audit not applicable. Todos los imports son builtins de Node (`node:os`, `node:path`, `node:test`, `node:assert/strict`).

## Architecture Patterns

### System Architecture Diagram

```
SessionStart hook fired by Claude Code
        │  (stdin: { cwd, session_id, transcript_path })
        ▼
   main()  ── findSession({sessionId, cwd}) ──► state.json (sessions + history)
        │                                         returns { session }
        ▼
   session.gsd ?
   ┌────┴─────────────────────────┐
   │ false (non-GSD)              │ true (GSD)
   ▼                              ▼
 buildSessionContext()        buildGsdContext(session, {brief})
 (ES block)                      │
   │  [APPEND ES plan instr]     ├─ getSessionMode(session) === 'quick'?
   │   at END of array           │   ├─ yes → quick block  [APPEND EN plan instr HERE, inside branch]
   ▼                             │   ├─ phase_id → phase block   (UNCHANGED — byte-identical)
 .join('\n')                     │   └─ else → bootstrap block   (UNCHANGED — byte-identical)
   │                             ▼
   │                        common block "## No automatic push"  (UNCHANGED — must stay byte-identical
   │                        appended OUTSIDE if/else to all 3      across all 3 branches per
   │                        branches                               D-04 invariance test)
   ▼                             ▼
   └──────────►  stdout: { hookSpecificOutput: { additionalContext } }  ──► Claude Code injects
                                                                            │
                            (later, at runtime) Claude session executes ────┤
                                                                            ▼
                                            writes ~/.kodo/plans/<task_id>.md  (D-03, tool Write creates parents)
                                                                            │
                                            (Phase 46) overlay plan.js reads ─┘
```

### Recommended edit sites (single file)
```
src/hooks/session-start.js
├── imports (top)            # ADD: import { join } from 'node:path'; import { KODO_DIR } from '../config.js';
├── buildSessionContext()    # ADD ES plan instr line(s) at END of the return [...] array (after Anti-push examples)
└── buildGsdContext()
    └── if (mode === 'quick') # ADD EN plan instr line(s) at END of the quick lines.push(...), INSIDE the branch
        (phase / bootstrap / common "## No automatic push" blocks: DO NOT TOUCH)
```

### Pattern 1: Append-al-final preserva golden-bytes (HOOK-02)
**What:** Las instrucciones nuevas se añaden como últimos elementos del array de líneas. Todo byte anterior queda idéntico.
**When to use:** Siempre que se extienda un builder pineado por tests de bytes.
**Example (buildSessionContext — append ES):**
```javascript
// Source: src/hooks/session-start.js:31-79 (patrón existente del bloque Anti-push)
return [
  // ... bloque existente sin cambios, hasta el último ejemplo Good/Bad ...
  '   - Good: "Deploy quedará efectivo una vez se haga `git push origin main`."',
  // --- APPEND nuevo (D-04a, D-08 ES, D-09 complementario) ---
  '',
  `Además, escribe un plan corto (qué vas a hacer + pasos previstos) en \`${join(KODO_DIR, 'plans', `${session.task_id}.md`)}\`.`,
].join('\n');
```
**Example (buildGsdContext rama quick — append EN, DENTRO del if):**
```javascript
// Source: src/hooks/session-start.js:123-133 (rama quick existente)
lines.push(
  'This is a one-shot GSD session.',
  '',
  'Execute the slash command:',
  '',
  `1. \`/gsd-quick "${safeTitle}"\``,
  '',
  'Run the slash command and finish — no plan/execute/verify cycle.',
  // --- APPEND nuevo (D-04b, D-08 EN, D-09 complementario) ---
  '',
  `Also, write a short plan (what you'll do + planned steps) to \`${join(KODO_DIR, 'plans', `${session.task_id}.md`)}\`.`,
);
// NOTE: el bloque común "## No automatic push" (lines.push fuera del if/else) NO se toca.
```

### Anti-Patterns to Avoid
- **Appendear la instrucción quick DESPUÉS del bloque común "## No automatic push":** rompería el test `D-04 common-block invariance` (gsd-context.test.js:160) que exige que el tail desde `## No automatic push` sea byte-idéntico en quick/phase/bootstrap. La instrucción quick debe ir DENTRO del `if (mode === 'quick')`.
- **Tocar las ramas phase/bootstrap:** D-04 las excluye explícitamente; además romperían los tests de bytes de esas ramas.
- **Pre-crear el directorio `~/.kodo/plans/` en el hook:** viola D-03 e introduciría I/O en un builder puro (rompiendo HOOK-03 idempotencia / pureza testeable).
- **Usar el literal `<task_id>` en el string inyectado:** la microcopy debe mostrar la ruta **resuelta** (homedir expandido + task_id real) — ver `<specifics>` del CONTEXT.
- **Frontmatter YAML en la instrucción o pedir frontmatter:** D-05 lo descarta; el overlay renderiza plano.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Resolver home dir | String concat con `process.env.HOME` | `homedir()` de `node:os` (ya vía `KODO_DIR`) | Cross-platform, ya es la convención del repo |
| Componer la ruta | Template literal `~/.kodo/plans/...` con `~` literal | `join(KODO_DIR, 'plans', \`${task_id}.md\`)` | `~` no se expande en strings; `join` normaliza separadores |
| Crear el directorio plans/ | `mkdirSync` en el hook | Dejar que el tool Write de la sesión cree parents (D-03) | Mantiene el builder puro; evita I/O en SessionStart |

**Key insight:** El builder NO debe hacer ninguna I/O. Toda la "escritura" la delega a la sesión de Claude vía la instrucción de texto. El builder solo computa un string (incluida la ruta resuelta) y lo devuelve.

## Runtime State Inventory

> Esta fase NO es un rename/refactor/migración. Es una adición de texto a builders puros. Inventario por completitud:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — el hook no lee ni escribe datastores. El artefacto futuro `~/.kodo/plans/<task_id>.md` lo escribe la sesión, no el hook. | Ninguna |
| Live service config | None — sin servicios externos. | Ninguna |
| OS-registered state | None — SessionStart hook ya registrado en Claude Code (no cambia su registro). | Ninguna |
| Secrets/env vars | None nuevos. `KODO_DIR` deriva de `HOME` (ya existente). | Ninguna |
| Build artifacts | None — sin compilación; ESM directo. | Ninguna |

**Nothing found across all categories:** verificado — la fase solo añade strings a dos arrays en un fichero puro.

## Common Pitfalls

### Pitfall 1: `session.task_id` undefined rompe la ruta
**What goes wrong:** Si `task_id` es `undefined`, la ruta interpolada sería `~/.kodo/plans/undefined.md`.
**Why it happens:** En las fixtures de test `task_id` siempre está presente, y `findSession` lo usa como identidad (`id = session.task_id`). En sesiones trackeadas reales **siempre** está presente (CONTEXT code_context: "session.task_id siempre presente en sesiones trackeadas"). El hook hace `process.exit(0)` si `findSession` no devuelve sesión (línea 204-207), así que el builder nunca corre sin una sesión.
**How to avoid:** El riesgo es teórico pero barato de blindar. La interpolación produce `undefined.md` solo si `task_id` fuese falsy — lo cual no ocurre en el path real. **Recomendación:** confiar en la garantía de `findSession` (no añadir defensa que ensucie golden-bytes), PERO añadir un test que documente que con un `task_id` real la ruta es correcta y NO contiene el literal `<task_id>` ni `undefined`. Si el planner quiere defensa explícita, usar `session.task_id ?? 'unknown'` — pero eso es discrecional y probablemente over-engineering dado el invariante.
**Warning signs:** Un test con `makeSession({ task_id: undefined })` mostraría `undefined.md`.

### Pitfall 2: Romper el invariante de bloque común EN (D-04 invariance)
**What goes wrong:** Si la instrucción quick se appendea al array DESPUÉS del `lines.push('## No automatic push', ...)` común, el tail compartido deja de ser byte-idéntico entre ramas.
**Why it happens:** El bloque "## No automatic push" se appendea fuera del if/else (líneas 169-180), DESPUÉS de la rama quick. Si se inserta texto entre el if/else y ese push común, o después de él en la rama quick, rompe `tail(ctxQuick) === tail(ctxPhase)`.
**How to avoid:** Insertar la instrucción quick DENTRO del `lines.push(...)` de la rama quick (antes de salir del `if`). El bloque común queda intacto y posterior.
**Warning signs:** Falla `gsd-context.test.js:160` ("quick tail must equal phase tail").

### Pitfall 3: KODO_DIR cacheado al import (aislamiento de tests)
**What goes wrong:** `KODO_DIR = join(homedir(), '.kodo')` se evalúa **una vez al import** de `config.js` (memoria de observación: "config.js caches KODO_DIR at import time, bypasses process.env.HOME redirect"). Un test que redirige `process.env.HOME` DESPUÉS de importar no verá el nuevo home.
**Why it happens:** Es una const de módulo, no una función.
**How to avoid:** Los builders son puros y NO leen el filesystem, así que el caching no afecta producción. Para los **tests** de esta fase: NO dependas de redirigir `HOME` para verificar la ruta. En su lugar, computa el valor esperado en el test con el mismo `homedir()`/`KODO_DIR` que usa el builder (assert relativo, no literal hardcoded). Patrón: `assert.ok(ctx.includes(join(KODO_DIR, 'plans', 'uuid-123.md')))`. Esto evita el landmine por completo.
**Warning signs:** Test que hardcodea `/Users/.../.kodo/plans/...` y falla en CI con otro HOME.

### Pitfall 4: La instrucción se confunde con el comentario-al-provider existente
**What goes wrong:** El bloque non-GSD ya pide "**1. Al empezar** — comenta tu plan de acción" (comentario al provider vía MCP, línea 45). Si la nueva instrucción no se distingue, Claude podría hacer solo una de las dos.
**Why it happens:** Ambas hablan de "plan".
**How to avoid:** D-09 ya lo resuelve: redactar como "**Además**, escribe un plan corto... **en `<ruta>`**". El "además" + la ruta de fichero local la diferencian del comentario al provider. Coherente con la microcopy de referencia del `<specifics>`.
**Warning signs:** —

## Code Examples

### Imports a añadir al top de session-start.js
```javascript
// Source: patrón de src/session/state.js:3-4 (join + KODO_DIR)
import { join } from 'node:path';
import { KODO_DIR } from '../config.js';
```
Nota: `findSession`, `loadConfig`, `getSessionMode`, `fileURLToPath` ya están importados (líneas 8-11). `KODO_DIR` ya se exporta en `src/config.js:228`.

### Test de ruta resuelta (sin hardcodear HOME)
```javascript
// Source: patrón de session-start.test.js (makeSession) + Pitfall 3
import { join } from 'node:path';
import { KODO_DIR } from '../src/config.js';

it('non-GSD: inyecta instrucción de plan con ruta resuelta a ~/.kodo/plans/<task_id>.md', () => {
  const session = makeSession({ task_id: 'uuid-abc' });
  const ctx = buildSessionContext(session, makeConfig());
  const expectedPath = join(KODO_DIR, 'plans', 'uuid-abc.md');
  assert.ok(ctx.includes(expectedPath), `debe incluir la ruta resuelta ${expectedPath}`);
  assert.ok(!ctx.includes('<task_id>'), 'no debe contener el literal <task_id>');
  assert.match(ctx, /Además, escribe un plan corto/);
});
```

### Test de invariancia de ramas excluidas (phase/bootstrap byte-idénticas)
```javascript
// Source: gsd-context.test.js:160 patrón D-04 invariance
it('PLAN-03: rama quick recibe la instrucción EN; phase/bootstrap NO', () => {
  const quick = buildGsdContext(makeSession({ gsd: true, gsd_mode: 'quick', summary: 'X' }));
  const phase = buildGsdContext(makeSession({ gsd: true, phase_id: '08' }));
  const boot  = buildGsdContext(makeSession({ gsd: true, phase_id: undefined }));
  assert.match(quick, /Also, write a short plan/);
  assert.ok(!phase.includes('Also, write a short plan'), 'phase no debe llevar la instrucción');
  assert.ok(!boot.includes('Also, write a short plan'), 'bootstrap no debe llevar la instrucción');
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Olfatear el plan nativo de Claude Code vía hooks no documentados | kodo inyecta una instrucción para que la sesión escriba un plan ligero a ruta kodo-controlada | Pivote 2026-06-09 | Esta fase implementa el approach actual; el spike de captura fue descartado por frágil/version-specific |

**Deprecated/outdated:**
- Leer `~/.claude/plans/` o `~/.claude/todos/`: formato no documentado, `TodoWrite` deprecado (REQUIREMENTS.md Out of Scope). NO aplicar aquí.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Importar `{ KODO_DIR }` de `../config.js` no dispara I/O en runtime del builder (es una const evaluada al import; `loadEnvFile()` ya corre al cargar config.js, que de todas formas se carga vía `loadConfig` en `main()`). | Standard Stack / Alternatives | Si el planner prefiere `homedir()` directo de `node:os` para evitar acoplar a config.js, es igual de válido y mantiene pureza. Ambas opciones son correctas; A1 solo afecta DRY-vs-desacoplamiento, no corrección. |
| A2 | `session.task_id` siempre presente en el path real (garantía de `findSession`). | Pitfalls 1 | Si en algún path no-trackeado el builder corriese con task_id falsy, la ruta sería `undefined.md`. Mitigable con `?? 'unknown'` discrecional. Riesgo bajo: `main()` hace exit(0) sin sesión. |

## Open Questions (RESOLVED)

1. **¿Importar `KODO_DIR` de config.js o `homedir()` directo de node:os?**
   - What we know: Ambas funcionan y mantienen pureza. `KODO_DIR` reusa la convención (DRY); `homedir()` desacopla el hook de config.js.
   - What's unclear: Preferencia de estilo del repo. config.js ya se importa en main() vía loadConfig, pero buildSessionContext recibe config como parámetro y buildGsdContext no importa config.js hoy.
   - Recommendation: Usar `KODO_DIR` (reusa convención, una línea de import). Si el plan-checker objeta acoplamiento del builder a config.js, fallback trivial a `import { homedir } from 'node:os'` + `join(homedir(), '.kodo', 'plans', ...)`.
   - **RESOLVED (plan 45-01):** usar `KODO_DIR` (DRY, precedente exacto en `state.js:3-4`, convención del repo).

2. **¿Microcopy con o sin mini-ejemplo de estructura?**
   - What we know: D-05/D-07 piden una sola línea imperativa. El `<specifics>` da wording de referencia de una línea.
   - What's unclear: Si añadir un mini-ejemplo de estructura (p.ej. "objetivo + bullets") ayuda al modelo sin violar D-07.
   - Recommendation: Una sola línea por D-07 (no ceremonia). La línea ya menciona "qué vas a hacer + pasos previstos", suficiente guía sin multi-paso.
   - **RESOLVED (plan 45-01):** una sola línea por D-07 (sin mini-ejemplo).

## Environment Availability

> Sin dependencias externas. La fase es código/test-only con builtins de Node. Sección no aplica (Node ≥18 ya garantizado por el repo: ESM + `node:test`).

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` + `node:assert/strict` (builtins) |
| Config file | none — `package.json` test script: `node --test $(find test -name '*.test.js' -type f)` |
| Quick run command | `node --test test/session-start.test.js test/gsd-context.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLAN-03 | `buildSessionContext` inyecta instrucción ES con ruta resuelta `~/.kodo/plans/<task_id>.md` | unit | `node --test test/session-start.test.js` | ✅ (extender) |
| PLAN-03 | Rama quick de `buildGsdContext` inyecta instrucción EN con ruta resuelta | unit | `node --test test/session-start.test.js` | ✅ (extender) |
| PLAN-03 | Ramas phase/bootstrap NO reciben la instrucción (byte-idénticas en su parte previa al bloque común) | unit | `node --test test/gsd-context.test.js` | ✅ (extender) |
| PLAN-03 (HOOK-02) | Bloque común "## No automatic push" sigue byte-idéntico en las 3 ramas | unit | `node --test test/gsd-context.test.js` | ✅ (existe: línea 160, no debe romperse) |
| PLAN-03 | La ruta inyectada es absoluta/resuelta, no el literal `<task_id>` | unit | `node --test test/session-start.test.js` | ✅ (extender) |
| PLAN-03 | Idempotencia: re-emitir produce bytes idénticos (HOOK-03) | unit | `node --test test/session-start.test.js` | ✅ (existe: líneas 129, 172, 180) |

### Sampling Rate
- **Per task commit:** `node --test test/session-start.test.js test/gsd-context.test.js`
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green antes de `/gsd:verify-work`

### Wave 0 Gaps
- None — la infraestructura de test existe (`test/session-start.test.js`, `test/gsd-context.test.js`), con fixtures `makeSession`/`makeConfig` reusables y patrones de assert de bytes ya establecidos. Solo hay que **añadir casos** a esos ficheros, no crear infraestructura.

**Baseline verificado:** `node --test test/session-start.test.js test/gsd-context.test.js` → 48 tests, 48 pass, 0 fail (ejecutado 2026-06-10).

## Security Domain

> `security_enforcement` no está configurado explícitamente (absent = enabled). Esta fase no toca auth, sesiones, crypto ni input de usuario externo. Análisis mínimo:

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | N/A |
| V3 Session Management | no | N/A |
| V4 Access Control | no | N/A |
| V5 Input Validation | parcial | `task_id` es un UUID generado por kodo/provider, no input de usuario libre. Se interpola en una ruta de fichero **mostrada al modelo** (no ejecutada por el hook). El hook no escribe el fichero (D-03). |
| V6 Cryptography | no | N/A |

### Known Threat Patterns for este stack
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Path traversal vía `task_id` en la ruta inyectada | Tampering | `task_id` es UUID controlado por kodo (no input externo arbitrario). El hook NO realiza I/O con la ruta — solo la muestra al modelo como texto. El **consumidor** (plan.js Phase 46) ya aplica containment anti-traversal (`String.includes('..')`, sin RegExp) por el hardening de Phase 44 (memoria 23076). El formato del artefacto debe respetar ese contrato never-throws/anti-ReDoS para Phase 46. |
| Prompt injection vía `summary`/título | Tampering | Fuera de scope de esta fase (el título ya se inyecta hoy; la rama quick ya hace `replace(/"/g, "'")` en `safeTitle`, línea 122). La instrucción de plan nueva no introduce superficie adicional. |

## Sources

### Primary (HIGH confidence)
- `src/hooks/session-start.js` (leído completo) — firmas de `buildSessionContext(session, config)` y `buildGsdContext(session, opts)`, estructura del array `.join('\n')`, rama quick (líneas 108-133), bloque común (169-180), patrón append HOOK-02 documentado inline (29-30, 166-168).
- `src/config.js` (leído completo) — `KODO_DIR = join(homedir(), '.kodo')` exportado (línea 228), imports `node:os`/`node:path`.
- `src/session/state.js` (leído completo) — `Session` typedef (`task_id` siempre presente), `findSession` sintetiza `id = task_id`, `main()` hace exit(0) sin sesión.
- `src/cli/dashboard/plan.js` (leído completo) — contrato never-throws/anti-ReDoS del consumidor (Phase 46 fallback).
- `src/labels.js:82-85` — `getSessionMode` retorna `'quick'` solo si `gsd && gsd_mode === 'quick'`.
- `test/session-start.test.js` + `test/gsd-context.test.js` (leídos completos) — patrones de assert de golden-bytes (lastIndexOf header, prefix `\n\n`, D-04 invariance, idempotencia). Baseline 48/48 verde.
- `package.json` test script — framework `node:test`.

### Secondary (MEDIUM confidence)
- Observaciones de memoria del proyecto: KODO_DIR cacheado al import (21811, 21885, 22683); arquitectura de inyección del hook (17922); bifurcación quick Phase 12 (17677, 17682).

### Tertiary (LOW confidence)
- None — toda la investigación es contra el codebase real (HIGH).

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — builtins de Node verificados en uso real en el repo.
- Architecture: HIGH — sitios de edición y patrón append leídos directamente del source y de los tests que los pinean.
- Pitfalls: HIGH — derivados de tests existentes (D-04 invariance) y observaciones documentadas (KODO_DIR caching).

**Research date:** 2026-06-10
**Valid until:** 2026-07-10 (código estable; sin dependencias de versión externa). Re-verificar si `session-start.js` se reescribe o si Phase 46 cambia el contrato de `plan.js`.
