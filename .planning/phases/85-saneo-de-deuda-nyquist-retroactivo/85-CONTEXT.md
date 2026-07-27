# Phase 85: Saneo de deuda + Nyquist retroactivo - Context

**Gathered:** 2026-07-27
**Status:** Ready for planning
**Mode:** `--auto` (decisiones auto-seleccionadas sobre la opción recomendada; alternativas descartadas auditables en `85-DISCUSSION-LOG.md`)

<domain>
## Phase Boundary

Última fase del milestone v0.19. **Barrido de cierre**: salda la deuda documental que v0.18 dejó abierta y la columna Nyquist de v0.16+v0.18. No entrega capacidad nueva — cierra filas de `STATE.md` §Deferred Items.

Cinco entregables, dos bloques independientes:

**Bloque DEBT (deuda de v0.18)**
- **DEBT-05** — el typedef `TaskHandoff` (`src/session/state.js:51-55`) documenta la semántica **PRE**-DEBT-01. El comentario del campo `next` dice literalmente «un `next` ausente/null NO borra el previo», que era el contrato de Phase 74/75. Phase 81 (DEBT-01) lo cambió al **contrato tres-estados por PRESENCIA**: string no vacío **sobrescribe** · `null` explícito **borra** · campo **ausente preserva**. El código ya lo hace (`:449-454`); el typedef miente. Cierra 81-REVIEW WR-01.
- **DEBT-06** — `deriveAnyNext` (`src/cli/dashboard/select.js:258-260`) decide la presencia de la columna `next` con `r.next.length > 0` sobre el string crudo, mientras el render (`nextCell`, `src/cli/dashboard/format.js:264`) colapsa whitespace y devuelve `''`. Un `next` de solo-whitespace en `state.json` **enciende la columna y la pinta vacía**. Cierra 81-REVIEW WR-02; con DEBT-05 salda R-81-02.
- **DEBT-07** — los 3 warnings de `80-REVIEW.md` (WR-01 fallos silenciosos del piggyback · WR-02 rama de advisories sin cobertura · WR-03 guard LOG-12 con premisa falsa) quedan **resueltos o re-aceptados individualmente con razón documentada**.

**Bloque NYQ (Nyquist retroactivo)**
- **NYQ-01** — `VALIDATION.md` de Phases **79/80/81** pasa a `nyquist_compliant: true`, citation-based.
- **NYQ-02** — ídem Phases **69/71/72**. Salda la columna Nyquist de v0.16 en Deferred Items.

**La fase es mayormente doc-only, pero NO es 100 % doc.** DEBT-06 y DEBT-07/WR-01+WR-02 tocan código de producción y su suite. Todo cambio de comportamiento lleva su test; la suite (2586 verde al cierre de 84) sigue verde.

**Fuera del boundary — deuda adyacente que NO se toca aquí** (detalle y triggers en `<deferred>`): format-isolation transitivo · rename `kodo-orchestrate/skill.md` → `SKILL.md` (D-08) · auto-sync multi-skill del orquestador (D-08b) · R-82-01 (carrera de 2.º orden de `stealLock` con holder VIVO) · IN-01 de 80-REVIEW (es *info*, no warning) · refresco de `.planning/codebase/TESTING.md` (desfasado desde 2026-04-07).

</domain>

<decisions>
## Implementation Decisions

### Constraints heredados (LOCKED — no re-discutir)

- **Cero deps npm nuevas** · **cero endpoints nuevos en `src/server.js`** · **color isolation** (`picocolors` jamás bajo `src/cli/dashboard/**`) · **`--json` byte-determinista** · **TUI never-throws** · **exit codes deterministas 0/1/2** · **LOG-12** (el grafo de `check.js` no toca `src/logger.js`).
- **Regex CONSTANTE** en todo módulo que matchee (anti-ReDoS) — jamás compilada desde input externo.
- **Greenear enmascarando está prohibido** (constraint heredado de DEBT-04): ningún assert se debilita para cerrar un warning.

---

### A. DEBT-05 — alcance del saneo del typedef `TaskHandoff`

- **D-01 (LOCKED):** el saneo es **doc-only y acotado a `src/session/state.js`**. Se reescribe el comentario del campo `next` del typedef (`:53`) para que enuncie el contrato tres-estados por PRESENCIA, y se revisa **el mismo fichero** en busca de otras menciones que repitan la semántica vieja (el `@param entry` y el `@returns` de `upsertTaskHandoff`, `:427-430`, son los candidatos naturales). Deja de citarse «WR-02» como si fuera vigente: ese aviso describía el comportamiento anterior.
  - *Descartada — barrido repo-wide de toda mención a la semántica del `next`*: convierte una corrección de 5 líneas en una auditoría de superficie abierta, con riesgo de tocar prosa de fases archivadas que son **snapshots históricos** y deben seguir describiendo lo que era cierto cuando se escribieron.
- **D-02:** el planner ejecuta **un grep de auditoría** (`next.*ausente|NO borra|preserva`) sobre `src/` y `README`/docs vivos y **documenta el resultado en el SUMMARY**. Lo que aparezca fuera de `state.js` se corrige **solo si es one-liner**; si exige contexto, se registra como deferred con su path. Sin esto, DEBT-05 arregla el typedef y deja la misma mentira a 300 líneas de distancia.
- **D-03:** **cero tests nuevos para DEBT-05.** El contrato tres-estados **ya está probado**: `test/state/handoff-state.test.js` tiene los tres casos explícitos — `CLEAR: next: null … BORRA` (`:265`), `PRESERVE: campo next AUSENTE … PRESERVA` (`:288`), `OVERWRITE: next no vacío … SOBRESCRIBE` (`:307`). Un comentario JSDoc no es testeable y el comportamiento que describe ya tiene su red. **La cita a esos tres tests es la evidencia de DEBT-05**, y va en el SUMMARY.

---

### B. DEBT-06 — dónde vive el colapso de whitespace

- **D-04 (LOCKED):** `deriveAnyNext` **delega en `nextCell`** (`import { nextCell } from './format.js'`), quedando `rows.some((r) => nextCell(r).length > 0)`. **Una sola fuente de verdad del colapso**: la incoherencia que WR-02 denuncia deja de ser posible por construcción, no por disciplina.
  - **Por qué aquí SÍ se importa y en Phase 84 (D-17) NO:** la duplicación de 84 estaba justificada por un riesgo concreto y verificado — `src/inbox/store.js:46` importa `../cli/format.js`, que importa **picocolors**, y un leaf del dashboard que lo importara metería color en el grafo del TUI. **`src/cli/dashboard/format.js` es otro fichero y es puro**: su único import es `node:path` (`:25`), y lleva el comentario de color-isolation explícito (`:22`). No hay ciclo (`format.js` no importa `select.js`). El precedente de 84 **no aplica**; invocarlo aquí sería duplicar sin razón.
  - **El aislamiento queda garantizado por el guard que ya existe**: `test/format-isolation.test.js` §TUI-04 comprueba **todos** los ficheros bajo `src/cli/dashboard/` — si alguien metiera picocolors en `format.js`, el test se pone rojo antes de que el import de `select.js` pueda hacer daño.
  - *Descartada — inline del `replace(/\s+/g, ' ').trim()` en `select.js` + test anti-drift que ancle los dos lectores*: es el patrón D-17/D-18 de Phase 84, y aquí sería cargo-cult. Cambia una dependencia intra-directorio inofensiva por una duplicación de regex más un test de custodia permanente. Se paga complejidad para no importar un módulo puro del mismo directorio.
  - *Descartada — extraer un tercer helper `collapseWs` a un módulo nuevo*: un fichero nuevo y dos imports para lo que ya vive, documentado y probado, dentro de `nextCell`.
- **D-05:** el **contrato de `deriveAnyNext` no cambia**: sigue siendo un flag estructural (`boolean`), sigue computándose sobre el set **SIN filtrar** (`enriched`, no `filtered` — Pitfall 4 de Phase 75, la columna no parpadea al teclear `/`), y sigue siendo never-throws para no-string. `App.js:820` **no se toca**.
- **D-06:** el test RED se escribe **antes** del fix y es el caso que hoy falla: `deriveAnyNext([{ next: '   ' }])` y `deriveAnyNext([{ next: '\n\t' }])` deben dar **`false`** (hoy dan `true`). Se añade a `test/dashboard-select.test.js` junto al bloque LIVE-05 existente (`:471`). Los 5 casos ya cubiertos ahí (`:473-496`) deben seguir verdes **sin tocarlos** — si alguno cambia, la delegación está mal hecha.

---

### C. DEBT-07 — los 3 warnings de 80-REVIEW, uno a uno

**Política: los tres se RESUELVEN. Ninguno se re-acepta.** Los tres son baratos, y uno de ellos (WR-01) degrada silenciosamente el diagnóstico de un carril automático — exactamente el tipo de deuda que este milestone existe para pagar.

- **D-07 — WR-01 (fallos por-item silenciosos): se resuelve.** El piggyback de `src/check.js:156-166` lee `r.added`/`r.ungrouped` pero **nunca inspecciona `r.errors`**; con `deps = {}` el logger es el `noopLogger` obligado por LOG-12, así que 3 `addToWorkspaceGroup` fallidos son **indistinguibles** de «no había nada que arreglar». Fix: tras el `logFn` de acciones aplicadas, si `(r.errors || []).length > 0`, emitir por **`errorFn`** una línea `[kodo:check] Sidebar: N acción(es) fallida(s) (fail-open)`.
  - **No se inyecta el logger real** — LOG-12 sigue intacto: la observabilidad sale por stdout/stderr (0 tokens), que es el canal que el piggyback ya usa.
  - **El fail-open no cambia:** la línea informa, **jamás** bloquea el check ni el launch, y **jamás** re-entra a `reasons` ni al gate `needsOrchestrator` (D-04 de Phase 80).
  - **Copy exacto a discreción del planner**, con una restricción: **`errorFn`, no `logFn`** — un fallo silencioso que se arregla escribiéndolo en el mismo canal que el éxito sigue siendo invisible en un pipe.
- **D-08 — WR-02 (rama de advisories y línea «Sidebar: N aplicadas» sin cobertura): se resuelve.** Test nuevo en `test/check.test.js` con `needsOrchestrator: true` + `scanFn` que devuelve `hasAdvisories: true` con `missing_group` no vacío + `executeFn` que devuelve `{ added: 2, ungrouped: 1, errors: [...] }`, capturando `logFn`/`errorFn` en arrays y aseverando el conteo `applied = 3`, la línea de advisories y la línea de fallos de D-07. **El mismo test cubre WR-01 y WR-02** — el fix de D-07 no se mergea sin él.
  - Los casos existentes (`:321-439`) revelan por qué la rama estaba muerta: A/D usan `cleanReport()` y C tiene `hasAdvisories: true` pero `needsOrchestrator: false`, así que el piggyback nunca corre. El test nuevo es el que cruza ambas condiciones.
- **D-09 — WR-03 (guard LOG-12 estático sobre premisa falsa): se resuelve en sus dos mitades.**
  1. **Corregir el comentario mentiroso** de `test/check-isolation.test.js:14,33-34` — «el repo no lo usa (verificado en 06-RESEARCH A3)» es **falso hoy**: `src/providers/registry.js:27,28,57,58` hace `await import()` y está en el grafo estático de `check.js`.
  2. **Reforzar el guard con un source-grep** sobre los ficheros del grafo que `walkImports` ya calcula, buscando `import('…logger.js')` dinámico y **excluyendo `logger-events.js` / `logger-noop`**. Sin esto el guard es decorativo: un `await import('../logger.js')` en `config.js`/`manager.js`/`state.js`/`client.js` rompería LOG-12 **en verde**.
  - **Precedente directo en el repo:** el guard *source-hygiene* de `test/skill-sync.test.js` (Phase 84) — misma forma (grep sobre fuentes ya enumeradas), mismo propósito (impedir que una regresión pase por inercia).
  - **Nota de riesgo para el planner:** el review afirma que hoy la invariante se sostiene (los providers solo cargan `logger-events.js`, puro). **Verifícalo antes de escribir el assert**: si el grep sale rojo de partida, es un hallazgo real de LOG-12 y **se escala** — no se relaja el grep para greenear (constraint heredado de DEBT-04).
- **D-10:** **`IN-01` no entra.** El criterio 3 dice literalmente «los 3 warnings». IN-01 (doble `scan` por pase; el conteo de advisories viene de otro snapshot que las acciones ejecutadas) está clasificado como *info* en el propio review. Se re-registra en `<deferred>` con su trigger.

---

### D. NYQ-01/02 — mecanismo y forma del backfill

- **D-11 (LOCKED):** el vehículo es **`/gsd-validate-phase {N}` invocado por fase**, tal como el criterio del roadmap lo nombra. **Verificado en esta discusión:** `init.phase-op` **resuelve fases archivadas** — `79` → `.planning/milestones/v0.18-phases/79-sidebar-doctor`, `69` → `.planning/milestones/v0.16-phases/69-red-y-autenticaci-n`, ambas con `has_verification: true`. La skill opera sobre el directorio archivado sin mover nada.
- **D-12 (LOCKED — el guardarraíl que hace esto una fase «ligera y mecánica»): CERO tests nuevos y CERO re-ejecución de la suite.** El criterio dice *citation-based … sin re-derivar*. La skill `gsd-validate-phase` puede querer **generar ficheros de test** para llenar gaps (su objetivo declarado incluye *generated test files*); **aquí eso está prohibido**. Si el auditor detecta un gap de cobertura real, se registra como fila **manual-only** o como **deferred con su path**, nunca como test nuevo.
  - Sin este límite, «backfill documental de 6 fases» se convierte en una fase de generación de tests sobre código de tres milestones distintos — el fallo de scope más probable de toda la fase 85.
- **D-13:** la **forma de salida es el molde ya probado en este repo**: `.planning/milestones/v0.10-phases/41-…/41-VALIDATION.md` (backfill Phase 47, NYQ-01) — nota de cabecera que declara el backfill y su origen, tabla *Test Infrastructure* con la evidencia citada, *Sampling Rate* con la política de backfill explícita, *Per-Task Verification Map* con columna **«Evidencia citada (fichero + resultado)»**, *Manual-Only Verifications* y *Validation Sign-Off* con checklist. Las 6 fases tienen `VERIFICATION.md` + un `SUMMARY.md` por plan en disco (verificado): **hay material para citar en las 6**.
- **D-14:** frontmatter resultante: **`nyquist_compliant: true`** + **`status: validated`** en las 6.
  - `validated` y no `approved`: los ficheros de 79/80/81 llevan **embebido** el lifecycle vigente (`draft (seeded by plan-phase) → validated (set by validate-phase §6)`) y la nota de que `audit-milestone` §5.5 distingue NOT-VALIDATED (`draft`) de PARTIAL (`validated` + `nyquist_compliant: false`). El `approved` de los backfills de v0.10/v0.11 es anterior a esa convención. Se usa **el mismo valor en las 6** para que el audit las lea igual, aunque 69/71/72 no traigan el comentario.
  - `wave_0_complete`: se pone a `true` solo si el backfill puede citarlo (79/80 lo traen a `false`, 81 ya a `true`). **Ante duda, se deja como está** — el campo que importa para NYQ-01/02 es `nyquist_compliant`.
- **D-15:** **los `MILESTONE-AUDIT.md` archivados NO se reescriben.** Son snapshots de lo que era cierto al cerrar v0.16/v0.18. El cierre se registra en (a) la nota de cabecera del propio `VALIDATION.md` («backfill Phase 85, NYQ-01/02», espejo de la de 41) y (b) la fila correspondiente de `STATE.md` §Deferred Items.
- **D-16:** **orden 79/80/81 primero, 69/71/72 después.** Las de v0.18 son recientes, su evidencia está fresca y comparten vocabulario con DEBT-07 (80-REVIEW). Las de v0.16 son las más antiguas y las de mayor riesgo de fricción; que vayan últimas evita que bloqueen el resto del barrido. **Cada fase es independiente** — el planner puede paralelizar dentro de cada bloque.
- **D-17:** **si una fase no admite `nyquist_compliant: true` honestamente** (evidencia insuficiente en su `VERIFICATION.md`), **no se fuerza**: se deja `validated` + `nyquist_compliant: false` con la razón escrita, que es exactamente el estado PARTIAL que `audit-milestone` §5.5 sabe leer. Marcar `true` sin cita sería greenear enmascarando.

---

### E. Frontera del saneo

- **D-18 (LOCKED):** **el `format-isolation` transitivo NO entra**, pese a estar anotado en Phase 84 como «candidato natural de la Phase 85». Razones: (1) no es DEBT-05/06/07 ni NYQ-01/02, y el boundary del roadmap es fijo; (2) la propia nota de 84 dice que **no se ha medido el radio de ficheros del dashboard que se pondrían rojos** al seguir imports transitivos — una fase declarada «ligera y mecánica» no es el sitio para descubrirlo.
  - **Matiz importante para el planner:** D-09/WR-03 **sí** refuerza `check-isolation.test.js`. Si ese refuerzo produce un helper reutilizable, **no se aplica a `format-isolation.test.js` en esta fase**. Que compartan patrón no los hace el mismo trabajo.
- **D-19:** la fase **no abre `src/gsd/lock.js`** (R-82-01 sigue siendo decisión de mantenedor pendiente) ni el formato de línea del inbox (congelado en 83) ni `src/server.js`.
- **D-20:** **`.planning/codebase/TESTING.md` no se refresca aquí.** Está desfasado desde 2026-04-07 (describe 2 ficheros de test; la suite real tiene 110 ficheros y 2586 tests). Es deuda documental **real y detectada en esta discusión**, pero no es ninguno de los 5 requirements — va a `<deferred>` con su trigger.

---

### Claude's Discretion

Copy exacta de la línea de fallos de D-07 (dentro de la restricción `errorFn`) · redacción concreta del comentario del typedef de D-01 · número y reparto de planes (los bloques DEBT y NYQ son independientes; la partición natural es DEBT-05+06 / DEBT-07 / NYQ, pero el planner decide) · nombre y ubicación del helper de source-grep de D-09 si lo extrae · N exacto de fixtures del test de D-08 · orden de invocación dentro de cada bloque de D-16 · si el grep de auditoría de D-02 se ejecuta como parte del plan de DEBT-05 o como paso previo compartido.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Alcance y requisitos
- `.planning/ROADMAP.md` §Phase 85 (`:117-130`) — goal + los 5 criterios de éxito literales.
- `.planning/REQUIREMENTS.md` §Saneo de deuda (DEBT) `:26-30` y §Nyquist retroactivo (NYQ) `:32-35` — DEBT-05/06/07 y NYQ-01/02 literales.
- `.planning/STATE.md` §Deferred Items — las filas exactas que esta fase cierra (81-REVIEW WR-01/WR-02 → DEBT-05/06 · 3 warnings de 80-REVIEW → DEBT-07 · Nyquist draft 79/80/81 → NYQ-01 · Nyquist draft 69/71/72 → NYQ-02) y las que **no** (R-82-01, D-08, D-08b, format-isolation).

### Bloque DEBT — fuentes de la deuda
- `.planning/milestones/v0.18-phases/81-saneo-de-deuda-v0-17/81-REVIEW.md` — WR-01 (typedef stale) y WR-02 (`deriveAnyNext` sin colapso). **Origen literal de DEBT-05/06.**
- `.planning/milestones/v0.18-phases/80-carril-orquestador-reconciliaci-n-documental/80-REVIEW.md` §Warnings `:61-136` — **lectura obligatoria completa**: WR-01 (`:63-91`, con el fix propuesto en código), WR-02 (`:92-112`, con el escenario de test), WR-03 (`:113-136`, con la lista de imports dinámicos reales). §Info `:137+` — IN-01, que **no** entra (D-10).
- `.planning/milestones/v0.18-phases/81-saneo-de-deuda-v0-17/81-CONTEXT.md` — D-01 (contrato tres-estados por presencia, la semántica que DEBT-05 debe reflejar) y D-03 (colapso whitespace render-only en `nextCell`, el precedente exacto de DEBT-06).
- `.planning/milestones/v0.18-phases/80-carril-orquestador-reconciliaci-n-documental/80-CONTEXT.md` — D-04 (el sidebar NO es trigger; el resultado del doctor jamás re-entra al gate) y D-05 (orden del piggyback). **Ambos siguen vigentes: D-07 no los toca.**

### Bloque DEBT — código y tests que se tocan
- `src/session/state.js:51-63` — el typedef `TaskHandoff` + `State`. `:427-430` el `@returns` de `upsertTaskHandoff`; `:449-454` el merge tres-estados **ya implementado** (la fuente de verdad que el typedef debe describir).
- `test/state/handoff-state.test.js:265,288,307` — CLEAR / PRESERVE / OVERWRITE. **La evidencia citable de DEBT-05** (D-03).
- `src/cli/dashboard/select.js:245-260` — `deriveAnyNext` y su docblock (Pitfall 4: se computa sobre el set SIN filtrar). `:27` el comentario de color-isolation. **Hoy sin imports** — D-04 le añade el primero.
- `src/cli/dashboard/format.js:250-268` — `nextCell` y su docblock (colapso `/\s+/g` + `trim`, render-only, DEBT-03). `:25` su único import (`node:path`) — **la razón por la que D-04 puede importarlo**.
- `test/dashboard-select.test.js:468-500` — el bloque LIVE-05 de `deriveAnyNext`; el test RED de D-06 va aquí.
- `test/dashboard-format.test.js:505-530` — los casos de `nextCell`, que fijan la semántica que `deriveAnyNext` hereda.
- `src/check.js:140-175` — el piggyback completo: `deps = {}` → noopLogger (LOG-12), `applied = added + ungrouped`, la rama `hasAdvisories`, el `catch` fail-open. **Donde vive el fix de D-07.**
- `test/check.test.js:321-439` — los 4 casos actuales; el test nuevo de D-08 se añade aquí.
- `test/check-isolation.test.js:10-40,156-164` — `IMPORT_FROM_RE`/`IMPORT_BARE_RE`, `walkImports` y el comentario con la premisa falsa que D-09 corrige.
- `src/providers/registry.js:27,28,57,58` — los `await import()` reales que desmienten esa premisa.
- `test/skill-sync.test.js` — el guard *source-hygiene* de Phase 84: **el molde de D-09**.
- `test/format-isolation.test.js:200-218` — el guard TUI-04 que cubre **todos** los ficheros de `src/cli/dashboard/`; es lo que hace seguro el import de D-04. **No se modifica** (D-18).

### Bloque NYQ — molde y objetivos
- `.planning/milestones/v0.10-phases/41-doctor-m-dulo-puro-de-saneo-cli/41-VALIDATION.md` — **el molde exacto de D-13** (backfill Phase 47, NYQ-01). Copiar su estructura, no su contenido.
- `.planning/milestones/v0.11-phases/44-overlay-de-plan-gsd-pulido-de-dashboard/44-VALIDATION.md` — segundo precedente (backfill Phase 51, NYQ-03), con la fórmula de cita «No suite re-run — coverage is cited from the empirical evidence already on disk».
- Objetivos NYQ-01: `.planning/milestones/v0.18-phases/{79-sidebar-doctor,80-carril-orquestador-reconciliaci-n-documental,81-saneo-de-deuda-v0-17}/` — cada uno con su `{N}-VALIDATION.md` (draft), `{N}-VERIFICATION.md` y sus `SUMMARY` por plan.
- Objetivos NYQ-02: `.planning/milestones/v0.16-phases/{69-red-y-autenticaci-n,71-fiabilidad-de-entrega-y-backstop,72-higiene-dx-y-verdad-documental}/` — ídem; 71 y 72 traen además `UAT.md`, 72 trae `SECURITY.md`.
- `$HOME/.claude/skills/gsd-validate-phase/SKILL.md` — la skill de D-11. **Ojo a su objetivo declarado** (*updated VALIDATION.md + generated test files*): D-12 prohíbe la segunda mitad.

### Convenciones
- `.planning/codebase/CONVENTIONS.md` — `// @ts-check` + JSDoc en todo export, kebab-case, imports con extensión `.js`, prefijos `[kodo:*]`, sin barrel files.
- `.planning/codebase/TESTING.md` — **desfasado (2026-04-07)**: describe 2 ficheros de test cuando la suite real tiene 110 y 2586 tests. Vale para el framework (`node:test` + `node:assert/strict`, DI, `beforeEach`/cleanup); **no vale como inventario**. No se refresca aquí (D-20).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `nextCell` (`src/cli/dashboard/format.js:264`): ya implementa el colapso exacto que DEBT-06 necesita, con su docblock y sus tests. D-04 lo convierte en **la** fuente, sin escribir lógica nueva.
- El bloque CLEAR/PRESERVE/OVERWRITE de `test/state/handoff-state.test.js` (`:265-313`): la red que hace de DEBT-05 un cambio doc-only seguro.
- `walkImports` / `extractImports` (`test/check-isolation.test.js`): el enumerador del grafo ya existe; D-09 solo añade un grep sobre la lista que ya devuelve.
- El guard *source-hygiene* de `test/skill-sync.test.js` (Phase 84): patrón probado de «grep sobre fuentes para impedir una regresión que el walker no ve».
- `41-VALIDATION.md` y `44-VALIDATION.md`: dos backfills citation-based **ya aceptados en este repo**. NYQ-01/02 es el tercer pase del mismo procedimiento, no un formato nuevo.

### Established Patterns
- **Colapso de whitespace render-only** (DEBT-03): el dato persistido queda VERBATIM; el colapso es de LAYOUT. D-04 extiende el mismo criterio a la *decisión de presencia* de la columna — no persiste nada distinto.
- **Flags estructurales sobre el set SIN filtrar** (`anyGsd`/`anyProgress`/`anyNext`): la columna no parpadea bajo query `/`. D-05 lo preserva.
- **Fail-open con observabilidad por stdout/stderr** (0 tokens) en los carriles automáticos: es el canal que D-07 usa para no violar LOG-12.
- **Test RED antes del fix**: es el test el que dicta la forma del arreglo (lección explícita de Phase 84 D-17/D-18). Aplica a D-06 y a D-08.
- **Backfill citation-based**: la cobertura ES la cita a la evidencia en disco; no se re-corre la suite (D-12).

### Integration Points
- `src/session/state.js` — solo comentarios (D-01). Cero cambios de comportamiento.
- `src/cli/dashboard/select.js` — gana su **primer** import (`./format.js`, módulo puro del mismo directorio). `App.js` no se toca.
- `src/check.js` — el piggyback gana una rama de error por `errorFn`. El gate, el orden y el fail-open no cambian.
- `test/check.test.js`, `test/check-isolation.test.js`, `test/dashboard-select.test.js` — los tres ficheros de test que crecen.
- `.planning/milestones/v0.16-phases/**` y `v0.18-phases/**` — 6 `VALIDATION.md` editados **in-place** en su directorio archivado (D-15: los `MILESTONE-AUDIT.md` de al lado no se tocan).
- `.planning/STATE.md` §Deferred Items — las 4 filas que esta fase cierra (vía `gsd-tools`, nunca por Write directo).

</code_context>

<specifics>
## Specific Ideas

- **DEBT-05 no es «actualizar un comentario»: es borrar una trampa.** El texto actual dice «OJO al leerlo (WR-02): un `next` ausente/null NO borra el previo». Un implementador que lo lea hoy escribirá código correcto para la semántica de Phase 74 e incorrecto para la vigente — y el typedef le habrá dado permiso. Por eso D-02 exige el grep: la deuda no es el comentario, es la *afirmación repetida*.
- **La asimetría con Phase 84 (D-17) es la decisión de esta fase, no un descuido.** Allí duplicar estaba justificado por un leak de picocolors **verificado**; aquí el módulo destino es puro y está cubierto por el mismo guard. Aplicar el precedente sin comprobar la premisa habría producido duplicación ritual. Cualquier review de esta fase debería poder señalar el import de `src/cli/dashboard/format.js:25` como la razón.
- **WR-01 de 80-REVIEW es el warning que más duele en operación.** «Sidebar: 0 acción(es) aplicadas» significa hoy dos cosas opuestas — todo bien, o cmux caído y tres acciones fallidas — y el operador no puede distinguirlas. Cuesta cuatro líneas.
- **El riesgo real de la fase es NYQ, no DEBT.** Los DEBT están acotados a ficheros y líneas concretas. El backfill toca 6 fases de 2 milestones con una skill que sabe generar tests. **D-12 es el guardarraíl que mantiene la fase dentro de su promesa de «barrido ligero».**
- **Un `nyquist_compliant: true` sin cita es peor que un `false` honesto.** D-17 existe para eso: el estado PARTIAL ya está contemplado por `audit-milestone` §5.5, y es la salida correcta si la evidencia no da.

</specifics>

<deferred>
## Deferred Ideas

- **`format-isolation` transitivo** (D-18) — el walker existe en `test/format-isolation.test.js` pero el guard sigue imports directos. **Trigger:** medir primero el radio de ficheros del dashboard que se pondrían rojos; hacerlo dentro de una fase declarada mecánica es cómo se descarrila. Anotado originalmente en Phase 84.
- **IN-01 de 80-REVIEW** (D-10) — doble `scan` por pase motivado; el conteo de advisories proviene de otro snapshot que las acciones ejecutadas. Clasificado *info*, fuera del criterio literal «los 3 warnings». **Trigger:** que el conteo de advisories se contradiga con lo aplicado en un caso real.
- **Refresco de `.planning/codebase/TESTING.md`** (D-20) — desfasado desde 2026-04-07: describe 2 ficheros de test frente a 110 reales y 2586 tests. **Trigger:** el próximo `/gsd-map-codebase` o `/gsd-docs-update`, o la apertura del siguiente milestone.
- **R-82-01** — carrera de 2.º orden en `stealLock` con holder VIVO. Pendiente de decisión del mantenedor; exige rediseño del primitivo. Esta fase **no abre `src/gsd/lock.js`** (D-19).
- **D-08** (Phase 84) — rename `kodo-orchestrate/skill.md` → `SKILL.md`. Cambia el path de distribución; dejaría huérfanos sin `--prune`. **Trigger:** próximo toque de esa skill o barrido con `--prune` documentado.
- **D-08b** (Phase 84) — el auto-sync de `src/orchestrator/launch.js` sigue distribuyendo solo `kodo-orchestrate`. **Trigger:** primer operador que reporte que `/kodo-capture` no le aparece.
- **D-24 / D-13** (Phase 84) — tecla del dashboard para triar el inbox · `task_ref` en la línea de captura. Triggers en `84/deferred-items.md`.
- **Hallazgos fuera de `state.js` en el grep de auditoría de D-02** que no sean one-liner — se registran con su path en el `deferred-items.md` de esta fase.

</deferred>

---

*Phase: 85-Saneo de deuda + Nyquist retroactivo*
*Context gathered: 2026-07-27*
