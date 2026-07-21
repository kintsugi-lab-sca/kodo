# Phase 78: Address tech debt — saneo del nudge (75/WR-01) + fixes 77-REVIEW — Research

**Researched:** 2026-07-22
**Domain:** Deuda técnica interna (hardening defensivo + cobertura de tests). Dos subsistemas: (1) nudge del orquestador en el hook `SessionEnd`; (2) resolución de grupos cmux en el `launchWorkItem` del session manager.
**Confidence:** HIGH — todos los hallazgos están anclados en lectura directa del código actual y en los `*-REVIEW.md` de las fases 75 y 77 (no en conocimiento externo). No hay librerías nuevas ni superficie de investigación web: el alcance es 100 % código propio.

> **Nota de metodología:** Esta fase no requirió research-plan seam ni consultas a Context7/web — no introduce dependencias ni patrones externos. La fuente autoritativa es el propio repositorio (grep + lectura de fuente) y los artefactos de revisión de las fases origen. Las afirmaciones se etiquetan `[VERIFIED: codebase]` cuando se confirmaron leyendo el fichero real en su estado actual.

---

## Summary

Phase 78 es una fase de **deuda técnica** cuyo scope NO viene de REQUIREMENTS.md sino de dos conjuntos de hallazgos de code-review ya cerrados como «no bloqueantes» pero pendientes de saldar:

1. **Saneo del nudge (75/WR-01):** el `NEXT:` (contenido escrito por un LLM) llega a `cmuxClient.send()` en el hook `SessionEnd` **sin** pasar por `stripControlChars`, a diferencia del mismo dato en el carril de render del dashboard (que sí lo blinda desde la Phase 75). Es una asimetría de saneo con riesgo de inyección de secuencias de escape de terminal (OSC-52 = escritura al portapapeles, CSI de reposicionamiento) hacia el terminal del orquestador. Registrado como **riesgo aceptado R-75-02** en `75-SECURITY.md`, marcado explícitamente como «candidato a follow-up de higiene (sanear los 3 campos en el mismo diff) en v0.18». Phase 78 ES ese follow-up.

2. **Fixes 77-REVIEW:** 9 hallazgos (0 critical · 2 warning · 7 info) de la revisión adversarial de la agrupación de workspaces cmux. Todos verificados como «deuda menor, NO gap» (el fail-open de la fase queda intacto en todos los escenarios), pero **8 de los 9 son accionables** con fixes concretos ya escritos en el propio review. El noveno (IN-07) es riesgo residual de una decisión **LOCKED (D-10)** y NO es accionable en esta fase.

Ambas fases pasaron UAT (`75-UAT.md` 3/3, `77-UAT.md` 5/5) y verificación (`75-VERIFICATION.md` 13/13, `77-VERIFICATION.md` 17/18). Nada de esto bloquea funcionalidad: es hardening defensivo y red de regresión de tests. El diff esperado es quirúrgico y toca pocos ficheros.

**Primary recommendation:** Dos planes independientes por subsistema — **Plan A: saneo del nudge** (hooks/stop + hooks/session-end, blinda los 3 campos LLM del texto del nudge) y **Plan B: hardening de resolución de grupos cmux** (session/manager: WR-01+IN-01 fusionados, IN-02, IN-04, IN-06 + tests WR-02/IN-05). Respetar todos los invariantes cross-milestone; ninguna dependencia npm nueva; ningún endpoint nuevo; `buildStopNudgeText` y las 3 funciones puras de grupo siguen puras y byte-deterministas para inputs limpios (D-09).

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Saneo del contenido LLM del nudge | Hook `SessionEnd` (`src/hooks/session-end.js`) | Helper puro de formato (`src/cli/format.js` → `stripControlChars`) | El nudge se compone y emite en el hook; el saneo es un helper puro reutilizado del carril de render del dashboard (ya importado por `App.js`/`markdown.js`) |
| Composición del texto del nudge | Función pura `buildStopNudgeText` (`src/hooks/stop.js`) | — | Único punto donde se interpolan `task_ref`, `summary` y `next` en el texto; debe seguir PURA (cero I/O) |
| Derivación/resolución del grupo cmux | Session manager (`src/session/manager.js`, funciones puras) | Host provider (`src/host/cmux.js` `_legacy` passthrough) | Toda la lógica de grupo vive en 3 funciones puras + su cableado en `launchWorkItem`; cmux confinado a `src/host/`+`src/cmux/` |
| Red de regresión (tests) | Test tier (`test/`) | — | WR-02 (Unicode) e IN-05 (assert vacuo) son huecos de cobertura, no de comportamiento |

**Por qué importa:** los dos subsistemas son **ortogonales** (hook de cierre vs. manager de arranque, cero solape de ficheros). Se pueden planificar y ejecutar en paralelo. El único acoplamiento interno es dentro del Plan B: 77/WR-01 e IN-01 tocan la MISMA función (`deriveExpectedGroupName`) y deben ir en el mismo cambio cohesivo.

---

## Scope Sources (qué se arregla y qué NO)

### A. Saneo del nudge — 75/WR-01

**Origen:** `.planning/phases/75-.../75-REVIEW.md` §WR-01; cross-referenciado en `75-VERIFICATION.md` §Anti-Patterns y `75-SECURITY.md` §Accepted Risks Log (R-75-02).

**Hallazgo `[VERIFIED: codebase]`:** En `src/hooks/session-end.js` (~línea 255), el bloque del nudge llama:
```js
await cmuxClient.send({
  workspace: orchMatch[1],
  text: buildStopNudgeText(session, handoffNext),   // handoffNext SIN sanear
});
```
`handoffNext` proviene de `state.tasks[...].next` (contenido escrito por el LLM de la sesión, o derivado del plan). `extractNext` solo hace `trim()` + `slice(200)`; NO neutraliza bytes de control. Además, `buildStopNudgeText` (`src/hooks/stop.js:49`) interpola **también** `session.task_ref` y `session.summary` crudos en la línea base:
```js
const base = `La sesión ${session.task_ref} (${session.summary}) ha terminado y está en Review.`;
```
Estos dos campos ya viajaban crudos al mismo sink desde antes de la Phase 75 (limitación preexistente documentada). El carril de render del dashboard SÍ blinda `next` con `stripControlChars` (`App.js:753`), dejando la asimetría a la vista.

**`stripControlChars` `[VERIFIED: codebase]`** (`src/cli/format.js:80`): función pura, never-throws (`String(s)`), elimina CSI completas, C0 (incl. ESC/BEL/CR), DEL y C1 `\x80-\x9f`; **preserva solo `\t` y `\n`**. Sobre ASCII limpio es la identidad → byte-determinismo preservado.

**Fix recomendado (del review, ampliado):** Sanear los **3 campos LLM** (`next`, `summary`, `task_ref`) que se interpolan en el texto del nudge, cerrando la limitación de una vez. Dos ubicaciones posibles (decisión de diseño para el planner):

- **Opción 1 (recomendada): sanear dentro de `buildStopNudgeText`.** Es el ÚNICO punto donde los 3 campos se interpolan. `stripControlChars` es pura (cero I/O) → la función **sigue pura** y el test de pureza (`test/stop.test.js`, que asserta ausencia de `readFileSync`/`writeFileSync`) sigue verde. Cierra los 3 campos en un solo sitio.
- **Opción 2 (la del review): sanear en el punto de threading en `session-end.js`.** Solo cubre `next` salvo que además se saneen `summary`/`task_ref` antes de construir `session`. Más disperso.

⚠️ **Invariante D-09 (byte-determinismo del nudge):** el test por-modo de `test/stop.test.js` asserta que sin `next` el texto queda byte-idéntico a la rama original. `stripControlChars` sobre las cadenas limpias de los tests existentes es la identidad, así que **no debe romper ningún golden**. Verificarlo es un must del plan.

### B. Fixes 77-REVIEW — enumeración completa

**Origen:** `.planning/phases/77-.../77-REVIEW.md`. Cross-check contra `77-VERIFICATION.md` §«Evaluación de las 2 Warnings» y `77-01/02-SUMMARY.md`: **ninguno de los 9 hallazgos fue arreglado durante la ejecución de la fase 77** — todos siguen abiertos en el código actual (verificado por grep, ver tabla).

| ID | Sev | Fichero (línea actual verificada) | Qué es | Fix | Disposición |
|----|-----|-----------------------------------|--------|-----|-------------|
| **77/WR-01** | Warning | `src/session/manager.js:143-162` (`deriveExpectedGroupName`) | El identifier derivado puede quedar `''` para refs degenerados `'#7'` (`split('#')[0]`=`''`) o `'-9'` (`replace(/-\d+$/,'')`=`''`), o `'/Módulo'`. Un grupo del operador con nombre solo-whitespace matchea `''` → la tarea aterriza en grupo arbitrario. Contradice el propio JSDoc («NO deriva un nombre bogus»). | Tras derivar el identifier, `if (!identifier || identifier.trim() === '') return null;`. Añadir tests `ref:'#7'` y `ref:'-9'` → null. | **ACCIONABLE** (fusionar con IN-01) |
| **77/WR-02** | Warning | `test/session/group-resolve.test.js:155-157` | El invariante Unicode (NFC) del código no tiene NINGÚN test — el único test de norm (`:155`) cubre solo caso/espacios (`' kodo '` vs `'KODO'`), cero bytes no-ASCII. Si alguien borra `.normalize('NFC')`, la suite sigue verde y `Traça Web` se rompe en silencio. | Añadir test: name en NFD (`ç` = `c`+U+0327) matchea expected en NFC → `workspace_group:N`. | **ACCIONABLE** (test-only) |
| **77/IN-01** | Info | `src/session/manager.js:144-153` | Ref con whitespace de borde (`'KODO-9 '`) deriva identifier sucio → no matchea → pérdida silenciosa de grupo. La guarda usa `ref.trim()` pero la derivación opera sobre el ref crudo. | Derivar sobre el ref trimeado: `const ref = String(task?.ref ?? '').trim(); if (ref === '') return null;` y usar ese `ref`. | **ACCIONABLE** (fusionar con WR-01: un solo cambio a la función cierra ambos) |
| **77/IN-02** | Info | `src/session/manager.js:184-190` (`resolveWorkspaceGroup`) | Devuelve `g.ref` validando solo `typeof g.ref === 'string'`, no el shape `workspace_group:\d+`. Un JSON anómalo de cmux podría colar un ref arbitrario (un `\n` forjaría líneas de log). | Añadir `&& /^workspace_group:\d+$/.test(g.ref)` al type-check por campo. | **ACCIONABLE** (hardening barato) |
| **77/IN-03** | Info | `src/session/manager.js:394-396` | El `catch { console.log('...resolucion_fallo') }` descarta el error → un motivo fijo para 4 causas distintas (cmux viejo / daemon headless / JSON malformado / bug). Dificulta diagnosticar. | *(Opcional)* `catch (err) { console.log(\`...resolucion_fallo: ${String(err?.message).slice(0,80)}\`) }` — el mensaje viene de cmux/JSON.parse, no del usuario → D-11 preservado. | **OPCIONAL** (diagnosticabilidad; decidir en discuss/plan) |
| **77/IN-04** | Info | `src/session/manager.js:391-393` | Ejecuta `listWorkspaceGroups()` (~50ms, timeout hasta 15s) aunque `expectedName` sea `null` (resultado garantizado null) → trabajo inútil por lanzamiento. | Guardar la llamada: `if (expectedName) { const raw = await host._legacy.listWorkspaceGroups(); groupRef = resolveWorkspaceGroup(JSON.parse(raw), expectedName); }`. | **ACCIONABLE** (perf; encaja con el mismo bloque) |
| **77/IN-05** | Info | `test/manager.test.js:849-852` | El assert GRP-04 hace `slice(indexOf('...buildSessionFromTask'), indexOf('...resolveProjectPath'))`; si se reordenan funciones, `end` queda `< start`, `slice` da `''` y el regex negativo pasa vacuo → guard GRP-04 apagado en silencio. | Añadir `assert.ok(end > start, 'resolveProjectPath debe seguir a buildSessionFromTask (delimitador del slice)')`. | **ACCIONABLE** (robustez de test) |
| **77/IN-06** | Info | `src/host/cmux.js:358` | JSDoc de `_legacy.newWorkspace` desactualizado: falta `group?: string` (el passthrough ya recibe `group` vía `newWorkspaceWithGroupFallback`; `client.js` sí se actualizó). | `/** @param {{ name: string, cwd?: string, command?: string, group?: string }} opts ... */`. | **ACCIONABLE** (doc) |
| **77/IN-07** | Info | `src/session/manager.js:211-216` | El retry de la capa 2 (D-10) reintenta ante CUALQUIER rejección con `--group`; si el 1er intento falló por timeout DESPUÉS de que cmux creó el workspace, el retry crea un duplicado. | **Ninguno en esta fase.** Es comportamiento que **D-10 fija (LOCKED)**, verificado como implementado fielmente. | **NO ACCIONABLE** (LOCKED; documentar como riesgo residual conocido) |

**Agrupación natural del Plan B:** WR-01+IN-01 (misma función, un cambio: trim del ref + guard del identifier derivado) → IN-04 (mismo bloque de `launchWorkItem`, guardar la llamada cuando `expectedName` null) → IN-02 (`resolveWorkspaceGroup`) → IN-06 (JSDoc en host/cmux.js) → tests WR-02 + IN-05. IN-03 es una decisión aparte (diagnosticabilidad) — recomiendo incluirla porque el `slice(0,80)` del mensaje ya está probado seguro por D-11, pero puede diferirse sin coste.

---

## Out of Scope (NO tocar en Phase 78)

| Item | Por qué queda fuera |
|------|---------------------|
| **77/IN-07** (retry D-10 duplica workspace ante timeout) | Comportamiento LOCKED (D-10). Cambiarlo exige discriminar la causa del error (`invalid_params`/exit=1 vs timeout) — es un seam nuevo, no un fix de deuda. Solo abordar «si el duplicado aparece en operación real». |
| **Flaky `test/gsd-lock-race.test.js` (CR-01)** | Es un **deferred item de la Phase 74** (`STATE.md` §Deferred Items), NO un hallazgo de 77-REVIEW. Está marcado «NO arreglar a ciegas (podría enmascarar una carrera real del lock)» → requiere `/gsd-debug`, no esta fase. |
| Saneo de `summary`/`task_ref` en OTROS sinks | El review acota el follow-up al **texto del nudge**. Auditar todos los sinks de esos campos es scope creep; limitarse a `buildStopNudgeText`. |
| Cualquier verbo de gestión de grupos cmux | GRP-04 LOCKED: kodo consume grupos, no los gestiona. Solo `workspace-group list` es admisible. |

---

## Standard Stack

**No aplica.** Cero dependencias nuevas (invariante LOCKED «Cero nuevas dependencias npm»). El único helper reutilizado es interno: `stripControlChars` desde `src/cli/format.js` (ya existente, ya importado por el dashboard). `[VERIFIED: codebase]`

**Instalación:** ninguna.

---

## Architecture Patterns

### Flujo de datos — Saneo del nudge (Plan A)

```
state.tasks[task_id].next  (contenido LLM, ≤200 chars)
        │
        ▼
writeHandoff() ── effectiveNext (post-asimetría upsert) ──► handoffNext   [session-end.js ~145]
        │                                                        │
   session.task_ref ─┐                                           │
   session.summary  ─┤                                           │
        │            ▼                                           ▼
        └──► buildStopNudgeText(session, next)  ◄────────────────┘   [stop.js:48]
                    │
             ★ AQUÍ: stripControlChars sobre task_ref/summary/next (FIX 75/WR-01)
                    │
                    ▼
             cmuxClient.send({ workspace: orchestrator, text })   [session-end.js ~255]
                    │
                    ▼
             Terminal del orquestador (sink que interpreta OSC/CSI)
```

### Flujo de datos — Resolución de grupo cmux (Plan B)

```
task.ref (provider)
    │
    ▼
deriveExpectedGroupName(task, entry, projectPath)   [manager.js:143]
    │  ★ FIX WR-01/IN-01: trim(ref) + guard identifier derivado vacío → null
    ▼
expectedName (o null)
    │
    ├── ★ FIX IN-04: if (expectedName) { ... }  (evita exec cmux garantizado-inútil)
    ▼
host._legacy.listWorkspaceGroups()  ──► stdout crudo   [único call site, manager.js:392]
    │
    ▼
JSON.parse(raw)  ── (dentro del try/catch capa 1 fail-open)   ★ FIX IN-03: catch(err) con motivo
    │
    ▼
resolveWorkspaceGroup(json, expectedName)   [manager.js:178]
    │  ★ FIX IN-02: exigir /^workspace_group:\d+$/ en g.ref
    ▼
groupRef (o null)
    │
    ▼
newWorkspaceWithGroupFallback(host._legacy.newWorkspace, {name,cwd}, groupRef)   [D-10 capa 2, INTACTO — IN-07 LOCKED]
```

### Patrón 1: Saneo en el punto de composición (no en cada sink)
**Qué:** aplicar `stripControlChars` una vez, en `buildStopNudgeText`, donde convergen los 3 campos LLM.
**Cuándo:** contenido de origen no confiable (LLM / `state.json` hand-editable) que cruza a un terminal.
**Ejemplo (patrón ya presente en el carril de render):**
```js
// Source: src/cli/dashboard/App.js:752-753 (patrón existente a replicar)
const rawNext = /* ... */;
row.next = typeof rawNext === 'string' && rawNext.length > 0
  ? stripControlChars(rawNext)
  : rawNext;
```

### Patrón 2: Guarda de entrada degenerada sobre el valor DERIVADO, no solo el crudo
**Qué:** validar el identifier tras derivarlo, no solo el `ref` de entrada.
**Cuándo:** cualquier transformación string→string que pueda colapsar a vacío (`split`, `replace`, `pop`).
**Ejemplo (el fix WR-01/IN-01):**
```js
// Source: 77-REVIEW.md §WR-01 fix (aplicar a src/session/manager.js)
const ref = String(task?.ref ?? '').trim();      // IN-01: trim primero
if (ref === '') return null;
const identifier = ref.includes('#')
  ? ref.split('#')[0].split('/').pop()
  : ref.replace(/-\d+$/, '');
if (!identifier || identifier.trim() === '') return null;  // WR-01: derivado vacío → fail-open
```

### Anti-Patterns to Avoid
- **Sanear en el sink en vez de en la composición:** dejaría `summary`/`task_ref` sin blindar y repetiría el saneo en cada llamada. Sanear en `buildStopNudgeText` (único punto de interpolación).
- **Romper la pureza de `buildStopNudgeText`:** el fix NO puede introducir I/O. `stripControlChars` es pura → OK; nunca leer state.json ahí.
- **Cambiar el output para inputs limpios:** violaría D-09 (byte-determinismo). `stripControlChars` sobre ASCII limpio es identidad; verificar con los goldens existentes.
- **Tocar el retry D-10 (IN-07):** decisión LOCKED; no re-cablear el fallback.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Neutralizar secuencias de escape de terminal | Un regex ad-hoc nuevo en `stop.js`/`session-end.js` | `stripControlChars` de `src/cli/format.js` | Ya cubre CSI/C0/C1/DEL, es pura, never-throws y es el MISMO saneo del carril de render (simetría) `[VERIFIED: codebase]` |
| Validar shape `workspace_group:N` | Parser custom | Un `RegExp` inline `/^workspace_group:\d+$/` en el type-check existente | Es el patrón defensivo por-campo que ya usa `resolveWorkspaceGroup` |

**Key insight:** todo el hardening de esta fase reutiliza primitivas ya presentes en el repo; no hay nada que construir desde cero.

---

## Common Pitfalls

### Pitfall 1: Romper el byte-determinismo del nudge (D-09)
**Qué va mal:** al insertar `stripControlChars`, si algún test golden esperaba un carácter que la función elimina (p. ej. `\r`), el golden cambia.
**Por qué pasa:** `stripControlChars` elimina `\r` y preserva `\t`/`\n`; los goldens de `test/stop.test.js` deben ser ASCII limpio.
**Cómo evitarlo:** correr `node --test test/stop.test.js` antes y después; los goldens por-modo deben quedar idénticos. Si cambian, es señal de que el golden tenía bytes de control (improbable).
**Señal temprana:** cualquier diff en `test/stop.test.js` sin haber tocado el texto base.

### Pitfall 2: Romper la pureza de `buildStopNudgeText`
**Qué va mal:** importar algo con efectos o leer estado dentro de la función pura.
**Por qué pasa:** confundir «sanear» con «resolver el dato».
**Cómo evitarlo:** el `next` ya llega en memoria (threadeado por `writeHandoff`); solo se le aplica `stripControlChars` (pura). El test de pureza de `test/stop.test.js` es la red.

### Pitfall 3: Regresión del fail-open de grupos (GRP-03)
**Qué va mal:** el guard nuevo del identifier vacío hace `return null` de más y rompe un caso legítimo.
**Por qué pasa:** confundir «identifier vacío» (bogus) con un identifier corto válido.
**Cómo evitarlo:** el fixture live (`Kodo`/`SCRIBBA`/`SCP-CMRi`) en `group-resolve.test.js` debe seguir resolviendo `KODO-9`→`workspace_group:1`. Los casos nuevos (`'#7'`, `'-9'`, `'KODO-9 '`) → null; los legítimos → sin cambio.
**Señal temprana:** cualquier fallo en los 29 tests existentes de `group-resolve.test.js`.

### Pitfall 4: El assert IN-05 sigue vacuo tras el «fix»
**Qué va mal:** añadir el `assert.ok(end > start)` pero después de un `slice` que ya devolvió `''`.
**Cómo evitarlo:** el assert debe ir ANTES de usar `body`, y fallar si el orden se rompió. Verificar mutando temporalmente el orden en local (debe ponerse rojo).

---

## Runtime State Inventory

**No aplica plenamente** — no es un rename/refactor/migración de datos; es hardening de código + tests. Aun así, verificación explícita por categoría:

| Categoría | Hallazgo | Acción |
|-----------|----------|--------|
| Stored data | El `next` en `state.tasks[...]` YA se persiste (Phase 74). Esta fase NO cambia su formato ni su schema. Sanear en el nudge NO reescribe state.json. | Ninguna — cero migración de datos |
| Live service config | Ninguna. Los grupos cmux se resuelven en fresco por lanzamiento y NO se persisten (GRP-04). | Ninguna |
| OS-registered state | Ninguna. | Ninguna |
| Secrets/env vars | Ninguna. | Ninguna |
| Build artifacts | Ninguna — cambios de fuente y tests, sin repackaging. | Ninguna |

**El `next` ya persistido con posibles bytes de control:** el saneo es en el punto de *proyección* (nudge), no en el de *escritura*. Un `next` histórico con bytes de control en `state.json` se neutraliza al emitirse, sin necesidad de migrar el fichero. `[VERIFIED: codebase]`

---

## Validation Architecture

> `workflow.nyquist_validation: true` en `.planning/config.json` `[VERIFIED: codebase]` → sección requerida.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node --test` (runner nativo, Node ≥ 20; entorno actual v22.22.3) `[VERIFIED: codebase]` |
| Config file | none — patrón `node --test $(find test -name '*.test.js' -type f)` en `package.json` |
| Quick run command | `node --test test/<fichero>.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Item | Behavior | Test Type | Automated Command | File Exists? |
|------|----------|-----------|-------------------|--------------|
| 75/WR-01 | El nudge sanea `next`/`summary`/`task_ref`; byte-idéntico para inputs limpios (D-09) | unit | `node --test test/stop.test.js` | ✅ |
| 75/WR-01 | Cadena e2e session-end → nudge con next saneado | integration | `node --test test/hooks/session-end-handoff.test.js` | ✅ |
| 77/WR-01+IN-01 | `deriveExpectedGroupName` con `'#7'`/`'-9'`/`'KODO-9 '` → null | unit | `node --test test/session/group-resolve.test.js` | ✅ |
| 77/WR-02 | `resolveWorkspaceGroup` matchea name NFD vs expected NFC | unit | `node --test test/session/group-resolve.test.js` | ✅ |
| 77/IN-02 | `resolveWorkspaceGroup` rechaza `g.ref` que no case `workspace_group:\d+` | unit | `node --test test/session/group-resolve.test.js` | ✅ |
| 77/IN-04 | `listWorkspaceGroups` NO se llama cuando `expectedName` es null | unit/source-hygiene | `node --test test/manager.test.js` | ✅ |
| 77/IN-05 | El assert de slice GRP-04 falla si el orden de funciones se rompe | source-hygiene | `node --test test/manager.test.js` | ✅ |

### Sampling Rate
- **Per task commit:** `node --test` del/los fichero(s) de test tocado(s) por la tarea.
- **Per wave merge:** `node --test test/stop.test.js test/hooks/session-end-handoff.test.js test/session/group-resolve.test.js test/manager.test.js test/cmux/client-args.test.js`.
- **Phase gate:** `npm test` en verde antes de `/gsd-verify-work` (baseline actual ~2253 pass / 0 fail / 1 skip).

### Wave 0 Gaps
- Ninguno. **Todos los ficheros de test ya existen**; la fase solo añade CASOS a suites existentes (`group-resolve.test.js`, `manager.test.js`, `stop.test.js`). No hace falta framework nuevo ni fixtures nuevos (el fixture live Kodo/SCRIBBA/SCP-CMRi ya está en `group-resolve.test.js`).

⚠️ **Nota de baseline (deferred):** `test/gsd-lock-race.test.js` «CR-01» es **flaky preexistente** (~1/3 runs, timing) — si `npm test` falla en ESE test, NO es regresión de Phase 78 (deferred item de Phase 74, fuera de scope). Re-correr para confirmar. `[VERIFIED: STATE.md §Deferred Items]`

---

## Security Domain

> `security_enforcement` ausente en config → tratado como habilitado. La fase **es en parte una corrección de seguridad** (saneo del nudge).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|------------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | no | — |
| V5 Input Validation | **yes** | `stripControlChars` sobre contenido LLM (nudge); guarda de shape `workspace_group:\d+` (IN-02); guarda de identifier degenerado (WR-01/IN-01) |
| V6 Cryptography | no | — |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Inyección de secuencias de escape de terminal (OSC-52 = escritura al portapapeles, CSI de reposicionamiento) vía `next`/`summary`/`task_ref` hacia el terminal del orquestador | Tampering | `stripControlChars` en el punto de composición del nudge (fix 75/WR-01; simetría con el carril de render T-75-01/T-75-02 ya cerrado) |
| Ref anómalo de cmux con `\n` forjando líneas de log | Tampering (log injection) | Guarda `/^workspace_group:\d+$/` sobre `g.ref` en `resolveWorkspaceGroup` (fix 77/IN-02) |
| Aterrizaje en grupo arbitrario por identifier bogus `''` matcheando grupo whitespace-only | Tampering (routing) | Guard del identifier derivado → null (fix 77/WR-01) |
| Fuga de contenido de usuario en logs de degradación | Information disclosure | D-11 preservado: los logs (`group_skipped`, IN-03) solo llevan motivo/ref, NUNCA título de tarea; `String(err?.message).slice(0,80)` viene de cmux/JSON.parse, no del usuario |

**Contexto de severidad:** el sink del nudge es un workspace de terminal **local del propio operador** (no un canal remoto), por lo que el riesgo incremental es acotado — de ahí que 75-REVIEW lo marcara Warning y R-75-02 lo aceptara como follow-up. Aun así, cerrar la asimetría es higiene de seguridad legítima y el objetivo declarado de esta fase.

---

## Project Constraints (from CLAUDE.md)

`./CLAUDE.md` no existe en el repo; aplica el global `~/.claude/CLAUDE.md`. Directivas actionables relevantes:

- **Cambios quirúrgicos (Regla 3):** tocar solo lo implicado por cada hallazgo; no «mejorar» código adyacente ni reformatear. Encaja perfecto con una fase de deuda.
- **Simplicidad primero (Regla 2):** aplicar los fixes exactos del review (5-10 líneas c/u), sin abstracciones especulativas.
- **Piensa antes de codificar (Regla 1):** declarar el tradeoff de la decisión de ubicación del saneo (Opción 1 vs 2) y de incluir o no IN-03.
- **Ejecución dirigida por objetivo (Regla 4):** criterio de éxito = suites en verde + goldens byte-idénticos + los casos nuevos rojos-sin-fix / verdes-con-fix (teeth por mutación).
- **Responde en español.** RESEARCH y artefactos en español; identificadores de código en su forma original.
- **Compound al cierre:** escribir resumen en `.compound/` si la sesión tiene sustancia.

---

## Invariants to Preserve (from STATE.md — verificados aplicables a esta fase)

| Invariante | Relevancia para Phase 78 |
|------------|--------------------------|
| Cero nuevas dependencias npm | Ambos planes: cero `npm install`; solo helpers internos |
| Cero endpoints nuevos en `src/server.js` | No se toca `server.js` |
| Escrituras de `state.json` bajo `withStateLock` | El saneo del nudge NO escribe state.json (proyección, no persistencia); no aplica escritor nuevo |
| TUI never-throws / hooks never-throws | El saneo va dentro del try/catch estructural existente de `session-end.js`; `stripControlChars` es never-throws |
| Color isolation (`picocolors` solo desde `src/cli/format.js`) | `stripControlChars` NO usa color; importar de `format.js` es el patrón ya aceptado por `App.js`/`markdown.js` (el test `format-isolation` solo prohíbe imports DIRECTOS de picocolors) |
| `--json` byte-determinismo (DX-06) / D-09 nudge byte-idéntico | El saneo debe ser identidad para inputs limpios → goldens intactos |
| Todo lo cmux-específico entra por `HostProvider`/`_legacy` | El bloque de grupo ya va por `host._legacy.listWorkspaceGroups`; no introducir imports directos de `cmux/client.js` en `manager.js` (walker `cmux-isolation`) |
| `HOST_METHODS` congelado en 4 · TaskProvider FROZEN | Ningún cambio de contrato; solo hardening interno |
| GRP-04 (kodo consume grupos, no los gestiona) | Ningún verbo de gestión; solo `workspace-group list` |
| D-10 (retry TOCTOU capa 2) LOCKED | IN-07 NO accionable; no re-cablear el fallback |

---

## State of the Art

No aplica — sin tecnología externa que evolucione. Los «cambios de estado» relevantes son internos:

| Antes (fases 75/77) | Después (Phase 78) | Impacto |
|---------------------|--------------------|---------|
| `next`/`summary`/`task_ref` viajan crudos al nudge | Saneados con `stripControlChars` en la composición | Cierra R-75-02; simetría con el carril de render |
| `deriveExpectedGroupName` deriva bogus `''` para refs patológicos | Guard del identifier derivado → null | Cierra WR-01/IN-01; JSDoc coherente con el código |
| Invariante Unicode sin red de regresión | Test NFD↔NFC | Cierra WR-02 |
| Assert GRP-04 con slice frágil | Assert `end > start` | Cierra IN-05 |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Sanear los 3 campos (`next`+`summary`+`task_ref`) es preferible a solo `next` | Scope A / Patterns | Bajo — el review lo sugiere explícitamente («Idealmente `summary`/`task_ref` recibirían el mismo tratamiento»); si se quiere scope mínimo, sanear solo `next` también cierra el hallazgo literal. Decisión de discuss/plan |
| A2 | Incluir IN-03 (motivo del error en el log) en Phase 78 | Scope B | Bajo — es opcional; diferible sin coste. D-11 se preserva porque el mensaje viene de cmux/JSON.parse, no del usuario. Decisión de discuss/plan |
| A3 | Ubicar el saneo DENTRO de `buildStopNudgeText` (Opción 1) mantiene la pureza y el test de pureza | Scope A | Bajo — `stripControlChars` es pura (cero I/O); verificable corriendo `test/stop.test.js`. Si el planner prefiere la Opción 2 (del review), también válido |

**Nada de esto son suposiciones sobre hechos externos** — son elecciones de diseño internas que el planner/discuss-phase deben clavar. Todos los hechos técnicos están `[VERIFIED: codebase]`.

---

## Open Questions

1. **¿Alcance del saneo: solo `next` o los 3 campos?**
   - Lo que sabemos: el hallazgo literal (WR-01) es sobre `next`; el review sugiere blindar los 3 «de una vez».
   - Recomendación: los 3 (cierra la limitación documentada en un diff). Confirmar en discuss/plan.

2. **¿Se incluye IN-03 (diagnosticabilidad del `catch`)?**
   - Lo que sabemos: es Info/opcional; mejora el diagnóstico de «por qué no se agrupan mis sesiones».
   - Recomendación: incluir (barato, seguro por D-11) o diferir explícitamente. Decisión de plan.

3. **¿Un solo plan o dos?**
   - Recomendación: **dos planes** (A: nudge; B: grupos cmux) por ortogonalidad de ficheros y posibilidad de paralelizar. Si se prefiere una sola cadena secuencial corta, también es viable dado el tamaño reducido del diff.

---

## Phase Requirements

No hay IDs de REQUIREMENTS.md mapeados (fase de deuda técnica). El «contrato» de la fase son los hallazgos enumerados:

| «ID» (hallazgo) | Descripción | Research Support |
|-----------------|-------------|------------------|
| 75/WR-01 | Sanear el contenido LLM del nudge del orquestador | §Scope A + §Security Domain + Pattern 1 |
| 77/WR-01 | Guard del identifier derivado bogus | §Scope B tabla + Pattern 2 |
| 77/WR-02 | Test de regresión Unicode NFC | §Scope B tabla + §Validation |
| 77/IN-01 | Trim del ref antes de derivar | §Scope B (fusionar con WR-01) |
| 77/IN-02 | Guard de shape `workspace_group:\d+` | §Scope B tabla + §Security |
| 77/IN-04 | No llamar cmux cuando `expectedName` null | §Scope B tabla (perf) |
| 77/IN-05 | Assert de slice no-vacuo | §Scope B tabla + §Validation |
| 77/IN-06 | JSDoc `group?: string` | §Scope B tabla |
| 77/IN-03 | (Opcional) motivo del error en log de degradación | §Scope B tabla + Open Question 2 |
| 77/IN-07 | Riesgo residual D-10 | **OUT OF SCOPE** (LOCKED) |

---

## Sources

### Primary (HIGH confidence) — codebase + artefactos de fase
- `src/hooks/session-end.js` (~130-160, 250-270, 380-405) — threading del nudge y `handoffNext` `[VERIFIED: codebase]`
- `src/hooks/stop.js:48-73` — `buildStopNudgeText` (interpola task_ref/summary/next) `[VERIFIED: codebase]`
- `src/cli/format.js:80-87` — `stripControlChars` (pura, never-throws) `[VERIFIED: codebase]`
- `src/session/manager.js:143-217, 388-408` — 3 funciones puras + cableado `launchWorkItem` `[VERIFIED: codebase]`
- `src/host/cmux.js:358` — JSDoc `_legacy.newWorkspace` sin `group` `[VERIFIED: codebase]`
- `test/session/group-resolve.test.js`, `test/manager.test.js:756-855`, `test/stop.test.js` — estado actual de cobertura `[VERIFIED: codebase]`
- `.planning/phases/75-.../75-REVIEW.md` §WR-01 — hallazgo del saneo `[CITED]`
- `.planning/phases/75-.../75-SECURITY.md` R-75-02 — riesgo aceptado / follow-up `[CITED]`
- `.planning/phases/77-.../77-REVIEW.md` — 9 hallazgos con fixes `[CITED]`
- `.planning/phases/77-.../77-VERIFICATION.md` §«Evaluación WR-01/WR-02» — veredicto «deuda menor, NO gap» `[CITED]`
- `.planning/STATE.md` §Deferred Items, §Critical Invariants, §Roadmap Evolution `[VERIFIED: codebase]`

### Secondary / Tertiary
- Ninguna. No se hicieron búsquedas web ni consultas a librerías externas — la fase es 100 % interna.

---

## Metadata

**Confidence breakdown:**
- Scope / hallazgos: HIGH — anclados en lectura de fuente actual + reviews verificados; líneas confirmadas por grep (IN-06 en :358, IN-05 en :849-852, guards en manager.js:143-190)
- Fixes: HIGH — el propio review provee el fix exacto de cada hallazgo; verificados aplicables al código actual
- Invariantes: HIGH — cotejados uno a uno contra STATE.md §Critical Invariants
- Decisiones de diseño abiertas (alcance del saneo, IN-03, split de planes): son elecciones de plan, no incertidumbre técnica

**Research date:** 2026-07-22
**Valid until:** ~30 días (código estable; sin dependencias externas que caduquen). Si `main` avanza sobre `src/hooks/stop.js`, `src/hooks/session-end.js` o `src/session/manager.js` antes de planificar, re-verificar las líneas.
