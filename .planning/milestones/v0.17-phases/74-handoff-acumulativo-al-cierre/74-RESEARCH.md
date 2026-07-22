# Phase 74: Handoff acumulativo al cierre - Research

**Researched:** 2026-07-15
**Domain:** Brownfield — hooks de ciclo de vida, contrato de formato markdown, concurrencia sobre `state.json` y ficheros de plan
**Confidence:** HIGH (todo el hallazgo es código leído en este repo, con file:line; cero tecnología externa)

## Summary

Esta fase no tiene superficie de investigación externa: **cero dependencias npm nuevas** es constraint duro y no hay librería que evaluar. Todo el valor está en el código existente, y la investigación ha ido a cerrar las tres incógnitas que podían descarrilar el plan: (1) ¿sobrevive una clave top-level nueva en `state.json`?, (2) ¿qué tests rompe exactamente tocar `session-start.js:85/:145`?, y (3) ¿es sólido el punto de inserción de D-07?

Las tres tienen respuesta concreta. **(1) `state.tasks` es seguro**: `reconcile.js:238` y `:396` reconstruyen el state con spread (`{...state, sessions, history}`), que preserva claves desconocidas; `migrateStateV2toV3` sí las destruye, pero está guardado por un early-return de idempotencia y es inalcanzable desde el carril del hook. Hay **una trampa latente** documentada abajo (`loadState` devuelve forma v2 si el fichero no existe) que solo muerde en tests mal sembrados. **(2) D-11 sobreestima el daño**: ningún test asserta los literales «sobrescribe si ya existe» / «overwrite if it exists» — las asserts son de prefijo, ruta resuelta y orden. Si se conserva el prefijo de la instrucción, **cero tests existentes rompen**; el riesgo real es otro y es un guard de emojis. **(3) D-07 es sólido**, pero el punto exacto no es «tras los guards» sino **tras la construcción del logger (`session-end.js:96`)**, porque el bloque necesita `log` para el `log.warn` de D-06.

Aparte, la investigación encontró **dos afirmaciones de CONTEXT.md que son factualmente incorrectas contra el código** (el render del marcador y la vía de consumo de `/status`). Ninguna invalida una decisión LOCKED, pero ambas deben llegar al planner y están en §Open Questions y §Assumptions Log.

**Primary recommendation:** Módulo `src/session/handoff.js` como **hoja pura del grafo de imports** (solo `node:` builtins, idealmente cero I/O en las funciones del contrato), consumido por `session-end.js` que aporta I/O y orquestación; el bloque de handoff se inserta en `session-end.js` entre `:96` y `:98`, con try/catch propio; la RMW del plan bajo `withFileLock(<plan>.lock, fn)` con `temp+rename` de nombre único (patrón `saveState:273`), **no** `writeFileAtomic` de config.js.

## Architectural Responsibility Map

Los "tiers" de kodo no son web tiers; son capas del grafo de módulos con reglas de aislamiento propias (LOG-12, color-isolation, leaf-isolation de `plan.js`).

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Construir el bloque `## Handoff` (D-01, D-03) | Contract module (`handoff.js`, puro) | — | D-13: writer y parser juntos; la Phase 75 parsea lo que la 74 escribe |
| Detectar marcador `session=<id>` (D-04) | Contract module (puro) | — | Función pura sobre el texto del plan; testeable sin fs |
| Extraer `NEXT:` + truncar a 200 (D-02) | Contract module (puro) | — | La Phase 75 necesita exactamente esta función |
| Validar `input.reason` contra el enum cerrado (D-03) | Contract module (puro) | — | Misma disciplina T-71-12; entrada no confiable → markdown |
| Leer/appendear/escribir el fichero de plan (D-08, D-09) | Hook I/O (`session-end.js`) | `state-lock.js` (`withFileLock`, import) | El hook es el único que hace I/O; el lock se reutiliza tal cual |
| Persistir `state.tasks[task_id]` (D-05, D-06) | `session/state.js` (`withStateLock`) | Hook I/O (caller) | Invariante v0.16 Phase 70: todo escritor pasa por la primitiva |
| Instrucción al LLM (D-10) | `session-start.js` (funciones puras) | — | `buildSessionContext`/`buildGsdContext` son puras → golden bytes |
| Pintar el handoff | **Fuera de fase** (Phase 75) | — | Out of Scope explícito |

**Aviso de tier para el planner:** la tentación natural es meter el I/O del plan dentro de `handoff.js` "porque es su fichero". Eso **degradaría a `handoff.js` de hoja a nodo con fs**, y la Phase 75 necesita importar su parser desde `src/cli/dashboard/plan.js`, que es una hoja deliberada (`plan.js:41-45` importa solo `node:fs`, `node:path`, `node:os`; su comentario `D-07/D-12` dice explícitamente que NO importa `src/config.js` para no acoplar el leaf). Ver §Pitfall 1.

## Standard Stack

**No aplica en el sentido habitual.** Constraint LOCKED: *«Cero dependencias npm nuevas»* (`REQUIREMENTS.md` §Constraints, `STATE.md` §Critical Invariants). Todo se construye con primitivas ya presentes.

### Core (todo ya en el repo — reutilizar por import, jamás reimplementar)

| Primitiva | Ubicación | Propósito en esta fase | Por qué es la estándar aquí |
|-----------|-----------|------------------------|------------------------------|
| `withFileLock(lockPath, fn, opts)` | `src/session/state-lock.js:215` | Lock advisory sobre `<plan>.lock` (D-08) | Genérica y path-agnostic por diseño (`state-lock.js:18-23` la nombra como reutilizable); es un import, cero deps [VERIFIED: código leído] |
| `withStateLock(mutator)` | `src/session/state.js:317` | Persistir `state.tasks` (D-05/D-06) | Invariante cross-milestone: todo escritor de `state.json` pasa por aquí [VERIFIED] |
| `saveState` tmp+rename | `src/session/state.js:266-281` | **Patrón** a copiar para el fichero de plan | Nombre de tmp único por escritor (pid+UUID, `:273`) — el fix WR-02 [VERIFIED] |
| `runSessionEndHook(input, deps)` | `src/hooks/session-end.js:58` | Punto de enganche único | Ya inyecta `findSessionFn`/`removeSessionFn`/`loggerFactory`/`cmux` [VERIFIED] |
| `node:test` | built-in | Framework de test | `package.json:10` → `node --test $(find test -name '*.test.js' -type f)` [VERIFIED] |

### Alternatives Considered

| En vez de | Se podría usar | Tradeoff |
|-----------|----------------|----------|
| tmp+rename propio (patrón `saveState`) | `writeFileAtomic` de `config.js:135`, exportado en `:615` | **NO recomendado.** Dos razones duras: (a) usa **tmp de nombre fijo** `path + '.tmp'` (`config.js:136`) — precisamente lo que el fix WR-02 corrigió en `saveState` porque dos escritores concurrentes comparten el `.tmp` y se pisan bytes parciales; bajo `withFileLock` sería seguro, pero el lock es **robable tras TTL 10s** (`state-lock.js:36`), así que la garantía no es absoluta. (b) Importarlo **acopla el módulo a `config.js`**, que computa `KODO_DIR` en module-load (`config.js:11`) y arrastra su grafo — rompe la hoja (ver Pitfall 1). |
| `state.tasks` top-level (D-05) | Campo en el registro de sesión | **Cerrado por D-05 y confirmado en código:** `removeSession` (`state.js:355-376`) archiva a `history` con cap FIFO 50 (`:361-366`) y borra la fila (`:368`). El dato moriría con la sesión. |
| Marcador HTML (D-01) | Heading pelado | Cerrado por D-04: con acumulación (LIVE-02) el conteo de bloques es un detector falso. |

**Installation:** ninguna. `npm test` sigue siendo `node --test`.

## Package Legitimacy Audit

**No aplica — esta fase instala CERO paquetes externos.** Constraint LOCKED «Cero dependencias npm nuevas» (`REQUIREMENTS.md` §Constraints). Dependencias actuales del proyecto (`package.json:12-21`, sin cambios): `commander`, `ink`, `picocolors`, `react`; dev: `@types/react`, `ink-testing-library`. Todas las primitivas de esta fase son `node:` builtins o módulos internos del repo.

**Packages removed due to [SLOP] verdict:** none (ninguno propuesto)
**Packages flagged as suspicious [SUS]:** none (ninguno propuesto)

## Architecture Patterns

### System Architecture Diagram

Flujo de datos del cierre de una sesión, tras esta fase. `‡` marca lo que la fase añade.

```
  Claude Code  ──(stdin JSON: session_id, cwd, reason)──►  session-end.js: main()
                                                                  │
                                                                  ▼
                                                        runSessionEndHook(input, deps)
                                                                  │
                                    ┌─────────────────────────────┴──── outer try/catch (never-throw) ────┐
                                    │                                                                     │
                                    ▼                                                                     │
                     findSessionFn({sessionId, cwd})  ──► null ──────────────────────► return (:72-75)    │
                                    │                                                                     │
                                    ├──► source === 'history' ─────────────────────────► return (:80-83)  │
                                    │                                                                     │
                                    ▼                                                                     │
                          construir `log` (:88-96)                                                        │
                                    │                                                                     │
                   ‡ ┌──────────────▼──────────────────────────────────┐                                  │
                   ‡ │  BLOQUE HANDOFF (D-07) — try/catch PROPIO       │  ◄── punto de inserción :97      │
                   ‡ │                                                 │                                  │
                   ‡ │   leer plan ──► ¿existe?                        │                                  │
                   ‡ │      │            └─ no ─► crear cabecera (D-09)│                                  │
                   ‡ │      ▼                                          │                                  │
                   ‡ │   ¿marcador session=<este id>?  (D-04)          │                                  │
                   ‡ │      ├─ sí ─► el LLM ya escribió → no append    │                                  │
                   ‡ │      └─ no ─► construir bloque mecánico (D-03)  │                                  │
                   ‡ │                     │                           │                                  │
                   ‡ │      todo bajo withFileLock(<plan>.lock) (D-08) │                                  │
                   ‡ │      escritura final: tmp+rename (PERSIST)      │                                  │
                   ‡ │                     │                           │                                  │
                   ‡ │                     ▼                           │                                  │
                   ‡ │   extraer NEXT: (D-02, trunc 200)               │                                  │
                   ‡ │                     │                           │                                  │
                   ‡ │                     ▼                           │                                  │
                   ‡ │   withStateLock(s => s.tasks[id]={...}) (D-05)  │──► lock-timeout ─► log.warn      │
                   ‡ └──────────────┬──────────────────────────────────┘         (jamás bloquea)          │
                                    │                                                                     │
                                    ▼                                                                     │
                          runReviewBackstop (:104-129)   ◄── orden LOCKED D-08: no se reordena            │
                                    │                                                                     │
                                    ▼                                                                     │
                          session.end typed event (:134-144)                                              │
                                    │                                                                     │
                                    ▼                                                                     │
                          releaseGsdLock si session.gsd (:149-156)                                        │
                                    │                                                                     │
                                    ▼                                                                     │
                    ╔═══ performTerminalCleanup (:159) ═══ DESTRUCTIVO ═══╗                               │
                    ║  worktree → removePromptFile → removeSession        ║                               │
                    ║  (removeSession archiva a history FIFO 50 + delete) ║                               │
                    ╚═════════════════════════════════════════════════════╝                               │
                                    │                                                                     │
                                    ▼                                                                     │
                    setColor (:175) → notify (:184) → nudge (:193)   ◄── trío LOCKED, intacto             │
                                    └─────────────────────────────────────────────────────────────────────┘

  ── Productores del fichero de plan (D-09/D-10) ──
  session-start.js: buildSessionContext (:25) ──► instrucción ES (:85)   ──► LLM escribe ~/.kodo/plans/<task_id>.md
                    buildGsdContext (:102) ├─ quick   (:116) ──► instrucción EN (:145) ──► idem
                                           ├─ phase   (:147) ──► SIN instrucción  ──► solo backstop mecánico (D-03)
                                           └─ bootstrap(:160) ──► SIN instrucción  ──► solo backstop mecánico (D-03)

  ── Consumidor aguas abajo (Phase 75, NO se toca aquí) ──
  plan.js readPlan (:91) ── phaseId == null ──► readLightPlan (:65) ──► md.split('\n') ──► render PLANO
```

### Recommended Project Structure

```
src/session/handoff.js        # ‡ NUEVO — contrato D-13. HOJA: solo node: builtins (idealmente cero)
src/hooks/session-end.js      # MOD — bloque D-07 entre :96 y :98
src/hooks/session-start.js    # MOD — :85 y :145 (D-10)
test/session/handoff.test.js  # ‡ NUEVO — contrato puro (sin fs, sin HOME)
test/hooks/session-end-handoff.test.js  # ‡ NUEVO — orquestación vía DI
test/state/handoff-concurrency.test.js  # ‡ NUEVO — dos cierres simultáneos (cross-process)
```

### Pattern 1: Bloque autónomo con try/catch propio (fail-open por paso)

**What:** cada efecto del hook vive en su propio try/catch **además** del outer never-throws, para que su fallo no impida los pasos siguientes.
**When to use:** el bloque de handoff de D-07 — es el precedente literal del backstop.
**Example:**
```javascript
// Source: src/hooks/session-end.js:98-129 (el backstop — el analog exacto de D-07)
    // ── Review backstop (DELIV-04, D-10..D-14) ─────────────────────────────
    // Bloque AUTÓNOMO: tras los guards de idempotencia (:61-72) y ANTES del
    // session.end event / lock release / performTerminalCleanup. [...] Envuelto en su
    // propio try/catch además del outer never-throws: un fallo del backstop NUNCA
    // impide el cleanup terminal (fail-open, D-13).
    try {
      // ...
      await runReviewBackstop({ session, input, provider, config, log });
    } catch (err) {
      console.error(`[kodo:session-end] Review backstop error: ${/** @type {Error} */ (err).message}`);
    }
```

### Pattern 2: `withStateLock` con carril de fallo explícito (WR-01)

**What:** el mutator toca **solo** su clave; el `{ok:false}` se propaga y **no** se emite telemetría de éxito.
**When to use:** D-06 — persistir `state.tasks` sin tocar `alive`.
**Example:**
```javascript
// Source: src/session/state.js:355-376 (removeSession — patrón WR-01)
export function removeSession(taskId, logger = noopLogger) {
  const r = withStateLock((state) => {
    // ... mutación en sitio; el mutator devuelve undefined
  });
  if (!r.ok) {
    logger.warn('state.session.remove_failed', { task_id: taskId, reason: r.reason });
    return r;   // ← fail-safe propagado, NUNCA throw
  }
  logger.info('state.session.removed', { task_id: taskId });
  return r;
}
```
Para D-05, la lectura defensiva del mutator debe ser `if (!state.tasks) state.tasks = {};` — espejo exacto de `if (!Array.isArray(state.history)) state.history = [];` (`state.js:361`).

### Pattern 3: Lectura defensiva de campo aditivo sin bump de schema

**What:** campo opcional nuevo + guard defensivo en todo lector; `schema_version` **no** se toca.
**Precedentes verificados:** `worktree_path` (`state.js:41` — el comentario dice literalmente *«NO bump de schema_version»*), `history` (`state.js:54` — *«aditivo opcional […] callers usan `Array.isArray(state.history) ? state.history : []` defensive guard»*), y sus lectores `listHistory` (`:381`) y `findSession` (`:457`).

### Anti-Patterns to Avoid

- **Meter fs en `handoff.js`:** rompe la hoja que la Phase 75 necesita (Pitfall 1).
- **Reordenar `backstop → setColor → notify`:** LOCKED (D-08 v0.16 Phase 71). Insertar **antes** del trío no lo reordena; mover cualquiera de los tres sí.
- **Escribir `alive` desde el hook:** `reconcileTick` es su único escritor (invariante D-04). El mutator de D-05 toca solo `state.tasks`.
- **Detectar autoría por conteo de bloques o mtime:** roto por LIVE-02 (D-04 lo cierra explícitamente).
- **Confiar en que `withFileLock` nunca lanza:** falso. Ver Pitfall 3.

## Don't Hand-Roll

| Problema | No construyas | Usa | Por qué |
|----------|---------------|-----|---------|
| Advisory lock sobre el fichero de plan | Un lockfile nuevo | `withFileLock` (`state-lock.js:215`) | Ya resuelve O_EXCL + `isPidAlive` + TTL + steal CAS + ABA guard (`:98-159`). Reimplementarlo es reintroducir las carreras que Phase 70 cerró |
| Liveness de PID | `process.kill(pid,0)` propio | `isPidAlive` (`gsd/lock.js`, ya importado por `state-lock.js:11`) | Precedente 70-PATTERNS: *«Reuse `isPidAlive` by import — do NOT reimplement»* |
| Escritura no-corruptiva de `state.json` | `writeFileSync` directo | `withStateLock` → `saveState` | Invariante cross-milestone; `saveState` ya hace tmp único + rename |
| Anti-clobber de `state.json` | Snapshot + merge propio | `withStateLock` (`state.js:317-323`) | Hace `loadState()` **fresco dentro** del lock (`:319`) — esa es la clave anti-clobber, no el rename |
| Serializar dos cierres del mismo plan | `appendFileSync` | RMW bajo `withFileLock` | `appendFileSync` no permite el read-decide-write de D-04 (hay que **leer** para detectar el marcador) |

**Key insight:** el 100% de la maquinaria de concurrencia que esta fase necesita existe y está testeada desde v0.16 Phase 70. El único código genuinamente nuevo es **el contrato de formato** (D-01..D-04), que es puro y no tiene análogo — ahí es donde debe ir el esfuerzo de diseño y de test.

## Runtime State Inventory

Fase brownfield con escritura de estado nuevo. Inventario de estado vivo afectado:

| Categoría | Items encontrados | Acción requerida |
|-----------|-------------------|------------------|
| **Stored data** | `~/.kodo/state.json` — gana clave top-level `tasks` (D-05). `~/.kodo/plans/<task_id>.md` — ficheros existentes de Phase 45, markdown plano | **Ninguna migración.** D-05 es aditivo sin bump (precedentes `history`/`worktree_path`). Los planes viejos aceptan append tal cual (Deferred §«Migración/backfill […] no surgió como requisito»); el `v=1` de D-01 existe para evolucionar sin romperlos |
| **Live service config** | Ninguno. Esta fase no toca provider (Plane/GitHub), ni cmux, ni webhooks | None — verificado: el bloque D-07 no llama a `provider.*` (D-03: *«sin red y sin LLM»*) |
| **OS-registered state** | Ninguno. No hay registro de tareas OS, ni pm2, ni launchd tocado | None — verificado: `session-end.js` no registra nada en el OS; solo lee stdin y escribe fs |
| **Secrets/env vars** | Ninguno. El handoff no lee ni escribe `~/.kodo/.env`; no hay clave nueva | None — verificado: boundary PERSIST-04 no se cruza (el bloque no serializa config ni secretos) |
| **Build artifacts** | Ninguno. Sin `pyproject`/`egg-info`; el paquete no se reinstala | None — verificado: `package.json` no cambia (cero deps nuevas) |
| **Ficheros nuevos en disco (‡)** | `~/.kodo/plans/<task_id>.md.lock` — lockfile nuevo creado por D-08 | El lock se libera en el `finally` de `withFileLock:228-230`. **Comprobar** que un `.lock` huérfano no confunde a `doctor.js` (§Open Question 2) |

## Common Pitfalls

### Pitfall 1: `handoff.js` deja de ser hoja y rompe a la Phase 75

**What goes wrong:** el módulo del contrato (D-13) importa `config.js` (para `KODO_DIR`) o `state.js` (para `withStateLock`). La Phase 75 intenta importar su parser desde `src/cli/dashboard/plan.js` y arrastra medio grafo al leaf del dashboard.
**Why it happens:** parece natural que "el módulo del handoff" sea dueño de su fichero. Pero `plan.js` es una hoja **deliberada**: `plan.js:41-45` importa solo `node:fs`, `node:path`, `node:os`, y su cabecera dice *«D-07: node:os es builtin → preserva la leaf-isolation […] NO se importa src/config.js para no acoplar el leaf a su I/O»* y *«Color-isolation (D-12): […] es un LEAF»*.
**How to avoid:** `handoff.js` = solo funciones **puras** (construir bloque, detectar marcador, extraer NEXT, validar reason). El I/O vive en `session-end.js`. Si hace falta un helper de ruta, replicar la convención `join(homedir(), '.kodo', 'plans')` como hace `plan.js:69` — no importar `config.js`.
**Warning signs:** el repo ya tiene tests que vigilan grafos de import con un walker (`test/check-isolation.test.js:40` `walkImports`, `test/format-isolation.test.js:40`). Si `handoff.js` acaba en el grafo de `check.js` y arrastra `logger.js`, **LOG-12 se rompe** (`check-isolation.test.js:75`).

### Pitfall 2: el guard de emojis del bloque ES — el riesgo REAL de tocar `session-start.js:85`

**What goes wrong:** se añade la instrucción de handoff con emojis (el prompt ES ya usa ✅/📁/⚠️/🔍 en otras secciones, así que es tentador) y **rompe un test que D-11 no anticipó**.
**Why it happens:** `test/session-start.test.js:174-190` hace `const block = ctx.slice(ctx.lastIndexOf('## Anti-push-fantasma'))` y asserta que **ese slice no contiene emojis ni ANSI**. Ese slice **llega hasta el final del string**, así que **ya incluye la instrucción de plan de `:85`** — y también incluirá cualquier instrucción de handoff nueva. El comentario del test es explícito: *«el resto del prompt ES contiene emojis legítimos (✅/📁/⚠️/🔍) en la sección "Comentario final"»* — pero la cola, no.
**How to avoid:** la instrucción de handoff (ES y EN) debe ser **markdown plano sin emojis y sin ANSI**. El equivalente EN tiene el mismo guard en `test/gsd-context.test.js:195-201` sobre el slice desde `## No automatic push`.
**Warning signs:** `node --test test/session-start.test.js` falla en *«HOOK-01 block must not contain emojis (D-02b)»*.

### Pitfall 3: `withFileLock` **sí** puede lanzar — el try/catch de D-07 es estructural

**What goes wrong:** se asume «withFileLock es never-throw, devuelve `{ok:false}`» y se omite el try/catch propio; un `EACCES`/`EROFS` crashea el hook y bloquea el cierre — violando el success criterion 5.
**Why it happens:** el contrato documentado (`state-lock.js:204-207`) dice *«never throws, never blocks indefinitely»*, pero eso aplica **solo al agotamiento de reintentos**. En el código real:
- `acquireLock` hace `mkdirSync(dirname(lockPath), {recursive:true})` (`state-lock.js:73`) — puede lanzar.
- `writeFileSync(lockPath, content, {flag:'wx'})` → `if (e.code !== 'EEXIST') throw e` (`:81`) — **rethrow explícito** de cualquier error que no sea EEXIST.
- `withFileLock` ejecuta `fn()` dentro de `try { return {ok:true, value: fn()} } finally { releaseLock(...) }` (`:226-230`) — **no hay catch**: si `fn()` lanza (p. ej. `saveState` fallando), propaga.
**How to avoid:** el bloque D-07 lleva su try/catch propio, exactamente como el backstop (`session-end.js:104-129`). Es el mismo motivo por el que el backstop lo tiene.
**Warning signs:** un test de «plan ilegible / directorio sin permisos» que espera `return` limpio y en su lugar ve una excepción.

### Pitfall 4: `withFileLock` es **síncrono y bloqueante** — nada de `await` dentro de `fn`

**What goes wrong:** se pasa un `async fn` a `withFileLock`; devuelve `{ok:true, value: Promise}` y el `finally` **libera el lock antes de que la escritura termine** → la sección crítica no protege nada.
**Why it happens:** `withFileLock` es genérico sobre `T` y no distingue una Promise.
**How to avoid:** `fn` totalmente síncrono (`readFileSync`/`writeFileSync`/`renameSync`). Precedente idéntico y ya documentado en el repo: `reconcile.js:357-359` — *«SIN `await` dentro del callback — el pgrep ya corrió arriba (Pitfall 1)»*, y `state-lock.js:45-48` usa `Atomics.wait` para que *«el retry loop se mantenga totalmente síncrono — matching the synchronous state mutators the lock coordinates»*.
**Coste:** defaults `retries=8`, `backoffMs=20`, `ttlMs=10_000` (`state-lock.js:34-36`) → peor caso ≈160 ms de bloqueo del event loop antes del `{ok:false}`. Aceptable en un hook de cierre; **hay dos locks** en el bloque (plan + state) → ≈320 ms peor caso.

### Pitfall 5: la trampa v2 — `state.tasks` se pierde si `state.json` no existe

**What goes wrong:** `withStateLock` escribe `tasks` en un state con `schema_version: 2`; el siguiente `loadState` migra v2→v3 y **borra `tasks`** silenciosamente.
**Why it happens:** cadena verificada:
1. `loadState()` (`state.js:255-263`): si el fichero **no existe** devuelve `{ schema_version: 2, sessions: {} }` (`:257`) — **forma v2**, sin `history`, sin `tasks`.
2. `withStateLock` (`:317-323`) mutaría eso y llamaría `saveState` → escribe en disco un fichero **v2** con `tasks`.
3. El siguiente `loadState` → `migrateStateIfNeeded` (`:214`) → `raw.schema_version === 2` → `migrateStateV2toV3` → **`return { schema_version: 3, sessions: newSessions, history: [...] }`** (`:139-143`) — reconstrucción **exhaustiva** que **descarta toda clave desconocida**, incluida `tasks`.
**How to avoid:** **inalcanzable desde el hook** (`findSession` → `loadState` → sin fichero → sin match → `return` en `session-end.js:72-75`), pero **totalmente alcanzable en un test** que llame al escritor de estado del handoff sin sembrar `state.json`. Los tests deben sembrar un v3 explícito — precedente `seedV3()` en `test/state/state-writers-concurrency.test.js:47`: `{ schema_version: 3, sessions: {}, history: [] }`.
**Warning signs:** un test que pasa en aislamiento y falla al reordenarse; o `tasks` que "desaparece" entre dos lecturas.

### Pitfall 6: HOME se resuelve en module-load — import estático = fuga al `~/.kodo` real

**What goes wrong:** un test hace `import { withStateLock } from '../../src/session/state.js'` arriba del fichero, pone `process.env.HOME = tmpHome` en `before()`, y el test **escribe en el `~/.kodo` real del operador**.
**Why it happens:** `config.js:11` → `const KODO_DIR = join(homedir(), '.kodo')` se evalúa **al importar**; `state.js:14` deriva `STATE_PATH` de ahí.
**How to avoid:** patrón establecido — `process.env.HOME = tmpHome` **antes** de un `await import(...)` dinámico dentro de `before()`. Precedente comentado: `test/state/state-writers-concurrency.test.js:149-152` (*«Dynamic import POST-HOME so STATE_PATH resolves to the isolated tmpdir»*) y `test/state/save-state-atomic.test.js:69-79` (*«NINGÚN import estático de state.js (rompería el aislamiento)»*).
**Nota:** `test/hooks/session-end.test.js` **no** aísla HOME — no lo necesita, porque inyecta `findSessionFn`/`removeSessionFn` y nunca toca `state.js`. Un test de handoff que use el hook real **sí** tocaría el fs → o aísla HOME, o (recomendado) el bloque D-07 acepta DI (`plansDir`/`writeFn`/`stateWriterFn`), coherente con el estilo del fichero.

### Pitfall 7: el marcador HTML **sí** se ve en el dashboard de hoy

**What goes wrong:** se asume D-01 (*«El marcador HTML es invisible al renderizar»*) y el operador ve `<!-- kodo:handoff v=1 session=... -->` como texto crudo en el overlay del dashboard.
**Why it happens:** `readLightPlan` (`plan.js:65-78`) hace `return { status: 'ok', lines: md.split('\n') }` (`:72`) con el comentario *«render plano (igual que plan.js:126)»*. **No hay renderizador de markdown hoy** — hay split por líneas. El marcador es invisible en markdown **renderizado**, que es lo que LIVE-06 traerá en la **Phase 75**.
**How to avoid:** no hay nada que arreglar en esta fase (Out of Scope: pintar el handoff). Pero el planner debe saber que **entre 74 y 75 el marcador es visible** en el overlay `phaseId == null`. No rompe nada: `md.split('\n')` no parsea ni crasha (`plan.js` es never-throws por contrato, `:29-30`).
**Warning signs:** un reporte de UAT «veo basura HTML en el plan» que no es un bug sino la ventana 74→75.

## Code Examples

### Punto de inserción exacto de D-07

CONTEXT.md dice *«después de los guards de idempotencia (`session-end.js:72-83`) y antes del backstop (`:104`)»*. Entre medias está la construcción del logger, que el bloque **necesita** (D-06: *«Lock-timeout […] → `log.warn` y seguir»*).

```javascript
// Source: src/hooks/session-end.js:85-104 (estado ACTUAL — el hueco es la línea 97)
    const { id, session } = result;                                    // :85

    // Logger compartido entre el backstop, el typed event y el cleanup.
    const log = deps.loggerFactory                                     // :88
      ? deps.loggerFactory({ session_id: session.session_id, task_id: session.task_id })
      : await (async () => {
          const { createLogger } = await import('../logger.js');
          return createLogger({
            sessionId: session.session_id,
            minLevel: /** @type {any} */ (process.env.KODO_LOG_LEVEL || 'info'),
          }).child({ component: 'hook', task_id: session.task_id });
        })();                                                          // :96

    // ◄────────── AQUÍ va el bloque de handoff (D-07). Línea 97.

    // ── Review backstop (DELIV-04, D-10..D-14) ─────────────────────  // :98
    try {                                                              // :104
```
**Veredicto de la ubicación: sólida.** Verificado: `performTerminalCleanup` está en `:159` (62 líneas más abajo), el trío cosmético LOCKED en `:175`/`:184`/`:193` (todos posteriores), y el bloque nuevo **no reordena nada** — solo se inserta antes del primero de los tres. Y `session` ya está desestructurada en `:85`, así que `session.task_id`/`session.status`/`session.summary`/`session.task_ref` (todo lo que D-03/D-09 necesitan) está disponible.

### La reconstrucción del state que PRESERVA `tasks` (la respuesta a la incógnita #3)

```javascript
// Source: src/session/reconcile.js:237-239 — reconcileTick, el único reescritor periódico
  return {
    state: { ...state, sessions, history },   // ← spread: PRESERVA toda clave top-level desconocida
    events: { rescued, sealed, transitioned, total },
  };
```
```javascript
// Source: src/session/reconcile.js:396 — refresh de process_alive bajo el lock
      if (changed) state = { ...state, sessions };   // ← spread: idem
```
```javascript
// Source: src/session/state.js:121-143 — el ÚNICO sitio que destruiría `tasks`…
export function migrateStateV2toV3(rawState) {
  if (rawState.schema_version === 3) return rawState;   // ← :122 …pero está guardado por idempotencia
  // ...
  return {
    schema_version: 3,
    sessions: newSessions,
    history: Array.isArray(rawState.history) ? rawState.history : [],
  };   // ← :139-143 reconstrucción exhaustiva: descarta claves desconocidas
}
```

### El mutator de D-05 (forma recomendada, espejo de `removeSession`)

```javascript
// Patrón derivado de src/session/state.js:355-376 + el guard defensivo de :361
const r = withStateLock((state) => {
  if (!state.tasks) state.tasks = {};        // espejo de `if (!Array.isArray(state.history))`
  state.tasks[session.task_id] = {           // toca SOLO state.tasks — jamás `alive` (D-04)
    plan_path: planPath,
    next: nextLine,                          // ya truncado a 200 por el contrato (D-02)
    updated_at: new Date().toISOString(),
  };
});
if (!r.ok) log.warn('session.handoff.state_write_failed', { reason: r.reason });  // seguir SIEMPRE (D-06)
```

### Las dos líneas que D-10 invierte

```javascript
// Source: src/hooks/session-start.js:85 — rama no-GSD, ES (buildSessionContext)
    `Además, al empezar escribe un plan corto (qué vas a hacer + pasos previstos) en \`${join(KODO_DIR, 'plans', `${session.task_id}.md`)}\` (sobrescribe si ya existe).`,
```
```javascript
// Source: src/hooks/session-start.js:145 — rama GSD quick, EN (buildGsdContext)
      `Also, at the start write a short plan (what you'll do + planned steps) to \`${join(KODO_DIR, 'plans', `${session.task_id}.md`)}\` (overwrite if it exists).`,
```

## State of the Art

| Enfoque anterior | Enfoque actual | Cuándo cambió | Impacto en esta fase |
|------------------|----------------|---------------|----------------------|
| Mutators de `state.json` haciendo load→mutate→save sin lock | Todo mutator pasa por `withStateLock` (load fresco **dentro** del lock) | v0.16 Phase 70 (CONC-01, D-02) | D-06 es obligatorio, no opcional. El hook es «un escritor más» |
| Lock GSD ad-hoc con `existsSync` + write | `withFileLock` genérico: `O_EXCL` (`wx`) + steal CAS + ABA guard | v0.16 Phase 70 (D-01, D-08) | D-08 reutiliza la primitiva; el fichero de plan es su segundo cliente |
| `saveState` con tmp de nombre fijo | tmp único por escritor (pid+UUID) — fix WR-02 | v0.16 Phase 70 | El plan debe copiar **este** patrón, no el de `writeFileAtomic` |
| Transición de estado dependiente solo del LLM | LLM + backstop mecánico gated | v0.16 Phase 71 (D-10..D-14) | D-03/D-04 replican el patrón para el handoff |
| Efectos cosméticos de cierre en `stop.js` (por turno) | Movidos a `SessionEnd` (una vez), orden LOCKED | v0.16 Phase 72 (HYG-04) | El orden `backstop→setColor→notify` no se toca |

**Deprecado/obsoleto:**
- El comentario de `session-start.js:83` (*«D-06 escribir al empezar (re-dispatch sobrescribe, latest-wins)»*) queda **obsoleto** con D-10. El planner debería actualizarlo junto con las líneas — es la justificación de la semántica que se invierte.
- Idem `session-start.js:142-143` para la rama quick.

## Project Constraints (from CLAUDE.md)

**No hay `CLAUDE.md` ni `.claude/CLAUDE.md` en la raíz del repo** — verificado. Aplica el `CLAUDE.md` global del usuario (`~/.claude/CLAUDE.md`). Directivas actionables relevantes a esta fase:

| Directiva | Aplicación aquí |
|-----------|-----------------|
| **Regla 2 — Simplicidad primero.** «Código mínimo que resuelva el problema. Sin features especulativas. Sin abstracciones para código de un solo uso» | Refuerza D-12 (sin poda) y acota `handoff.js` a las 4 funciones que D-13 nombra. No inventar un registro de handoffs ni un índice |
| **Regla 3 — Cambios quirúrgicos.** «Toca solo lo que debas. No "mejores" código adyacente, comentarios ni formato» | En `session-start.js` tocar **solo** `:85`/`:145` (+ sus comentarios obsoletos, que sí son parte del cambio). En `session-end.js`, insertar sin reordenar |
| **Regla 1 — Declara qué asumes. Empuja de vuelta cuando exista un enfoque más simple** | Motiva §Assumptions Log y §Open Questions abajo |
| **Estilo:** 2 espacios, `@ts-check`, comentarios que citan la decisión (`D-0X`) | Convención viva en todo `src/session/` y `src/hooks/` |
| **Responde en español** | Aplica a la interacción, no al código. Nota: el repo mezcla ES/EN **por rama deliberadamente** (D-08 Phase 45): la instrucción no-GSD es ES, la GSD es EN. D-10 lo preserva |

**Project skills:** `.claude/skills/` contiene `kodo-orchestrate` y `worktree-cleanup` — ninguna aporta patrones de código relevantes a esta fase (son skills operativas). Sin `rules/*.md`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Ningún test **fuera** de `test/session-start.test.js` y `test/gsd-context.test.js` asserta sobre el output de `buildSessionContext`/`buildGsdContext` de forma que las líneas `:85`/`:145` lo rompan. Grep encontró 5 ficheros que los referencian (`session-start-event`, `session-start`, `gsd-context`, `orchestrator-gsd`, `gsd-inspect-cli`); leí en profundidad los dos primeros relevantes, no los tres restantes | Golden bytes / D-11 | BAJO — el planner corre `npm test` de todas formas; el peor caso es un test extra que actualizar |
| A2 | `os.homedir()` respeta `process.env.HOME` en macOS/POSIX (base del aislamiento de tests) | Pitfall 6 | MUY BAJO — todo el suite de `test/state/` depende de esto y pasa hoy |
| A3 | El operador quiere el `.lock` del plan en `<plan>.md.lock` (junto al plan), como CONTEXT.md D-08 escribe (`<plan>.lock`) | Open Question 2 | BAJO — cosmético; `doctor.js` podría verlo como residuo (ver OQ2) |

## Open Questions (RESOLVED)

> **Estado al cierre del planning (2026-07-15).** Las tres quedan cerradas y ninguna bloquea la
> ejecución: **OQ1** (cómo llega `state.tasks` a la TUI) se difiere explícitamente a la Phase 75 y
> está anotada en `74-CONTEXT.md` §Deferred Ideas — la 74 solo produce el dato. **OQ2** (`<plan>.md.lock`
> vs `doctor.js`) se resolvió durante el planning: `detectHungLocks` (`doctor.js:341`) solo escanea
> `join(projectPath, '.planning/.kodo.lock')` sobre rutas de proyecto, nunca `~/.kodo/plans/` — no hay
> colisión posible; documentado en `74-04-PLAN.md` para no re-litigarlo. **OQ3** (el guard de `task_id`
> sube de listón porque D-09 convierte al hook en escritor) se implementa como `isSafeTaskId` en los
> planes 01 y 04, con `String.includes` y cero RegExp.

1. **`/status` NO sirve `state.json` — la premisa de consumo de D-05 es incorrecta**
   - **Lo que sabemos:** CONTEXT.md D-05 afirma *«La Phase 75 lo lee por `task_id` sin endpoint nuevo (`/status` ya sirve `state.json`)»*. **Eso es falso contra el código.** `server.js:588-624`: el handler hace `const sessions = listSessions()` (`:589`), y `listSessions` es `Object.values(loadState().sessions)` (`state.js:420-422`). Luego enriquece **por fila** con `{...s, elapsed_min, provider_state, provider_state_reason}` (`:620-624`). **`/status` sirve `sessions` + `pending`, nunca el objeto `state.json` completo.** Con D-05, `state.tasks` **no** saldría por `/status` hoy.
   - **Lo que no está claro:** cómo consume la Phase 75. Nada de esto cambia el trabajo de la Phase 74 — D-05 sigue siendo la decisión correcta por la razón dura que la motiva (`removeSession` archiva la fila a `history` FIFO 50 y la borra, `state.js:355-376`), y esa razón está verificada.
   - **Recomendación:** **no bloquear la Phase 74.** Registrar el hecho para el discuss de la Phase 75, que tiene dos salidas ya con precedente y ninguna necesita endpoint nuevo: (a) enriquecer las filas en el mapper existente de `/status` (modificar el payload de un handler existente ≠ endpoint nuevo), o (b) que la TUI lea `state.json` del fs directamente — precedente literal de `plan.js` (D-10 Phase 44: *«lee el filesystem como `focus.js` invoca cmux — cero endpoints»*). Ojo: la fila de la sesión **desaparece al cerrar**, así que (a) no basta por sí sola para tareas sin sesión viva — que es exactamente el caso de uso del handoff.

2. **¿Confunde `<plan>.md.lock` a `doctor.js`?**
   - **Lo que sabemos:** `doctor.js` detecta `hung locks` (`detectHungLocks`, invocado en `:419`). El fichero de plan gana un `.lock` hermano nuevo, en `~/.kodo/plans/`.
   - **Lo que no está claro:** si el scan de doctor mira `~/.kodo/plans/` o solo locks GSD/state. No lo verifiqué en profundidad (fuera del alcance de las 7 preguntas del brief).
   - **Recomendación:** una comprobación de 5 minutos en el plan (`grep -n "detectHungLocks" -A30 src/gsd/doctor.js`). Si doctor no escanea `plans/`, no hay nada que hacer. Riesgo bajo: el lock se libera en el `finally` de `withFileLock:228-230` y solo sobrevive a un SIGKILL exacto durante la sección crítica (~ms), y aun así es robable por TTL 10s.

3. **D-09 create-if-missing y el guard de contención del `task_id`**
   - **Lo que sabemos:** `plan.js:117-124` valida el `task_id` antes de construir la ruta (`!includes('/') && !includes('\\') && !includes('..')`, con `String.includes` — anti-ReDoS D-13) porque el `task_id` viene del provider (input externo). D-09 hace que el hook **cree** ficheros bajo `~/.kodo/plans/`.
   - **Lo que no está claro:** si el planner replicará ese guard en el lado escritor. Un `task_id` malicioso con `../` sería ahora una **escritura** fuera del root, no solo una lectura.
   - **Recomendación:** el guard es obligatorio en el escritor y **más crítico** que en el lector. Espejo exacto de `plan.js:119-121`. Ver §Security Domain V5.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | todo | ✓ | `engines: >=20.0.0` (`package.json:22-24`) | — |
| `node:test` | suite de tests | ✓ | built-in | — |
| `node:fs`, `node:path`, `node:os`, `node:crypto` | locks, RMW, rutas | ✓ | built-in | — |
| `Atomics`/`SharedArrayBuffer` | `sleepSync` de `state-lock.js:45-48` | ✓ | built-in | — (ya en uso en producción desde v0.16) |
| npm registry | — | n/a | — | **No se necesita: cero deps nuevas** |

**Missing dependencies with no fallback:** ninguna.
**Missing dependencies with fallback:** ninguna.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in, Node ≥20) |
| Config file | none — `package.json:10` script |
| Quick run command | `node --test test/session-start.test.js test/gsd-context.test.js test/hooks/session-end.test.js` |
| Full suite command | `npm test` (→ `node --test $(find test -name '*.test.js' -type f)`) |
| Baseline | 2027 tests al cierre de v0.16 (`STATE.md`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|--------------|
| LIVE-01 | El plan gana `## Handoff <fecha>` con Hecho/Pendiente/NEXT al cerrar | unit (DI) | `node --test test/hooks/session-end-handoff.test.js` | ❌ Wave 0 |
| LIVE-01 | El handoff aterriza **ANTES** de `removeSession`/worktree/promptFile — orden de efectos observable | unit (DI, orden de llamadas) | `node --test test/hooks/session-end-handoff.test.js` | ❌ Wave 0 |
| LIVE-01 | Orden LOCKED `backstop → setColor → notify` intacto tras insertar el bloque | unit (regresión, cmux stub) | `node --test test/hooks/session-end.test.js` | ✅ existe (extender) |
| LIVE-02 | Segunda sesión acumula 2º bloque; el 1º íntegro byte a byte | unit (contrato puro + hook) | `node --test test/session/handoff.test.js` | ❌ Wave 0 |
| LIVE-02 | `buildSessionContext` ordena preservar-y-appendear (ya no «sobrescribe») | unit (golden bytes) | `node --test test/session-start.test.js` | ✅ existe (extender) |
| LIVE-02 | `buildGsdContext` quick ordena preservar-y-appendear | unit (golden bytes) | `node --test test/gsd-context.test.js` | ✅ existe (extender) |
| LIVE-02 | Ramas GSD full/bootstrap **siguen sin** instrucción (D-10) | unit (regresión) | `node --test test/gsd-context.test.js` | ✅ existe (`:219`, `:224`) |
| LIVE-03 | Sin marcador de esta sesión → append del bloque mecánico `— automático`, sin `NEXT:` | unit | `node --test test/session/handoff.test.js` | ❌ Wave 0 |
| LIVE-03 | Con marcador `session=<este id>` → **no** se appendea nada | unit | `node --test test/session/handoff.test.js` | ❌ Wave 0 |
| LIVE-03 | **Caso crítico D-04:** plan con bloque de sesión **anterior** + esta sesión sin escribir → **sí** appendea mecánico (el detector es scoped, no por conteo) | unit | `node --test test/session/handoff.test.js` | ❌ Wave 0 |
| LIVE-03 | `input.reason` desconocido colapsa a `other`; enum cerrado validado | unit | `node --test test/session/handoff.test.js` | ❌ Wave 0 |
| LIVE-04 | `state.tasks[task_id] = {plan_path, next, updated_at}` tras el cierre | unit (HOME isolation) | `node --test test/state/handoff-state.test.js` | ❌ Wave 0 |
| LIVE-04 | `NEXT:` truncado a 200 chars al persistir (D-02) | unit (contrato puro) | `node --test test/session/handoff.test.js` | ❌ Wave 0 |
| LIVE-04 | El mutator **no** toca `alive` (invariante D-04) | unit | `node --test test/state/handoff-state.test.js` | ❌ Wave 0 |
| LIVE-04 | **Concurrencia:** N cierres reales simultáneos de tareas distintas → cero escrituras perdidas en `state.tasks` | integration (cross-process) | `node --test test/state/handoff-concurrency.test.js` | ❌ Wave 0 |
| LIVE-04 | **Concurrencia D-08:** dos escritores simultáneos del **mismo** plan → ambos bloques presentes (cero lost update) | integration (cross-process) | `node --test test/state/handoff-concurrency.test.js` | ❌ Wave 0 |
| LIVE-04 | Aditividad: `state.tasks` sobrevive a un `reconcileTick` (spread preserva) | unit (regresión anti-drop) | `node --test test/session/reconcile-*.test.js` | ✅ existe (extender) |
| SC#5 | Plan ilegible (EACCES) → `log.warn`, **no** throw, cierre completa | unit (fs stub que lanza) | `node --test test/hooks/session-end-handoff.test.js` | ❌ Wave 0 |
| SC#5 | Lock ocupado (`{ok:false}`) → `log.warn`, **no** bloquea el cierre | unit | `node --test test/hooks/session-end-handoff.test.js` | ❌ Wave 0 |
| D-09 | Plan ausente → se crea con cabecera mínima + bloque | unit | `node --test test/hooks/session-end-handoff.test.js` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `node --test test/session-start.test.js test/gsd-context.test.js test/hooks/session-end.test.js` (+ el fichero nuevo de la task) — < 10 s
- **Per wave merge:** `npm test` (suite completa, ~30-60 s según el precedente de `71-VALIDATION.md`)
- **Phase gate:** suite completa verde antes de `/gsd-verify-work`
- **Max feedback latency:** 60 s

### Wave 0 Gaps

- [ ] `test/session/handoff.test.js` — contrato puro (D-01..D-04). **Cero fs, cero HOME** si `handoff.js` es hoja pura → el test más barato y el que más cubre
- [ ] `test/hooks/session-end-handoff.test.js` — orquestación vía DI. Analog: `test/hooks/session-end.test.js` (`makeSession:45`, `makeLogger:16`, `makeCmuxStub:34`)
- [ ] `test/state/handoff-state.test.js` — persistencia. Analog: `test/state/save-state-atomic.test.js:69-83` (HOME + dynamic import). **Sembrar v3** (Pitfall 5)
- [ ] `test/state/handoff-concurrency.test.js` — cross-process. Analog: `test/state/state-writers-concurrency.test.js` (barrera `go` `:100-104`, `env: {...process.env, HOME: sandbox}` `:87`, `seedV3` `:47`). **Requiere extender o clonar** `test/helpers/lock-race-child.mjs` con un `--kind handoff`
- [ ] Framework install: **ninguno** — `node:test` es built-in

## Security Domain

`security_enforcement` no está desactivado en `.planning/config.json` → sección requerida.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | La fase no toca auth (el bearer default-deny de v0.16 no se cruza) |
| V3 Session Management | no | «Session» aquí es una sesión de Claude Code, no una sesión de usuario autenticado |
| V4 Access Control | no | Sin superficie multi-usuario; todo es local al `$HOME` del operador |
| V5 Input Validation | **sí** | (a) `input.reason` → enum cerrado `{clear, logout, prompt_input_exit, bypass_permissions_disabled, other}`, desconocido → `other` (D-03, precedente T-71-12). (b) `session.task_id` → guard de contención de ruta con `String.includes` (`/`, `\`, `..`), **nunca RegExp** (anti-ReDoS, precedente `plan.js:119-121` / D-13 Phase 44) |
| V6 Cryptography | no | Sin cripto. `randomUUID` se usa solo para nombres únicos de tmp/token, no como secreto |
| V7 Error Handling & Logging | **sí** | Never-throw + logs sin contenido de usuario (precedente T-71-18: el backstop loguea **solo** `{session_id, task_id, state}`) |
| V12 File Resources | **sí** | Escritura bajo root fijo `~/.kodo/plans/`; tmp+rename; lock advisory |

### Known Threat Patterns for esta fase

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| `task_id` con `../` → **escritura** fuera de `~/.kodo/plans/` (D-09 crea ficheros; el riesgo sube respecto al lector de Phase 46) | Tampering | Guard de contención en el escritor, espejo `plan.js:119-121`; ruta **construida** con `join(plansDir, taskId + '.md')`, nunca derivada |
| `input.reason` interpolado crudo en el markdown del bloque mecánico | Tampering / Injection | Enum cerrado validado **antes** de interpolar (D-03). El `reason` viene de Claude Code por stdin — entrada no confiable |
| `session.summary`/`task_ref` interpolados en la cabecera de D-09 (vienen del **provider**, no del operador) | Tampering | **No cubierto por D-03**, que solo nombra `reason`. Son texto de un work item remoto. Riesgo real bajo (markdown en un fichero local, no HTML ni shell), pero conviene al menos no interpolarlos en la **ruta** y aceptar que pueden contener `#`/backticks |
| Lost update en el plan (dos cierres) | Tampering (pérdida de datos) | `withFileLock` (D-08) — la razón entera de su existencia |
| Lock robado por TTL durante una escritura larga | Tampering | `fn` síncrono y corto (Pitfall 4); TTL 10s ≫ una RMW de un md pequeño |
| DoS del cierre por lock ocupado | DoS | `{ok:false}` → warn → seguir; peor caso ~160 ms por lock (`state-lock.js:34-36`) |
| Un handoff que lanza bloquea el cierre de Claude Code | DoS | try/catch propio (D-07) + outer never-throws (Pitfall 3) |
| Ficheros de plan con permisos world-readable | Information Disclosure | Fuera de alcance: los planes ya existen desde Phase 45 con umask del proceso; no son secretos (PERSIST-04 cubre solo `~/.kodo/.env`) |

## Sources

### Primary (HIGH confidence) — código leído en esta sesión

- `src/hooks/session-end.js` (373 líneas, completo) — estructura, guards, backstop, orden LOCKED
- `src/hooks/session-start.js` (273 líneas, completo) — `:85`, `:145`, las 4 ramas
- `src/hooks/terminal-cleanup.js` (85 líneas, completo) — la secuencia destructiva
- `src/session/state.js` (500 líneas, completo) — locks, typedefs, migraciones, `removeSession`
- `src/session/state-lock.js` (231 líneas, completo) — `withFileLock` y su contrato real
- `src/cli/dashboard/plan.js` (189 líneas, completo) — `readLightPlan`, leaf-isolation, guards
- `src/session/reconcile.js:340-416`, `:237-239` — la respuesta a la incógnita de `state.tasks`
- `src/config.js:135-146`, `:11`, `:615` — `writeFileAtomic`, `KODO_DIR`
- `src/server.js:588-624` — `/status` (contradice la premisa de D-05; OQ1)
- `src/gsd/doctor.js:405-420` — fallback de shape
- `test/session-start.test.js`, `test/gsd-context.test.js`, `test/hooks/session-end.test.js`, `test/state/state-writers-concurrency.test.js`, `test/state/save-state-atomic.test.js`, `test/check-isolation.test.js`, `test/format-isolation.test.js`
- `package.json`, `.planning/config.json`

### Secondary (MEDIUM confidence) — artefactos de fase

- `.planning/milestones/v0.16-phases/71-.../71-PATTERNS.md`, `71-VALIDATION.md` — precedente LLM+backstop y formato Nyquist
- `.planning/milestones/v0.16-phases/70-.../70-PATTERNS.md` — precedente de locking, «reuse by import»
- `.planning/phases/74-.../74-CONTEXT.md`, `.planning/REQUIREMENTS.md`, `.planning/STATE.md`

### Tertiary (LOW confidence)

Ninguna. **Cero WebSearch, cero Context7** — no había tecnología externa que investigar (constraint «cero deps npm nuevas»). Todo hallazgo es verificable con `grep`/`sed` sobre este repo.

## Metadata

**Confidence breakdown:**
- Standard stack: **HIGH** — no hay stack que elegir; las primitivas se leyeron línea a línea
- Architecture / punto de inserción: **HIGH** — `session-end.js` leído completo; el hueco `:97` es aritmética sobre el fichero
- `state.tasks` aditivo (la incógnita #1): **HIGH** — cadena completa verificada (`reconcile.js:238`/`:396` spread; `migrateStateV2toV3:122` guard; `loadState:257` trampa v2 identificada y acotada)
- Golden bytes (D-11): **HIGH** — grep exhaustivo sobre `test/` (cero hits de los literales) + lectura de los 2 ficheros de test relevantes. Residual A1 (3 ficheros no leídos en profundidad)
- Pitfalls: **HIGH** para 1-6 (todos con file:line); **HIGH** para 7 (`plan.js:72` es inequívoco)
- OQ1 (`/status`): **HIGH** en el hecho (`server.js:589` es `listSessions()`); la recomendación para la Phase 75 es una sugerencia, no una decisión

**Research date:** 2026-07-15
**Valid until:** ~30 días — investigación 100% interna sobre un repo estable; solo caduca si Phases 75/76 tocan `state.json`, `session-end.js` o `plan.js` antes de ejecutar la 74.
