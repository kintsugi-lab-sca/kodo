# Phase 49: Live-progress spike (HARD GATE) - Research

**Researched:** 2026-06-12
**Domain:** Empirical instrumentation of an interactive `claude --worktree` session on the installed Claude Code build — capture surface for live task progress (`N/M`)
**Confidence:** HIGH (all surfaces inspected firsthand on the installed machine; correlation tested against real kodo `state.json`)

> Este documento estructura CÓMO correr la sonda empírica y qué mirar. NO sustituye el veredicto:
> el spike debe observar el comportamiento vivo en primera persona contra la build instalada.
> La evidencia de este research viene de inspección directa del filesystem (`~/.claude`, `~/.kodo`)
> y del código de kodo, NO de inferencia de docs.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Instrumentación empírica de una **sesión interactiva real `claude --worktree`** contra la build instalada, no inferencia de docs. El harness es **throwaway** (cero código de producción como deliverable). La evidencia DEBE venir de la versión instalada en ejecución.
- **D-02:** Evaluar las 3 superficies candidatas en **orden de preferencia fijo**, parando en la primera que satisface las 4 condiciones VIABLE; descender a la siguiente solo ante un fallo demostrado. Registrar evidencia de **cada** superficie intentada (incluidos fallos) para que el veredicto sea auditable:
  1. **Hook events** `TaskCreated`/`TaskCompleted` (`~/.claude/hooks/`) — preferida.
  2. **JSONL transcript watcher** (`~/.claude/projects/<slug>/*.jsonl`).
  3. **`~/.claude/tasks/` reading** — último recurso, frágil. *(Empíricamente: el dir EXISTE con entradas UUID — candidato real, no hipotético.)*
- **D-03:** El deliverable es un doc de veredicto dedicado **`49-SPIKE.md`** en el dir de fase, estructurado: header `claude --version` → matriz de **4 condiciones por superficie** → apéndice de evidencia cruda (payloads de muestra, listados de dir, snippets de transcript) → **VIABLE/INVIABLE** explícito → decisión de gate para Phase 50. Este es el ÚNICO deliverable.
- **D-04:** **INVIABLE es el default esperado.** VIABLE exige las 4 condiciones probadas empíricamente, **sin crédito parcial** — cualquier fallo único → INVIABLE:
  1. la superficie dispara/se lee de hecho en la build 2.1.175 (en sesión interactiva),
  2. payload estable para derivar `N/M`,
  3. correlación determinista `session_id → task_id` (vía el `state.json` de kodo existente),
  4. cero latencia/ruptura de sesión **y** la captura escribe a un artefacto kodo-controlado `~/.kodo/…` (los internos de Claude Code son solo la superficie de LECTURA, nunca la fuente de verdad).
- **D-05:** El artefacto kodo espeja el seam productor↔consumidor del plan ligero de v0.11 (`~/.kodo/plans/<task_id>.md`): escribir/poseerlo vía el patrón `session-start.js` HOOK-02 (golden-bytes preservados), correlacionado por `task_id`, nunca dependiendo de rutas no documentadas de Claude Code como fuente de verdad. Demostrar correlación con **un round-trip real `session_id → task_id`** vía el registro de sesión existente de kodo.

### Claude's Discretion
- Scripting exacto del harness, cuántas sesiones probar para estabilidad, y el filename preciso del artefacto kodo de progreso (`~/.kodo/progress/<task_id>.*` vs alternativa) — researcher/planner deciden. El spike no debe sobre-construir; una sesión instrumentada mínima basta.

### Deferred Ideas (OUT OF SCOPE)
- **PROG-02 (captura + persiste progreso vivo)** — Phase 50, condicional a VIABLE. NO este spike.
- **PROG-03 (display `N/M` por sesión en dashboard)** — Phase 50, condicional a VIABLE. NO este spike.
- **"kodo bidireccional" (sesión cmux → tarea)** — backlog Phase 999.1; los hallazgos de superficie alimentan ese milestone futuro, pero construirlo está fuera de scope aquí.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PROG-01 | Veredicto empírico VIABLE/INVIABLE sobre capturar task-state vivo de una sesión `claude --worktree` interactiva en la build instalada, vía superficie soportada (3 candidatas en orden), con las 4 condiciones VIABLE | Este research provee: (a) el método de sonda concreto por superficie en la build 2.1.175 (Architecture Patterns), (b) la evidencia empírica de partida ya recogida (Surface Evidence Dossier), (c) la prueba de correlación `session_id↔task_id` ya verificada contra `state.json`, (d) el gate de las 4 condiciones operacionalizado (Validation Architecture). El spike ejecuta la sonda en vivo y emite el veredicto. |
</phase_requirements>

## Summary

El spike evalúa si el progreso vivo (`N/M` tareas) de una sesión `claude --worktree` interactiva puede leerse en la build **instalada** (medición empírica: `claude --version` = **2.1.175**, NO 2.1.174 como decía el objetivo — ver Pitfall 0) sin romper la sesión, y persistirse a un artefacto kodo-controlado correlacionado por `task_id`. Tres superficies en orden de preferencia: hooks `TaskCreated`/`TaskCompleted` → transcript JSONL → `~/.claude/tasks/`.

Inspección empírica del filesystem en esta máquina arroja un cuadro matizado que **invierte parcialmente** la suposición previa del proyecto:

1. **Los eventos hook `TaskCreated`/`TaskCompleted` SÍ EXISTEN** en la build actual (confirmado en docs oficiales y en la lista de 30 eventos de lifecycle de 2.1.175). NO están deprecados. PERO están atados a la herramienta **`TaskCreate`** (gestión de tareas de agent-teams), no a `TodoWrite`. El payload no está documentado oficialmente — el spike debe capturarlo en vivo.
2. **El transcript JSONL NO contiene entradas de task/todo.** En 15 transcripts recientes inspeccionados, CERO `tool_use` de `TodoWrite`/`Task`. El transcript registra `Read/Bash/Edit/Write/Agent/Skill/AskUserQuestion` pero las herramientas de task-tracking NO escriben al transcript visible. Surface 2 casi seguro **falla la condición (b)** (derivar N/M).
3. **`~/.claude/tasks/<uuid>/N.json` SÍ permite derivar N/M limpiamente** (`M` = nº de ficheros `N.json`; `N` = los con `status: "completed"`). Verificado: dirs con `M=21 N=21`, `M=3 N=3`, `M=9 N=0 (pending)`. Y el `<uuid>` ES un `session_id` de Claude Code (intersección 58/58 con nombres de transcript). Esto hace la **condición (c) potencialmente resoluble** vía `kodo.session_id → ~/.claude/tasks/<session_id>/`.

**El nudo del spike (riesgo central, condición (a)+(c) acopladas):** el dir `~/.claude/tasks/` solo se crea cuando la sesión usa la herramienta `TaskCreate`/agent-teams (`CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1`). **0 de 23** `session_id` de kodo en el `state.json` actual tienen dir `tasks/`. Pero 12 de 58 dirs `tasks/` SÍ son sesiones de worktree — luego las sesiones de worktree de GSD *pueden* crear tasks dirs cuando `execute-phase` dispara olas de agentes con TaskCreate. **Qué tipo de sesión interactiva de kodo dispara (o no) la superficie es exactamente lo que el spike debe medir en primera persona.**

**Primary recommendation:** Correr el spike contra **una sesión `claude --worktree` real lanzada por kodo que ejecute `/gsd-execute-phase`** (no una sesión quick/idle), porque ese es el flujo que dispara las olas de agentes con `TaskCreate`. Instalar un hook `TaskCreated`/`TaskCompleted` throwaway que vuelque su payload crudo a `/tmp`, y en paralelo observar si `~/.claude/tasks/<session_id>/` se materializa. Probar Surface 1 primero (hook); si su payload no lleva un identificador correlacionable con `session_id`/`cwd`, caer a Surface 3 leyendo `~/.claude/tasks/<session_id>/`. Sesgo por defecto INVIABLE: documentar cada condición con evidencia cruda. El veredicto realista es **INVIABLE o VIABLE-condicional-a-execute-phase** — el display de Phase 50 ya está presupuestado para tolerar la cohorte sin-tasks vía estado degradado `—`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Disparar/observar el evento de task-state | Claude Code internals (READ surface) | — | Es comportamiento del runtime instalado; kodo nunca es la fuente del evento, solo lo observa (D-04) |
| Correlacionar `session_id → task_id` | kodo `state.json` (source of truth) | hook stdin (`session_id`, `cwd`, `transcript_path`) | `state.json` ya guarda ambos por sesión; el hook recibe `session_id` de Claude Code (verificado en `session-start.js:166`) |
| Persistir el progreso capturado | kodo artefacto `~/.kodo/…` (write-owner) | — | Invariante D-04/D-05: la persistencia vive en territorio kodo, espejo de `~/.kodo/plans/<task_id>.md` |
| Consumir/mostrar `N/M` (Phase 50, fuera de scope) | kodo TUI (filesystem reader) | — | Espejo de `readLightPlan`: lee filesystem, cero endpoints nuevos |

## Standard Stack

Este es un spike throwaway (D-01) sin dependencias externas nuevas. El "stack" es el toolkit de instrumentación ya presente en la máquina + el runtime de kodo.

### Core
| Tool | Version | Purpose | Why Standard |
|------|---------|---------|--------------|
| `claude` (Claude Code) | **2.1.175** `[VERIFIED: claude --version]` | El runtime bajo prueba; vive en `/Applications/cmux.app/Contents/Resources/bin/claude` | Es la build instalada — el sujeto del spike |
| `node` (test runner) | nativo `node --test` `[VERIFIED: package.json]` | Cualquier aserción del harness si se necesita | kodo ya usa `node --test`; cero deps nuevas |
| `jq` o `python3` | sistema | Parsear payloads JSON crudos de hooks/tasks/transcript | Pre-instalado; inspección ad-hoc |

### Supporting
| Tool | Purpose | When to Use |
|------|---------|-------------|
| hook `command` throwaway en `~/.claude/settings.json` | Capturar el payload crudo de `TaskCreated`/`TaskCompleted` a `/tmp/kodo-spike-*.json` | Surface 1 probe |
| `tail -f` / `fs.watch` ad-hoc | Observar append al transcript JSONL en vivo sin romper la sesión | Surface 2 probe |
| `ls -R` / `stat` sobre `~/.claude/tasks/<session_id>/` | Detectar materialización del dir y derivar N/M | Surface 3 probe |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Hook `command` que escribe a `/tmp` | Hook que escribe directo a `~/.kodo/progress/` | El spike es throwaway (D-01); escribir a `/tmp` evita contaminar el territorio kodo de producción durante la sonda. La escritura a `~/.kodo/` es lo que Phase 50 construiría, no el spike. |

**Installation:** Ninguna. No se instalan paquetes externos. Ver Package Legitimacy Audit.

**Version verification:**
```bash
claude --version          # → 2.1.175 (Claude Code)  [VERIFIED 2026-06-12]
readlink -f "$(which claude)"  # → /Applications/cmux.app/Contents/Resources/bin/claude
```

## Package Legitimacy Audit

**No external packages are installed by this phase.** El spike usa exclusivamente: el binario `claude` ya instalado, `node --test` (runtime de kodo ya presente), y utilidades de sistema (`jq`/`python3`/`tail`/`stat`). No hay superficie de slopsquatting.

| Package | Registry | Disposition |
|---------|----------|-------------|
| (ninguno) | — | N/A — spike throwaway, cero deps nuevas |

## Architecture Patterns

### System Architecture Diagram — el seam que el spike valida

```
                    ┌─────────────────────────────────────────────┐
                    │  Sesión interactiva `claude --worktree`       │
                    │  lanzada por kodo (cwd = .bg-shell/<sid>/)    │
                    │  ejecuta /gsd-execute-phase (olas de agentes) │
                    └───────────────┬───────────────────────────────┘
                                    │ (¿dispara TaskCreate?)
            ┌───────────────────────┼───────────────────────┐
            ▼                       ▼                       ▼
   SURFACE 1 (preferida)    SURFACE 2               SURFACE 3 (último recurso)
   hook TaskCreated/        transcript JSONL        ~/.claude/tasks/<session_id>/
   TaskCompleted            ~/.claude/projects/     N.json (status:completed)
   (settings.json)          <slug>/<sid>.jsonl
            │                       │                       │
   payload crudo →          ¿task entries?          M = nº ficheros
   /tmp/spike.json          → NINGUNA (evidencia:    N = status==completed
   ¿lleva sid/cwd?            0 tool_use task/todo)  ✓ N/M derivable
            │                  ✗ cond (b) falla              │
            └───────────────────────┬───────────────────────┘
                                    │
                         CORRELACIÓN (condición c)
                                    ▼
                    ┌───────────────────────────────────┐
                    │  kodo ~/.kodo/state.json           │
                    │  sessions[task_id] = {             │
                    │    session_id,  ← linchpin         │
                    │    task_id,                        │
                    │    worktree_path: .bg-shell/<sid>/ │
                    │  }                                 │
                    └───────────────┬───────────────────┘
                                    │ session_id → task_id
                                    ▼
                    ┌───────────────────────────────────┐
                    │  ARTEFACTO KODO (write-owner, D-05) │
                    │  ~/.kodo/progress/<task_id>.json    │  ← Phase 50, no el spike
                    │  espejo de ~/.kodo/plans/<task_id>.md│
                    └───────────────────────────────────┘
```

### Pattern 1: El mirror productor↔consumidor del plan ligero (v0.11 Phase 45/46)
**What:** El spike demuestra el lado productor del mismo seam que ya existe para el plan ligero. El productor (`session-start.js`) escribe `~/.kodo/plans/<task_id>.md` con bytes byte-idénticos a la ruta que el consumidor (`readLightPlan`) reconstruye. Phase 50 replicaría exactamente esto para progreso.
**When to use:** Cualquier artefacto kodo-controlado correlacionado por `task_id`.
**Source:** `src/cli/dashboard/plan.js:62-90` (`readLightPlan`) — ruta construida `join(homedir(),'.kodo','plans',`${taskId}.md`)`, never-throws, ENOENT→`no-light-plan`, anti-ReDoS guard `taskId.includes('/')||includes('\\')||includes('..')`.
```javascript
// Productor (session-start.js:145): byte-idéntico al consumidor
`Also, at the start write a short plan ... to \`${join(KODO_DIR, 'plans', `${session.task_id}.md`)}\``
// Consumidor (plan.js:84): ruta CONSTRUIDA, no derivada por regex
const plansDir = deps.kodoPlansDir || join((deps.homedirFn||homedir)(), '.kodo', 'plans');
const md = readFileFn(join(plansDir, `${taskId}.md`));
```

### Pattern 2: El hook recibe `session_id` + `transcript_path` de Claude Code (la fuente de la correlación)
**What:** El hook `SessionStart` de kodo ya lee de stdin `{ session_id, cwd, transcript_path }` que Claude Code le entrega. Esto es la prueba viva de que Claude Code expone `session_id` al territorio del hook — el ancla de la correlación condición (c).
**Source:** `src/hooks/session-start.js:163-166, 192`:
```javascript
const input = JSON.parse(await readStdin());
const cwd = input.cwd || process.cwd();
const sessionId = input.session_id;          // ← Claude Code lo provee
// ...
transcript_path: input.transcript_path,       // ← y la ruta del transcript también
```
**Implicación para el spike:** un hook `TaskCreated`/`TaskCompleted` throwaway recibirá su propio stdin. La pregunta empírica (condición c) es: **¿ese payload de TaskCreated incluye `session_id`/`cwd`** para correlacionar con `state.json`? Si NO, Surface 1 falla condición (c) y se cae a Surface 3 (donde el dir-name ES el session_id).

### Pattern 3: Golden-bytes HOOK-02 (append-at-end, never-throws)
**What:** Cualquier inyección de kodo en `session-start.js` debe APPEND al final del array de líneas para preservar los bytes de los bloques anteriores; el hook nunca lanza (silent failure → nunca rompe el arranque de Claude Code).
**Source:** `src/hooks/session-start.js:50-52` (bloque anti-push al FINAL "satisfied-by-construction"), `:268-270` (`catch {}` silent).
**Relevancia al spike:** el spike NO debe tocar `session-start.js` (es throwaway). Pero la condición (d) "cero ruptura de sesión" se mide contra esta misma disciplina never-throws.

### Anti-Patterns to Avoid
- **Tratar `~/.claude/tasks/` como fuente de verdad:** viola D-04. Es solo la superficie de LECTURA. La persistencia vive en `~/.kodo/`.
- **Probar la sonda contra una sesión quick/idle:** las sesiones quick (`/gsd-quick`) y idle NO disparan olas de agentes con TaskCreate → ningún tasks dir → falso INVIABLE. Probar contra `/gsd-execute-phase` (el flujo que dispara agent-teams).
- **Asumir que el transcript JSONL lleva todos:** evidencia empírica dice que NO. No perder tiempo construyendo un parser de todos sobre el transcript.
- **Pin del payload de TaskCreated desde docs:** los docs NO publican el schema. DEBE capturarse en vivo (D-01).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Leer N/M de `~/.claude/tasks/` | Un parser de transcript que reconstruye todos | Contar ficheros `N.json` con `status:"completed"` en el dir del session_id | El dir ya tiene la estructura derivable directamente (evidencia: `M=21 N=21`) |
| Correlacionar session→task | Un nuevo índice o sidecar | Leer `state.json` existente (`findSession({sessionId})` en `state.js:330`) | kodo YA mapea `session_id→task_id`; reusar `findSession` |
| Persistir el artefacto | Un nuevo endpoint o DB | El patrón filesystem `~/.kodo/<dir>/<task_id>.ext` (mirror de `plans/`) | Invariante "cero endpoints nuevos"; el mold ya existe (`readLightPlan`) |
| Capturar el payload del hook | Parsear logs de Claude Code | Un hook `command` throwaway que vuelca stdin crudo a fichero | Es la vía soportada y la única que ve el payload real |

**Key insight:** Casi toda la maquinaria que Phase 50 necesitaría YA existe en kodo (el seam del plan ligero, `findSession`, `KODO_DIR`). El spike NO construye infraestructura — solo mide si la superficie de Claude Code alimenta ese seam. El riesgo es 100% del lado de Claude Code (¿dispara? ¿payload estable? ¿correlacionable?), 0% del lado de kodo.

## Surface Evidence Dossier (evidencia cruda ya recogida — punto de partida del spike)

> El spike debe RE-VERIFICAR esto en vivo durante una sesión activa. Esta es la línea base estática.

### Surface 1 — hooks `TaskCreated` / `TaskCompleted`
- `[VERIFIED: code.claude.com/docs/en/hooks]` Ambos eventos EXISTEN en la lista de 30 eventos lifecycle de la build actual. NO deprecados. No soportan matchers (siempre disparan).
- `[VERIFIED: docs]` Atados a la herramienta **`TaskCreate`** (gestión de tareas de agent-teams), NO a `TodoWrite`/todos.
- `[VERIFIED: docs]` `exit code 2` en `TaskCreated` hace rollback de la creación; en `TaskCompleted` previene el marcado de completado.
- `[ASSUMED]` El payload JSON de stdin NO está documentado. Campos como `task_id`/`session_id`/`status` deben capturarse en vivo. **Esta es la incógnita #1 del spike para condición (c).**
- `[VERIFIED: ~/.claude/settings.json]` Hoy NO hay ningún hook `TaskCreated`/`TaskCompleted` configurado en la máquina (solo hooks GSD/codeisland en `~/.claude/hooks/`). El spike debe AÑADIR uno throwaway.
- `[VERIFIED: ~/.claude/settings.json]` `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1` está activo — la maquinaria de TaskCreate está habilitada en esta máquina.

### Surface 2 — transcript JSONL `~/.claude/projects/<slug>/<session_id>.jsonl`
- `[VERIFIED: filesystem]` El nombre del fichero `.jsonl` ES el `session_id` (campo `sessionId` interno coincide con el filename). Correlación con kodo: **19 de 23** session_ids de kodo tienen su `.jsonl` (los 4 misses son sesiones test/dead como `s-ok-1`).
- `[VERIFIED: filesystem]` Tipos de línea en un transcript real (695 líneas): `assistant`(248), `attachment`(181), `user`(109), `mode`(42), `last-prompt`(41), `system`(25), `ai-title`(26), `file-history-snapshot`(17), `queue-operation`(6).
- `[VERIFIED: filesystem]` `tool_use` dentro de `assistant`: `Read/Bash/Edit/Write/Agent/Skill/AskUserQuestion`. **CERO `TodoWrite`, CERO `Task`.** Scan de 15 transcripts recientes: 0 hits de `TodoWrite`/`Task`.
- **Veredicto base Surface 2:** correlación (c) excelente, pero **condición (b) falla** — el transcript no contiene datos de task/todo de los que derivar N/M. Probable INVIABLE para Surface 2 salvo que una sesión `execute-phase` viva escriba entradas que no aparecen en sesiones pasadas (improbable; el spike lo confirma).

### Surface 3 — `~/.claude/tasks/<uuid>/N.json` (último recurso)
- `[VERIFIED: filesystem]` El dir EXISTE: 65 entradas UUID. Cada entrada es un dir con `.lock` (0 bytes) + ficheros `1.json`, `2.json`, … numerados.
- `[VERIFIED: filesystem]` Schema de `N.json`: `{ id, subject, description, activeForm, status, blocks[], blockedBy[], metadata{phase,plan,wave,autonomous} }`. `status ∈ {pending, completed, ...}`.
- `[VERIFIED: filesystem]` **N/M derivable limpiamente:** `M` = nº de ficheros `N.json`; `N` = los con `status=="completed"`. Ejemplos reales: `7c0bb115 → M=21 N=21`, `1f564fba → M=3 N=3`, `25f3ab13 → M=3 N=0(pending)`, `3365fbad → M=9 N=0`.
- `[VERIFIED: filesystem]` **El `<uuid>` ES un `session_id` de Claude Code:** intersección 58/58 entre nombres de dir `tasks/` y nombres de transcript `.jsonl`. Luego `kodo.session_id → ~/.claude/tasks/<session_id>/` es una correlación determinista construible (condición c potencialmente SÍ).
- `[VERIFIED: filesystem]` **PERO 0 de 23** session_ids de kodo (en `state.json` actual) tienen dir `tasks/`. La razón: el dir solo nace si la sesión usa `TaskCreate`/agent-teams. **12 de 58** dirs `tasks/` SÍ son sesiones de worktree → las sesiones de worktree *pueden* crearlo cuando `execute-phase` dispara olas de agentes.
- `[VERIFIED: filesystem]` Los ficheros NO contienen `sessionId`/`session_id` propio — la única correlación es el nombre del dir = session_id.
- **Veredicto base Surface 3:** N/M (b) ✓, correlación (c) ✓ *si* el dir se materializa. Riesgo: condición (a) — depende de que la sesión interactiva de kodo dispare TaskCreate. El spike DEBE medir esto en una sesión `execute-phase` real.

### Correlación kodo (condición c) — round-trip verificado
- `[VERIFIED: ~/.kodo/state.json]` Estructura: `{ schema_version, sessions{task_id → record}, history[] }`. Cada record: `session_id`, `task_id` (=clave del mapa), `task_ref`, `worktree_path: .bg-shell/<session_id>/`, etc.
- `[VERIFIED: state.js:14-15, 233]` `task_id` = UUID del task en el provider; `session_id` = UUID de la sesión de Claude Code. `findSession({sessionId})` (`state.js:330`) ya resuelve session→record→task_id. **El round-trip D-05 es construible con código existente.**
- `[VERIFIED: filesystem]` Round-trip de ejemplo: `state.json` sesión `f8dcd7d6-…` → `worktree_path .bg-shell/f8dcd7d6-…/` → transcript `~/.claude/projects/-Users-…-worktrees-f8dcd7d6-…/f8dcd7d6-….jsonl` existe. La cadena session_id→task_id→artefacto es demostrable.

## Common Pitfalls

### Pitfall 0: La versión instalada es 2.1.175, NO 2.1.174
**What goes wrong:** El objetivo y el CONTEXT mencionan `2.1.174`. La medición empírica de hoy da **2.1.175**. Un veredicto que cite 2.1.174 sería incorrecto.
**How to avoid:** El header de `49-SPIKE.md` (D-03) DEBE re-ejecutar `claude --version` al momento de correr el spike y citar el valor real. Anclar TODA condición a la versión efectivamente medida.
**Warning signs:** Cualquier mención de 2.1.174 sin re-verificar.

### Pitfall 1: Probar contra el tipo de sesión equivocado → falso INVIABLE
**What goes wrong:** Sesiones quick/idle/bootstrap NO disparan olas de agentes con TaskCreate → ningún tasks dir, ningún evento → INVIABLE espurio.
**Why it happens:** El dir `tasks/` solo nace con `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` + uso real de TaskCreate, que en GSD ocurre en `/gsd-execute-phase` (olas paralelas), confirmado por `execute-plan.md` (9 refs a wave/parallel/agent).
**How to avoid:** Lanzar el spike contra una sesión `claude --worktree` que ejecute `/gsd-execute-phase` de una fase con ≥2 plans/waves. Documentar qué comando GSD corrió la sesión instrumentada.
**Warning signs:** El dir `~/.claude/tasks/<session_id>/` nunca aparece durante la sesión.

### Pitfall 2: El payload del hook puede no llevar el identificador de correlación
**What goes wrong:** Surface 1 dispara (condición a ✓) pero su payload no incluye `session_id`/`cwd` → no se puede correlacionar con `state.json` (condición c ✗) → INVIABLE aunque la superficie funcione.
**Why it happens:** El schema de `TaskCreated`/`TaskCompleted` NO está documentado; no hay garantía de que lleve el session_id.
**How to avoid:** El hook throwaway debe volcar el stdin COMPLETO crudo. Inspeccionar si lleva `session_id`/`cwd`/`transcript_path` (como sí hace `SessionStart`). Si no, caer a Surface 3 donde el dir-name = session_id resuelve la correlación.

### Pitfall 3: Tailing del transcript puede no romper la sesión — pero el watcher de `tasks/` tiene un `.lock`
**What goes wrong:** Leer `~/.claude/tasks/<sid>/` mientras Claude Code escribe podría chocar con el `.lock` (0 bytes presente en cada dir).
**How to avoid:** Leer es seguro (el `.lock` es de escritor, no impide lectura POSIX), pero condición (d) "cero ruptura" exige verificar que el polling de lectura no degrada la sesión. Usar lectura best-effort never-throws (mirror `readLightPlan`), nunca tomar el lock.
**Warning signs:** Errores de la sesión coincidentes con el polling.

### Pitfall 4: Sesgo de confirmación VIABLE
**What goes wrong:** Querer que salga VIABLE lleva a aceptar evidencia parcial.
**How to avoid:** D-04 manda: INVIABLE por defecto, sin crédito parcial. Cualquier condición sin evidencia cruda en el apéndice = esa condición FALLA. El display de Phase 50 ya tolera el caso degradado, así que un INVIABLE no es un fracaso del milestone (PROG-F1).

## Code Examples

### Sonda Surface 1 — hook throwaway que captura el payload crudo
```bash
# 1. Crear hook throwaway (NO en src/ — es throwaway, D-01)
cat > /tmp/kodo-spike-taskhook.sh <<'SH'
#!/usr/bin/env bash
# vuelca stdin crudo + timestamp; never-throws
ts=$(date +%s%N)
cat > "/tmp/kodo-spike-task-${ts}.json" 2>/dev/null || true
exit 0   # nunca bloquear (no exit 2 → no rollback)
SH
chmod +x /tmp/kodo-spike-taskhook.sh

# 2. Registrar temporalmente en ~/.claude/settings.json (backup primero):
#    "hooks": { "TaskCreated":[{"type":"command","command":"/tmp/kodo-spike-taskhook.sh"}],
#               "TaskCompleted":[{"type":"command","command":"/tmp/kodo-spike-taskhook.sh"}] }

# 3. Lanzar sesión kodo execute-phase, dejar correr, inspeccionar:
ls -t /tmp/kodo-spike-task-*.json | head -1 | xargs python3 -m json.tool
#    → ¿lleva session_id / cwd / task status? (condición c)

# 4. DESREGISTRAR el hook al terminar (restaurar settings.json del backup).
```

### Sonda Surface 3 — derivar N/M y correlacionar con kodo
```bash
# Durante/tras la sesión, con el session_id de kodo:
SID=$(python3 -c "import json;d=json.load(open('$HOME/.kodo/state.json'));\
print(next(iter(d['sessions'].values()))['session_id'])")
TDIR="$HOME/.claude/tasks/$SID"
if [ -d "$TDIR" ]; then
  python3 - "$TDIR" <<'PY'
import json,glob,os,sys
d=sys.argv[1]; files=glob.glob(d+'/*.json')
done=sum(1 for f in files if (json.load(open(f)).get('status')=='completed'))
print(f"N/M = {done}/{len(files)}")   # ← condición (b)
PY
else
  echo "tasks dir NO materializado para session $SID → condición (a) FALLA"
fi
```

### Correlación condición (c) — round-trip con código kodo existente
```javascript
// Reusar findSession (src/session/state.js:330) — cero código nuevo de producción
import { findSession } from './src/session/state.js';
const r = findSession({ sessionId: SID });   // SID = nombre del dir ~/.claude/tasks/
// r.session.task_id  ← el task_id para nombrar ~/.kodo/progress/<task_id>.json (D-05)
```

## State of the Art

| Old Approach (suposición previa del proyecto) | Current Approach (evidencia 2.1.175) | Impact |
|-----------------------------------------------|--------------------------------------|--------|
| "TodoWrite deprecado, hooks de task no existen/no fiables" | `TaskCreated`/`TaskCompleted` SÍ existen (30 eventos lifecycle), atados a `TaskCreate` (agent-teams) | Surface 1 es un candidato genuino — el spike DEBE probarlo, no descartarlo a priori |
| "transcript/internal paths frágiles entre versiones" | Sigue cierto para el transcript (no lleva todos); `~/.claude/tasks/` schema es estable y N/M-derivable | Surface 3 sube de "frágil teórico" a "candidato fuerte con riesgo de materialización" |
| `Task*` tools bypassean PostToolUse (issue #20243) | Coherente: por eso el transcript no ve `Task`/`TodoWrite` y existen eventos dedicados `TaskCreated/Completed` en su lugar | Confirma por qué Surface 2 falla (b) y por qué Surface 1 es la vía dedicada |

**Deprecated/outdated:**
- Pin de versión `2.1.174` en el objetivo: la build real es **2.1.175**. Re-verificar siempre.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | El payload de `TaskCreated`/`TaskCompleted` incluye (o no) `session_id`/`cwd` correlacionable | Surface 1 dossier, Pitfall 2 | Si NO lo lleva, Surface 1 falla condición (c) y obliga a caer a Surface 3. El spike lo resuelve en vivo. |
| A2 | Las sesiones `execute-phase` de kodo disparan `TaskCreate` (creando el dir `tasks/`) | Summary, Pitfall 1 | Si NUNCA lo disparan en sesión interactiva (solo headless), las 3 superficies fallan condición (a) → INVIABLE. Inferido de 12/58 dirs siendo worktree sessions; el spike lo confirma. |
| A3 | El polling de lectura sobre `~/.claude/tasks/` no degrada la sesión (`.lock` es de escritor) | Pitfall 3 | Si la lectura interfiere, condición (d) falla. Bajo riesgo (lectura POSIX). |
| A4 | El payload/schema de `tasks/N.json` se mantiene estable durante una sesión viva igual que en los snapshots estáticos inspeccionados | Surface 3 dossier | Si el schema muta mid-session, la derivación N/M se rompe. El spike observa la mutación en vivo. |

**Nota:** Estos `[ASSUMED]` son precisamente las incógnitas que el spike empírico existe para resolver. No requieren confirmación del usuario — requieren la sonda en vivo (que es el deliverable del spike).

## Open Questions

1. **¿El evento `TaskCreated`/`TaskCompleted` dispara en una sesión `claude --worktree` INTERACTIVA, o solo en modo headless/print?**
   - What we know: el evento existe; el dir `tasks/` se materializa para 12 sesiones de worktree históricas.
   - What's unclear: si la sesión interactiva lanzada por kodo (vía cmux) los dispara.
   - Recommendation: medir en primera persona — es el corazón de condición (a).

2. **¿El `task_id` de `metadata` en `tasks/N.json` (phase/plan/wave) podría dar un N/M más rico que el conteo de status?**
   - What we know: `metadata: {phase, plan, wave, autonomous}` está presente.
   - What's unclear: si es estable/útil vs el simple conteo `status==completed`.
   - Recommendation: el conteo de status es suficiente y robusto; metadata es bonus opcional.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `claude` (Claude Code) | Todo el spike (sujeto) | ✓ | **2.1.175** | — (sin él no hay spike) |
| `cmux` (lanzador de sesión) | Sesión `claude --worktree` interactiva real | ✓ | en `/Applications/cmux.app/` | lanzar `claude` directo si cmux estorba |
| `~/.claude/tasks/` dir | Surface 3 | ✓ (existe, 65 entradas) | — | — |
| `~/.claude/settings.json` hooks block | Surface 1 (registrar hook throwaway) | ✓ (editable; backup obligatorio) | — | — |
| `~/.kodo/state.json` | Correlación condición (c) | ✓ | schema_version presente | — |
| `node --test` | Aserciones de harness (opcional) | ✓ | runtime kodo | inspección manual |
| `python3`/`jq` | Parseo de payloads | ✓ | sistema | el otro |

**Missing dependencies with no fallback:** Ninguna. Todas las superficies y la fuente de correlación están presentes en la máquina.

## Validation Architecture

> `nyquist_validation: true` en config → sección incluida. **La validación del spike ES su evidencia cruda**: el veredicto se valida por la matriz de 4 condiciones con payloads/listados adjuntos en el apéndice de `49-SPIKE.md` (D-03), no por una suite de tests de producción (no se envía código).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node --test` (kodo) — solo si el harness necesita aserciones; el spike es throwaway |
| Config file | none — `node --test $(find test -name '*.test.js')` (package.json) |
| Quick run command | n/a — la "validación" es la captura de evidencia, no un test suite |
| Full suite command | `npm test` (solo para confirmar que el spike NO tocó producción: `git diff -- src/ test/` debe quedar vacío) |

### Phase Requirements → Evidence Map (sustituye al Test Map; el deliverable es un veredicto, no código)
| Req ID | Behavior | Evidence Type | Cómo se valida | Existe? |
|--------|----------|---------------|----------------|---------|
| PROG-01 cond (a) | La superficie dispara/se lee en 2.1.175 interactiva | Listado de dir / payload crudo capturado durante sesión viva | Adjuntar en apéndice `49-SPIKE.md`: `/tmp/kodo-spike-task-*.json` o `ls -R ~/.claude/tasks/<sid>/` con timestamp dentro de la ventana de sesión | ❌ Wave 0 (capturar en vivo) |
| PROG-01 cond (b) | Payload estable para derivar N/M | Cálculo N/M sobre la evidencia cruda | Mostrar el conteo `status==completed / total` reproducible | ❌ Wave 0 |
| PROG-01 cond (c) | Correlación determinista `session_id→task_id` | Round-trip vía `findSession` sobre `state.json` real | Adjuntar el mapeo `session_id → task_id → ~/.kodo/<artefacto>` de UNA sesión real (D-05) | ✓ código existe (`state.js:330`); ejecutar el round-trip |
| PROG-01 cond (d) | Cero latencia/ruptura + escritura a `~/.kodo/` | Observación de la sesión durante el polling + ausencia de errores | Constatar que la sesión completó sin degradación durante la lectura | ❌ Wave 0 |

### Sampling Rate
- **Per surface probe:** capturar evidencia cruda ANTES de juzgar la condición (sin evidencia = condición falla, D-04).
- **Phase gate:** las 4 condiciones documentadas con evidencia para la superficie ganadora (o todas fallidas → INVIABLE), `git diff -- src/ test/ bin/` vacío (el spike no envía código).

### Wave 0 Gaps
- [ ] Script harness throwaway `/tmp/kodo-spike-taskhook.sh` (Surface 1) — NO en `src/`.
- [ ] Procedimiento de backup/restore de `~/.claude/settings.json` (registrar/desregistrar el hook sin perder los hooks existentes).
- [ ] Una sesión `claude --worktree` real lanzada por kodo ejecutando `/gsd-execute-phase` (Pitfall 1) — el sujeto de la sonda.
- [ ] Round-trip `session_id→task_id` ejecutado vía `findSession` y adjuntado (cond c, D-05).

*(No hay "tests de producción" que crear: el spike es throwaway y su validación es la evidencia adjunta al veredicto.)*

## Project Constraints (from CLAUDE.md)

No existe `./CLAUDE.md` de proyecto en kodo (verificado — solo el global de usuario). Directivas del CLAUDE.md global aplicables al spike:
- **Regla 3 (cambios quirúrgicos):** el spike es throwaway — NO refactorizar `session-start.js` ni el código de producción. Tocar solo `/tmp` y un backup temporal de `settings.json`.
- **Regla 2 (simplicidad):** no sobre-construir el harness; una sesión instrumentada mínima basta (D-05 discretion).
- **Responder en español** (memorias especiales) — `49-SPIKE.md` y la comunicación en español; los identificadores de campo/superficie en su forma literal.
- **Tier de merge:** el spike es Tier 1 (doc-only deliverable, cero código de producción) — fast-forward, sin push, una vez emitido el veredicto.

## Sources

### Primary (HIGH confidence)
- `claude --version` (ejecución directa) — build instalada **2.1.175**.
- Filesystem `~/.claude/` (inspección directa): `tasks/`, `projects/<slug>/*.jsonl`, `hooks/`, `settings.json` — schemas, correlaciones, intersecciones de UUID.
- Filesystem `~/.kodo/state.json` (inspección directa) — estructura sessions/history, campos `session_id`/`task_id`/`worktree_path`.
- Código kodo: `src/hooks/session-start.js`, `src/cli/dashboard/plan.js`, `src/config.js`, `src/session/state.js` — patrón mirror y stdin del hook.
- code.claude.com/docs/en/hooks — lista de 30 eventos lifecycle, semántica de `TaskCreated`/`TaskCompleted` (atados a `TaskCreate`), exit-code 2.

### Secondary (MEDIUM confidence)
- WebSearch (verificado contra docs oficiales): existencia de `TaskCreated`/`TaskCompleted`, no-matcher, PostToolUse observe-only, Task tools bypass.

### Tertiary (LOW confidence)
- `[ASSUMED]` payload exacto de `TaskCreated`/`TaskCompleted` (docs no lo publican) — a capturar en vivo.

## Metadata

**Confidence breakdown:**
- Surfaces/evidence base: HIGH — todo inspeccionado en primera persona en la máquina.
- Correlación session_id↔task_id: HIGH — round-trip verificado contra `state.json` y código existente.
- Disparo en vivo del evento (condición a): MEDIUM — inferido de evidencia estática (12/58 dirs son worktree sessions); requiere confirmación en vivo (el deliverable del spike).
- Payload del hook (condición c para Surface 1): LOW — no documentado, a capturar.

**Research date:** 2026-06-12
**Valid until:** 7 días para los detalles de versión de Claude Code (build cambia rápido — ya saltó 2.1.174→2.1.175); 30 días para el patrón mirror de kodo (estable).
```