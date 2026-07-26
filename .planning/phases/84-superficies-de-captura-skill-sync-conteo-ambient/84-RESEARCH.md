# Phase 84: Superficies de captura — skill, sync, conteo ambient - Research

**Researched:** 2026-07-26
**Domain:** Distribución de skills de Claude Code · verificación de contratos escritos en markdown · leafs de filesystem dentro de un TUI ink
**Confidence:** HIGH (todo lo estructural verificado con sonda ejecutada en esta sesión sobre el propio repo; el formato `SKILL.md` citado de los docs oficiales)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Decisiones heredadas (LOCKED — no re-discutir)**

- **Cero deps npm nuevas** · **cero endpoints nuevos en `src/server.js`** · **color isolation** (`picocolors` solo desde `src/cli/format.js`) · **`--json` byte-determinista** (DX-06) · **TUI never-throws** · **exit codes deterministas 0/1/2**.
- **El formato de línea del inbox es un contrato inter-fase ya fijado.** `encodeLine`/`parseLine` (`src/inbox/store.js`) son la SoSoT; el golden vive en `test/inbox-format-golden.test.js`. Esta fase lo **consume**, no lo modifica.
- **Los paths del inbox se resuelven PEREZOSAMENTE**, jamás como constante de módulo (`83-01`: la fuga de `homedir()` en el cuerpo de `config.js:11` contamina los tests). Todo lector nuevo repite esa disciplina.
- **El seam de enrutado es documental** (83 D-09): kodo no invoca `gsd-capture`. Esta fase no lo cambia.

**A. Registro multi-skill de `kodo skill sync` (CAPT-05)**

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
- **D-08:** `kodo-capture` se escribe con **`SKILL.md`** (convención de Claude Code, precedente de `worktree-cleanup` en este mismo repo). **`kodo-orchestrate/skill.md` NO se renombra en esta fase** — un rename cambia el path de distribución y dejaría un fichero huérfano en `~/.claude/skills/kodo-orchestrate/` de todos los operadores salvo que corran `--prune`. Queda como deuda registrada.

**B. La skill `/kodo-capture` (CAPT-02)**

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

**C. Conteo ambient en el dashboard (CAPT-07)**

- **D-16:** se cuentan las capturas **abiertas** — las líneas `- [ ] `. «Sin enrutar» y «abierta» son el mismo conjunto: `enrutada` y `descartada` cierran ambas el checkbox (83 D-05). Una descartada **no** cuenta: ya fue triada.
- **D-17 (LOCKED):** el contador es un **leaf propio** en `src/cli/dashboard/inbox-count.js` que importa **solo `node:fs` / `node:os` / `node:path`** y usa una **regex CONSTANTE** anclada al prefijo del checkbox. Espejo exacto de la forma de `src/cli/dashboard/progress.js` (leaf puro, síncrono, never-throws, sin acoplar el leaf a la I/O de otros módulos).
  - *Descartada — importar `listCaptures` de `src/inbox/store.js`*: sería la opción obvia (cero duplicación del formato), pero `store.js:46` importa `stripForKeystroke` de `../cli/format.js`, **que importa picocolors**. Un leaf del dashboard que importe el store mete el paquete de color en el grafo del TUI por la puerta de atrás. El test `test/format-isolation.test.js` no lo detectaría (comprueba imports **directos** de los ficheros bajo `src/cli/dashboard/`), así que el invariante se erosionaría en silencio. Arrastraría además `withFileLock` y `resolveProjectId` a un módulo que solo tiene que contar líneas.
  - Contar no requiere parsear: el único campo que importa es el checkbox, que es semántica de **markdown estándar**, no una invención de kodo. No es «un segundo parser del formato»: es leer el bit más estable del contrato.
- **D-18 (anti-drift — la contrapartida obligatoria de D-17):** un test ancla los **dos** lectores entre sí: sobre el **mismo fixture**, el conteo del leaf debe ser **exactamente igual** a `listCaptures(...).captures.filter(c => c.open).length`. El fixture incluye el de regresión de 1500 capturas de `83-05` y líneas hand-editadas que no parsean. Sin este test, D-17 sería duplicación con riesgo de deriva; con él, la deriva es un fallo de suite.
- **D-19:** el leaf resuelve el path **perezosamente**, `join(homedir(), '.kodo', 'inbox.md')`, replicando `defaultInboxPaths` (`src/inbox/store.js:141`) sin importarlo. No hay override por env de `KODO_DIR` en el repo (`src/config.js:11`), así que ambos resuelven al mismo fichero y un test que fije `HOME` antes de **invocar** obtiene su sandbox.
- **D-20:** **never-throws de cuerpo entero**: fichero ausente, ilegible, permisos, binario → **0**. Nunca un banner de error, nunca un throw. Un inbox que no se puede leer es indistinguible de un inbox vacío **a efectos de presión de triage** — y el dashboard no es el sitio para diagnosticar el filesystem.
- **D-21:** **cadencia por piggyback** sobre el tick de poll que ya existe (`usePoll`, base 2500 ms). Cero timers nuevos, cero cambios en el scheduler. Es lo que ya hacen `plan.js` / `progress.js` / `enrich.js`: lectura síncrona de disco enganchada al ciclo de render.
- **D-22:** se pinta en la **cabecera de `SessionTable`**, junto al indicador de conexión (`● live` / `⚠ server caído`) — la zona de estado ambient ya establecida (`src/cli/dashboard/SessionTable.js:131-161`). No en el keybar del pie, que ya lleva 12 teclas y es la zona de acciones, no de estado.
- **D-23:** **el conteo se oculta cuando es 0.** Precedente estructural directo: `anyGsd` / `anyProgress` / `anyNext` hacen desaparecer su columna cuando no hay nada que enseñar. Un `0 sin enrutar` permanente es ruido que enseña al ojo a ignorar la zona — exactamente lo contrario de la presión ambient que CAPT-07 busca.
- **D-24:** **cero teclas nuevas.** El dashboard no gana atajo para abrir/triar el inbox. CAPT-07 pide un **conteo**, no navegación; el triage vive en `kodo inbox`.

### Claude's Discretion

Nombre y ubicación exactos de la constante del registro de skills (`KODO_SKILLS`) · orden de las skills en el registro y en el render · copy exacta del render human por skill y del conteo ambient (p. ej. `3 sin enrutar` vs `inbox 3`) · color del conteo (dentro de la paleta acotada del TUI) · marcador exacto del bloque cercado del `SKILL.md` que el golden extrae · redacción completa del prompt de `kodo-capture` (salvo la invocación canónica de D-11, que es contrato) · nombre exacto del fichero del leaf y de sus exports · N y forma de los fixtures del test anti-drift D-18 · si el bucle de sync corre secuencial (recomendado por simplicidad y determinismo del render).

### Deferred Ideas (OUT OF SCOPE)

- **Renombrar `kodo-orchestrate/skill.md` → `SKILL.md`** para unificar con la convención de Claude Code (D-08). Cambia el path de distribución: dejaría un huérfano en `~/.claude/skills/kodo-orchestrate/` de cada operador salvo que corra `--prune`. Trigger natural: la próxima vez que se toque el contenido de esa skill por otra razón, o un barrido de deuda con `--prune` documentado.
- **Tecla en el dashboard para abrir/triar el inbox** (D-24). CAPT-07 pide conteo, no navegación. Trigger: que el conteo demuestre generar la presión y el operador pida el atajo.
- **Vincular una captura a una tarea** (`task_ref` en la línea, D-13). Exige abrir el formato congelado y romper el golden. Trigger: un caso de uso real que la derivación por proyecto no cubra.
- **CAPT-F1** — filtros `--project` / `--open` en `kodo inbox`: v2, «solo cuando el inbox tenga volumen real».
- **CAPT-F2** — archival/rotación del inbox: v2, «solo si el fichero crece hasta molestar».
- **Barrido del drenaje de stdout a los comandos no-inbox** (`polling`/`daemon`/`gsd`/`sidebar`/`skill`): deuda registrada en `83-05`, con payloads hoy muy por debajo de 64 KB. **Nota para el planner:** si el payload `--json` de `skill sync` creciera con `skills[]` (D-04), sigue siendo de decenas de bytes — no alcanza el umbral y **no** justifica abrir ese barrido aquí.
- **R-82-01** — carrera de 2º orden en `stealLock` con holder VIVO: ajena por construcción (esta fase no toca `src/gsd/lock.js` ni escribe en el inbox).
- **RMW del inbox sobre string UTF-8** (`83/deferred-items.md`): ajeno — el conteo de CAPT-07 solo lee.

</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Descripción | Soporte de esta investigación |
|----|-------------|-------------------------------|
| **CAPT-02** | `/kodo-capture` captura mid-session desde Claude Code con formato byte-idéntico al CLI — el skill deriva proyecto/tarea del contexto de sesión de forma determinista y shellea a `kodo capture` (un solo writer; jamás escribe el fichero directamente) | §Pattern 2 (forma del `SKILL.md` loadable + contrato del frontmatter, `[CITED]`) · §Pattern 3 (mecanismo de extracción + ejecución de D-14, con las dos vías medidas) · §Pitfall 3 (quoting de `$ARGUMENTS`) · §Pitfall 4 (`--` load-bearing, **probado**: exit 1 sin él) · §Code Example 3 |
| **CAPT-05** | `kodo skill sync` distribuye también el skill `kodo-capture` (generalización multi-skill del mecanismo hoy single-skill de `kodo-orchestrate`) | §Pattern 1 (las líneas exactas que cambian en `src/cli/skill-sync.js`) · §Pitfall 1 (**6 tests existentes se ponen rojos**; inventario nominal) · §Pitfall 2 (los otros tres consumidores hardcodeados de `kodo-orchestrate` que NO se generalizan) · §Pitfall 5 (ceguera de case en macOS, **probada**) |
| **CAPT-07** | El operador ve el conteo de capturas sin enrutar como superficie ambient (dashboard TUI, reader leaf never-throws sobre `~/.kodo/inbox.md`, cero endpoints nuevos) | §Pattern 4 (el molde real del leaf: `tasks.js`, no `progress.js`) · §**Pitfall 6 — el hallazgo central: la regex de prefijo de D-17 rompe D-18, medido 7 vs 2** · §Pitfall 7 (el leaf corre por RENDER, no por tick; coste medido) · §Pitfall 8 (los tests de dashboard corren contra el HOME real) · §Code Example 4/5 |

</phase_requirements>

---

## Summary

Esta fase no inventa nada: monta **tres superficies delgadas sobre contratos que Phase 83 ya congeló**. El writer único ya existe y ya acepta `--origin skill` (verificado end-to-end en esta sesión: `kodo capture --origin skill -- "-3 % de conversión"` produce `- [ ] xrf2kw · -3 % de conversion · kodo · 2026-07-26 · skill`). El mecanismo de sync per-skill ya existe y es puro. El molde de leaf de filesystem dentro del TUI ya existe por triplicado. El trabajo real es **de cableado y de verificación**, no de diseño.

Dicho eso, la investigación ha encontrado **dos landmines que el planner tiene que planificar explícitamente**, y ninguno de los dos es visible leyendo solo el CONTEXT:

1. **La regex que D-17 describe en prosa («anclada al prefijo del checkbox») hace FALLAR el test anti-drift que D-18 exige.** Medido sobre un fixture de 12 líneas con hand-edits realistas: la regex de prefijo cuenta **7**, el oráculo `listCaptures(...).filter(open)` cuenta **2**. Un `- [ ] comprar leche` escrito a mano —el hand-edit más probable en un fichero que el proyecto declara human-editable por diseño— es suficiente para desalinear los dos lectores. La resolución no es descartar D-17 ni D-18: es que la regex constante del leaf sea la **especialización a línea-abierta de `LINE_RE`**, no un prefijo. Con esa regex, medido: **2 vs 2**. Ver §Pitfall 6.
2. **Generalizar el bucle de `skill sync` pone rojos 6 tests existentes de `test/skill-sync.test.js`** —no por un fallo de diseño, sino porque su `makeFixture()` solo siembra `kodo-orchestrate` y su assert de `--json` está anclado con `^…$`. Cada uno tiene un fix mecánico, pero si el plan no los enumera, el ejecutor los descubre uno a uno en rojo. Ver §Pitfall 1, con el inventario nominal.

Además, tres precisiones sobre D-14 que cambian cómo se planifica el golden: (a) la vía **in-process** es determinista pero exige que el test parsee la cadena de comando, y un parser laxo del test dejaría pasar una edición que rompe el contrato; (b) la vía **child-process** ejercita el commander real —es la única que demuestra que `--` es load-bearing— pero no admite inyección de reloj/ID; (c) por eso la aserción de verdad no es «la línea sale igual», sino **`deepEqual(argvExtraídoDelMarkdown, argvCongelado)`**, con la ejecución como prueba de que ese argv efectivamente funciona. Las tres piezas caben en un solo test y se refuerzan. Ver §Pattern 3.

**Primary recommendation:** planificar 3 planes independientes (uno por superficie, sin dependencia entre ellos salvo el orden de commit), y **dentro del plan de CAPT-07 poner el test anti-drift D-18 en Wave 0** — porque es el test que dicta cuál regex es admisible, y escribir el leaf antes que su oráculo es escribir la regex equivocada.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Captura mid-session (`/kodo-capture`) | **Prompt / Agente** (`.claude/skills/kodo-capture/SKILL.md`) | CLI (`kodo capture`) | El markdown es un prompt para el modelo; la ESCRITURA la hace el CLI. D-10: un solo writer. |
| Derivación del tag-proyecto | **Lógica pura** (`src/inbox/store.js` → `deriveTag`) | — | Ya existe y es determinista. La skill hereda el cwd; no decide nada (D-12). |
| Verificación de la byte-identidad | **Test** (`test/…golden…`) | Prompt (el markdown es el sujeto) | Un `SKILL.md` no se puede unit-testear ejecutando un LLM; lo testeable es la cadena de comando que contiene (D-14). |
| Registro de skills distribuibles | **Thin CLI handler** (`src/cli/skill-sync.js`) | — | D-06 congela `syncSkill`. El registro y el bucle viven en el caller. |
| Copia diferencial por hash | **Lógica pura** (`src/skill/sync.js`) | — | Ya existe, per-skill y pura. NO se toca. |
| Lectura del conteo de capturas | **Dashboard leaf** (`src/cli/dashboard/inbox-count.js`) | — | Leaf de filesystem síncrono y never-throws. NO el store (arrastra picocolors, §Pitfall 9). |
| Cadencia del conteo | **Render de `App.js`** | `usePoll` (ya existente) | Piggyback: el leaf se invoca en el cuerpo del render, que el tick de poll re-dispara (D-21). `usePoll.js` **no se toca**. |
| Presentación del conteo | **`SessionTable.js`** (cabecera) | `App.js` (prop) | La cabecera es la zona de estado ambient ya establecida (D-22). |
| Persistencia del inbox | **`src/inbox/store.js`** | — | Congelado por Phase 83. Esta fase **solo lee**. Cero escrituras nuevas. |
| Transporte HTTP | **— (ninguno)** | — | Invariante: cero endpoints nuevos en `src/server.js`. El dato viaja por filesystem. |

---

## Project Constraints (from CLAUDE.md)

**No existe `./CLAUDE.md` ni `./.claude/CLAUDE.md` en este repo** [VERIFIED: `ls` en esta sesión]. Aplican las instrucciones globales del operador (`~/.claude/CLAUDE.md`), de las cuales son accionables aquí:

| Directiva | Aplicación en esta fase |
|-----------|-------------------------|
| **Responder siempre en español** | Este documento, la prosa del `SKILL.md` y los mensajes de usuario del CLI/TUI en español. Identificadores, paths y comandos verbatim. |
| **Regla 2 — simplicidad primero** | Prohibido añadir abstracciones especulativas: el registro es un array literal, no un módulo de registro; el leaf es una función, no una clase. |
| **Regla 3 — cambios quirúrgicos** | `src/skill/sync.js`, `src/cli/dashboard/usePoll.js`, `src/inbox/store.js` y `src/server.js` **no se tocan**. No «mejorar» código adyacente. |
| **Sin coletillas en espacios compartidos** | Los mensajes del render human y del `SKILL.md` se ciñen a contenido accionable. |

Convenciones del repo que el planner debe hacer cumplir (`.planning/codebase/CONVENTIONS.md`) [VERIFIED: leído en esta sesión]:
`// @ts-check` en la primera línea de todo `.js` nuevo · JSDoc en todo export · ficheros kebab-case · imports con extensión `.js` explícita · sin barrel files · constantes de módulo en UPPERCASE · regex **nunca** compiladas desde input externo.

---

## Standard Stack

### Core — cero incorporaciones

| Librería | Versión | Propósito | Por qué es la estándar aquí |
|----------|---------|-----------|------------------------------|
| `node:test` + `node:assert/strict` | Node ≥20 (built-in) | Runner y aserciones | Es el runner del repo; `npm test` = `node --test $(find test -name '*.test.js')` [VERIFIED: `package.json`] |
| `node:fs` | built-in | `readFileSync` del leaf, walker del sync | Invariante cross-milestone: cero deps npm nuevas |
| `node:os` / `node:path` | built-in | `homedir()` perezoso + `join` | Lo único que el leaf puede importar (D-17) |
| `node:child_process` | built-in | `spawnSync` del carril integración de los tests | Ya es el molde de `test/inbox-cli.test.js` y `test/skill-sync.test.js` |
| `ink` | ^6.8.0 (ya instalada) | Render del TUI | El conteo es un `<Text>` más en la cabecera |
| `react` | ^19.2.0 (ya instalada) | Estado del dashboard | — |
| `commander` | ^13.0.0 (ya instalada) | Parseo de argv de `kodo capture` | El `--` que D-11 exige es semántica de commander |
| `picocolors` | ^1.1.1 (ya instalada) | Color del CLI clásico | **Prohibido en el grafo del dashboard** — la razón entera de D-17 |

**Instalación:** ninguna. `npm install` no se ejecuta en esta fase.

**Gate de verificación existente:** `test/inbox-cli.test.js` §*Gate cero-deps* afirma que `package.json` declara **exactamente 4** dependencias de producción [VERIFIED: leído]. Cualquier `npm install` en esta fase pone rojo ese test — la barrera ya está puesta y es automática.

### Alternativas consideradas

| En vez de | Se podría usar | Tradeoff |
|-----------|----------------|----------|
| Leaf propio con regex | `listCaptures` de `src/inbox/store.js` | Cero duplicación, pero mete `picocolors` en el grafo del TUI por vía transitiva **[VERIFIED: cadena probada, §Pitfall 9]**. Descartado por D-17. |
| Bucle secuencial de sync | Bucle con `Promise.all` | `syncSkill` es **síncrono**; no hay nada que paralelizar. El bucle secuencial además hace determinista el orden del render (D-05). |
| Extraer el comando con un parser YAML/markdown | Regex constante sobre un bloque con marcador | El repo prohíbe deps nuevas y ya tiene el patrón «regex constante + marcador estable» en cinco sitios. |

---

## Package Legitimacy Audit

**No aplica: esta fase no instala ningún paquete externo.**

| Package | Registry | Verdict | Disposition |
|---------|----------|---------|-------------|
| *(ninguno)* | — | — | — |

**Paquetes eliminados por veredicto [SLOP]:** ninguno.
**Paquetes marcados como sospechosos [SUS]:** ninguno.

El invariante «cero deps npm nuevas» es cross-milestone y está blindado por un test que cuenta las claves de `package.json.dependencies` y exige exactamente 4 [VERIFIED: `test/inbox-cli.test.js`]. El planner **no debe** añadir tarea alguna de instalación.

---

## Architecture Patterns

### System Architecture Diagram

```
SUPERFICIE A — distribución (CAPT-05)
                                 ┌───────────────────────────────────────┐
  operador ── `kodo skill sync   │  src/cli.js:502-517  (registro        │
     [--prune] [--json]`  ─────► │  commander; SIN ensureConfig)         │
                                 └────────────────┬──────────────────────┘
                                                  ▼
                        ┌─────────────────────────────────────────────────┐
                        │ src/cli/skill-sync.js  runSkillSyncCli()        │
                        │  (1) GATE exit 2 ── ¿existe                     │
                        │      <cwd>/.claude/skills/kodo-orchestrate/     │
                        │      {SKILL.md | skill.md}?  ── NO ─► stderr    │
                        │      literal + return 2   (D-02, D-07)          │
                        │  (2) for (name of KODO_SKILLS)  ◄── D-01/D-03   │
                        │      resiliente: un error NO aborta el bucle    │
                        │  (3) agregar: status/files_changed  (D-04)      │
                        │  (4) render human por skill | --json  (D-05)    │
                        └───────────┬─────────────────────────────────────┘
                                    │ (una llamada por skill; firma INTACTA)
                                    ▼
                        ┌────────────────────────────────────────┐
                        │ src/skill/sync.js  syncSkill()  ◄─ D-06│
                        │  walk → sha256 → copia diferencial     │
                        │  → symlink legacy → prune opcional     │
                        └───────────┬────────────────────────────┘
                                    ▼
                        ~/.claude/skills/{kodo-orchestrate,kodo-capture}/
                                    │
     (otro caller, NO se generaliza)│
   src/orchestrator/launch.js:165 ──┘  auto-sync solo de kodo-orchestrate


SUPERFICIE B — captura mid-session (CAPT-02)
   operador en sesión Claude Code
      │ `/kodo-capture <texto>`
      ▼
   .claude/skills/kodo-capture/SKILL.md   ── (distribuido por la superficie A)
      │  frontmatter: description (+ argument-hint, allowed-tools: Bash(kodo capture *))
      │  cuerpo: UNA sola invocación, en bloque cercado con marcador estable
      ▼
   el MODELO ejecuta vía tool Bash:
      kodo capture --origin skill -- "<texto>"     ◄── D-11 (contrato)
      │                    │        └── protege texto con guion inicial (probado)
      │                    └── vocabulario creado por 83 D-16
      ▼
   src/cli.js:601-638 (commander)  ──►  src/cli/capture.js runCaptureCli()
      │  deriveTag(cwd)  ·  todayLocal()  ·  newCaptureId()
      ▼
   src/inbox/store.js  encodeLine() ──► appendCapture()  [O_APPEND + withFileLock]
      ▼
   ~/.kodo/inbox.md          ◄── EL ÚNICO WRITER (D-10)

   verificación (D-14):
   test ──lee──► SKILL.md ──extrae argv──► deepEqual(argv, ARGV_CONGELADO)
                                      └──► ejecuta ──► línea ──► compara vs golden 83


SUPERFICIE C — conteo ambient (CAPT-07)
   ~/.kodo/inbox.md
      │  readFileSync utf-8 (síncrono, never-throws → 0)
      ▼
   src/cli/dashboard/inbox-count.js   [NUEVO — solo node:fs/os/path]
      │  cuenta líneas que casan la regex CONSTANTE de línea-ABIERTA
      │  (especialización de LINE_RE — ver Pitfall 6)
      ▼
   src/cli/dashboard/App.js  (cuerpo del render; prop inboxCountFn con default real)
      │  se re-evalúa en cada render; el tick de usePoll (2500 ms) es
      │  quien re-dispara el render  ── D-21, cero timers nuevos
      ▼
   prop  inboxOpen: number  ──►  src/cli/dashboard/SessionTable.js:909-914
      │  header = <Box row> LiveIndicator · countsLabel · [conteo] </Box>
      └─ se OMITE cuando es 0  ── D-23 (mismo patrón que anyGsd/anyProgress/anyNext)

   anti-drift (D-18):
   mismo fixture ──► leaf.count  ===  listCaptures(...).captures.filter(open).length

   src/server.js ── NO SE TOCA (cero endpoints nuevos)
   src/cli/dashboard/usePoll.js ── NO SE TOCA
   src/inbox/store.js ── NO SE TOCA
```

### Estructura de ficheros recomendada

```
.claude/skills/
├── kodo-orchestrate/skill.md      # existente — NO se renombra (D-08)
├── kodo-capture/SKILL.md          # NUEVO (D-08, D-09)
└── worktree-cleanup/SKILL.md      # existente — NO se distribuye (la razón de D-01)

src/cli/
├── skill-sync.js                  # ÚNICO fichero de src/ que cambia para CAPT-05
└── dashboard/
    ├── inbox-count.js             # NUEVO leaf (D-17)
    ├── App.js                     # + prop inboxCountFn + prop inboxOpen a SessionTable
    ├── SessionTable.js            # + prop inboxOpen, render en el header (:909-914)
    └── usePoll.js                 # INTACTO

test/
├── skill-sync.test.js             # ACTUALIZAR — 6 asserts se ponen rojos (Pitfall 1)
├── kodo-capture-skill.test.js     # NUEVO — el golden de D-14
└── dashboard-inbox-count.test.js  # NUEVO — leaf + anti-drift D-18 + render header
```

---

### Pattern 1 — Generalización multi-skill del thin handler (CAPT-05)

**Qué:** `runSkillSyncCli` pasa de una invocación a un bucle sobre una allowlist, con agregación. `syncSkill` no se entera.

**Las líneas exactas que cambian en `src/cli/skill-sync.js`** [VERIFIED: fichero leído íntegro en esta sesión]:

| Línea actual | Cambio |
|--------------|--------|
| `:62-63` — `const source = join(cwd, '.claude','skills','kodo-orchestrate')` / `const dest = join(homedir(), …)` | Se mueven **dentro** del bucle, derivados de `name`. |
| `:67-70` — gate exit 2 | **El path del gate sigue anclado a `kodo-orchestrate`** (D-02). Solo cambia el nombre del fichero probado: candidatas `['SKILL.md','skill.md']` en ese orden (D-07). **El literal del `err(...)` de `:68` NO se toca** — está comparado con `assert.equal` byte a byte en `test/skill-sync.test.js:535-538`. |
| `:72-83` — invocación + mapeo de error | Se convierten en el cuerpo del bucle. **Ojo:** hoy un `status:'error'` hace `return 1` inmediato; con D-03 debe **acumular** y seguir. |
| `:85-97` — branch `--json` / human | El payload pasa a llevar `skills:[…]`; `renderHuman` se llama una vez por skill. |

**Qué NO cambia:** `src/skill/sync.js` entero (D-06) · su suite entera · la firma `runSkillSyncCli(opts, deps)` y sus deps DI (`syncFn`/`writeFn`/`errFn`/`formatterFn`/`cwdFn`/`cleanupFn`) · el `try/finally` externo del `cleanupFn` (ADVISORY-02) · `src/cli.js:502-517` salvo, si se quiere, el texto de `.description()`.

**Sutileza de la DI que el planner debe conservar:** `deps.syncFn` se inyecta como **una sola función** en los tests de ordering (`test/skill-sync.test.js:399, 452`). Con el bucle, ese mismo stub se invocará **N veces**. Los tres tests de esa suite sobreviven (asertan código de salida y ordering, no el número de llamadas), pero el planner debe saber que la semántica del stub cambia de «resultado» a «resultado por skill».

**Anti-patrón a evitar:** meter el bucle dentro de `syncSkill` (rompe D-06 y su suite) · hacer que el gate de exit 2 se evalúe por skill (rompe D-02: un repo sin `kodo-capture` seguiría siendo un repo kodo).

---

### Pattern 2 — Un `SKILL.md` que Claude Code carga de verdad (CAPT-02)

Un `SKILL.md` no es prosa: es un artefacto con contrato. Lo relevante de los docs oficiales [CITED: code.claude.com/docs/en/skills]:

- **El comando sale del NOMBRE DEL DIRECTORIO**, no del frontmatter. `.claude/skills/kodo-capture/SKILL.md` → `/kodo-capture` **aunque no haya frontmatter**. En skills personales/de proyecto el campo `name` fija solo la etiqueta que se muestra en el listado.
- **Todos los campos del frontmatter son opcionales; solo `description` es *recomendado*.** Sin `description`, Claude usa el primer párrafo del markdown. Esto explica exactamente lo que se observa hoy: `.claude/skills/kodo-orchestrate/skill.md` **no tiene frontmatter** y aparece en el listado de skills como `kodo-orchestrate: kodo:orchestrate` — su H1 [VERIFIED: `head -40` del fichero + listado de skills de esta sesión].
- `description` + `when_to_use` se **truncan a 1 536 caracteres** en el listado de skills.
- Campos útiles aquí: `argument-hint` (hint de autocompletado; `~/.claude/skills/gsd-capture/SKILL.md` ya lo usa [VERIFIED]), `allowed-tools` (pre-aprueba tools durante el turno de invocación; **no restringe**, solo evita el prompt de permiso), `disable-model-invocation` (si se quisiera que solo el operador la dispare).
- **Sustituciones en el cuerpo:** `$ARGUMENTS` (la cadena completa tal cual se tecleó), `$ARGUMENTS[N]` / `$N` (con quoting estilo shell), `$nombre` (declarado en `arguments:`), `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}`, `${CLAUDE_SESSION_ID}`. **Si `$ARGUMENTS` no aparece en el cuerpo, los argumentos se anexan como `ARGUMENTS: <valor>`.**
- Recomendación oficial: mantener `SKILL.md` por debajo de 500 líneas.

**Recomendación prescriptiva para `kodo-capture/SKILL.md`:**

```yaml
---
name: kodo-capture
description: Captura una idea al inbox global de kodo (~/.kodo/inbox.md) sin salir de la sesión. Úsala cuando el usuario suelte una idea, un pendiente o una nota que no pertenece a la tarea en curso y no quiere perder el hilo. Shellea a `kodo capture`; nunca escribe el fichero.
argument-hint: "<texto de la idea>"
allowed-tools: Bash(kodo capture *)
---
```

`name` es redundante para el comando pero se pone por legibilidad del listado; `description` es lo que hace que Claude la auto-cargue cuando toca; `allowed-tools` con el patrón `Bash(kodo capture *)` evita el prompt de permiso en el turno de invocación, que es justo lo que convierte «capturar mid-session» en algo de fricción cero.

**Anti-patrón:** copiar la forma sin frontmatter de `kodo-orchestrate`. Sin `description`, Claude no sabe **cuándo** cargarla, y CAPT-02 pide captura mid-session — es decir, auto-invocación oportuna, no solo `/kodo-capture` explícito.

---

### Pattern 3 — Cómo se testea un contrato que vive en markdown (D-14)

Esta es la parte con más carga de investigación. Hay **tres aserciones distintas** y solo una es la que de verdad blinda el contrato.

**(i) La aserción de verdad — igualdad de argv contra una lista congelada.**
El `SKILL.md` contiene la invocación en un bloque cercado con marcador. El test la extrae, la tokeniza y compara contra una constante:

```js
const ARGV_CANONICO = Object.freeze(['capture', '--origin', 'skill', '--', PLACEHOLDER]);
assert.deepEqual(argvExtraido, ARGV_CANONICO);
```

Esto es lo que se pone rojo si alguien edita la línea del markdown, que es literalmente lo que D-14 pide. **Es la única aserción que detecta un `--` eliminado sin necesidad de un texto adversarial.**

**(ii) La aserción de unicidad** (corolario explícito de D-14): contar ocurrencias de `kodo capture` en el fichero **entero** y exigir exactamente 1.
⚠ Trampa conocida del repo: `83-01` (deviación 2) y `test/inbox-cli.test.js:1440-1445` documentan que un gate anclado al **nombre suelto** pone roja la suite por la propia documentación que explica la regla. El `SKILL.md` va a contener prosa que menciona `kodo capture`. **El contador debe anclarse al patrón de comando** (p. ej. principio de línea dentro de un bloque cercado, o el marcador), **nunca** a la subcadena `kodo capture` en cualquier posición.

**(iii) La ejecución** — y aquí están las dos vías, con sus consecuencias reales:

| Vía | Determinismo | Fidelidad del parseo | Consecuencia |
|-----|--------------|----------------------|--------------|
| **In-process** `runCaptureCli({text, origin}, {idFn, clockFn, pathsFn, …})` | **Total.** `idFn`/`clockFn`/`pathsFn` son deps ya existentes [VERIFIED: `src/cli/capture.js:55-65`, y `test/inbox-cli.test.js:66-80` ya tiene el helper `fixedDeps`] | **Ninguna.** El test tiene que convertir la cadena en `{text, origin}` él mismo. Un tokenizador laxo del test aceptaría un comando que commander rechaza. | Permite comparar **byte a byte** contra el golden de 83, pero **no demuestra que el argv funcione**. |
| **Child process** `spawnSync(process.execPath, [bin/kodo, ...argv], {env:{HOME: sandbox}})` | **Ninguna.** No hay seam de env para `newCaptureId()` ni `todayLocal()` [VERIFIED: `src/inbox/store.js:168,180` — sin override] | **Total.** Es el commander real. | Es la **única** vía que demuestra que `--` es load-bearing: probado en esta sesión, con `--` → exit 0; sin `--` y texto `-3 % de conversion` → **exit 1**. |

**Recomendación: las tres, en un solo fichero de test, y sin fingir determinismo donde no lo hay.**
- (i) y (ii) son puramente estáticas — cero I/O.
- (iii) child-process con `HOME` sandbox: se ejecuta el argv extraído con un texto conocido, se lee la línea producida, se `parseLine`a y se asserta `origin === 'skill'` + `open === true` + `text === TEXTO`. Se repite con un texto que empieza por guion para que la ausencia de `--` sea un fallo duro.
- (iii-bis) byte-identidad: se re-encodea `encodeLine({...capturaParseada})` y se compara con la línea leída del fichero → round-trip byte-exacto contra el codec de 83. Y se compara la **forma** contra el golden sustituyendo id/fecha por los valores realmente observados (ver §Pitfall 10 sobre el flake de medianoche).
- (iv) opcional, in-process: el mismo argv extraído, mapeado a `runCaptureCli` con `fixedDeps` → línea **completamente** determinista comparable con la constante literal del golden de 83.

**Anti-patrón crítico:** confiar solo en (iii). Si el test solo ejecuta y comprueba que «sale una línea válida», una edición del markdown a `kodo capture --origin cli -- "<texto>"` seguiría pasando el `parseLine` y solo fallaría el assert de `origin` — pero una edición a `kodo capture "<texto>"` (sin `--`, sin `--origin`) con un texto normal **pasaría todo**. La igualdad de argv de (i) es la que no se puede eludir.

---

### Pattern 4 — Leaf de filesystem dentro del TUI (CAPT-07)

D-17 dice «espejo exacto de la forma de `src/cli/dashboard/progress.js`». Correcto en cuanto a *forma* (leaf puro, síncrono, never-throws, regex constante, solo builtins) — pero **el molde más cercano es `src/cli/dashboard/tasks.js`**, porque es el único de los cuatro que resuelve un path **HOME-relative**, que es exactamente lo que D-19 pide [VERIFIED: fichero leído].

```js
// src/cli/dashboard/tasks.js:39-48 — el molde EXACTO de la resolución perezosa
export function readTasks(deps = {}) {
  const readFileFn = deps.readFileFn || ((p) => readFileSync(p, 'utf-8'));
  const kodoDir = deps.kodoDir || join((deps.homedirFn || homedir)(), '.kodo');
  try {
    const state = JSON.parse(readFileFn(join(kodoDir, 'state.json')));
    return state && typeof state.tasks === 'object' && state.tasks !== null ? state.tasks : {};
  } catch {
    return {};
  }
}
```

Tres cosas a copiar literalmente: (a) la tríada de deps `readFileFn` / `kodoDir` / `homedirFn` (permite aislar el HOME **sin** tocar `process.env`, que es el fallo de `83-01`); (b) el `try/catch` que envuelve **todo** el cuerpo; (c) los tres únicos imports: `node:fs`, `node:path`, `node:os`.

De `progress.js` se copia lo otro: la **regex como constante de módulo** con el comentario que justifica por qué no deriva de input externo (anti-ReDoS), y el comentario que explica por qué el módulo **no importa `src/config.js`**.

**Cableado en `App.js`** — el precedente exacto es `readTasksFn` [VERIFIED: `src/cli/dashboard/App.js:506` prop con default real, `:742` invocación en el cuerpo del render]:

```js
// App.js — firma
inboxCountFn = readOpenCaptureCount,          // default real, mismo patrón que readTasksFn
// App.js — cuerpo del render, junto a `const tasks = readTasksFn({})`
const inboxOpen = inboxCountFn({});           // never-throws → 0
// App.js:2033-2082 — paso de props
inboxOpen,
```

**Render en `SessionTable.js:909-914`** — el header ya es un `<Box flexDirection="row">` con dos hijos condicionales; se añade un tercero:

```js
const header = h(
  Box, { flexDirection: 'row' },
  indicator,
  label ? h(Text, null, `   ${label}`) : null,
  inboxOpen > 0 ? h(Text, { color: 'yellow' }, `   ${inboxOpen} sin enrutar`) : null,  // D-23
);
```

Color **solo por nombre ink** (`<Text color>`), jamás picocolors ni ANSI inline — invariante D-12 de Phase 34, blindado automáticamente por el walker de `test/format-isolation.test.js`.

### Anti-Patterns to Avoid

- **Importar `src/inbox/store.js` desde el leaf.** Cadena verificada: `src/inbox/store.js` → `src/cli/format.js` → `picocolors`. El test de aislamiento **no lo detecta** (§Pitfall 9).
- **Resolver `homedir()` en el cuerpo del módulo.** Es el fallo literal de `src/config.js:11` [VERIFIED: leído] que `83-01` documentó. Perezoso siempre.
- **Añadir un `setInterval`/`setTimeout` para el conteo.** D-21: piggyback. `usePoll.js` es el único scheduler y no se toca.
- **Meter el bucle multi-skill en `syncSkill`.** Rompe D-06 y su suite.
- **Gate de exit 2 por skill.** Rompe D-02.
- **Que la skill lea o escriba `inbox.md`.** Rompe D-10 y el invariante del writer único.
- **Anclar el contador de invocaciones del golden a la subcadena `kodo capture`.** La prosa del propio `SKILL.md` la contendrá (trampa ya vivida en `83-01`).

---

## Don't Hand-Roll

| Problema | No construir | Usar en su lugar | Por qué |
|----------|--------------|------------------|---------|
| Copia diferencial de la skill al HOME | Walker + hash propio | `syncSkill` (`src/skill/sync.js`) | Ya hace walk + SHA-256 + copia diferencial + reemplazo de symlink legacy + prune, con 8 escenarios probados. D-06 lo congela. |
| Derivar el tag-proyecto | Lógica en el prompt de la skill | `deriveTag(cwd, projects)` (`src/inbox/store.js:277`) | Ya resuelve nearest-ancestor, proyección de claves UUID (`83-07` Decisión B) y fallback a `basename(cwd)`, todo never-throws. Un LLM decidiendo el tag es una segunda fuente de verdad (D-12). |
| Construir la línea del inbox | `encodeLine` propio en la skill/leaf | Shellear a `kodo capture` (D-10) | La byte-identidad se **hereda** de que exista un solo writer; construirla exigiría probar que se construye igual. |
| Escribir el fichero de forma atómica | `writeFileSync` a pelo | No escribir nada — esta fase **solo lee** | `~/.kodo/inbox.md` tiene lock compartido, `O_APPEND` y guard compare-and-swap. Un escritor nuevo reabre invariantes cerrados en 83. |
| Comprobar el aislamiento de color | Grep manual en el review | `test/format-isolation.test.js` (ya existe) | Cubre automáticamente todo `.js` nuevo bajo `src/cli/dashboard/` — **pero solo imports DIRECTOS** (§Pitfall 9). |
| Parsear el frontmatter del `SKILL.md` | Parser YAML propio | No hace falta: el test de D-14 trabaja sobre el **cuerpo**, no sobre el frontmatter | Cero deps y cero superficie nueva. |
| Sanear el texto capturado | Saneo en la skill | `stripForKeystroke` + el saneo de `store.js` (ya en el writer) | El writer único ya lo hace; la skill no toca el texto. |
| Scheduler del refresco del conteo | Timer nuevo | El tick de `usePoll` que ya re-dispara el render | D-21. |

**Key insight:** en esta fase, *todo* lo que parece «lógica» ya existe y está probado. Lo único genuinamente nuevo es **una regex, un bucle, un fichero markdown y tres tests**. Cualquier plan que produzca más superficie que eso está sobreingenierizando — y el CONTEXT lo dice sin ambages en tres sitios distintos.

---

## Runtime State Inventory

Esta fase no es un rename, pero **sí publica estado fuera del repo** (la sync escribe en el HOME de cada operador). Ese carril merece inventario explícito.

| Categoría | Encontrado | Acción requerida |
|-----------|------------|------------------|
| **Estado publicado en HOME** | `~/.claude/skills/kodo-capture/` empieza a crearse en la primera `kodo skill sync` posterior al merge. Es **creación**, no migración: no existe hoy. | Ninguna migración. Documentar en el release note que la sync ahora distribuye dos skills. |
| **Estado huérfano potencial** | Ninguno **en esta fase**. El huérfano solo aparecería si se renombrara `kodo-orchestrate/skill.md` → `SKILL.md`, que D-08 **difiere explícitamente**. | Ninguna. No renombrar. |
| **Datos almacenados** | `~/.kodo/inbox.md` — esta fase **solo lee**. Cero migraciones de datos, cero reescrituras. | Ninguna. |
| **Config de servicio vivo** | Ninguna. `kodo skill sync` no toca cmux, ni n8n, ni el daemon, ni `state.json`. | Ninguna — verificado por grep de callers. |
| **Estado registrado en el SO** | Ninguno. No hay tareas programadas, launchd ni pm2 implicados. | Ninguna. |
| **Secretos / env vars** | Ninguno. `kodo skill sync` no invoca `ensureConfig()` [VERIFIED: `src/cli.js:512` comentario explícito] y `kodo capture` tampoco [VERIFIED: `src/cli/capture.js:24-26`]. | Ninguna. |
| **Artefactos de build / paquetes instalados** | Ninguno. No hay `files` en `package.json` ni referencias a skills en `packaging/` ni en `homebrew-kodo/` [VERIFIED: grep]. | Ninguna. |
| **Consumidores hardcodeados de `kodo-orchestrate`** | **Tres, fuera de `skill-sync.js`**: `src/orchestrator/launch.js:164-166` (auto-sync en el launch), `src/hooks/stop.js:296,314` (auto-commit de learnings, pathspec `.claude/skills/kodo-orchestrate/`), `src/hooks/stop.js:21` (`SKILL_PATH`, hoy constante **muerta** — declarada y nunca usada). | **Ninguno se generaliza** (§Pitfall 2). Refuerzan D-08: renombrar `skill.md` rompería `stop.js:21` además del path de distribución. |

---

## Common Pitfalls

### Pitfall 1 — El bucle multi-skill pone rojos 6 asserts de `test/skill-sync.test.js` (CAPT-05)

**Qué falla:** `makeFixture()` (`test/skill-sync.test.js:39-55`) siembra **solo** `kodo-orchestrate` en el repo temporal. Con el bucle de D-01, la segunda iteración llama `syncSkill({source: <tmpRepo>/.claude/skills/kodo-capture, …})`, cuyo `existsSync(join(source,'skill.md'))` da false → `{status:'error', error:'source skill not found'}` → agregado `error` → **exit 1**.

**Por qué pasa:** el fixture es sintético y hoy no tiene por qué conocer la segunda skill. Un repo real sí la tendrá.

**Inventario nominal de lo que se rompe** [VERIFIED: fichero leído íntegro; baseline de suite 2556 tests / 0 fail medido en esta sesión]:

| Test | Línea | Assert que se rompe | Fix |
|------|-------|---------------------|-----|
| `SKILL-04 #1: ok (first sync)` | :480 | `status === 0` y `/Synced 2 files? to /` | Sembrar `kodo-capture/SKILL.md` en `makeFixture`; actualizar el copy esperado al render por skill (D-05) |
| `SKILL-04 #2: noop segundo run` | :493 | `status === 0`, `/No drift/` | idem |
| `SKILL-04 #3: fs error` | :502 | `status === 1` (pasa por casualidad, por la razón equivocada) | Sembrar ambas para que el 1 venga del EACCES real |
| `D-04 CLI: legacy symlink` | :544 | `status === 0` | idem #1 |
| `D-06b --json byte-deterministic` | :558 | `/^\{"status":"ok","files_changed":2\}\n$/` — **anclado a los dos extremos**; el `skills:[…]` de D-04 lo rompe por construcción | Nuevo literal con `skills[]`, orden de claves FIJO |
| `D-05 --prune` | :567 | `status === 0`, `/Pruned 1 foreign file/` | idem #1 + agregación de `files_pruned` |

**Sobreviven sin tocar:** las 8 de la Suite 1 (`syncSkill` unit — D-06 lo garantiza), las 2 de `onConsoleWarn` DI, `SKILL-04 #4` (gate exit 2, D-02 lo mantiene idéntico) y las 3 de `cleanupFn ordering` (aunque el `syncFn` stub pase a invocarse N veces).

**Cómo evitarlo:** el plan de CAPT-05 debe llevar la actualización de `makeFixture` como **tarea explícita y previa** al cambio del handler, no como consecuencia descubierta en rojo.

**Señal temprana:** `npm test 2>&1 | grep "skill-sync"` justo después de tocar el bucle, antes de tocar el render.

---

### Pitfall 2 — Generalizar de más: los otros tres consumidores de `kodo-orchestrate`

**Qué va mal:** un ejecutor con celo ve `kodo-orchestrate` hardcodeado en cuatro sitios y «termina el trabajo».

**Los tres que NO se tocan** [VERIFIED: grep sobre `src/`]:

1. **`src/orchestrator/launch.js:164-166`** — auto-sync fail-open en el launch del orquestador. Sincronizar `kodo-capture` aquí sería una decisión de producto que el CONTEXT no toma; y §Integration Points dice literalmente «`src/cli/skill-sync.js`: **único** fichero que cambia para CAPT-05». Ver §Open Question 1.
2. **`src/hooks/stop.js:296,314`** — auto-commit de learnings del orquestador, con pathspec `git add -- .claude/skills/kodo-orchestrate/`. `kodo-capture` **no** es una skill que acumule aprendizaje; ampliar el pathspec metería un fichero de contrato bajo un commit automático, que es exactamente lo que no se quiere para el sujeto del golden de D-14.
3. **`src/hooks/stop.js:21`** — `SKILL_PATH` apunta a `kodo-orchestrate/skill.md` y **no se usa en ninguna parte del fichero** (constante muerta). Refuerza D-08: un rename la dejaría apuntando a la nada.

**Cómo evitarlo:** una nota en el plan y, si se quiere blindaje, un test source-hygiene que asserte que `src/orchestrator/launch.js` y `src/hooks/stop.js` **no** importan la constante del registro `KODO_SKILLS`.

---

### Pitfall 3 — El quoting de `$ARGUMENTS` puede romper el comando

**Qué va mal:** si el cuerpo del `SKILL.md` escribe literalmente `kodo capture --origin skill -- "$ARGUMENTS"`, y el operador teclea `/kodo-capture el "problema" de la conversión`, la sustitución produce `… -- "el "problema" de la conversión"` — el shell hace word-splitting y llegan varios argumentos donde `kodo capture` espera uno.

**Por qué pasa:** `$ARGUMENTS` «se expande siempre a la cadena completa de argumentos tal cual se tecleó» [CITED: code.claude.com/docs/en/skills], sin escapado. Las comillas simples no son alternativa: en español el apóstrofo es frecuente.

**Cómo evitarlo:** el `SKILL.md` no es un script, es un **prompt**. La invocación canónica de D-11 es una **plantilla que el modelo adapta**, y el que hace el escapado correcto al llamar a la tool `Bash` es el modelo. Por eso el cuerpo debe decirlo explícitamente: *«pasa el texto como UN solo argumento, escapando las comillas si las hubiera; los flags van SIEMPRE antes del `--`»*. El test de D-14 verifica **la forma del argv**, no que el escapado sea perfecto en todos los casos — y eso es honesto: la única forma de verificar el escapado sería ejecutar un LLM.

**Señal temprana:** una captura cuyo texto aparece truncado en la primera comilla.

---

### Pitfall 4 — El `--` es load-bearing y su ausencia es silenciosa en el caso feliz

**Qué va mal:** alguien «limpia» la invocación quitando el `--` porque con textos normales funciona igual.

**Evidencia medida en esta sesión** [VERIFIED: sonda con `HOME` sandbox]:

```
kodo capture --origin skill -- "-3 % de conversion"   → exit 0   (línea escrita)
kodo capture --origin skill    "-3 % de conversion"   → exit 1   (commander: opción desconocida)
```

**Cómo evitarlo:** dos capas. (a) La igualdad de argv de §Pattern 3(i) —la única que falla incluso con texto benigno—. (b) Un caso de ejecución con texto que empieza por guion, para que el fallo sea también observable end-to-end. La segunda sin la primera deja el hueco: con texto normal, todo pasa.

---

### Pitfall 5 — macOS oculta la discrepancia `SKILL.md` / `skill.md` (D-07)

**Qué va mal:** el gate de `syncSkill:67` pide `skill.md` en minúsculas. `worktree-cleanup` usa `SKILL.md`. En macOS el filesystem es case-insensitive y nadie lo nota; en Linux (CI, contenedor, operador Linux) es un fallo duro.

**Evidencia medida** [VERIFIED: sonda]: con **solo** `SKILL.md` en disco, `existsSync('<dir>/skill.md')` devuelve `true` y `readdirSync` devuelve `['SKILL.md']`. La discrepancia es literalmente invisible desde `existsSync`.

**Corolario que va más allá de D-07:** los docs de Claude Code documentan el entrypoint **siempre** como `SKILL.md` y no declaran tolerancia de mayúsculas [CITED: code.claude.com/docs/en/skills]. Es plausible —**no verificado**— que `kodo-orchestrate/skill.md` **no cargue como skill en Linux**. Eso no es alcance de esta fase (D-08 difiere el rename), pero conviene registrarlo en `deferred-items.md` como riesgo del ítem diferido, no solo como cosmética.

**Cómo evitarlo:** implementar D-07 como un helper que itere `['SKILL.md','skill.md']` y devuelva el primero existente, usado **tanto en el gate de `runSkillSyncCli` como en el de `syncSkill:67`**. Y añadir un test que cree el fixture con `SKILL.md` y otro con `skill.md` — en macOS ambos pasarán trivialmente, pero el test protege el día que la CI corra en Linux.

---

### Pitfall 6 — ⚠ LA REGEX DE PREFIJO DE D-17 HACE FALLAR EL TEST DE D-18

**Este es el hallazgo central de la investigación.** D-17 describe la regex del leaf como «anclada al prefijo del checkbox» y añade «contar no requiere parsear». D-18 exige que el conteo del leaf sea **exactamente igual** a `listCaptures(...).captures.filter(open).length` sobre un fixture que **debe incluir líneas hand-editadas que no parsean**. **Las dos cosas son incompatibles con una regex de prefijo.**

**Medición ejecutada en esta sesión** [VERIFIED: sonda con `listCaptures` real sobre 12 líneas]:

```
oráculo (listCaptures open) : 2
regex de prefijo /^- \[ \] / : 7   *** DRIFT ***
espejo de LINE_RE            : 2   OK
```

Desglose línea a línea:

| Línea | prefijo | espejo | oráculo |
|-------|:---:|:---:|:---:|
| `- [ ] a3f9k2 · idea buena · kodo · 2026-07-25 · cli` | 1 | 1 | ✔ |
| `- [ ] comprar leche` | **1** | 0 | ✘ |
| `- [ ] TODO: revisar esto mañana` | **1** | 0 | ✘ |
| `- [ ] zz1 · fecha mala · kodo · 26-07-25 · cli` | **1** | 0 | ✘ |
| `- [ ] zz2 · sep en tag · ta·g · 2026-07-25 · cli` | **1** | 0 | ✘ |
| `- [ ]  d1e2f3 · doble espacio · …` | **1** | 0 | ✘ |
| `  - [ ] e1f2g3 · indentada · …` | 0 | 0 | ✔ |
| `- [ ] f1a2b3 · abierta con sufijo · … · cli · enrutada` | 1 | 1 | ✔ |
| `- [x] …` (×2), línea vacía, `# Cabecera` | 0 | 0 | ✔ |

**Por qué importa de verdad:** `- [ ] comprar leche` no es un vector artificial. `~/.kodo/inbox.md` es **human-editable por diseño** (83 D-04, D-19: sin cabecera, lista pura de checklist markdown). Una lista de checklist en markdown es exactamente lo que un humano escribe a mano en ese fichero. La regex de prefijo convierte cualquier checklist ajena en presión de triage falsa — y rompe la suite en cuanto D-18 incluye el fixture que D-18 mismo exige.

**Resolución prescriptiva** (no reabre ninguna decisión: D-17 dice «regex CONSTANTE» y «solo builtins»; ambas se cumplen):

```js
// src/cli/dashboard/inbox-count.js
// Especialización a línea ABIERTA de LINE_RE (src/inbox/store.js:126). NO es un
// segundo parser: es la misma gramática, restringida a `- [ ]`, sin capturas.
// Duplicación DELIBERADA para no arrastrar picocolors al grafo del TUI (D-17);
// la deriva la impide el test anti-drift de D-18, que ancla este contador a
// listCaptures() sobre el mismo fixture.
// CONSTANTE DE MÓDULO, jamás compilada desde input (anti-ReDoS; sonda: 0,082 ms
// sobre 80 KB sin match, sin backtracking catastrófico).
const OPEN_LINE_RE =
  /^- \[ \] [0-9a-z]+ · .+ · [^·]* · \d{4}-\d{2}-\d{2} · [^·]*?(?: · (?:enrutada|descartada)(?: → .*)?)?$/;
```

**Nota sobre la última línea del desglose:** una línea `- [ ]` **con** sufijo de estado (hand-edit incoherente) la cuenta `parseLine` como `open:true`. La regex de arriba también. Es correcto: el checkbox es la autoridad (83, decisión de contrato 2) y ambos lectores coinciden — que es todo lo que D-18 pide.

**Consecuencia de planificación:** **el test anti-drift de D-18 va en Wave 0**, antes de escribir el leaf. Escribir el leaf primero es escribir la regex de prefijo primero.

---

### Pitfall 7 — El leaf corre en cada RENDER, no en cada tick de poll

**Qué va mal:** D-21 dice «piggyback sobre el tick de poll (2500 ms)». El precedente real (`readTasksFn` en `App.js:742`, `readGsdProgress` en `:786`) se invoca en el **cuerpo del render**, y `App` re-renderiza en cada `setState` — incluida **cada pulsación de tecla** manejada por `useInput`. La frecuencia efectiva no es 0,4 Hz: es la del teclado.

**Coste medido** [VERIFIED: sonda, `readFileSync` + conteo con la regex de arriba, media de 20 pasadas]:

| Capturas | Bytes | Media |
|---------:|------:|------:|
| 100 | 9,5 KB | **0,070 ms** |
| 1 500 | 144 KB | **0,425 ms** |
| 50 000 | 4,9 MB | **10,9 ms** |

**Veredicto:** en el rango realista (< 2 000 capturas) el coste es despreciable y **no hay que optimizar nada**. A 50 000 sería perceptible en la latencia de tecleo, pero ese volumen ya está cubierto por CAPT-F2 (rotación, diferida a v2).

**Cómo evitarlo:** no cachear, no memoizar, no añadir un `stat` previo con caché de `mtimeMs` — sería estado dentro de un leaf que el CONTEXT define como puro, a cambio de 0,4 ms. **Documentar la medición en el JSDoc del leaf** para que un futuro «optimizador» sepa que ya se midió.

---

### Pitfall 8 — Los tests de dashboard renderizan `App` contra el HOME REAL

**Qué va mal:** siete ficheros de test hacen `render(createElement(App, …))` inyectando solo `fetchFn` y el clock [VERIFIED: grep — `dashboard-{config,overlay,mask,render,projects,status-line,table}.test.js`]. **No sandboxean `HOME`.** En cuanto el leaf tenga un default real, esos tests leerán el `~/.kodo/inbox.md` del desarrollador que ejecute la suite, y el header pintará su conteo real.

**Por qué hoy no explota:** los asserts son `assert.match(frame, /…/)`, no comparaciones de frame completo [VERIFIED: revisado `dashboard-table.test.js`, `dashboard-status-line.test.js`]. Un texto extra en el header no rompe un `match`. **Pero es un test no hermético**: en una máquina con inbox vacío da un resultado y en otra con capturas abiertas, otro.

**Cómo evitarlo:** exponer `inboxCountFn` como prop de `App` con default real — **exactamente** el patrón de `readTasksFn` (`App.js:504-506`) — y que el fichero de test nuevo lo inyecte siempre. Para los siete existentes, la opción quirúrgica (Regla 3) es no tocarlos: siguen pasando. Si el planner quiere hermeticidad, el cambio mínimo es añadir `inboxCountFn: () => 0` a los helpers `injectProps(...)` de cada uno — una línea por fichero, sin tocar ningún assert.

**Señal temprana:** ejecutar la suite con `~/.kodo/inbox.md` con 3 capturas abiertas y ver si algún frame cambia.

---

### Pitfall 9 — `test/format-isolation.test.js` no ve los imports transitivos

**Qué va mal:** el guard que protege el color del TUI comprueba solo imports **directos**.

```js
// test/format-isolation.test.js:209-220 — VERIFICADO leyendo el fichero
const dashFiles = listJsFiles(SRC).filter((f) => f.includes('/cli/dashboard/'));
const leakers = dashFiles.filter((f) => extractImports(readFileSync(f,'utf-8')).includes('picocolors'));
```

`extractImports` devuelve los specifiers del **propio fichero**. El walker transitivo (`walkImports`, definido en el mismo fichero :35-53) **existe pero se usa para otra suite**, no para esta.

**Cadena verificada en esta sesión** [VERIFIED: sonda con walker propio]:

```
src/inbox/store.js  →  src/cli/format.js  →  picocolors
```

Es decir: un `import { listCaptures } from '../../inbox/store.js'` dentro de `src/cli/dashboard/inbox-count.js` **pasaría el test de aislamiento** y metería picocolors en el grafo del TUI. La justificación de D-17 es literalmente correcta y ahora está probada.

**Cómo evitarlo:** además de no importar el store, considerar (discreción del planner, coste ~10 líneas) **endurecer el guard a transitivo** reutilizando el `walkImports` que ya vive en ese fichero. Sería la contrapartida estructural de D-17: hoy el invariante depende de que nadie escriba el import; con el walker, dependería de la suite. Ver §Open Question 2.

---

### Pitfall 10 — Flake de medianoche en el golden de D-14

**Qué va mal:** si el test calcula la fecha esperada con `todayLocal()` por su cuenta y el proceso hijo la calcula con la suya, una ejecución que cruce las 00:00 locales produce dos fechas distintas → rojo intermitente e irreproducible.

**Por qué pasa:** `todayLocal()` usa el reloj real y no tiene override por env [VERIFIED: `src/inbox/store.js:180`]; la vía child-process no admite `clockFn`.

**Cómo evitarlo:** en la vía child-process, **derivar la fecha esperada de la propia línea producida** (`parseLine(linea).date`) y asertar solo su **forma** (`/^\d{4}-\d{2}-\d{2}$/`); la byte-identidad total se obtiene de la vía in-process con `clockFn` inyectado, que es determinista por construcción. Nunca calcular la fecha dos veces con dos relojes.

---

### Pitfall 11 — Determinismo de bytes del `--json` agregado

**Qué va mal:** D-04 añade `skills:[…]`. `JSON.stringify` respeta el orden de inserción de claves, así que el orden del objeto **es** el contrato — y hoy hay un test anclado con `^…$` que lo demuestra.

**Cómo evitarlo:** construir el payload con orden explícito y fijo, exactamente como hoy (`src/cli/skill-sync.js:88-93`): primero `status`, luego `files_changed`, luego `skills`, y solo después las condicionales `files_pruned` / `symlink_replaced`. Cada entrada de `skills[]` con el mismo orden `{name, status, files_changed}`. El orden del array = el orden de `KODO_SKILLS` (bucle secuencial — la discreción que el CONTEXT recomienda).

---

### Pitfall 12 — El gate de `node:child_process` del inbox

**Qué va mal:** `test/inbox-cli.test.js` tiene un gate source-hygiene que prohíbe importar `node:child_process` en `src/inbox/store.js`, `src/cli/capture.js` y `src/cli/inbox.js` [VERIFIED: leído].

**Por qué es relevante:** el sujeto del gate son esos **tres ficheros de `src/`**. Un fichero de **test** que use `spawnSync` para la vía child-process de D-14 no lo activa. Pero si a alguien se le ocurriera «hacer que la skill sea más robusta» invocando el CLI desde código de `src/`, el gate se pone rojo — y con razón.

---

## Code Examples

### 1. Bucle multi-skill con agregación (D-01, D-03, D-04)

```js
// src/cli/skill-sync.js — sustituye a :62-97. Firma y deps INTACTAS (D-06).

/**
 * Allowlist EXPLÍCITA de skills que kodo distribuye (D-01). NO es un glob de
 * `.claude/skills/*`: ese directorio también contiene skills de trabajo local del repo
 * (`worktree-cleanup`) que kodo NO publica en el HOME de nadie. Añadir una skill a este
 * array es un acto deliberado y revisable en diff.
 * @type {ReadonlyArray<string>}
 */
const KODO_SKILLS = Object.freeze(['kodo-orchestrate', 'kodo-capture']);

/** Skill cuya presencia MARCA que el cwd es un repo kodo (D-02). No es por-skill. */
const IDENTITY_SKILL = 'kodo-orchestrate';

/** Candidatas del entrypoint, en orden de preferencia (D-07). */
const ENTRYPOINTS = Object.freeze(['SKILL.md', 'skill.md']);

/** ¿Existe alguno de los entrypoints bajo `dir`? Tolerante al case (D-07). */
function hasSkillEntry(dir) {
  return ENTRYPOINTS.some((f) => existsSync(join(dir, f)));
}

// --- dentro de runSkillSyncCli, tras resolver cwd ---
if (!hasSkillEntry(join(cwd, '.claude', 'skills', IDENTITY_SKILL))) {
  // ⚠ LITERAL COMPARADO BYTE A BYTE por test/skill-sync.test.js:535-538. NO TOCAR.
  err('Error: not a kodo repository (no .claude/skills/kodo-orchestrate/skill.md found)\n');
  return 2;
}

/** @type {Array<{name:string, result:import('../skill/sync.js').SyncSkillResult, dest:string}>} */
const perSkill = [];
for (const name of KODO_SKILLS) {                       // secuencial: determinismo del render
  const source = join(cwd, '.claude', 'skills', name);
  const dest = join(homedir(), '.claude', 'skills', name);
  /** @type {import('../skill/sync.js').SyncSkillResult} */
  let result;
  try {
    result = syncFn({ source, dest, prune: opts.prune === true });
  } catch (e) {
    // D-03: una skill rota NO aborta el bucle. Se normaliza a `error` y se sigue.
    result = { status: 'error', files_changed: 0, error: /** @type {Error} */ (e).message };
  }
  perSkill.push({ name, result, dest });
}

const anyError = perSkill.some((s) => s.result.status === 'error');
const anyOk = perSkill.some((s) => s.result.status === 'ok');
const filesChanged = perSkill.reduce((n, s) => n + s.result.files_changed, 0);
const status = anyError ? 'error' : anyOk ? 'ok' : 'noop';
```

### 2. Payload `--json` aditivo y byte-determinista (D-04, Pitfall 11)

```js
if (opts.json === true) {
  // ORDEN DE CLAVES = CONTRATO (DX-06). Las de nivel superior son el AGREGADO y
  // conservan su posición para no romper a quien hoy lee .status / .files_changed.
  /** @type {Record<string, any>} */
  const payload = { status, files_changed: filesChanged };
  payload.skills = perSkill.map((s) => ({
    name: s.name,
    status: s.result.status,
    files_changed: s.result.files_changed,
  }));
  if (opts.prune === true) {
    payload.files_pruned = perSkill.reduce((n, s) => n + (s.result.files_pruned ?? 0), 0);
  }
  if (perSkill.some((s) => s.result.symlink_replaced === true)) payload.symlink_replaced = true;
  write(JSON.stringify(payload) + '\n');
} else {
  for (const s of perSkill) {
    if (s.result.status === 'error') {
      err(`Error: filesystem error [${s.name}]: ${s.result.error || 'unknown'}\n`);
      continue;
    }
    renderHuman(s.result, s.dest, write, fmt, s.name);   // D-05: una línea por skill
  }
}
return anyError ? 1 : 0;                                  // D-03: 2 queda para el gate
```

### 3. El golden de D-14 — las tres aserciones

```js
// test/kodo-capture-skill.test.js (NUEVO)
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { parseLine, encodeLine } from '../src/inbox/store.js';
import { runCaptureCli } from '../src/cli/capture.js';

const SKILL_MD = join(REPO, '.claude', 'skills', 'kodo-capture', 'SKILL.md');

/** Marcador estable del bloque cercado que contiene la ÚNICA invocación (discreción D-14). */
const BLOCK_RE = /<!-- kodo:capture:invocacion -->\s*```(?:bash|sh)?\r?\n([\s\S]*?)\r?\n```/;
/** Detector de invocaciones: ANCLADO A PRINCIPIO DE LÍNEA, jamás a la subcadena suelta
 *  (la prosa del SKILL.md menciona `kodo capture` — trampa vivida en 83-01). */
const INVOCATION_RE = /^\s*kodo\s+capture\b/gm;
/** El contrato de D-11, congelado. El placeholder lo sustituye el test. */
const PLACEHOLDER = '$ARGUMENTS';
const ARGV_CANONICO = Object.freeze(['capture', '--origin', 'skill', '--', PLACEHOLDER]);

const md = readFileSync(SKILL_MD, 'utf-8');

// (ii) UNICIDAD — dos comandos = dos caminos = la ambigüedad que D-10 cierra.
it('el SKILL.md contiene EXACTAMENTE una invocación de `kodo capture`', () => {
  assert.equal((md.match(INVOCATION_RE) || []).length, 1);
});

// (i) LA ASERCIÓN DE VERDAD — se pone roja si alguien edita la línea del markdown.
it('la invocación canónica es byte-exacta al contrato D-11', () => {
  const block = BLOCK_RE.exec(md);
  assert.ok(block, 'falta el bloque cercado con el marcador estable');
  const argv = tokenize(block[1].trim());           // tokenizador shell-like del propio test
  assert.equal(argv.shift(), 'kodo');
  assert.deepEqual(argv, ARGV_CANONICO);            // ← el `--` y el `--origin skill` viven aquí
});

// (iv) BYTE-IDENTIDAD determinista — in-process, con reloj e ID inyectados.
it('el skill-path produce la MISMA línea que el CLI-path (golden de Phase 83)', () => {
  const argv = tokenize(BLOCK_RE.exec(md)[1].trim()).slice(1);
  const text = 'el texto de la idea';
  const opts = argvToCaptureOpts(argv, text);       // { text, origin } — mapeo explícito
  const escritas = [];
  const code = runCaptureCli(opts, {
    idFn: () => 'a3f9k2', clockFn: () => '2026-07-25',
    cwdFn: () => '/x/kodo', projectsFn: () => ({}),
    pathsFn: () => ({ inboxPath: '/x/inbox.md', lockPath: '/x/inbox.lock' }),
    appendFn: (line) => (escritas.push(line), { ok: true, coordinated: true }),
    writeFn: () => {}, errFn: () => {},
    formatterFn: () => createFormatter({ isTTY: false }, { NO_COLOR: '1' }),
  });
  assert.equal(code, 0);
  // El golden de 83 con el ÚNICO campo que la fase cambia: origen `skill`.
  assert.equal(
    escritas[0],
    '- [ ] a3f9k2 · el texto de la idea · kodo · 2026-07-25 · skill\n',
  );
});

// (iii) EJECUCIÓN REAL — la única vía que demuestra que `--` es load-bearing.
it('el argv extraído sobrevive al commander real con un texto que empieza por guion', () => {
  const home = mkdtempSync(join(tmpdir(), 'kodo-skill-capture-'));
  const argv = tokenize(BLOCK_RE.exec(md)[1].trim()).slice(1)
    .map((t) => (t === PLACEHOLDER ? '-3 % de conversion' : t));
  const r = spawnSync(process.execPath, [KODO_BIN, ...argv], {
    cwd: REPO, encoding: 'utf-8', timeout: 10_000,
    env: { ...process.env, HOME: home, NO_COLOR: '1' },
  });
  assert.equal(r.status, 0, `stderr: ${r.stderr}`);
  const linea = readFileSync(join(home, '.kodo', 'inbox.md'), 'utf-8').trim();
  const c = parseLine(linea);
  assert.ok(c, 'la línea producida por el skill-path debe parsear con el codec de Phase 83');
  assert.equal(c.origin, 'skill');
  assert.equal(c.open, true);
  assert.equal(c.text, '-3 % de conversion');
  assert.match(c.date, /^\d{4}-\d{2}-\d{2}$/);        // forma, NO valor (Pitfall 10)
  assert.equal(encodeLine(c), linea);                  // round-trip byte-exacto
  rmSync(home, { recursive: true, force: true });
});
```

### 4. El leaf del conteo (D-17, D-19, D-20)

```js
// @ts-check
//
// src/cli/dashboard/inbox-count.js — Phase 84 (CAPT-07; D-16..D-21).
//
// Leaf PURO, síncrono y NEVER-THROWS del conteo de capturas ABIERTAS de
// `~/.kodo/inbox.md`. Molde de la resolución HOME-relative: tasks.js:39-48.
// Molde de la regex constante: progress.js:33-44.
//
// PROHIBIDO importar `src/inbox/store.js`: importa `../cli/format.js`, que importa
// picocolors — metería el paquete de color en el grafo del TUI por vía transitiva, y
// `test/format-isolation.test.js` NO lo detectaría (comprueba imports DIRECTOS).
// PROHIBIDO importar `src/config.js`: evalúa `homedir()` en el cuerpo del módulo
// (config.js:11) y esa fuga contamina los tests.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Especialización a línea ABIERTA de `LINE_RE` (src/inbox/store.js:126). Duplicación
 * DELIBERADA (ver cabecera); la deriva la impide el test anti-drift de D-18, que ancla
 * este contador a `listCaptures()` sobre el mismo fixture.
 *
 * NO basta con el prefijo `- [ ] `: el fichero es human-editable por diseño y un
 * `- [ ] comprar leche` escrito a mano lo contaría como presión de triage falsa
 * (medido: 7 vs 2 sobre el fixture adversarial de D-18).
 *
 * CONSTANTE DE MÓDULO, jamás compilada desde input (anti-ReDoS; sonda: 0,082 ms sobre
 * 80 KB sin match, sin backtracking catastrófico).
 */
const OPEN_LINE_RE =
  /^- \[ \] [0-9a-z]+ · .+ · [^·]* · \d{4}-\d{2}-\d{2} · [^·]*?(?: · (?:enrutada|descartada)(?: → .*)?)?$/;

/**
 * Cuenta las capturas ABIERTAS del inbox. Síncrono, never-throws (D-20): fichero
 * ausente, ilegible, sin permisos o binario → 0. Un inbox que no se puede leer es
 * indistinguible de un inbox vacío A EFECTOS DE PRESIÓN DE TRIAGE.
 *
 * Coste medido (readFileSync + conteo, media de 20 pasadas): 0,070 ms a 100 capturas,
 * 0,425 ms a 1 500, 10,9 ms a 50 000. Se invoca en el cuerpo del render de App.js, es
 * decir en cada re-render (incluida cada pulsación de tecla), no una vez por tick.
 * En el rango realista el coste es despreciable: NO cachear, NO memoizar.
 *
 * @param {{ readFileFn?: (p: string) => string, kodoDir?: string, homedirFn?: () => string }} [deps]
 *   Aíslan el HOME real en tests SIN tocar `process.env` (molde tasks.js:39-41).
 * @returns {number} capturas abiertas, o 0 ante cualquier fallo.
 */
export function readOpenCaptureCount(deps = {}) {
  const readFileFn = deps.readFileFn || ((p) => readFileSync(p, 'utf-8'));
  // PEREZOSO: `homedir()` se evalúa AQUÍ, jamás en el cuerpo del módulo (lección de 83-01).
  const kodoDir = deps.kodoDir || join((deps.homedirFn || homedir)(), '.kodo');
  try {
    const raw = readFileFn(join(kodoDir, 'inbox.md'));
    let n = 0;
    for (const line of raw.split('\n')) if (OPEN_LINE_RE.test(line)) n++;
    return n;
  } catch {
    return 0;
  }
}
```

### 5. El test anti-drift de D-18 (Wave 0 — dicta la regex)

```js
// test/dashboard-inbox-count.test.js — la mitad de D-17 que impide la deriva.
import { listCaptures } from '../src/inbox/store.js';   // el ORÁCULO, no la dependencia
import { readOpenCaptureCount } from '../src/cli/dashboard/inbox-count.js';

/** Fixture ADVERSARIAL: capturas reales + los hand-edits que D-18 exige. */
const FIXTURE = [
  '- [ ] a3f9k2 · idea buena · kodo · 2026-07-25 · cli',
  '- [x] b7c1m0 · ya enrutada · kodo · 2026-07-25 · cli · enrutada → .planning/todos/T-1.md',
  '- [x] c4d8n5 · descartada · kodo · 2026-07-25 · cli · descartada',
  '- [ ] comprar leche',                                  // ← el que rompe la regex de prefijo
  '- [ ] TODO: revisar esto mañana',                      // ←
  '- [ ] zz1 · fecha mala · kodo · 26-07-25 · cli',       // ←
  '- [ ] zz2 · sep en tag · ta·g · 2026-07-25 · cli',     // ←
  '- [ ]  d1e2f3 · doble espacio · kodo · 2026-07-25 · cli', // ←
  '  - [ ] e1f2g3 · indentada · kodo · 2026-07-25 · cli',
  '- [ ] f1a2b3 · abierta con sufijo · kodo · 2026-07-25 · cli · enrutada',
  '', '# Cabecera escrita a mano',
];

it('D-18: leaf y listCaptures coinciden EXACTAMENTE sobre el fixture adversarial', () => {
  const p = seed(FIXTURE.join('\n') + '\n');
  assert.equal(
    readOpenCaptureCount({ kodoDir: dirname(p) }),
    listCaptures({ inboxPath: p }).captures.filter((c) => c.open).length,
  );
});

it('D-18: los dos lectores coinciden sobre el fixture de regresión de 1 500 capturas (83-05)', () => {
  const lines = [];
  for (let i = 0; i < 1500; i++) {
    lines.push(`- [${i % 3 === 0 ? 'x' : ' '}] a${i.toString(36).padStart(5, '0')} · idea ${i} · kodo · 2026-07-25 · cli`);
  }
  const p = seed(lines.join('\n') + '\n');
  assert.equal(
    readOpenCaptureCount({ kodoDir: dirname(p) }),
    listCaptures({ inboxPath: p }).captures.filter((c) => c.open).length,
  );
});

it('D-20 never-throws: fichero ausente / directorio / ilegible / binario → 0', () => {
  assert.equal(readOpenCaptureCount({ kodoDir: '/no/existe/en/ningun/sitio' }), 0);
  assert.equal(readOpenCaptureCount({ readFileFn: () => { throw new Error('EACCES'); } }), 0);
});
```

---

## State of the Art

| Enfoque anterior | Enfoque actual | Cuándo cambió | Impacto en esta fase |
|------------------|----------------|---------------|----------------------|
| Comandos personalizados en `.claude/commands/*.md` | **Fusionados en skills**; `.claude/skills/<name>/SKILL.md` produce el mismo `/<name>` y añade directorio de apoyo, frontmatter de control de invocación y auto-carga por `description` | Documentado como estado actual [CITED: code.claude.com/docs/en/skills] | D-09 elige la forma correcta: `.claude/skills/kodo-capture/SKILL.md`, no `.claude/commands/kodo-capture.md` |
| Frontmatter `name` definía el comando | Para skills personales/de proyecto, **el comando sale del nombre del DIRECTORIO**; `name` es solo la etiqueta de display | Cambio de comportamiento en plugins a partir de v2.1.216 | `kodo-capture` funciona como `/kodo-capture` sin depender del frontmatter; `description` sigue siendo lo que habilita la auto-invocación |
| Sin sustitución de variables en el cuerpo | `$ARGUMENTS`, `$N`, `${CLAUDE_SKILL_DIR}`, `${CLAUDE_PROJECT_DIR}` (este último requiere ≥ v2.1.129 / v2.1.196 según el caso) | Progresivo | Determina el placeholder que el golden de D-14 sustituye (§Pattern 3) |
| Skills siempre inline | `context: fork` ejecuta en subagente; `background`, `agent`, `model`, `effort` | v2.1.218 y anteriores | **No aplicar aquí**: `/kodo-capture` debe correr inline para heredar el cwd de la sesión, que es de lo que depende D-12 |

**Deprecado / desaconsejado para esta fase:**

- **`SKILL.md` sin frontmatter** (la forma actual de `kodo-orchestrate/skill.md`). No está deprecado técnicamente —`description` cae al primer párrafo— pero degrada la auto-invocación. `kodo-capture` no debe copiarla.
- **Entrypoint en minúsculas (`skill.md`).** Los docs documentan `SKILL.md` uniformemente. D-08 ya elige la forma correcta para la skill nueva.

---

## Assumptions Log

| # | Claim | Sección | Riesgo si es falso |
|---|-------|---------|--------------------|
| A1 | Claude Code **no** carga `skill.md` en minúsculas en un filesystem case-sensitive (Linux) | Pitfall 5 | Bajo para esta fase (D-08 no renombra), pero eleva la prioridad del ítem diferido. **No verificado**: no se dispuso de un FS case-sensitive en esta sesión. |
| A2 | `allowed-tools: Bash(kodo capture *)` casa efectivamente la invocación de D-11 y evita el prompt de permiso | Pattern 2 | Si el matching de patrones Bash no cubre la forma con `--`, la skill pedirá permiso en cada captura: degrada la UX de «fricción cero», **no** el contrato. Verificable con una prueba manual en UAT. |
| A3 | El orden de las claves de `JSON.stringify` sobre un objeto literal es el de inserción y es estable entre versiones de Node ≥20 | Pitfall 11 | Bajo: es comportamiento especificado en ECMAScript para claves string no-índice, y el repo ya depende de él en `src/cli/skill-sync.js:88-93` con un test anclado. |
| A4 | La copy propuesta `«N sin enrutar»` es la que el operador quiere | Pattern 4 | Nulo — el CONTEXT lo pone explícitamente bajo «Claude's Discretion». |
| A5 | El auto-sync de `src/orchestrator/launch.js` debe seguir siendo single-skill | Pitfall 2, Open Question 1 | Medio: si la intención era que el orquestador también distribuya `kodo-capture`, quedaría un carril donde `/kodo-capture` no llega al HOME salvo `kodo skill sync` explícita. **Necesita confirmación del operador.** |
| A6 | Ningún consumidor externo (script del operador, CI) parsea hoy el render **human** de `kodo skill sync` | Pattern 1, D-05 | Bajo: el carril scriptable es `--json` por diseño (DX-06), y el CONTEXT autoriza cambiar el render human. |

---

## Open Questions (RESOLVED)

> Las tres quedaron resueltas antes de planificar y sus resoluciones están trazadas en los planes.
> **OQ1 → RESOLVED:** cerrada por **D-08b** en `84-CONTEXT.md` (no se generaliza el auto-sync; el hueco
> se registra en `deferred-items.md` con su trigger) — plan `84-01` Task 3.
> **OQ2 → RESOLVED:** diferida a Phase 85 (fase de saneo); D-17 ya cierra el riesgo concreto por
> construcción, así que endurecer el guard a transitivo no es prerrequisito de nada aquí.
> **OQ3 → RESOLVED:** el pattern-mapping lo verificó — el fixture está **inline**
> (`seedLargeInbox` en `test/inbox-cli.test.js:944-960`), no extraído, así que se regenera en el test
> nuevo — plan `84-03`.

1. **¿Debe `src/orchestrator/launch.js` auto-sincronizar también `kodo-capture`?** — **RESOLVED** (ver arriba)
   - **Lo que sabemos:** `launch.js:164-166` hace un auto-sync fail-open de `kodo-orchestrate` antes del primer side-effect de cmux [VERIFIED]. El CONTEXT §Integration Points dice «`src/cli/skill-sync.js`: **único** fichero que cambia para CAPT-05», lo que excluye tocarlo.
   - **Lo que no está claro:** con el auto-sync intacto, un operador que solo use `kodo orchestrate` (y nunca `kodo skill sync`) nunca recibe `/kodo-capture` en su HOME. Si el `~/.claude/skills/kodo-capture/` no llega, CAPT-02 no se materializa para ese operador.
   - **Recomendación:** **no tocarlo en esta fase** (respeta el boundary literal y la Regla 3) y **registrar el hueco en `deferred-items.md`** como «distribución de `kodo-capture` por el carril de auto-sync del orquestador», con trigger «el primer operador que reporte que `/kodo-capture` no aparece». Si el operador prefiere cerrarlo aquí, es un cambio de ~4 líneas (bucle sobre `KODO_SKILLS` importado) — pero es una decisión suya, no del planner.

2. **¿Endurecer `test/format-isolation.test.js` a imports transitivos?** — **RESOLVED** (ver arriba)
   - **Lo que sabemos:** el guard comprueba solo imports directos; el walker transitivo ya existe en el mismo fichero [VERIFIED].
   - **Lo que no está claro:** endurecerlo podría poner rojos ficheros del dashboard que hoy pasan. No se ha ejecutado la variante transitiva sobre todo `src/cli/dashboard/` para medir el radio.
   - **Recomendación:** **fuera del alcance de esta fase.** D-17 ya cierra el riesgo concreto por construcción. Registrarlo como candidato de deuda para Phase 85 (que ya es la fase de saneo DEBT-05/06/07), donde encaja naturalmente.

3. **¿El fixture de 1 500 capturas de `83-05` es reutilizable tal cual?** — **RESOLVED** (ver arriba)
   - **Lo que sabemos:** D-18 lo nombra explícitamente. `test/inbox-concurrency.test.js` existe y la referencia viene de `83-05`.
   - **Lo que no está claro:** si el fixture está extraído como helper reutilizable o generado inline en ese test.
   - **Recomendación:** el ejecutor lo revisa al escribir el test; si está inline, **generarlo** en el test nuevo (12 líneas, coste cero) en vez de exportarlo desde el otro fichero — el repo no usa barrel files ni helpers cross-test.

---

## Environment Availability

| Dependencia | Requerida por | Disponible | Versión | Fallback |
|-------------|---------------|:---:|---------|----------|
| Node.js ≥ 20 | Todo el repo (`engines`) | ✓ | ejecutado en esta sesión sin warning | — |
| `node --test` | Suite completa | ✓ | 2 556 tests, 2 555 pass, 1 skip, **0 fail** (21,6 s) | — |
| `bin/kodo` ejecutable | Carril integración de D-14 | ✓ | verificado end-to-end con `HOME` sandbox | — |
| `~/.kodo/inbox.md` | Sonda manual del leaf | ✓ | existía vacío; restaurado a vacío tras la sonda | El leaf devuelve 0 si falta (D-20) |
| `.claude/skills/kodo-orchestrate/skill.md` | Gate de exit 2 (D-02) | ✓ | 27 KB, **sin frontmatter** | — |
| `.claude/skills/worktree-cleanup/SKILL.md` | Justificación de D-01 | ✓ | 6,3 KB, **con frontmatter** | — |
| `~/.claude/skills/gsd-capture/SKILL.md` | Referencia de forma | ✓ | frontmatter con `name`/`description`/`argument-hint`/`allowed-tools` | — |
| Filesystem **case-sensitive** | Verificar A1 (Pitfall 5) | ✗ | macOS (case-insensitive) | Test que cubra ambos nombres: pasa trivialmente en macOS, muerde en CI Linux |

**Dependencias ausentes sin fallback:** ninguna.
**Dependencias ausentes con fallback:** solo el FS case-sensitive (A1). El fallback —un test que ejercite ambos entrypoints— es suficiente y barato.

---

## Validation Architecture

### Test Framework

| Propiedad | Valor |
|-----------|-------|
| Framework | `node:test` + `node:assert/strict` (built-in, Node ≥ 20) |
| Fichero de config | **ninguno** (defaults de Node — es la convención del repo) |
| Comando rápido | `node --test test/skill-sync.test.js test/kodo-capture-skill.test.js test/dashboard-inbox-count.test.js` |
| Suite completa | `npm test` → `node --test $(find test -name '*.test.js' -type f)` |
| Baseline medido | **2 556 tests · 2 555 pass · 1 skip · 0 fail · 21,6 s** (esta sesión) |

### Phase Requirements → Test Map

| Req | Comportamiento | Tipo | Comando automatizado | ¿Existe? |
|-----|----------------|------|----------------------|:---:|
| CAPT-05 | El registro distribuye ambas skills | integración | `node --test test/skill-sync.test.js` | ❌ Wave 0 (fixture) |
| CAPT-05 | Resiliencia: una skill rota no impide la otra (D-03) | unit (DI `syncFn`) | idem | ❌ |
| CAPT-05 | Exit code agregado 0/1, gate 2 intacto y **stderr byte-idéntico** (D-02) | integración | idem (`SKILL-04 #4` ya existe — **debe seguir verde sin tocar**) | ✅ existe |
| CAPT-05 | `--json` aditivo, orden de claves fijo (D-04) | integración | idem | ❌ (assert actual se rompe) |
| CAPT-05 | Render human con una línea por skill (D-05) | integración | idem | ❌ |
| CAPT-05 | Gate tolerante a `SKILL.md` / `skill.md` (D-07) | unit | idem | ❌ |
| CAPT-02 | **Exactamente una** invocación en el `SKILL.md` (D-14 corolario) | unit estático | `node --test test/kodo-capture-skill.test.js` | ❌ |
| CAPT-02 | `deepEqual(argvExtraído, ARGV_CANONICO)` (D-11) | unit estático | idem | ❌ |
| CAPT-02 | Byte-identidad vs golden de 83, reloj e ID inyectados (D-14) | unit in-process | idem | ❌ |
| CAPT-02 | El argv sobrevive al commander real con texto de guion inicial | integración `spawnSync` | idem | ❌ |
| CAPT-02 | La skill **no** contiene ninguna escritura a `inbox.md` (D-10) | unit estático (source-hygiene sobre el `.md`) | idem | ❌ |
| CAPT-07 | **Anti-drift leaf ↔ `listCaptures`** sobre fixture adversarial (D-18) | unit | `node --test test/dashboard-inbox-count.test.js` | ❌ **Wave 0** |
| CAPT-07 | Anti-drift sobre el fixture de 1 500 (D-18) | unit | idem | ❌ |
| CAPT-07 | Never-throws: ausente / EACCES / directorio / binario → 0 (D-20) | unit | idem | ❌ |
| CAPT-07 | Resolución perezosa del HOME (D-19) | unit (`kodoDir` inyectado) | idem | ❌ |
| CAPT-07 | El header pinta el conteo cuando > 0 y lo **omite** en 0 (D-22, D-23) | render ink | idem (`ink-testing-library`) | ❌ |
| CAPT-07 | El leaf no importa picocolors ni el store | source-hygiene | `node --test test/format-isolation.test.js` | ✅ automático (cubre todo `.js` nuevo bajo `src/cli/dashboard/`) |
| — | Cero deps npm nuevas | source-hygiene | `node --test test/inbox-cli.test.js` | ✅ existe |

### Sampling Rate

- **Por commit de tarea:** el fichero de test de la superficie tocada (< 3 s).
- **Por merge de wave:** los tres ficheros de la fase + `test/format-isolation.test.js` + `test/inbox-format-golden.test.js`.
- **Gate de fase:** `npm test` completo verde (2 556+ tests) antes de `/gsd-verify-work`. **Regresión cero es el listón**: el baseline medido es 0 fail.

### Wave 0 Gaps

- [ ] **`test/dashboard-inbox-count.test.js` — el test anti-drift de D-18.** ⚠ **Va PRIMERO, antes del leaf.** Es el test que dicta cuál regex es admisible (§Pitfall 6): escribir el leaf antes es escribir la regex equivocada.
- [ ] `test/skill-sync.test.js` — actualizar `makeFixture()` para sembrar **ambas** skills (§Pitfall 1). Va antes de tocar `src/cli/skill-sync.js`.
- [ ] `test/kodo-capture-skill.test.js` — fichero nuevo del golden de D-14. Se escribe **junto** al `SKILL.md`, no después (es el que define el marcador del bloque cercado).
- [ ] Instalación de framework: **ninguna** — `node:test` es built-in.
- [ ] Fixtures compartidos: **ninguno** — el repo no usa `conftest`/helpers cross-test; cada fichero siembra los suyos (convención verificada en `test/skill-sync.test.js:39` y `test/inbox-cli.test.js:66`).

---

## Security Domain

`security_enforcement` no está desactivado en `.planning/config.json` [VERIFIED], así que la sección aplica.

### Applicable ASVS Categories

| Categoría ASVS | Aplica | Control estándar en esta fase |
|----------------|:---:|-------------------------------|
| V2 Autenticación | no | Ninguna superficie de auth. `kodo skill sync` y `kodo capture` no invocan `ensureConfig()` [VERIFIED] |
| V3 Gestión de sesión | no | Sin sesiones HTTP. `src/server.js` no se toca |
| V4 Control de acceso | **parcial** | `kodo skill sync` **escribe en `~/.claude/skills/`**. El único control es la allowlist de D-01: sin ella, un fichero dejado en `.claude/skills/` del repo se publicaría en el HOME de todo operador. **La allowlist ES el control de acceso de esta fase.** |
| V5 Validación de entrada | **sí** | El texto capturado ya pasa por `stripForKeystroke` + neutralización de U+2028/29 + cota de 1 000 chars en el writer único [VERIFIED: `src/inbox/store.js:310-315`]. La skill **no** añade superficie: no sanea, no interpreta, solo shellea |
| V6 Criptografía | no (indirecto) | `syncSkill` usa SHA-256 solo para detección de drift, no como control de seguridad. No se toca |
| V12 Ficheros y recursos | **sí** | El leaf lee un path derivado de `homedir()` con nombre **fijo** — cero componente de path desde input externo. Never-throws ante EACCES/EISDIR (D-20) |
| V14 Configuración | **sí** | Invariantes preservados: cero deps npm nuevas, cero endpoints nuevos |

### Known Threat Patterns

| Patrón | STRIDE | Mitigación estándar | Estado en esta fase |
|--------|--------|---------------------|---------------------|
| **Distribución no intencionada de una skill al HOME del operador** | Elevation of Privilege | Allowlist explícita en código, revisable en diff (D-01) | ✅ Es literalmente el propósito de D-01. `worktree-cleanup` es la prueba viva de que el riesgo es real |
| **Prompt injection vía skill de proyecto** | Tampering | Los docs advierten: `allowed-tools` de una skill de proyecto surte efecto tras aceptar el diálogo de confianza del workspace; **revisar las skills de proyecto antes de confiar en un repo** [CITED: code.claude.com/docs/en/skills] | ⚠ `allowed-tools: Bash(kodo capture *)` es deliberadamente **estrecho**. NUNCA `Bash(*)` |
| **ReDoS por regex derivada de input** | DoS | Regex como constante de módulo, jamás compilada desde contenido de fichero | ✅ Sonda medida: 0,082 ms sobre 80 KB sin match |
| **Inyección de argumentos vía texto de captura** | Tampering | El separador `--` de commander + una sola invocación (D-11, D-14) | ✅ Probado: sin `--`, un texto con guion inicial **aborta** (exit 1) en vez de ser reinterpretado |
| **Path traversal en el destino de la sync** | Tampering | Los nombres salen de una constante `Object.freeze`d, nunca de input | ✅ Por construcción con D-01 |
| **Fuga de contenido del inbox al render del TUI** | Information Disclosure | El conteo es un **entero**; el texto de las capturas nunca entra en el frame | ✅ Por construcción con D-16 |
| **Escritura accidental sobre el inbox del operador durante los tests** | Tampering | `HOME` sandbox por spawn + inyección de `pathsFn`/`kodoDir` en el carril unit | ⚠ **Riesgo real, materializado en esta sesión**: una sonda sin `HOME` sandbox escribió una línea en el `~/.kodo/inbox.md` real (retirada acto seguido). El plan debe exigir que **todo** test nuevo inyecte paths o sandboxee `HOME`, sin excepción — es la disciplina que `test/inbox-cli.test.js:66-80` ya codifica |

---

## Sources

### Primary (HIGH confidence) — verificado con herramienta en esta sesión

- `src/cli/skill-sync.js` (íntegro, 132 líneas) — líneas exactas del gate, del render y del payload
- `src/skill/sync.js` (íntegro, 174 líneas) — gate `skill.md:67`, contrato de retorno
- `src/inbox/store.js` (íntegro, 839 líneas) — `LINE_RE:126`, `defaultInboxPaths:141`, `deriveTag:277`, `listCaptures:430`, import de `format.js:46`
- `src/cli/capture.js` (íntegro) — DI de `idFn`/`clockFn`/`pathsFn`, manejo de `--origin:113-114`
- `src/cli/dashboard/{progress,tasks,usePoll}.js` — moldes del leaf y del scheduler
- `src/cli/dashboard/{App,SessionTable}.js` — `readTasksFn:504-506,742`, `LiveIndicator:144`, header `:909-914`
- `src/cli.js:502-517, 601-638` — registro commander de `skill sync` y `capture`
- `src/orchestrator/launch.js:164-166`, `src/hooks/stop.js:21,296,314` — los tres consumidores hardcodeados
- `test/{skill-sync,inbox-cli,inbox-format-golden,format-isolation,dashboard-status-line,dashboard-table}.test.js`
- `.claude/skills/{kodo-orchestrate/skill.md, worktree-cleanup/SKILL.md}`, `~/.claude/skills/gsd-capture/SKILL.md`
- **Sondas ejecutadas:** (1) cadena transitiva `store.js → format.js → picocolors`; (2) conteo prefijo-vs-espejo-vs-oráculo (7 / 2 / 2); (3) coste del leaf a 100/1 500/50 000 capturas; (4) ReDoS a 80 KB; (5) `--` load-bearing (exit 0 vs exit 1); (6) `existsSync` case-insensitive en macOS; (7) `npm test` completo (2 556 / 0 fail)

### Secondary (MEDIUM confidence) — documentación oficial

- [code.claude.com/docs/en/skills](https://code.claude.com/docs/en/skills) — formato `SKILL.md`, tabla completa de frontmatter, derivación del nombre del comando, sustituciones de cadena, semántica de `allowed-tools`, layout de directorios, advertencia de confianza en skills de proyecto

### Tertiary (LOW confidence)

- Resultados de búsqueda web sobre el formato `SKILL.md` (agensi.io, agentpatterns.ai, allahabadi.dev): **coinciden en lo esencial pero contradicen a los docs oficiales en un punto** — afirman que `name` y `description` son *obligatorios* y que `name` es «el nombre del slash-command». Los docs oficiales dicen lo contrario para skills personales/de proyecto (todos los campos opcionales; el comando sale del directorio) y el comportamiento observado de `kodo-orchestrate/skill.md` **sin frontmatter** confirma la versión oficial. **No usar las fuentes terciarias.**

---

## Metadata

**Desglose de confianza:**

| Área | Nivel | Razón |
|------|-------|-------|
| Superficie A — skill sync | **HIGH** | Los 4 ficheros implicados leídos íntegros; los 6 asserts que se rompen identificados nominalmente con número de línea; suite ejecutada para fijar el baseline |
| Superficie B — la skill | **HIGH** (mecánica) / **MEDIUM** (frontmatter) | El comportamiento de `--` y `--origin skill` probado end-to-end; el contrato del frontmatter viene de los docs oficiales, no de una prueba de carga real de la skill |
| Superficie C — conteo | **HIGH** | Molde localizado; la tensión D-17/D-18 **medida**, no razonada; coste y ReDoS medidos; cadena de picocolors probada |
| Pitfalls | **HIGH** | 8 de 12 respaldados por una sonda ejecutada en esta sesión; los otros 4 por lectura directa del código con número de línea |
| Arquitectura de validación | **HIGH** | Baseline de suite real (2 556 / 0 fail); comandos verificados |
| A1 (case-sensitivity de Claude Code en Linux) | **LOW** | No verificable en macOS. Marcado en el Assumptions Log |

**Fecha de investigación:** 2026-07-26
**Válido hasta:** 2026-08-25 (30 días). El código del repo es estable; lo que se mueve rápido es el formato `SKILL.md` de Claude Code — reverificar §Pattern 2 si la fase se ejecuta más tarde.
