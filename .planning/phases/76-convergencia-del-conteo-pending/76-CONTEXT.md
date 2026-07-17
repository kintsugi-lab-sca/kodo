# Phase 76: Convergencia del conteo `pending` - Context

**Gathered:** 2026-07-17 (modo `--auto` — decisiones auto-seleccionadas sobre la opción recomendada; auditar contra `76-DISCUSSION-LOG.md`)
**Status:** Ready for planning

<domain>
## Phase Boundary

`/status` y `kodo check` derivan su `pending_count` de la **misma fuente de verdad** con la misma
semántica (ORCH-05), y con el provider caído `/status` **señala explícitamente** que el dato es
caducado en vez de servirlo como fresco (ORCH-06). Causa raíz localizada en código: `server.js:591`
sirve desde `pendingCache` (TTL 30s) mientras `check.js:37` lee fresco sin caché; peor,
`server.js:599` devuelve `pendingCache.data` en el catch **sin comprobar TTL** — dato
arbitrariamente viejo con solo un `console.warn` de rastro.

**Hecho estructural que acota la fase:** `kodo check` es un proceso CLI separado del server — no
comparten memoria. «Converger» NO puede significar compartir el caché in-memory: significa que
ambos consumidores ejecutan el **mismo código** con la misma semántica de frescura, y que la
ventana de divergencia (≤ TTL 30s) queda documentada y auditable vía timestamp expuesto.

**Dentro:** el camino de lectura de pending en `/status` (server.js:588-664), `checkPendingTasks`
en `check.js`, el render del conteo en el HTML del dashboard web (server.js:370 «Candidatas»),
y los tests que hoy no existen sobre este carril.

**Fuera:** rediseño del `pendingCache` a invalidación por evento (descartado en REQUIREMENTS §Out
of Scope — sobreingeniería para un TTL de 30s), endpoints nuevos, el carril de dispatch de
`src/triggers/polling.js` (también llama `listPendingTasks()` pero su semántica es de **entrega**,
no de reporte — no se toca), debounce del nudge (el genérico se eliminó el 2026-07-14), la TUI ink
(no consume `pending` — verificado por grep en `src/cli/dashboard/`).

</domain>

<decisions>
## Implementation Decisions

### Fuente única del conteo (ORCH-05)

- **D-01: Módulo puro compartido con factory DI** — extraer fetch+caché+frescura a un módulo nuevo
  (factory tipo `createPendingResolver({ listPendingTasksFn, ttlMs, now })`), espejo exacto del
  patrón `src/server/provider-state.js` (que ya recibe `PENDING_CACHE_TTL_MS` de server.js «sin
  segundo literal» — D-02 de Phase 40). `server.js` lo instancia con `PENDING_CACHE_TTL_MS` (30s,
  el número no se duplica); `check.js` usa el mismo módulo en modo fresco (TTL 0 / sin caché — un
  proceso one-shot no se beneficia de cachear). Ambos números salen de la misma función.
  Rechazado: quitar el caché de `/status` (la TUI pollea `/status` cada ~2.5s → martilleo al
  provider en cada tick); caché cross-proceso en disco (rediseño descartado por REQUIREMENTS
  §Out of Scope).

- **D-02: El módulo es hoja de imports mínimos** — `kodo check` tiene un test-graph guard (LOG-12,
  `test/check-isolation.test.js`) que restringe qué puede importar su grafo. El módulo compartido
  no importa logger ni deps pesadas; recibe todo por DI (precedente: `src/session/handoff.js`,
  hoja de cero imports blindada por el mismo test).

- **D-03: TTL 30s se mantiene** — un solo literal `PENDING_CACHE_TTL_MS` (D-02 Phase 40). La
  convergencia que ORCH-05 exige es de código y semántica; la ventana ≤30s residual queda honesta
  y auditable vía `pending_fetched_at` (D-05). Reducir el TTL o eliminarlo no es requisito y
  castiga al provider.

### Política de frescura en fallo del provider (ORCH-06)

- **D-04: Resultado discriminado con frescura explícita** — el módulo devuelve
  `{ tasks, fetched_at, stale }`: fetch OK → `stale: false` y `fetched_at` del momento; fetch
  falla → **last-known-good etiquetado** (`stale: true` + el `fetched_at` real del último éxito),
  jamás dato viejo presentado como fresco. Cold-start con provider caído (nunca hubo fetch
  exitoso) → `tasks: []`, `fetched_at: null`, `stale: true` — hoy ese caso sirve `[]` como si
  fuera verdad fresca. Rechazado: colapsar a `pending_count: null` en error — rompería el shape
  numérico que consume el HTML (`server.js:370`) y descarta información útil (el último conteo
  conocido con su edad es más valioso que nada).

### Contrato `/status` y superficie de consumo

- **D-05: Campos aditivos, tipos intactos** — `/status` gana `pending_stale: boolean` y
  `pending_fetched_at: string|null` (ISO), siempre presentes; `pending` (array) y `pending_count`
  (number) conservan tipo y significado. Aditivo puro, cero endpoints nuevos (invariante desde
  v0.10), precedente exacto: el enriquecimiento `provider_state` de Phase 40.

- **D-06: El HTML del dashboard web marca lo stale** — la stat «Candidatas» (`server.js:370`)
  indica visualmente cuando `pending_stale` es true (indicador mínimo: estilo dim o sufijo corto);
  el detalle exacto es Claude's Discretion. La TUI ink no cambia (no consume `pending`).

- **D-07: `kodo check` — output sano byte-idéntico** — en el camino sano `checkPendingTasks`
  produce exactamente las mismas líneas que hoy (los tests existentes no se rompen); en error
  conserva la línea roja actual. `check` sigue siendo fresco: su cifra es la verdad del instante,
  y `/status` expone la suya con timestamp — ambos comparables sin ambigüedad.

### Verificación de la convergencia

- **D-08: Cerrar el hueco de cobertura** — hoy **cero tests** cubren el carril `pendingCache`
  (grep de `pendingCache|pending_count` en `test/` → vacío). La fase entrega: tests unitarios del
  módulo (TTL fresco/caducado, catch etiquetado stale, cold-start caído, clock inyectado), y tests
  de contrato de `/status` (campos nuevos presentes en ambas ramas).

- **D-09: Guard source-hygiene de la convergencia** — un test que verifique que server y check
  consumen el módulo compartido y no re-implementan la lógica inline (precedente anti-inline:
  D-09/D-10/D-11 de v0.4 Phase 13 y el walker de `handoff.js`). `test/check-isolation.test.js`
  debe seguir verde con el import nuevo.

### Claude's Discretion

- Nombre y ubicación del módulo compartido (`src/server/pending.js` junto a `provider-state.js`
  vs módulo neutral tipo `src/tasks/pending.js` — atención al grafo de check-isolation).
- Dedup in-flight de fetches solapados (el resolver de Phase 40 lo tiene; espejarlo aquí es
  recomendable pero no requisito — polls de `/status` solapados durante un fetch lento).
- Indicador visual exacto de staleness en el HTML web y su redacción.
- Si `checkPendingTasks` instancia el resolver con TTL 0 o consume una función `fetchFresh`
  exportada por el mismo módulo — mientras la lógica viva en un solo sitio.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements y alcance
- `.planning/REQUIREMENTS.md` §Conteo de tareas pendientes (ORCH-05, ORCH-06) — los dos
  requirements con la causa raíz citada; §Out of Scope — el rediseño a invalidación por evento
  está explícitamente descartado.
- `.planning/PROJECT.md` §Current Milestone v0.17 (bullet ORCH-05) — contexto de por qué esta
  fase entra con causa raíz localizada (lección de la Phase 73 retirada: no planificar sobre
  síntomas).
- `.planning/ROADMAP.md` — entrada de Phase 76 (success criteria de la fase).

### Código afectado (causa raíz)
- `src/server.js:21-22` — `PENDING_CACHE_TTL_MS = 30s` + shape `pendingCache = {data, ts}`.
- `src/server.js:588-664` — handler `/status`: rama TTL (:591), fetch+update (:594-596), el catch
  defectuoso (:597-600) y el payload (:648-662).
- `src/server.js:370` — render «Candidatas» del dashboard web (consumidor de `pending_count`).
- `src/check.js:29-52` — `checkPendingTasks` (DI `getProviderFn` ya existente, fetch fresco).

### Patrones a espejar
- `src/server/provider-state.js` — factory con DI (`ttlMs`, `now`), caché con TTL sin hardcodear
  el 30s, dedup in-flight, fail-open. El patrón arquitectónico exacto que D-01 replica.
- `test/check-isolation.test.js` — test-graph guard LOG-12 que restringe el grafo de imports de
  `kodo check`; el módulo nuevo debe pasarlo.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/server/provider-state.js`: patrón factory+DI+TTL+fail-open listo para replicar (D-01).
- `checkPendingTasks` (`src/check.js:29`): ya recibe `getProviderFn`/`formatterFn` por DI — el
  punto de inyección del módulo compartido existe.
- `createFormatter` (`src/cli/format.js`): única fuente de color para el output de check (no tocar).

### Established Patterns
- Campos aditivos en `/status` sin endpoint nuevo (Phase 40 `provider_state`) — D-05 lo repite.
- «No second number»: constantes compartidas se pasan por parámetro, no se re-declaran (D-02
  Phase 40).
- Never-throws / fail-open en todo el carril de lectura; `console.warn` como rastro en server.
- Source-hygiene guards anti-inline (Phase 13, `handoff.js` D-13) para forzar la fuente única.

### Integration Points
- `server.js` `/status` handler (sustituir el bloque :590-601 por el resolver compartido).
- `src/check.js` `checkPendingTasks` (mismo módulo, modo fresco).
- HTML dashboard web (`server.js:370`) — único consumidor visual de `pending_count` (la TUI ink
  no lo consume; verificado por grep).

### Constraint estructural
- `kodo check` (proceso CLI) y el server no comparten memoria — la convergencia es de código y
  semántica con ventana TTL documentada, no de caché compartida.

</code_context>

<specifics>
## Specific Ideas

No specific requirements beyond the decisions above — la fase nace con la causa raíz citada
línea a línea en REQUIREMENTS.md y PROJECT.md; el margen creativo está acotado a las áreas de
Claude's Discretion.

</specifics>

<deferred>
## Deferred Ideas

None — discussion stayed within phase scope. (El rediseño a invalidación por evento ya estaba
descartado en REQUIREMENTS §Out of Scope antes de esta discusión; no es un deferred nuevo.)

</deferred>

---

*Phase: 76-Convergencia del conteo `pending`*
*Context gathered: 2026-07-17*
