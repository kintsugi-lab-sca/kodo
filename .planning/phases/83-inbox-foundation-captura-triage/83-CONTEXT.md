# Phase 83: Inbox foundation — captura + triage - Context

**Gathered:** 2026-07-25
**Status:** Ready for planning
**Mode:** `--auto` (decisiones auto-seleccionadas sobre la opción recomendada; auditables en `83-DISCUSSION-LOG.md`)

<domain>
## Phase Boundary

kodo gana su primer buffer de captura global, extremo a extremo **por CLI**:

- `kodo capture "idea"` desde cualquier proyecto appendea a `~/.kodo/inbox.md` una línea `texto · tag-proyecto · fecha · origen`; append atómico `O_APPEND` (N capturas concurrentes → N líneas, cero pérdidas), texto saneado a una sola línea vía `stripForKeystroke` (CAPT-01).
- `kodo inbox` lista las capturas abiertas y las marca `enrutada`/`descartada` **sin borrarlas jamás** — traza permanente de qué se convirtió en qué (CAPT-03).
- El **modelo de estado del marcado** queda decidido explícitamente aquí, no por defecto silencioso de un implementador (CAPT-03, crit 3 del ROADMAP; decisión abierta registrada en `STATE.md` §Accumulated Context).
- Trace pointer `→ destino` best-effort en la línea de una captura enrutada; sin ref utilizable, la marca `enrutada` no se bloquea (CAPT-06).
- El **seam de enrutado** (`kodo inbox` → `/gsd-capture` → marcar `enrutada`) queda documentado delegando el «a dónde va» en `gsd-capture`, sin import ni reimplementación de su lógica de destinos (CAPT-04).

**Fuera del boundary — Phase 84 (no discutir aquí):** `/kodo-capture` mid-session (CAPT-02), `kodo skill sync` multi-skill (CAPT-05), conteo ambient de capturas sin enrutar en el dashboard TUI (CAPT-07).

**Fuera del boundary — Out of Scope de `REQUIREMENTS.md` (exclusiones vigentes):** NLP/quick-add parsing en `kodo capture` · auto-routing en el momento de la captura · múltiples inboxes o inbox por proyecto · editor TUI in-place del inbox · endpoint `GET /inbox` en `src/server.js` · delete duro de capturas · reimplementar el routing de `gsd-capture` · deps npm nuevas.

</domain>

<decisions>
## Implementation Decisions

### Decisiones heredadas (LOCKED — no re-discutir)

- **Cero deps npm nuevas** — `node:fs` + `node:crypto` built-in cubren todo (invariante cross-milestone).
- **Cero endpoints nuevos en `src/server.js`** desde v0.10 — el inbox es filesystem, no HTTP.
- **La primitiva de lock es `withFileLock` (`src/session/state-lock.js:215`), NUNCA `src/gsd/lock.js`** — así lo fija el `Depends on` del ROADMAP §Phase 83 y lo delimitó el boundary de Phase 82. `src/gsd/lock.js` coordina locks de fases GSD por repo; su carrera de 2º orden abierta (R-82-01) es ajena a esta fase.
- **Delete duro prohibido** — solo transiciones de estado. La traza permanente ES el valor del feature.

### Modelo de estado del marcado (el gray area central — CAPT-03 crit 3)

- **D-01 (LOCKED):** **lock compartido `withFileLock`** sobre un lockfile hermano (`~/.kodo/inbox.lock`), tomado por **ambos** carriles. El marcado es el **único** escritor que reescribe el fichero; la captura solo appendea.
  - *Descartada — event-log append-only puro* (marcado = appendear una línea de evento, estado plegado en lectura): rompe dos cosas que el milestone protege explícitamente. (a) CAPT-06 exige el trace pointer **«en su línea»**, y en un event-log el destino vive en la línea de evento, no en la de captura. (b) `REQUIREMENTS.md` §Out of Scope justifica no hacer editor TUI porque *«el fichero es human-editable en markdown»* — un log de eventos entrelazado degrada esa legibilidad y duplica el tamaño.
  - *Descartada — marcado in-place posicional* (`pwrite` de un token de estado de ancho fijo, sin lock): sería elegante (regiones disjuntas → un `O_APPEND` concurrente nunca colisiona), pero **CAPT-06 la mata**: el trace pointer `→ destino` es de longitud **variable** y va en la propia línea, así que el marcado tiene que reescribir de todos modos. Añadiría fragilidad de offsets (UTF-8 multi-byte, edición manual del fichero) a cambio de nada.
- **D-02:** la captura toma el lock **y** appendea con `appendFileSync` (flag `'a'` → `O_APPEND`), **nunca** `writeFileAtomic` (CAPT-01 literal). Son dos capas independientes: el lock protege contra el RMW del marcado; el `O_APPEND` garantiza por sí solo que N capturas concurrentes producen N líneas aunque el lock no estuviera. Patrón ya en producción en `src/logger.js:318` (sink NDJSON).
- **D-03:** **fail-open de la captura ante `lock-timeout`.** `withFileLock` nunca lanza: devuelve `{ok:false, reason:'lock-timeout'}` tras agotar el presupuesto (default 8 retries × 20 ms). Agotado el presupuesto, `kodo capture` **appendea igual** y emite un warn a stderr. Principio GTD: una idea perdida es peor que una línea escrita sin coordinación. **Riesgo residual explícito y acotado:** la captura solo puede perderse si el timeout coincide además con la ventana read→rename de un marcado concurrente (orden de milisegundos, tras ~160 ms de reintentos). Se documenta como aceptado, no se enmascara.
- **D-04 (invariante):** el marcado, **dentro del lock**, hace RMW con lectura fresca y escritura vía `writeFileAtomic` (temp+rename intra-fs, `src/config.js:135`). **Toda línea distinta de la marcada se preserva BYTE A BYTE** — incluidas las que no parsean. El fichero es human-editable: el marcado jamás destruye una edición manual ni normaliza contenido ajeno.

### Formato de línea e identidad de una captura

- **D-05:** formato **checklist markdown** — legible, editable y parseable sin dependencias:
  ```
  - [ ] a3f9k2 · el texto de la idea · kodo · 2026-07-25 · cli
  ```
  Cerrada por enrutado (con y sin ref):
  ```
  - [x] a3f9k2 · el texto de la idea · kodo · 2026-07-25 · cli · enrutada → .planning/todos/TODO-012.md
  - [x] b7c1m0 · otra idea · ROMAN · 2026-07-25 · cli · enrutada
  ```
  Cerrada por descarte:
  ```
  - [x] c4d8n5 · idea que no va · kodo · 2026-07-25 · cli · descartada
  ```
  El checkbox `- [ ]` / `- [x]` marca **abierta / cerrada**; el sufijo discrimina **cuál** de los dos cierres.
- **D-06:** identidad por **ID corto opaco** generado en la captura (`node:crypto`, cero deps), visible como primer campo de la línea. Es el handle del marcado (`kodo inbox route <id>`).
  - *Descartado — índice de línea*: se invalida en cuanto el humano edita el fichero, y el fichero es human-editable por diseño.
  - *Descartado — hash del contenido*: dos capturas con el mismo texto colisionarían.
- **D-07:** fecha `YYYY-MM-DD` **local** (dato humano, mismo carril que los bloques `## Handoff` de v0.17 — no ISO-UTC, que es el carril máquina de `state.json`). La hora no aporta al triage y alarga la línea; el orden cronológico ya es implícito por posición en un fichero append-only.
- **D-08:** **parseo anclado a la cola.** El separador es ` · ` (U+00B7 con espacios), pero el texto del usuario puede contenerlo: el parser ancla el ID al principio y los **3 campos estructurados al final** (tag · fecha · origen [· estado [→ destino]]); todo lo que queda en medio es el texto, verbatim. Así el texto del usuario nunca se degrada ni se escapa.

### Seam de enrutado a `gsd-capture` (CAPT-04, CAPT-06)

- **D-09 (LOCKED):** el seam es **puramente documental**. `kodo inbox` **NO invoca** `gsd-capture`: `gsd-capture` es un skill de Claude Code (routing a `.planning/todos/`, notas, backlog 999.x, seeds — ver su `SKILL.md`), no un binario con contrato de retorno máquina-legible. Flujo documentado: `kodo inbox` → el operador (o el LLM en sesión) ejecuta `/gsd-capture …` → `kodo inbox route <id> [--dest <ref>]`. Cero acoplamiento, cero drift, cero import de código GSD.
- **D-10:** `--dest` es **OPCIONAL** — es la implementación literal del best-effort de CAPT-06. Sin ref, la línea queda `enrutada` sin destino y el marcado **nunca se bloquea** por falta de ref.
- **D-11:** `--dest` es una string libre saneada con `stripForKeystroke` (`src/cli/format.js:114`) — path relativo, `999.4`, `SEED-012`, lo que sea. kodo **no valida que exista ni interpreta su forma**: el «a dónde va» es competencia exclusiva de `gsd-capture`.

### Superficie CLI

- **D-12:** subcomandos planos, al estilo del repo (`kodo gsd doctor`, `kodo sidebar doctor`, `kodo skill sync`):
  - `kodo capture "<texto>"` — appendea.
  - `kodo inbox` — lista las **abiertas** (human coloreado vía `createFormatter`; `--json` byte-determinista, DX-06).
  - `kodo inbox --all` — incluye las cerradas (la traza permanente es consultable).
  - `kodo inbox route <id> [--dest <ref>]` — marca `enrutada`.
  - `kodo inbox discard <id>` — marca `descartada`.
- **D-13:** exit codes deterministas, espejo de `skill sync`: `0` ok/noop · `1` error de fs · `2` id inexistente o captura ya cerrada.
- **D-14:** **sin** filtros `--project` / `--open` — CAPT-F1 está diferido a v2 («solo cuando el inbox tenga volumen real»). No adelantar superficie.
- **Color isolation (Phase 14 D-07):** los módulos nuevos NUNCA importan el paquete de color directamente — solo `createFormatter`. Blindado por `test/format-isolation.test.js`.

### Derivación de `tag-proyecto` y `origen`

- **D-15:** el tag sale de `resolveProjectId(cwd, projects)` (`src/cli/dashboard/select.js:407` — nearest-ancestor sobre `projects.json`, never-throws sobre shapes corruptos). **Sin match → `basename(cwd)`**: un solo campo, siempre poblado, siempre informativo; se documenta que un tag no mapeado es sencillamente el nombre del directorio desde el que se capturó.
- **D-16:** el campo `origen` tiene vocabulario `cli` | `skill`. `kodo capture` acepta `--origin <valor>` (**interno**, no anunciado en el help principal) con default `cli`. Existe **ya en esta fase** porque CAPT-02 exige que el skill de Phase 84 produzca una línea **byte-idéntica** shelleando a `kodo capture` — un solo writer. Si el flag no existiera aquí, Phase 84 tendría que cambiar el formato o duplicar el writer.
- **D-17:** **sin** `--project` de override — superficie innecesaria; la derivación por cwd cubre el caso real.

### Robustez del reader y del fichero

- **D-18:** reader **leaf never-throws** (patrón establecido en el dashboard): fichero ausente → listado vacío con copy explícita, jamás un throw. Una línea que no parsea se **preserva byte a byte** en disco (D-04) y se **excluye** del listado estructurado — no es una captura válida, pero tampoco es basura que kodo pueda tirar.
- **D-19:** `~/.kodo/inbox.md` se crea on-demand (`mkdirSync` recursivo del `KODO_DIR`, patrón `ensureDir` de `src/config.js:98`). **Sin cabecera ni preámbulo markdown** — el fichero es una lista pura, para que el append nunca dependa de estructura previa ni tenga que distinguir el primer caso.
- **D-20:** permisos por defecto (umask), como `state.json` / `config.json`. El inbox no es un secreto; el `0600` está reservado al carril de credenciales (`~/.kodo/.env`, `*_secret`).

### Validación (CAPT-01 y CAPT-03 crit 3)

- **D-21:** test de concurrencia con **procesos reales + barrier file** (patrón `test/gsd-lock-race.test.js`), en dos escenarios:
  1. N capturas concurrentes → exactamente N líneas, cero pérdidas (CAPT-01).
  2. **Caso mixto**: capturas concurrentes **durante** un marcado → la captura sobrevive al RMW (el invariante literal de CAPT-03 crit 3). Este es el test que justifica D-01; sin él la decisión del modelo de estado queda sin evidencia.
- **D-22:** **golden test del formato de línea.** Phase 84 exige byte-identidad skill↔CLI; el golden que se escriba aquí es la referencia contra la que 84 comparará. Debe fijar la línea completa con un clock y un generador de ID inyectados (determinismo).

### Claude's Discretion

Longitud y alfabeto exactos del ID corto (p. ej. 4-6 chars base36 desde `randomBytes`) · nombre exacto del lockfile · organización de módulos (`src/inbox/*.js` de lógica pura + `src/cli/inbox.js` thin handler, espejo de `skill-sync.js` → `src/skill/sync.js`) · regex concreta del parser anclado a cola · copy exacta de los mensajes y del listado · N del test de concurrencia · si el listado human numera filas o muestra solo IDs.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Alcance y requisitos del milestone
- `.planning/ROADMAP.md` §Phase 83 — goal + 5 success criteria (crit 3 es el que obliga a decidir el modelo de estado explícitamente).
- `.planning/REQUIREMENTS.md` §Inbox de capturas (CAPT) — CAPT-01/03/04/06 literales; §Out of Scope — las 9 exclusiones que acotan la fase; §v2 Requirements — CAPT-F1/F2 diferidos.
- `.planning/STATE.md` §Accumulated Context — la decisión abierta *«modelo de estado del marcado del inbox — lock compartido vs event-log append-only»* que D-01 cierra; §Deferred Items — R-82-01 (ajeno a esta fase).

### Primitivas que se reutilizan (NO reimplementar)
- `src/session/state-lock.js:215` — `withFileLock(lockPath, fn, opts)`: `{ok:true,value}` / `{ok:false,reason:'lock-timeout'}`, never-throws, release en `finally`. `:61` `acquireLock` (defaults 8 retries × 20 ms, TTL 10 s) — la base de D-01/D-03.
- `src/cli/format.js:114` — `stripForKeystroke`: colapsa `\n`/`\t` reales **y** las secuencias literales `\n`/`\r`/`\t` a espacio. Es el saneo de una línea que exige CAPT-01 (D-02, D-11).
- `src/cli/dashboard/select.js:407` — `resolveProjectId(cwd, projects)`: reverse lookup cwd→projectId, nearest-ancestor, never-throws sobre `projects.json` corrupto (D-15).
- `src/cli/adopt.js:43` — `resolveProjectPath(cwd, entry)`: la semántica hermana (path más largo que sea ancestro); referencia de estilo para D-15.
- `src/config.js:135` — `writeFileAtomic` (temp+rename intra-fs) para el RMW del marcado (D-04); `:98` `ensureDir` (D-19); `:615` exports `KODO_DIR`.
- `src/logger.js:318` — `appendFileSync` como sink append-only ya en producción: el patrón `O_APPEND` de D-02.

### Patrones de CLI a espejar
- `src/cli.js` — registro de subcomandos con commander (`kodo gsd …`, `kodo sidebar …`, `kodo skill …`); ahí se cuelgan `capture` e `inbox` (D-12).
- `src/cli/skill-sync.js` — thin CLI handler canónico: gate → lógica en módulo aparte (SoSoT) → render human/`--json` → exit codes 0/1/2, con DI de `writeFn`/`errFn`/`formatterFn` y color isolation (D-12, D-13).

### Seam de enrutado
- `~/.claude/skills/gsd-capture/SKILL.md` — los destinos reales del routing (`--note`, `--backlog` 999.x, `--seed`, todo por defecto). **Leer para entender por qué D-09 hace el seam documental**: es un skill de Claude Code, no un binario con contrato de retorno.

### Convenciones y precedente
- `.planning/codebase/CONVENTIONS.md` — `// @ts-check` + JSDoc en todo export, kebab-case de ficheros, imports con extensión `.js`, prefijos de log `[kodo:*]`, sin barrel files.
- `.planning/phases/82-fix-de-la-carrera-de-steallock/82-CONTEXT.md` — precedente inmediato: fija que el inbox usa `withFileLock` y **NO** `src/gsd/lock.js`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `withFileLock` (`src/session/state-lock.js:215`): probada en v0.16 CONC-01 con una carrera de 10 procesos sin escrituras perdidas. Es la coordinación de D-01 tal cual, sin envoltorios.
- `stripForKeystroke` (`src/cli/format.js:114`): el saneo a una línea de CAPT-01 ya existe y ya está probado — no escribir uno nuevo.
- `resolveProjectId` (`src/cli/dashboard/select.js:407`): la derivación del tag-proyecto ya existe con la semántica correcta (nearest-ancestor + never-throws). Reutilizar, no duplicar.
- `writeFileAtomic` (`src/config.js:135`): temp+rename intra-fs; el marcado escribe con esto dentro del lock.
- `appendFileSync` (`src/logger.js:318`): precedente vivo de sink append-only en el repo.
- `createFormatter` (`src/cli/format.js`): render human/JSON con color isolation obligatoria.

### Established Patterns
- **Thin CLI handler + lógica pura en módulo aparte** (`src/cli/skill-sync.js` → `src/skill/sync.js`): argv → gate → delegar → render. DI de `writeFn`/`errFn`/`formatterFn` para testabilidad sin capturar stdout.
- **Reader leaf never-throws**: todo consumidor de filesystem del dashboard colapsa fallos a estado vacío en vez de lanzar (D-18).
- **`--json` byte-determinista** (DX-06) y **exit codes deterministas** 0/1/2 en todo subcomando.
- **Tests de carrera con procesos reales + barrier file** (`test/gsd-lock-race.test.js`): el molde de D-21.
- **Cero deps, `node:*` built-in** (v0.16 CONC-02): el ID corto sale de `node:crypto`, no de `uuid`.

### Integration Points
- `src/cli.js`: dos comandos nuevos de primer nivel (`capture`, `inbox`). No toca ningún comando existente.
- `~/.kodo/`: fichero nuevo `inbox.md` + lockfile hermano. Mismo directorio que `config.json`/`projects.json`/`state.json`; `ensureDir` ya lo crea.
- **Phase 84 consume dos contratos de esta fase**: el flag `--origin` (writer único, CAPT-02) y el formato de línea de `inbox.md` (reader del conteo ambient, CAPT-07). Ambos quedan fijados aquí — cambiarlos después rompe 84.
- `src/server.js`: **no se toca** (invariante cero endpoints nuevos).

</code_context>

<specifics>
## Specific Ideas

- El criterio de éxito 3 del ROADMAP («el modelo de estado queda decidido explícitamente en discuss-phase, no por defecto silencioso de un implementador») se satisface con **D-01 + las dos alternativas descartadas con razón**, y se **prueba** con el escenario mixto de D-21. Una revisión de esta fase debe poder explicar por qué una captura concurrente al marcado no se pierde — y el único hueco admitido es el residual acotado de D-03.
- El fichero tiene que aguantar que el humano lo abra y lo edite a mano: eso es lo que hace de D-04 («preservación byte a byte de toda línea no marcada») un invariante y no una nicety.
- La línea es un contrato inter-fase, no un detalle de render: el golden de D-22 es lo que Phase 84 comparará byte a byte.

</specifics>

<deferred>
## Deferred Ideas

- **CAPT-F1** — filtros `--project` / `--open` en `kodo inbox`: v2, «solo cuando el inbox tenga volumen real» (`REQUIREMENTS.md` §v2).
- **CAPT-F2** — archival/rotación del inbox: v2, «solo si el fichero crece hasta molestar».
- **Phase 84** (ya en el roadmap, no re-abrir aquí): `/kodo-capture` mid-session (CAPT-02), `kodo skill sync` multi-skill (CAPT-05), conteo ambient de capturas sin enrutar en el dashboard TUI (CAPT-07).
- **R-82-01** — carrera de 2º orden en `stealLock` con holder VIVO (`STATE.md` §Deferred Items, pendiente de decisión del mantenedor): ajena a esta fase por construcción — el inbox usa `withFileLock`, no `src/gsd/lock.js`.
- **Riesgo residual de D-03** (captura fail-open coincidiendo con la ventana read→rename de un marcado): documentado y aceptado. Si alguna vez se materializa en uso real, el fix natural es subir el presupuesto de reintentos de la captura, **nunca** debilitar el test de D-21.

</deferred>

---

*Phase: 83-Inbox foundation — captura + triage*
*Context gathered: 2026-07-25*
