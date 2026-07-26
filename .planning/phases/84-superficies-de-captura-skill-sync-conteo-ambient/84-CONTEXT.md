# Phase 84: Superficies de captura — skill, sync, conteo ambient - Context

**Gathered:** 2026-07-26
**Status:** Ready for planning
**Mode:** `--auto` (decisiones auto-seleccionadas sobre la opción recomendada; alternativas descartadas auditables en `84-DISCUSSION-LOG.md`)

<domain>
## Phase Boundary

Phase 83 dejó el buffer de captura operativo **por CLI**. Esta fase le pone las tres superficies que cierran el ciclo, **sin tocar el modelo de datos ni el formato de línea** (ambos congelados en 83):

- **`/kodo-capture` mid-session (CAPT-02)** — una skill de Claude Code que captura sin salir de la sesión, shelleando a `kodo capture`. **Un solo writer**: la skill jamás escribe `~/.kodo/inbox.md`. La byte-identidad skill-path ↔ CLI-path se verifica con golden test.
- **`kodo skill sync` multi-skill (CAPT-05)** — el mecanismo hoy single-skill (`kodo-orchestrate` hardcodeado en `src/cli/skill-sync.js:62-63`) se generaliza **explícitamente** para distribuir también `kodo-capture`.
- **Conteo ambient (CAPT-07)** — el dashboard TUI muestra cuántas capturas quedan sin enrutar, leyendo `~/.kodo/inbox.md` con un reader leaf never-throws. **Cero endpoints nuevos en `src/server.js`.**

**Congelado por Phase 83 — NO se re-abre aquí:** el formato de línea (`83-CONTEXT.md` D-05), el flag `--origin` (D-16, creado en 83 precisamente para que esta fase tenga un writer único), la identidad por ID corto (D-06), el modelo de estado del marcado (D-01, lock compartido + guard compare-and-swap de 83-04) y la semántica abierta/cerrada del checkbox.

**Fuera del boundary — Out of Scope vigente de `REQUIREMENTS.md`:** NLP/quick-add parsing · auto-routing en el momento de la captura · múltiples inboxes o inbox por proyecto · editor TUI in-place del inbox · endpoint `GET /inbox` · delete duro · reimplementar el routing de `gsd-capture` · deps npm nuevas.

**Fuera del boundary — Phase 85:** DEBT-05/06/07 y NYQ-01/02.

</domain>

<decisions>
## Implementation Decisions

### Decisiones heredadas (LOCKED — no re-discutir)

- **Cero deps npm nuevas** · **cero endpoints nuevos en `src/server.js`** · **color isolation** (`picocolors` solo desde `src/cli/format.js`) · **`--json` byte-determinista** (DX-06) · **TUI never-throws** · **exit codes deterministas 0/1/2**.
- **El formato de línea del inbox es un contrato inter-fase ya fijado.** `encodeLine`/`parseLine` (`src/inbox/store.js`) son la SoSoT; el golden vive en `test/inbox-format-golden.test.js`. Esta fase lo **consume**, no lo modifica.
- **Los paths del inbox se resuelven PEREZOSAMENTE**, jamás como constante de módulo (`83-01`: la fuga de `homedir()` en el cuerpo de `config.js:11` contamina los tests). Todo lector nuevo repite esa disciplina.
- **El seam de enrutado es documental** (83 D-09): kodo no invoca `gsd-capture`. Esta fase no lo cambia.

---

### A. Registro multi-skill de `kodo skill sync` (CAPT-05)

- **D-01 (LOCKED):** el registro de skills distribuibles es una **allowlist explícita en código** — una constante `KODO_SKILLS = ['kodo-orchestrate', 'kodo-capture']` (nombre y ubicación a discreción del planner), **no** un glob de `.claude/skills/*`.
  - *Descartada — descubrimiento por directorio*: el repo YA contiene `.claude/skills/worktree-cleanup/`, que es una skill **de trabajo local del repo, no un producto que kodo distribuya**. Un glob la empezaría a copiar a `~/.claude/skills/` en la próxima `kodo skill sync`, en silencio y sin que nadie lo haya decidido. Peor: cualquier skill futura que alguien deje caer en ese directorio quedaría auto-distribuida. La allowlist hace que **añadir una skill al carril de distribución sea un acto explícito y revisable**, que es exactamente lo que CAPT-05 pide («generalización … de forma explícita»).
- **D-02:** el **gate de exit 2** («no es un repo kodo») sigue anclado a **`kodo-orchestrate`** y solo a él. Es el marcador de identidad del repo, no una comprobación por skill. Mensaje de stderr **byte-idéntico** al actual (`src/cli/skill-sync.js:68`) — es literal comparado por test.
- **D-03:** **resiliencia por skill**: si una skill del registro falla, las demás **se sincronizan igual**. El bucle no aborta a la primera. Una skill rota no puede impedir que la otra llegue a su destino.
  - Agregación del exit code: `1` si **alguna** skill terminó en `error`; `0` en caso contrario. `2` sigue reservado al gate de D-02.
- **D-04:** el payload `--json` **crece de forma aditiva**, sin romper a nadie que hoy lea `.status` / `.files_changed`:
  ```json
  {"status":"ok","files_changed":3,"skills":[{"name":"kodo-orchestrate","status":"noop","files_changed":0},{"name":"kodo-capture","status":"ok","files_changed":3}]}
  ```
  Las claves de nivel superior pasan a ser el **agregado** (`files_changed` = suma; `status` = `error` si alguna erró, `ok` si alguna cambió algo, `noop` si ninguna). `files_pruned` / `symlink_replaced` mantienen su condicionalidad actual, agregados igual.
  - *Descartada — sustituir el objeto por un array puro*: rompería el contrato `--json` por nada; el consumidor que solo quiere «¿hubo drift?» sigue leyendo `.status`.
- **D-05:** el render human lista **una línea por skill** (reutilizando el `renderHuman` actual con el nombre por delante), no un total opaco. El operador tiene que poder ver **cuál** de las dos se movió.
- **D-06:** **`syncSkill` (`src/skill/sync.js`) NO cambia su firma ni su contrato.** Sigue siendo per-skill y pura (D-08 de Phase 21: no emite eventos, el caller decide). La generalización vive **entera** en el handler `src/cli/skill-sync.js`, que itera el registro. Esto mantiene verdes los tests de `sync.js` sin tocarlos y respeta la separación thin-handler / lógica pura.
- **D-07:** el gate de existencia de la skill acepta **`SKILL.md` y `skill.md`** (candidatas en ese orden). Hoy `syncSkill:67` codifica `'skill.md'` en minúsculas y `kodo-orchestrate` usa esa forma, mientras que `worktree-cleanup` usa `SKILL.md` — la convención de Claude Code. En macOS el filesystem es case-insensitive y la discrepancia es invisible; **en Linux sería un fallo duro**. Tolerar ambos nombres cuesta una línea y elimina la trampa.
- **D-08b (post-research, 2026-07-26):** **el auto-sync de `src/orchestrator/launch.js:164` NO se generaliza.** Ese path sincroniza `kodo-orchestrate` de piggyback al lanzar el orquestador; hay otros dos consumidores hardcodeados en `src/hooks/stop.js:296,314` (+ una constante muerta en `:21`). Ninguno entra en el boundary literal de CAPT-05, que habla de **`kodo skill sync`**. **Consecuencia conocida y aceptada:** un operador que solo use `kodo orchestrate` y nunca ejecute `kodo skill sync` no recibirá `/kodo-capture`. Se registra en `deferred-items.md` de la fase con su trigger, no se cierra aquí — ampliar el auto-sync es una decisión sobre el arranque del orquestador, no sobre la distribución de skills.
- **D-08:** `kodo-capture` se escribe con **`SKILL.md`** (convención de Claude Code, precedente de `worktree-cleanup` en este mismo repo). **`kodo-orchestrate/skill.md` NO se renombra en esta fase** — un rename cambia el path de distribución y dejaría un fichero huérfano en `~/.claude/skills/kodo-orchestrate/` de todos los operadores salvo que corran `--prune`. Queda como deuda registrada (ver `<deferred>`).

---

### B. La skill `/kodo-capture` (CAPT-02)

- **D-09 (LOCKED):** `/kodo-capture` es una **skill de Claude Code** en `<repo>/.claude/skills/kodo-capture/SKILL.md`, espejo estructural de `kodo-orchestrate`. Es lo que la hace invocable como `/kodo-capture` **y** distribuible por `kodo skill sync` (CAPT-05 lo exige literalmente).
- **D-10 (invariante — un solo writer):** la skill **shellea `kodo capture`** y no hace nada más. Jamás abre, lee ni escribe `~/.kodo/inbox.md`, jamás construye una línea, jamás toca el lockfile. La byte-identidad no se «consigue»: es una **consecuencia estructural** de que solo exista un writer.
- **D-11:** la invocación canónica es, literalmente:
  ```
  kodo capture --origin skill -- "<texto>"
  ```
  Las dos piezas son obligatorias y por razones distintas: **`--origin skill`** es el vocabulario que D-16 de Phase 83 creó para esta fase; **`--`** protege contra un texto que empiece por guion (`83-05` WR-05 documentó exactamente este caso: `kodo capture -- "-3 % de conversión"`). Los flags van **antes** del `--`; si fueran después, commander los leería como texto.
- **D-12:** **la skill no deriva nada.** El «derivar proyecto/tarea del contexto de sesión de forma determinista» de CAPT-02 se satisface **por herencia del cwd**: la sesión de Claude Code corre en el directorio del proyecto, y `deriveTag(cwd, projects)` (`src/inbox/store.js`, refinada en `83-07` con la Decisión B para claves UUID) ya hace la derivación con la semántica correcta. Cualquier derivación adicional en el prompt de la skill sería **una segunda fuente de verdad no determinista** (un LLM decidiendo el tag) — justo lo que la byte-identidad prohíbe.
- **D-13:** **no hay campo de tarea.** El formato congelado (83 D-05) es `- [ ] id · texto · tag · fecha · origen [· estado [→ destino]]`: no existe slot para una task ref, y abrirlo rompería el golden, el parser anclado a la cola y el reader de CAPT-07. Si el operador quiere la referencia a la tarea, va **dentro del texto**. El vínculo tarea↔captura no es un requisito de esta fase.
- **D-14 (el mecanismo que hace la byte-identidad verificable):** el `SKILL.md` contiene **exactamente una** invocación canónica, dentro de un bloque cercado con un marcador estable, y **un test la extrae del fichero y la ejecuta**. Con el reloj y el generador de ID inyectados, la línea producida se compara **byte a byte** contra el golden de Phase 83 (`test/inbox-format-golden.test.js`).
  - Esto es lo que convierte el criterio de éxito 1 en algo real: un `SKILL.md` es un **prompt**, no código, y no se puede unit-testear ejecutando un LLM. Lo que sí se puede blindar es que **la cadena de comando que la skill le dice al modelo que ejecute** siga siendo la correcta. Si alguien edita esa línea en el markdown, el golden se pone rojo.
  - Corolario: el test debe fallar también si aparece **más de una** invocación de `kodo capture` en el fichero — dos comandos = dos caminos = la ambigüedad que D-10 cierra.
- **D-15:** la skill **no** ofrece triage, listado ni enrutado. Captura y calla. `kodo inbox` ya existe para lo demás, y ampliar la superficie de la skill la volvería un segundo cliente del inbox con su propio criterio.

---

### C. Conteo ambient en el dashboard (CAPT-07)

- **D-16:** se cuentan las capturas **abiertas** — las líneas `- [ ] `. «Sin enrutar» y «abierta» son el mismo conjunto: `enrutada` y `descartada` cierran ambas el checkbox (83 D-05). Una descartada **no** cuenta: ya fue triada.
- **D-17 (LOCKED):** el contador es un **leaf propio** en `src/cli/dashboard/inbox-count.js` que importa **solo `node:fs` / `node:os` / `node:path`** y usa una **regex CONSTANTE**. Leaf puro, síncrono, never-throws, sin acoplar el leaf a la I/O de otros módulos.
  - **Corrección post-research (2026-07-26) — cambia el MECANISMO, no la semántica.** Una versión previa de D-17 decía «regex anclada al **prefijo** del checkbox» y «contar no requiere parsear». **Es incorrecto y hace fallar el test que D-18 exige.** Medido sobre un fixture de 12 líneas con hand-edits realistas: prefijo `/^- \[ \] /` cuenta **7**, el oráculo `listCaptures(...).filter(open)` cuenta **2**. Basta un `- [ ] comprar leche` escrito a mano — el hand-edit **más probable** en un fichero que el proyecto declara human-editable por diseño — para desalinear los dos lectores: `listCaptures` solo cuenta lo que casa `LINE_RE` **entera**, y una línea sin los campos estructurados no es una captura. **La regex constante del leaf debe ser la especialización a línea-abierta de `LINE_RE`** (`src/inbox/store.js:126`), no un prefijo. Con ella, medido: **2 vs 2**. `RESEARCH.md` §Pitfall 6 tiene la sonda y el desglose línea a línea.
  - Corolario de planning (lo recoge `RESEARCH.md`): **el test anti-drift de D-18 se escribe ANTES que el leaf.** Es el test el que dicta qué regex es admisible; escribir el leaf primero es escribir la regex equivocada.
  - **El molde de referencia es `src/cli/dashboard/tasks.js`, no `progress.js`** — es el único leaf del dashboard que combina resolución HOME-relative perezosa con la tríada de DI que D-19 necesita.
  - *Descartada — importar `listCaptures` de `src/inbox/store.js`*: sería la opción obvia (cero duplicación del formato), pero `store.js:46` importa `stripForKeystroke` de `../cli/format.js`, **que importa picocolors**. Un leaf del dashboard que importe el store mete el paquete de color en el grafo del TUI por la puerta de atrás. El test `test/format-isolation.test.js` no lo detectaría (comprueba imports **directos** de los ficheros bajo `src/cli/dashboard/`), así que el invariante se erosionaría en silencio. Arrastraría además `withFileLock` y `resolveProjectId` a un módulo que solo tiene que contar líneas.
  - Contar no requiere parsear: el único campo que importa es el checkbox, que es semántica de **markdown estándar**, no una invención de kodo. No es «un segundo parser del formato»: es leer el bit más estable del contrato.
- **D-18 (anti-drift — la contrapartida obligatoria de D-17):** un test ancla los **dos** lectores entre sí: sobre el **mismo fixture**, el conteo del leaf debe ser **exactamente igual** a `listCaptures(...).captures.filter(c => c.open).length`. El fixture incluye el de regresión de 1500 capturas de `83-05` y líneas hand-editadas que no parsean. Sin este test, D-17 sería duplicación con riesgo de deriva; con él, la deriva es un fallo de suite.
- **D-19:** el leaf resuelve el path **perezosamente**, `join(homedir(), '.kodo', 'inbox.md')`, replicando `defaultInboxPaths` (`src/inbox/store.js:141`) sin importarlo. No hay override por env de `KODO_DIR` en el repo (`src/config.js:11`), así que ambos resuelven al mismo fichero y un test que fije `HOME` antes de **invocar** obtiene su sandbox.
- **D-20:** **never-throws de cuerpo entero**: fichero ausente, ilegible, permisos, binario → **0**. Nunca un banner de error, nunca un throw. Un inbox que no se puede leer es indistinguible de un inbox vacío **a efectos de presión de triage** — y el dashboard no es el sitio para diagnosticar el filesystem.
- **D-21:** **cadencia por piggyback** sobre el tick de poll que ya existe (`usePoll`, base 2500 ms). Cero timers nuevos, cero cambios en el scheduler. Es lo que ya hacen `plan.js` / `progress.js` / `enrich.js`: lectura síncrona de disco enganchada al ciclo de render.
- **D-22:** se pinta en la **cabecera de `SessionTable`**, junto al indicador de conexión (`● live` / `⚠ server caído`) — la zona de estado ambient ya establecida (`src/cli/dashboard/SessionTable.js:131-161`). No en el keybar del pie, que ya lleva 12 teclas y es la zona de acciones, no de estado.
- **D-23:** **el conteo se oculta cuando es 0.** Precedente estructural directo: `anyGsd` / `anyProgress` / `anyNext` hacen desaparecer su columna cuando no hay nada que enseñar. Un `0 sin enrutar` permanente es ruido que enseña al ojo a ignorar la zona — exactamente lo contrario de la presión ambient que CAPT-07 busca.
- **D-24:** **cero teclas nuevas.** El dashboard no gana atajo para abrir/triar el inbox. CAPT-07 pide un **conteo**, no navegación; el triage vive en `kodo inbox`. (Registrado en `<deferred>`.)

---

### Claude's Discretion

Nombre y ubicación exactos de la constante del registro de skills (`KODO_SKILLS`) · orden de las skills en el registro y en el render · copy exacta del render human por skill y del conteo ambient (p. ej. `3 sin enrutar` vs `inbox 3`) · color del conteo (dentro de la paleta acotada del TUI) · marcador exacto del bloque cercado del `SKILL.md` que el golden extrae · redacción completa del prompt de `kodo-capture` (salvo la invocación canónica de D-11, que es contrato) · nombre exacto del fichero del leaf y de sus exports · N y forma de los fixtures del test anti-drift D-18 · si el bucle de sync corre secuencial (recomendado por simplicidad y determinismo del render).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Alcance y requisitos
- `.planning/ROADMAP.md` §Phase 84 — goal + los 3 criterios de éxito (crit 1 es el que obliga al golden test skill↔CLI).
- `.planning/REQUIREMENTS.md` §Inbox de capturas (CAPT) — CAPT-02/05/07 literales; §Out of Scope — las exclusiones vigentes; §v2 — CAPT-F1/F2 diferidos.
- `.planning/STATE.md` §Critical Invariants — lock del inbox, cero endpoints nuevos, cero deps, color isolation, `--json` byte-determinista; §Accumulated Context — el log de decisiones 83-01..83-07.

### Contratos que Phase 83 congeló y esta fase CONSUME
- `.planning/phases/83-inbox-foundation-captura-triage/83-CONTEXT.md` — **lectura obligatoria completa.** D-05 (formato de línea), D-06 (ID), D-07 (fecha local), D-08 (parseo anclado a cola), D-16 (`--origin`, creado explícitamente para esta fase), D-18 (reader never-throws).
- `src/inbox/store.js` — `encodeLine` / `parseLine` / `listCaptures` / `defaultInboxPaths` (`:141`) / `deriveTag`. La constante `LINE_RE` (`:126`) es la forma canónica de la línea. **Ojo `:46`** — importa `../cli/format.js` (picocolors transitivo): es la razón de D-17.
- `test/inbox-format-golden.test.js` — el golden de Phase 83 contra el que D-14 compara la línea del skill-path.
- `.planning/phases/83-inbox-foundation-captura-triage/deferred-items.md` — el RMW sobre string UTF-8 (ajeno a esta fase: el conteo no escribe).

### Superficie A — skill sync
- `src/cli/skill-sync.js` — el thin handler a generalizar: `:62-63` los paths hardcodeados, `:67-70` el gate de exit 2 con su mensaje literal, `:85-97` el branch `--json` / human.
- `src/skill/sync.js` — `syncSkill`, per-skill y pura (**D-06: no se toca**). `:67` es el gate `skill.md` que D-07 vuelve case-tolerante.
- `.claude/skills/kodo-orchestrate/skill.md` — la skill canónica actual (minúsculas, ver D-08).
- `.claude/skills/worktree-cleanup/SKILL.md` — la skill del repo que **NO** se distribuye: la razón entera de D-01.
- `src/cli.js:502-517` — el registro commander de `kodo skill sync`.

### Superficie B — la skill de captura
- `src/cli/capture.js` — el writer único. `:113-114` el manejo de `--origin`, `:117` la construcción de la línea, `:145` el render de confirmación.
- `src/cli.js:601-638` — el registro de `kodo capture`, incluido el texto de ayuda del separador `--` (WR-05 de `83-05`) y el flag interno `--origin`.
- `~/.claude/skills/gsd-capture/SKILL.md` — el skill de enrutado. **No se importa ni se invoca** (83 D-09); referencia solo para no confundir las dos superficies.

### Superficie C — conteo ambient
- `src/cli/dashboard/progress.js:1-35` — **el molde exacto de D-17**: leaf puro, síncrono, never-throws, regex constante, solo builtins, con el comentario que explica por qué no importa `src/config.js`.
- `src/cli/dashboard/SessionTable.js:131-161` — `renderConnIndicator`, las tres ramas live/stale/waiting y la cabecera donde entra el conteo (D-22).
- `src/cli/dashboard/App.js:2033-2082` — el render raíz, el paso de props a `SessionTable` y los flags estructurales `anyGsd`/`anyProgress`/`anyNext` (el precedente de D-23).
- `src/cli/dashboard/usePoll.js:1-45` — el scheduler del tick al que D-21 hace piggyback (single-flight, backoff, teardown). **No se modifica.**
- `test/format-isolation.test.js:200-218` — el guard de color del dashboard: comprueba imports **directos**, no transitivos (por eso D-17 no puede delegar en el test).

### Convenciones
- `.planning/codebase/CONVENTIONS.md` — `// @ts-check` + JSDoc en todo export, kebab-case, imports con extensión `.js`, prefijos `[kodo:*]`, sin barrel files.
- `.planning/codebase/TESTING.md` — disciplina de la suite (2370+ tests verdes al cierre de 83).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `syncSkill` (`src/skill/sync.js`): hace **ya** todo el trabajo real por skill — walk + hash SHA-256 + copia diferencial + reemplazo de symlink legacy + prune opcional. La multi-skill es un bucle en el caller (D-06), no un rediseño.
- `runSkillSyncCli` (`src/cli/skill-sync.js`): molde canónico de thin handler (gate → delegar → render human/JSON → exit code, con DI de `writeFn`/`errFn`/`formatterFn`/`cleanupFn`). Se **extiende**, no se reescribe.
- `runCaptureCli` (`src/cli/capture.js`): el writer único que la skill shellea. Su DI de `idFn`/`clockFn` es lo que hace determinista el golden de D-14.
- `listCaptures` (`src/inbox/store.js:430`): ya es un reader never-throws; es el **oráculo** del test anti-drift D-18 (no la dependencia del leaf — ver D-17).
- `progress.js` / `plan.js` / `enrich.js` (`src/cli/dashboard/`): tres leafs de filesystem ya en producción dentro del proceso del TUI. El precedente que hace de CAPT-07 un patrón conocido y no una excepción.

### Established Patterns
- **Thin CLI handler + lógica pura aparte** (`src/cli/skill-sync.js` → `src/skill/sync.js`): la generalización respeta la frontera.
- **Leaf never-throws con regex CONSTANTE** (anti-ReDoS; `progress.js`, `plan.js:131`, `store.js:126`): jamás se compila un regex desde input externo.
- **Flags estructurales que colapsan la UI** (`anyGsd`/`anyProgress`/`anyNext`): la columna desaparece cuando no hay nada que enseñar → D-23.
- **Resolución perezosa de paths HOME-relative**: nunca constante de módulo (lección de `83-01`).
- **`--json` aditivo y byte-determinista** (DX-06): las claves nuevas no desplazan a las existentes → D-04.

### Integration Points
- `src/cli/skill-sync.js`: **único** fichero que cambia para CAPT-05. `src/skill/sync.js` y su suite quedan intactos (D-06). El registro commander de `src/cli.js:502-517` solo necesita retoque si cambia el texto de `.description()`.
- `.claude/skills/kodo-capture/SKILL.md`: fichero nuevo. Al entrar en la allowlist de D-01 empieza a distribuirse en la siguiente `kodo skill sync`.
- `src/cli/dashboard/inbox-count.js`: fichero nuevo (leaf). Se consume desde `App.js` (estado + prop) y se pinta en `SessionTable.js` (cabecera). `usePoll.js` **no se toca**.
- `src/server.js`: **no se toca** (invariante cero endpoints nuevos, criterio 3 literal de CAPT-07).
- `src/inbox/store.js`: **no se toca** — el formato está congelado y esta fase solo lo consume.

</code_context>

<specifics>
## Specific Ideas

- **La byte-identidad de CAPT-02 no se «logra», se hereda.** Si la skill construyera la línea, habría que probar que la construye igual; como solo shellea, la única superficie que puede desviarse es **la cadena de comando escrita en el markdown** — y eso es precisamente lo que D-14 pone bajo test. Una revisión de esta fase debe poder señalar el test que se pone rojo si alguien edita esa línea del `SKILL.md`.
- **`worktree-cleanup` es la prueba viva de por qué D-01 no es paranoia.** El directorio `.claude/skills/` de este repo ya contiene una skill que no es un producto distribuible. Un glob la publicaría en el `~/.claude/skills/` de todos los operadores en la siguiente sync, sin que nadie lo hubiera decidido.
- **D-17 + D-18 van juntos o no van.** Aislar el leaf del store sin anclar los dos lectores con un test sería cambiar un riesgo de acoplamiento por un riesgo de deriva silenciosa. La pareja es la decisión; ninguna de las dos mitades se puede dejar caer en planning.
- El conteo es **presión de triage**, no telemetría: por eso desaparece en 0 (D-23) y por eso un inbox ilegible cuenta 0 en vez de gritar (D-20).

</specifics>

<deferred>
## Deferred Ideas

- **Renombrar `kodo-orchestrate/skill.md` → `SKILL.md`** para unificar con la convención de Claude Code (D-08). Cambia el path de distribución: dejaría un huérfano en `~/.claude/skills/kodo-orchestrate/` de cada operador salvo que corra `--prune`. Trigger natural: la próxima vez que se toque el contenido de esa skill por otra razón, o un barrido de deuda con `--prune` documentado.
- **Tecla en el dashboard para abrir/triar el inbox** (D-24). CAPT-07 pide conteo, no navegación. Trigger: que el conteo demuestre generar la presión y el operador pida el atajo.
- **Vincular una captura a una tarea** (`task_ref` en la línea, D-13). Exige abrir el formato congelado y romper el golden. Trigger: un caso de uso real que la derivación por proyecto no cubra.
- **CAPT-F1** — filtros `--project` / `--open` en `kodo inbox`: v2, «solo cuando el inbox tenga volumen real».
- **CAPT-F2** — archival/rotación del inbox: v2, «solo si el fichero crece hasta molestar».
- **Barrido del drenaje de stdout a los comandos no-inbox** (`polling`/`daemon`/`gsd`/`sidebar`/`skill`): deuda registrada en `83-05`, con payloads hoy muy por debajo de 64 KB. **Nota para el planner:** si el payload `--json` de `skill sync` creciera con `skills[]` (D-04), sigue siendo de decenas de bytes — no alcanza el umbral y **no** justifica abrir ese barrido aquí.
- **R-82-01** — carrera de 2º orden en `stealLock` con holder VIVO: ajena por construcción (esta fase no toca `src/gsd/lock.js` ni escribe en el inbox).
- **RMW del inbox sobre string UTF-8** (`83/deferred-items.md`): ajeno — el conteo de CAPT-07 solo lee.

</deferred>

---

*Phase: 84-Superficies de captura — skill, sync, conteo ambient*
*Context gathered: 2026-07-26*
