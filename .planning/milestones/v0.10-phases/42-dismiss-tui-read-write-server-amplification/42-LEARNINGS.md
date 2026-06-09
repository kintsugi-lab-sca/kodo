---
phase: 42
phase_name: "dismiss-tui-read-write-server-amplification"
project: "kodo"
generated: "2026-06-06"
counts:
  decisions: 10
  lessons: 7
  patterns: 8
  surprises: 5
missing_artifacts:
  - "UAT.md (el UAT fue un checkpoint:human-verify inline en 42-03-PLAN, registrado en 42-03-SUMMARY y 42-VERIFICATION — no hubo archivo UAT separado)"
---

# Phase 42 Learnings: dismiss-tui-read-write-server-amplification

## Decisions

### Guard `alive` server-side = autoridad TOCTOU (409)
El 409 vive en `src/server/dismiss.js`, que re-lee `loadState().sessions[taskId]` FRESCO al recibir el DELETE y rechaza con `{ok:false, error:'alive'}` ANTES de invocar `execute`. El guard de la TUI es solo UX; la autoridad race-safe es el server.

**Rationale:** Una sesión que revive entre arm y confirm debe cazarse en el punto de mutación, no en el snapshot del cliente (D-07/D-08, SC#3). Defensa en 3 capas (TUI → 409 server → re-check per-action de doctor).
**Source:** 42-01-SUMMARY.md, STATE.md (Decisions 42-01/42-02)

### `dismiss.js` como módulo pure-DI (espejo Phase 40 provider-state)
La lógica destructiva se extrajo del closure de `createServer` a `createDismissHandler({loadState, executeFn, logger})`; el handler DELETE de `server.js` queda como thin adapter.

**Rationale:** El handler inline original era estructuralmente intesteable (closure + import estático + cero tests, DRIFT #3). La extracción DI permite testear sin boot HTTP, replicando el precedente `provider-state.js`.
**Source:** 42-01-SUMMARY.md, 42-01-PLAN.md

### `fix:true` lockeado en el server
`dismiss.js` siempre llama `executeFn({}, {taskId, fix:true})`; no es configurable desde fuera.

**Rationale:** `doctor.execute` es un no-op silencioso sin `opts.fix` (`doctor.js:468`, DRIFT #2). Olvidarlo produciría un dismiss fantasma que reporta éxito sin sanear nada. Verificado con spy.
**Source:** 42-01-SUMMARY.md

### `actions[]` sintetizado de contadores (`translateToActions`)
`execute` devuelve contadores agregados (`worktrees/zombies/locks/errors`), NO el `actions:[{type,result}]` de D-06. El server los traduce byte-deterministamente; `worktrees.skipped` no emite acción.

**Rationale:** DRIFT #1 — el shape `actions[]` no existe en el retorno de doctor; el server es responsable de sintetizarlo para el contrato HTTP que consume la TUI.
**Source:** 42-01-SUMMARY.md

### No llamar a `removeSession` desde `dismiss.js` (anti double-archive)
El módulo no invoca `removeSession`; `executeFn` ya archiva la entrada zombie (`doctor.js:527`).

**Rationale:** Llamarlo de nuevo sería un doble-archivado. Grep gate `grep -c removeSession src/server/dismiss.js` == 0.
**Source:** 42-01-SUMMARY.md

### Máquina `mode:'confirm'` doble-`d` con clear-on-any-input sin timer
`d` sobre fila `alive===false` arma (captura `task_id` por identidad); segunda `d` ejecuta; `Esc` y cualquier otra tecla cancelan sin mensaje ni timer.

**Rationale:** Una sola confirmación explícita evita borrados accidentales (T-42-06, D-01..04). La fila desaparece por el poll natural (D-11), sin UI optimista.
**Source:** 42-02-SUMMARY.md

### `mapDismissResult` devuelve discriminante estructurado, no copy literal
Vive en `select.js` (React-free) y retorna `{kind,color,reason?}` en vez de la copia literal de App.js.

**Rationale:** Mantiene `select.js` libre de imports de App.js → sin import circular (grep gate == 0) y testeable en aislamiento. Precedencia `error > dirty`.
**Source:** 42-02-SUMMARY.md

### Generalizar `focusError` (Phase 37) en footer transitorio con `footerColor` sibling
En lugar de introducir un objeto `{text,color}` nuevo, se generalizó el `focusError` existente añadiendo un estado hermano `footerColor`.

**Rationale:** Diff mínimo (D-12), reusa la maquinaria de footer transitorio ya probada; el color se deriva de `actions[]`, no de un lookup.
**Source:** 42-02-SUMMARY.md

### Seam test maneja `createDismissHandler` directo con fakes + adapter de fidelidad
El test e2e no arranca HTTP: inyecta `loadState`/`executeFn` fake y puentea el body del server al discriminante del cliente con `serverBodyToClientResult()`, replicando exactamente lo que hace `dismissSession()` en producción.

**Rationale:** Prueba el wiring REAL (emisor → adaptación del cliente → consumidor) sin la fragilidad de un boot HTTP, manteniéndolo como drift canary genuino.
**Source:** 42-03-SUMMARY.md

### STATE.md reframe del invariante como ruptura SHIPPED (observabilidad → gestión)
El bullet de "Critical Invariants" se reescribió de ruptura *futura* a *SHIPPED*: dashboard ahora read-WRITE para dismiss-de-dead, cambio de identidad observabilidad→gestión, zero new endpoints.

**Rationale:** La ruptura consciente del invariante v0.9 debe quedar documentada para planificadores de futuros milestones (T-42-13). Futuras capacidades read-write heredan el precedente (doble-confirm + guard server autoritativo + never-throws).
**Source:** 42-03-SUMMARY.md, STATE.md:150

---

## Lessons

### `doctor.execute` es no-op silencioso sin `fix:true`
Sin `opts.fix`, `execute` retorna en `doctor.js:468` sin sanear nada pero sin señalar error.

**Context:** DRIFT #2 detectado en RESEARCH. Un dismiss que omita `fix:true` reportaría `{ok:true}` mientras deja worktree/lock/state intactos — un fallo silencioso de seguridad (T-42-03 Repudiation).
**Source:** 42-01-SUMMARY.md, 42-01-PLAN.md (interfaces)

### `findSession` NO indexa por `task_id`
Para re-leer una sesión por task_id hay que usar `loadState().sessions[taskId]` directo (o `listSessions().find(s => s.task_id === taskId)`).

**Context:** Pitfall 6. Usar `findSession` para el guard 409 habría fallado silenciosamente — re-confirmado leyendo `state.js:319-364` durante la ejecución.
**Source:** 42-01-SUMMARY.md, 42-01-PLAN.md

### `doctor.execute` devuelve contadores, no `actions[]`
El retorno es un agregado `{worktrees, zombies, locks, logs, errors}`, no la lista `[{type,result}]` que espera el contrato D-06.

**Context:** DRIFT #1. Asumir el shape `actions[]` directo habría roto el contrato; el server tuvo que añadir una capa de síntesis (`translateToActions`).
**Source:** 42-01-SUMMARY.md

### El registry `EVENTS` es frozen y validado por exact-match
`test/logger-events.test.js` afirma la lista canónica completa; añadir `SESSION_DISMISSED` rompió el test (29→30 entradas).

**Context:** Deviation Rule 3 (blocking). Cualquier evento nuevo obliga a actualizar la lista esperada Y el contador de la aserción. No es un fallo, es el contrato de taxonomía.
**Source:** 42-01-SUMMARY.md

### Keystrokes encadenados en ink necesitan un frame real (`setTimeout`), no `setImmediate`
Con el `setImmediate` `drain()` del test de overlay, la segunda `d` usó un closure obsoleto `mode==='list'` y re-armó en vez de ejecutar; con `setTimeout(80ms)` despacha un DELETE y limpia.

**Context:** RESEARCH Pitfall 5. La segunda `d` depende del re-render de `mode` para que ink re-registre `useInput` con el closure fresco. El molde correcto fue `app-focus.test.js` (también 80ms), no el de overlay.
**Source:** 42-02-SUMMARY.md

### Tests con el footer-hint hardcodeado se rompen al cambiar la copy
`app-focus.test.js` afirmaba el literal `↑↓ move · / filter · q quit`; añadir `· d dismiss` lo rompió.

**Context:** Deviation Rule 1. Era la copy nueva intencional (no regresión); se actualizó la aserción al contrato nuevo. Lección: aserciones sobre strings de UI literal son frágiles ante cambios de copy planificados.
**Source:** 42-02-SUMMARY.md

### `confirmLine` debe derivar de `mode==='confirm'`, no de `focusError`
Si el prompt de confirmación derivara de `focusError`, el clear-on-any-input consumiría la segunda `d` antes de que dispare el DELETE.

**Context:** RESEARCH Pitfall 4. La separación de fuentes de estado (prompt persistente vs footer transitorio) es lo que permite que la doble-`d` funcione.
**Source:** 42-02-SUMMARY.md

---

## Patterns

### Pure DI factory para testabilidad sin boot
`createXxxHandler({deps})` con defaults reales y mocks inyectables; el handler de transporte queda como thin adapter.

**When to use:** Cualquier lógica destructiva o compleja atrapada en un closure de servidor. Permite tests unitarios deterministas sin levantar HTTP. Ya aplicado en Phase 40 (provider-state) y ahora Phase 42 (dismiss) — precedente consolidado.
**Source:** 42-01-SUMMARY.md

### Capa de síntesis contador→shape (`translateToActions`)
Función pura que mapea contadores agregados de un dominio a la forma del contrato externo, byte-determinista.

**When to use:** Cuando el productor interno y el contrato público divergen en forma. Aísla el mapeo en una unidad pura testeable y la hace candidata a drift canary.
**Source:** 42-01-SUMMARY.md

### Cliente de capa de datos never-throws (calque de `fetchComments`)
`dismissSession` colapsa todo fallo red/HTTP/JSON/409 a `{ok:false,error}`; ningún throw llega a React. `encodeURIComponent` en el path anti path-traversal.

**When to use:** Toda llamada de red desde la TUI ink. Mantiene el invariante v0.9 "la TUI nunca crashea" — el handler hace `await` sin try/catch porque la función es never-throws por construcción.
**Source:** 42-02-SUMMARY.md, STATE.md:152

### Máquina de estados `useInput` gated por `mode` en ink
Una rama `mode==='confirm'` hermana de las de filter/overlay; las teclas se enrutan según el modo.

**When to use:** Interacciones multi-paso o destructivas en TUI ink que requieren confirmación. Sibling del patrón filter/overlay ya existente.
**Source:** 42-02-SUMMARY.md

### Mapper de derivación puro extraído para test React-free
Mover la lógica de derivación a un módulo sin imports de React/App.js, verificado con grep gate (`== 0` imports circulares).

**When to use:** Cuando una transformación de datos vive en un componente pero no necesita React. Extraerla la hace unit-testeable y rompe acoplamientos circulares.
**Source:** 42-02-SUMMARY.md

### Drift-canary seam test bidireccional
Alimentar la salida real del emisor a través del consumidor real, con una aserción de vocabulario que falla si cualquiera de los dos lados emite/omite un valor que el otro no maneja.

**When to use:** Cuando dos módulos sin archivos compartidos acuerdan un vocabulario implícito (aquí `{removed, moved-dirty, pruned, kept, error}`). Caza la deriva de contrato antes de que llegue a producción (T-42-11).
**Source:** 42-03-SUMMARY.md

### UAT humano para mutaciones destructivas
Checkpoint `human-verify` bloqueante que ejercita el efecto físico real (borrado de worktree/lock/state, preservación `.dirty`) que los mocks no pueden demostrar.

**When to use:** Toda mutación destructiva irreversible. Espejo de cómo v0.9 cerró Phases 37/38. Complementa — no reemplaza — la cobertura automatizada del contrato de datos.
**Source:** 42-03-SUMMARY.md, 42-VERIFICATION.md

### Footer transitorio vía generalización de estado existente
Generalizar un estado de error transitorio previo (`focusError`) añadiendo un sibling de color en vez de un objeto nuevo.

**When to use:** Cuando necesitas una variante de un feedback de UI ya existente. Diff mínimo, reusa la maquinaria de timing/clear probada.
**Source:** 42-02-SUMMARY.md

---

## Surprises

### El molde de test de overlay no transfirió a keystrokes encadenados
Se esperaba reusar el `setImmediate` `drain()` del test de overlay; resultó que los keystrokes que dependen del re-render previo necesitan un frame real (`setTimeout 80ms`).

**Impact:** Sin el ajuste, la segunda `d` re-armaba en vez de despachar — un falso negativo sutil. Obligó a usar el molde de `app-focus.test.js`. Documentado para futuros tests de máquinas de estado ink.
**Source:** 42-02-SUMMARY.md

### `dismiss.js` quedó limpio en el primer GREEN — sin REFACTOR
La secuencia TDD RED→GREEN no necesitó un commit REFACTOR; la implementación fue correcta a la primera.

**Impact:** Ejecución más rápida de lo previsto (Plan 01: 14 min, 15 tests). Indica que el contrato estaba bien especificado en el plan (interfaces extraídas del código fuente).
**Source:** 42-01-SUMMARY.md

### Plan 03 ejecutado exactamente, cero desviaciones
Ningún Rule 1-4 deviation; los 3 criterios de aceptación autónomos + el gate human-verify se satisficieron como estaban escritos.

**Impact:** Confirma la calidad del planning para el plan de cierre. La única nota fue una decisión de fidelidad (el adapter `serverBodyToClientResult`), no una desviación.
**Source:** 42-03-SUMMARY.md

### Import muerto retenido deliberadamente en `server.js`
Tras dejar de llamar `removeSession`, el símbolo quedó importado-pero-sin-usar; el plan instruyó explícitamente dejarlo.

**Impact:** Inerte — el proyecto no tiene script de lint (solo `npm test`). Cambio quirúrgico: no perseguir limpieza no relacionada. Decisión consciente, no descuido.
**Source:** 42-01-SUMMARY.md

### Primera ruptura consciente del invariante v0.9 "TUI read-only" con zero new endpoints
El dashboard pasó de observabilidad pura a gestión, pero SIN añadir endpoints — `DELETE /sessions/{id}` ya existía y solo se amplió.

**Impact:** Cambio de identidad de la superficie (observabilidad → gestión) acotado a dismiss-de-dead, con `reconcileTick` aún como único escritor de `alive`. Sienta el precedente arquitectónico para futuras capacidades read-write de la TUI.
**Source:** 42-03-SUMMARY.md, STATE.md:150
