# Phase 62: Adopción inteligente desde el dashboard (ORCH-02) - Research

**Researched:** 2026-06-25
**Domain:** CLI Node.js (ink/React TUI) · spawn one-shot de `claude -p` headless · derivación LLM fail-open · parsing de transcript `.jsonl`
**Confidence:** HIGH (la mayoría de hallazgos verificados en vivo contra el código real y el binario `claude` real)

## Summary

Esta fase inserta un paso de **derivación LLM one-shot** en el flujo de la tecla `a` del dashboard ink, entre "el operador arma el adopt" y el shell de `kodo adopt`. El paso lee memoria del proyecto (GSD: PROJECT.md/ROADMAP/STATE; non-GSD: git log + primer prompt del transcript), la inyecta en un prompt mínimo, spawnea `claude -p --model claude-haiku-4-5 --output-format json` sin tools, y parsea `{title, description}` del `result`. Si algo falla (timeout, ENOENT, parse-error) cae a `basename(cwd)` — el adopt **nunca se bloquea** (D-03). Todo el código a tocar ya existe y es DI-friendly: `runAdopt` (adopt.js) ya inserta `--title` argv-literal y necesita un `--description` simétrico; `resolveTranscriptPath`, `isGsdProject`, `sanitizeAdoptionData`, `computeAdoptable` y los estados confirm de App.js están verificados.

**Tres hallazgos load-bearing descubiertos en vivo (NO eran obvios desde CONTEXT.md):**

1. **El timeout ~8s de D-03 es inviable.** Mediciones reales de `claude -p --model claude-haiku-4-5 --output-format json` dieron **8.7s / 16.1s / 21.9s / 15.5s** (wallclock, incluyendo overhead del shim cmux). Un timeout de 8s cortaría casi todas las derivaciones legítimas → fail-open sistemático a `basename(cwd)` = recrear el bug que la fase arregla. **El planner DEBE elevar el timeout a ~25-30s** (D-03 delega el valor exacto al planner; la evidencia empírica lo fija aquí).

2. **`--json-schema` elimina el fence markdown y hace el parse trivial.** Sin schema, `result` viene envuelto en ` ```json ... ``` ` (hay que pelar el fence). Con `--json-schema '{...}'`, `result` es JSON estricto directamente `JSON.parse`-able. Usar `--json-schema` es la opción robusta.

3. **El "primer prompt del usuario" del transcript NO es la intención natural del humano en muchos casos.** El primer turno `type:'user'` aparece en línea variable (3, 4, 6, 11…), y a menudo es un prompt de agente inyectado (claude-mem observer, compound-learning) o un slash-command (`<command-message>...<command-name>`). Hay que filtrar tool_result-only y, idealmente, esos prefijos sintéticos.

**Primary recommendation:** Crear `src/cli/dashboard/enrich.js` con una función `deriveAdoptionMeta({...})` never-throws, DI por `*Fn` (spawn + lectura de fs + lectura de transcript), que use `claude -p --model claude-haiku-4-5 --output-format json --json-schema <schema>` resuelto **por PATH** (NO por `config.claude.binary`, que apunta a un binario inexistente), con timeout ~25s, y fail-open a `{}` (→ runAdopt omite `--title`/`--description` → core cae a basename). Insertar la llamada en App.js entre el primer `a` (arma) y el segundo `a` (confirma), con un estado `'deriving'`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Disparo por tecla `a` + estados UX (derive→confirm) | TUI ink (App.js) | — | El teclado y los modos (`list`/`overlay`/`confirm`) ya viven en App.js |
| Lectura de memoria (PROJECT.md / git log / transcript) | Módulo nuevo `enrich.js` | fs/node:child_process (DI) | I/O acotado, never-throws, testeable con fakes |
| Spawn de `claude -p` + parse del envelope | Módulo nuevo `enrich.js` | — | Aísla el LLM en un solo carril (D-11/D-14: el suelo 0-token del core intacto) |
| Saneo del `{title, description}` derivado | Core `adopt.js` (`sanitizeAdoptionData`) | — | Backstop BIDIR-08 ya aplica en `adoptSession` — no añadir saneo nuevo (D-12) |
| Shell de `kodo adopt --title --description` | `runAdopt` (dashboard/adopt.js) | core `adoptSession` | argv literal injection-safe (D-13); ya inserta `--title`, falta `--description` |
| Reverse-lookup cwd→projectId | `select.js` (`resolveProjectId`) | — | Sin cambios (ya resuelto en confirm-arm) |

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01:** Derivador **one-shot** `claude -p --model claude-haiku-4-5`, headless, disparado por la tecla `a` (NO daemon, NO orquestador persistente). Precedente de spawn de `claude` en `src/orchestrator/launch.js:197`.
- **D-02:** **Contexto inline pre-leído** — kodo lee los insumos (PROJECT.md/ROADMAP/STATE para GSD; git log + primer prompt del transcript) y los **inyecta en el prompt**. El subproceso NO lleva tools (sin Read/Bash). Razón: rápido, determinista, coste acotado, cero superficie de tools en el subproceso.
- **D-03:** **never-throws / fail-open** con timeout acotado (orden de ~8s; valor exacto lo fija el planner). Si Haiku falla/timeout/parse-error → fallback a `basename(cwd)` (comportamiento actual de Phase 56) y el adopt **nunca se bloquea**.
- **D-04:** **GSD** (`.planning/` existe): leer `PROJECT.md` + `ROADMAP.md` + `STATE.md` → captura el **alcance global** del proyecto (arregla el F2 del UAT).
- **D-05:** **non-GSD** (sin `.planning/`): **SÍ se enriquece** — derivar de `git log --oneline` + el **primer prompt del usuario** del transcript. NO cae a basename salvo fallo.
- **D-06:** El **primer prompt del usuario** del transcript es señal primaria de *intención*; `git log` es señal de *actividad*. Reusar `resolveTranscriptPath(cwd, sessionId)` de `src/logger-events.js:109` — NO reinventar el path.
- **D-07:** **Prompt nuevo, dedicado y mínimo** (NO reutilizar la prosa de adopción del orquestador). La shell-safety la garantiza `execFile` con argv literal; el mandato de charset/single-quote de ORCH-01 es **redundante aquí**. El prompt solo pide derivar `{title, description}` desde el contexto inline.
- **D-08:** **Derive-then-confirm**: pick surface → estado "derivando…" (spinner) → muestra `{title, description}` propuestos → segunda `a` confirma → `kodo adopt`.
- **D-09:** **v1 no-editable**: si la propuesta no convence, Esc → el operador usa `kodo adopt --title '…'` manual. Editar en el overlay ink se difiere.
- **D-10:** Por qué derive-ANTES-de-crear: no hay `updateTask` para el título (FROZEN-9), así que el buen título debe existir antes del `createTask`. La descripción viaja como `--description` (cuerpo at-adopt), NO como comentario post-hoc.
- **D-11:** Suelo determinista 0-token intacto: `adoptSession`/`createTask` no cambian; el LLM vive SOLO en el paso de derivación del dashboard.
- **D-12:** El `{title, description}` derivado pasa igual por `sanitizeAdoptionData` (BIDIR-08, `src/adopt.js`) — redacción de home/rutas. Sin saneo nuevo.
- **D-13:** `execFile` argv (sin shell) → inyección estructuralmente imposible; T-57-01 no aplica a este carril.
- **D-14:** Rompe el invariante literal "vigilante/server 0-token" — pero es un spawn **explícito, disparado por tecla, acotado**. Aceptado.
- **D-15:** Dependencia dura del CLI `claude` en PATH. Aceptado. El planner debe definir el fallback si `claude` no está disponible (→ basename, como cualquier otro fail-open).

### Claude's Discretion
- Valor exacto del timeout (~8s de referencia). **→ Research recomienda ~25-30s con evidencia empírica (ver Pitfall 1).**
- Ubicación del módulo nuevo (sugerencia: `src/cli/dashboard/enrich.js`) y su firma DI.
- Forma exacta del prompt y del parse del `--output-format json` (envelope → extraer `{title, description}`; parse-fail → fallback). **→ Research recomienda `--json-schema` (ver Pattern 2).**
- Presupuesto de contexto inline (cuánto de PROJECT.md/transcript alimentar; caps).

### Deferred Ideas (OUT OF SCOPE)
- Edición del título/descripción en el overlay ink — v2.
- Enriquecimiento de tareas YA adoptadas con el derivador LLM (existe `kodo comment`, Phase 60) — follow-up.
- Backfill del título de tareas ya creadas — bloqueado por ausencia de `updateTask` (FROZEN-9).
- claude-mem como fuente de memoria adicional — v1 se mantiene filesystem-based para no añadir dependencia MCP en el subproceso.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ORCH-02 | Al pulsar `a` sobre un surface ad-hoc, el dashboard ejecuta derivación LLM one-shot (`claude -p --model claude-haiku-4-5`, ≤timeout, never-throws/fail-open) que lee memoria del proyecto (GSD) o git log + primer prompt (non-GSD) y propone `{title, description}` ANTES de crear; segunda `a` confirma → `kodo adopt --title '…' --description '…'`. Invariantes: suelo determinista intacto, LLM solo en derivación, sanitizeAdoptionData aplica, execFile argv injection-inerte. | Spawn pattern (Pattern 2 + envelope verificado en vivo); parse path con `--json-schema` (Pattern 2); transcript parsing (Pattern 3 + formato `.jsonl` verificado); inserción en App.js (Pattern 4 + estados confirm verificados); `runAdopt` extensión `--description` (Pattern 1 — el flag CLI YA existe); fail-open + timeout empírico (Pitfalls 1-3); rama GSD/non-GSD vía `isGsdProject` (verificado). |
</phase_requirements>

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:child_process` (`execFile`) | builtin | Spawn de `claude -p` con argv literal (no shell) | Ya es el patrón del proyecto (`runAdopt`, `runFocus`, `runOpen`); injection-inerte (D-13) [VERIFIED: codebase grep] |
| `node:fs` (`readFileSync`/`existsSync`) | builtin | Leer PROJECT.md/ROADMAP/STATE + transcript `.jsonl` | DI-inyectable; `isGsdProject` ya usa `existsSync` inyectable [VERIFIED: src/adopt.js:38] |
| `node:test` + `node:assert/strict` | builtin | Test runner del proyecto | `package.json` test script = `node --test ...` [VERIFIED: package.json:10] |
| `claude` CLI | 2.1.191 | Binario externo del derivador (`-p --output-format json --json-schema`) | D-01/D-15; resuelto en PATH [VERIFIED: `claude --version` en vivo] |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `react` (`useState`) | (ya en deps) | Estado `'deriving'` en App.js | Para el spinner derive-then-confirm (D-08) [VERIFIED: App.js imports] |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| `--json-schema` (structured output) | Parsear el fence ` ```json ``` ` del `result` con regex | Sin schema el modelo envuelve la respuesta en markdown fence → parse frágil; con schema el `result` es JSON estricto directo. **Usar `--json-schema`.** [VERIFIED: probe en vivo] |
| `execFile` con PATH lookup | `config.claude.binary` (DEFAULT_CONFIG) | `config.claude.binary` = `/Applications/cmux.app/.../bin/claude` **NO existe en disco**; el `claude` real está en PATH. Resolver por PATH (o `execFile('claude', ...)` con shell:false). [VERIFIED: `ls` falló, `command -v claude` OK] |
| Spawn directo del binario | `cmux.send` (lo que hace launch.js:204) | launch.js NO spawnea `claude` directamente — lo envía como texto a un workspace cmux interactivo. Ese precedente NO aplica a un one-shot headless. **Usar `execFile('claude', ['-p', ...])` directo.** [VERIFIED: launch.js:196-204] |

**Installation:** Ninguna instalación npm nueva. Solo builtins + el CLI `claude` (dependencia de entorno aceptada en D-15).

## Package Legitimacy Audit

> No se instalan paquetes externos en esta fase. Todo es `node:*` builtin + el CLI `claude` (dependencia de entorno preexistente, D-15). **Package Legitimacy Gate: N/A** (cero dependencias nuevas de registro).

## Architecture Patterns

### System Architecture Diagram

```
  Operador pulsa `a` sobre surface ad-hoc (overlay picker)
        │
        ▼
  [App.js] resolveProjectId(cwd) ──── error none/ambiguous ──► footer ADOPT_NO_PROJECT (rojo), abort
        │ match único
        ▼
  setMode('deriving')  + render spinner "derivando…"      ◄── ESTADO NUEVO (entre arm y confirm)
        │
        ▼
  [enrich.js] deriveAdoptionMeta({ cwd, sessionId, isGsd, spawnFn, readFileFn, ... })
        │
        ├── isGsdProject(cwd)? ──YES──► leer .planning/PROJECT.md + ROADMAP.md + STATE.md (capped)
        │                       └─NO──► git log --oneline -N  +  primer prompt del transcript .jsonl
        │
        ▼
  construir prompt mínimo (D-07) con contexto inline
        │
        ▼
  execFile('claude', ['-p','--model','claude-haiku-4-5','--output-format','json',
                      '--json-schema', SCHEMA, prompt], { timeout: ~25_000 })
        │
        ├── ENOENT / timeout / exit≠0 / parse-fail ──► return {} (FAIL-OPEN)
        │
        ▼ stdout = envelope JSON
  JSON.parse(stdout) → envelope.is_error? ──true──► return {}
        │ false
        ▼
  JSON.parse(envelope.result) → { title, description }   (con --json-schema, result es JSON estricto)
        │
        ▼
  return { title, description }   (o {} en cualquier fallo)
        │
        ▼
  [App.js] setMode('confirm') + stash armedSurface={...title, description}
        │
        ▼  (operador pulsa `a` por segunda vez)
  onAdopt(armedSurface) ──► runAdopt({..., title, description})
        │                         │
        │                         ▼ argv literal (execFile, no shell)
        │            node bin/kodo adopt --workspace .. --cwd .. --session-id .. --project ..
        │                         --title '<derived>' --description '<derived>' --json
        ▼
  [core adoptSession] sanitizeAdoptionData (BIDIR-08) → createTask → addSession
        │  (title ausente → basename(cwd); core suelo 0-token intacto)
        ▼
  footer ADOPT_OK (verde) / ADOPT_ALREADY (ámbar) / error (rojo)
```

### Recommended Project Structure
```
src/cli/dashboard/
├── enrich.js        # NUEVO — deriveAdoptionMeta (never-throws, DI por *Fn)
├── adopt.js         # EXTENDER — runAdopt: añadir par `--description` (espejo de `--title`)
├── App.js           # EXTENDER — estado 'deriving' + spinner; await deriveAdoptionMeta entre arm y confirm
├── index.js         # EXTENDER — cablear onDerive (DI del spawn de claude) hacia App
└── select.js        # SIN CAMBIOS (resolveProjectId/computeAdoptable ya resuelven)
```

### Pattern 1: Extender `runAdopt` con `--description` (espejo de `--title`)
**What:** `runAdopt` ya inserta `--title` como par argv literal condicional (adopt.js:123). Añadir `--description` con el idéntico idioma. **El flag CLI `kodo adopt --description` YA existe y está enhebrado** — el único trabajo es que `runAdopt` lo inserte en el argv.
**When to use:** Siempre que la derivación produzca una descripción.
**Example:**
```javascript
// src/cli/dashboard/adopt.js — añadir al argv tras el bloque --title (línea ~123)
// Source: espejo EXACTO de la línea --title existente (VERIFIED: adopt.js:123)
...(typeof title === 'string' && title.length > 0 ? ['--title', title] : []),
...(typeof description === 'string' && description.length > 0 ? ['--description', description] : []),
```
**Cadena ya verificada (no requiere cambios aguas abajo):**
- `src/cli.js:250` registra `.option('--description <d>', 'Task description (optional)')` en el comando `adopt` [VERIFIED].
- `src/cli/adopt.js:174` pasa `description: opts.description` a `adoptSession` [VERIFIED].
- `adoptSession` (adopt.js:255-262) la omite si `undefined` y la enhebra a `createTask` [VERIFIED].
- Solo falta añadir `description` a la firma de `runAdopt` (adopt.js:91) y al wiring `onAdopt` de index.js:175-176.

### Pattern 2: Spawn one-shot de Haiku + parse del envelope (con `--json-schema`)
**What:** `execFile('claude', [...])` headless, sin tools, timeout acotado, parse de doble capa (envelope → result).
**When to use:** El núcleo de `enrich.js`.
**Example:**
```javascript
// src/cli/dashboard/enrich.js (nuevo) — never-throws, fail-open a {}
// Source: envelope shape VERIFICADO en vivo contra claude 2.1.191 (probe 2026-06-25)
const SCHEMA = JSON.stringify({
  type: 'object',
  properties: { title: { type: 'string' }, description: { type: 'string' } },
  required: ['title', 'description'],
  additionalProperties: false,
});

/**
 * @param {{
 *   prompt: string,
 *   spawnFn: (cmd, args, opts, cb) => any,   // execFile-shaped DI (NO default — leak guard)
 *   timeoutMs?: number,                       // ~25_000 (ver Pitfall 1)
 * }} args
 * @returns {Promise<{title?: string, description?: string}>}  // {} en CUALQUIER fallo
 */
export function spawnDerive({ spawnFn, prompt, timeoutMs = 25_000 }) {
  return new Promise((resolve) => {
    try {
      const argv = [
        '-p',
        '--model', 'claude-haiku-4-5',
        '--output-format', 'json',
        '--json-schema', SCHEMA,
        prompt,                       // argv literal — execFile, no shell → injection-inerte (D-13)
      ];
      spawnFn('claude', argv, { timeout: timeoutMs }, (err, stdout) => {
        if (err) return resolve({});                       // ENOENT / timeout / exit≠0
        try {
          const env = JSON.parse(stdout);                  // capa 1: envelope
          if (!env || env.is_error || typeof env.result !== 'string') return resolve({});
          const inner = JSON.parse(env.result);            // capa 2: result ES JSON estricto (con schema)
          const out = {};
          if (typeof inner.title === 'string' && inner.title.trim()) out.title = inner.title.trim();
          if (typeof inner.description === 'string' && inner.description.trim()) out.description = inner.description.trim();
          resolve(out);
        } catch { resolve({}); }                           // parse-fail → fail-open
      });
    } catch { resolve({}); }                               // spawn síncrono throw → fail-open
  });
}
```
**Envelope real verificado** (top-level keys): `type:'result'`, `subtype:'success'`, `is_error:false`, `result:<string>`, `session_id`, `total_cost_usd`, `usage`, `duration_ms`, `stop_reason`. Con `--json-schema`, `result` = `'{"title":"...","description":"..."}'` (JSON estricto, sin fence). [VERIFIED: probe en vivo]

### Pattern 3: Parsing del transcript `.jsonl` (primer prompt de usuario)
**What:** Leer `resolveTranscriptPath(cwd, sessionId)`, encontrar el PRIMER turno `type:'user'` con texto real.
**When to use:** Rama non-GSD (D-05/D-06).
**Example:**
```javascript
// src/cli/dashboard/enrich.js — never-throws
// Source: formato VERIFICADO leyendo transcripts reales en ~/.claude/projects (2026-06-25)
import { resolveTranscriptPath } from '../../logger-events.js';

export function firstUserPrompt({ cwd, sessionId, readFileFn }) {
  try {
    const path = resolveTranscriptPath(cwd, sessionId);
    const raw = readFileFn(path, 'utf8');                 // ENOENT → catch → ''
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }  // hay líneas no-mensaje (queue-operation)
      if (o.type !== 'user' || typeof o.message !== 'object') continue;
      const c = o.message.content;
      let text = '';
      if (typeof c === 'string') text = c;
      else if (Array.isArray(c)) {
        const hasToolResult = c.some((b) => b && b.type === 'tool_result');
        const texts = c.filter((b) => b && b.type === 'text').map((b) => b.text);
        if (hasToolResult && texts.length === 0) continue;  // tool_result-only → no es prompt
        text = texts.join(' ');
      }
      if (text && text.trim()) return text.trim().slice(0, 1500);  // cap (Pitfall 4)
    }
    return '';
  } catch { return ''; }
}
```
**Hallazgos de formato verificados:**
- El primer `type:'user'` aparece en línea **variable** (3, 4, 6, 11…), nunca asumas la línea 1.
- Hay líneas no-mensaje (`type:'queue-operation'`) → `JSON.parse` por línea con try/catch, saltar las no-`user`.
- `message.content` puede ser **string** o **array de bloques** (`text` / `tool_result`). Filtrar turnos tool_result-only.
- El primer prompt a menudo es un **prompt de agente inyectado** (claude-mem observer, compound-learning) o un **slash-command** (`<command-message>...<command-name>...<command-args>`). El planner puede optar por: (a) aceptarlo tal cual (señal imperfecta pero acotada), o (b) saltar prefijos `<command-*>` y agentes conocidos. Recomendación: aceptar tal cual en v1 + cap de chars; documentar como señal best-effort. [VERIFIED: 8 transcripts reales inspeccionados]

### Pattern 4: Estado `'deriving'` en App.js (derive-then-confirm)
**What:** Insertar un estado entre el primer `a` (arma, App.js:512-549) y el segundo `a` (ejecuta, App.js:580-617).
**When to use:** Para enmascarar la latencia de Haiku (D-08).
**Mecánica actual verificada (App.js):**
- `mode` ∈ `'list' | 'filter' | 'overlay' | 'confirm'` (App.js:339). **Añadir `'deriving'`.**
- Primer `a` (overlay picker, App.js:512): resuelve projectId, `setArmedSessionId` + `setArmedSurface({workspaceRef,cwd,sessionId,projectId,title})`, `setMode('confirm')`.
- **Punto de inserción:** entre la resolución de projectId (App.js:524) y `setMode('confirm')` (App.js:548): `setMode('deriving')` → `await onDerive({cwd, sessionId})` → fusionar `{title,description}` en `armedSurface` → `setMode('confirm')`. El `await` es legal (handler ya es `async` y usa `await onAdopt`, App.js:591) y never-throws (`onDerive` fail-open a `{}`).
- Segundo `a` (App.js:580): `onAdopt(armedSurface)` — `armedSurface` ya lleva `title`/`description` derivados → runAdopt los inserta como argv.
- **El confirm debe mostrar el `{title, description}` propuesto** (D-08). Hoy `ADOPT_CONFIRM(ref)` (App.js:184) solo muestra el ref; extender para mostrar el título derivado (o un nuevo render).
- **Esc / cualquier otra tecla en `confirm` cancela** (App.js:619-623) — ya cubre D-09 (v1 no-editable).
**Pitfall de re-render:** mientras `mode==='deriving'`, el poll sigue corriendo bajo (D-05 Phase 56); el `armedSurface` está congelado por identidad (sessionId) → el await no se invalida. Usar el patrón `overlayReqRef` (App.js:347) si se quiere invalidar una derivación obsoleta tras Esc.

### Anti-Patterns to Avoid
- **Resolver el binario `claude` vía `config.claude.binary`:** ese path NO existe en disco (verificado); usar PATH lookup. [VERIFIED]
- **`JSON.parse(envelope.result)` SIN `--json-schema`:** sin schema, `result` trae fence markdown → parse falla. Usar `--json-schema`. [VERIFIED]
- **Asumir que el primer prompt es la línea 1 del `.jsonl`:** es línea variable y puede ser no-`user`. [VERIFIED]
- **Pasar tools al subproceso:** D-02 manda subproceso SIN tools. NO añadir `--allowedTools`; `-p` headless sin MCP ni tools es lo deseado.
- **Lanzar el spawn vía shell (`exec`/`sh -c`):** rompe D-13 (injection-inerte requiere `execFile` argv literal).
- **Bloquear el adopt si `claude` falta:** D-03/D-15 → fail-open a basename.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Localizar el `.jsonl` de la sesión | Concatenar `~/.claude/projects/<encode>` a mano | `resolveTranscriptPath(cwd, sessionId)` (logger-events.js:107) | Ya encapsula el encoding `encodeURIComponent().replace(/%2F/g,'-')` empíricamente verificado (D-06) |
| Detectar proyecto GSD | `existsSync('.planning')` ad-hoc | `isGsdProject(projectPath, existsSyncFn)` (adopt.js:38) | DI-inyectable, never-throws, ya chequea PROJECT.md/STATE.md (D-04/D-05) |
| Sanear title/description antes del POST | Regex de redacción nueva | `sanitizeAdoptionData` (adopt.js:105) — ya corre en `adoptSession` | BIDIR-08 backstop; D-12 manda NO añadir saneo nuevo |
| Shell de `kodo adopt` never-throws | Nuevo wrapper de execFile | Extender `runAdopt` (adopt.js:91) con `--description` | Ya maneja ENOENT/NON_ZERO_EXIT/SPAWN_ERROR/ALREADY_ADOPTED + argv literal; el flag CLI ya existe |
| Mockear el spawn en tests | child_process real | DI por `*Fn` param `(cmd,args,opts,cb)` | Patrón del proyecto: `fakeExec` en focus.test.js:232 |
| Reverse-lookup cwd→projectId | Parseo nuevo de projects.json | `resolveProjectId` (select.js) | Ya maneja la forma `{default,modules}` real + none/ambiguous |

**Key insight:** Casi todo el andamiaje (path del transcript, detección GSD, saneo, shell de adopt + flag CLI `--description`, reverse-lookup, DI de spawn) ya existe y está verificado. El único código genuinamente nuevo es `enrich.js` (lectura de memoria + spawn de Haiku + parse) y el estado `'deriving'` en App.js. La fase es de **integración/wiring**, no de infraestructura nueva.

## Runtime State Inventory

> No es una fase de rename/refactor/migración — es feature nueva. **N/A.** No hay datos almacenados, config de servicio viva, estado OS-registrado ni artefactos de build afectados por strings renombrados. El único estado externo tocado es la tarea creada en Plane/GitHub vía `createTask` (sin cambios en su contrato).

## Common Pitfalls

### Pitfall 1: El timeout ~8s de D-03 corta casi todas las derivaciones (CRÍTICO)
**What goes wrong:** Mediciones reales de `claude -p --model claude-haiku-4-5 --output-format json` dieron **8.7s, 16.1s, 21.9s, 15.5s** (wallclock). Con timeout=8s casi todas las derivaciones legítimas se cortarían → fail-open sistemático a `basename(cwd)` → la fase NO arregla el bug que motiva ORCH-02 (título = basename, F2 del UAT).
**Why it happens:** Latencia del modelo + overhead del shim cmux + cache cold/warm + cola de la API. La latencia de Haiku en `-p` no es sub-segundo.
**How to avoid:** Elevar el timeout a **~25-30s** (D-03 delega el valor exacto al planner). La latencia se enmascara en el spinner derive-then-confirm (D-08) — el operador espera unos segundos, no es bloqueante percibido. Aceptar que una derivación lenta-pero-exitosa es mejor que un fail-open rápido a basename.
**Warning signs:** En testing manual, si TODOS los adopts caen a basename, el timeout es demasiado bajo.

### Pitfall 2: `result` viene con fence markdown si no se usa `--json-schema`
**What goes wrong:** Sin `--json-schema`, el `result` del envelope es ` ```json\n{...}\n``` ` → `JSON.parse(result)` lanza → fail-open siempre.
**Why it happens:** El modelo formatea su salida como bloque de código por defecto.
**How to avoid:** Usar `--json-schema '{...}'`; el `result` pasa a ser JSON estricto directo. [VERIFIED]
**Warning signs:** parse-error constante con `result` empezando por backticks.

### Pitfall 3: `config.claude.binary` apunta a un binario inexistente
**What goes wrong:** `DEFAULT_CONFIG.claude.binary = '/Applications/cmux.app/Contents/Resources/bin/claude'` NO existe en disco; resolver el spawn por ese path → ENOENT → fail-open siempre.
**Why it happens:** El `claude` real es un shim en una ruta temporal de cmux, resuelto vía PATH.
**How to avoid:** Spawn por PATH: `execFile('claude', argv, ...)` (execFile busca en PATH cuando el nombre no tiene `/`). NO usar `config.claude.binary`. [VERIFIED: `ls` del path falló]
**Warning signs:** ENOENT aunque `command -v claude` funcione en el shell.

### Pitfall 4: Contexto inline sin cap → coste/latencia desbordados
**What goes wrong:** PROJECT.md/ROADMAP/STATE pueden ser largos; inyectarlos completos infla input tokens, coste y latencia (ya alta).
**Why it happens:** D-02 inyecta el contenido en el prompt.
**How to avoid:** Caps concretos sugeridos: PROJECT.md ≤ 3000 chars, ROADMAP.md ≤ 2000 chars (preferir las primeras N líneas + el header de fases), STATE.md ≤ 2000 chars, git log `--oneline -20`, primer prompt ≤ 1500 chars. Total objetivo del contexto inline ≤ ~8000 chars. (Valores afinables por el planner.)
**Warning signs:** `total_cost_usd` por derivación notablemente > $0.03; latencia creciente.

### Pitfall 5: El "primer prompt" puede ser ruido sintético (agente/slash-command)
**What goes wrong:** El primer `type:'user'` es a menudo un prompt de agente inyectado o un `<command-message>` de slash-command → la derivación non-GSD se ancla en ruido en vez de intención.
**Why it happens:** Claude Code persiste prompts de subagentes y slash-commands como turnos `user`.
**How to avoid:** En v1, aceptar la señal best-effort + el `git log` como contrapeso (D-06: log = actividad). Opcional: saltar turnos cuyo texto empiece por `<command-` o que coincidan con prompts de agente conocidos. El prompt de derivación debe instruir al modelo a derivar el ALCANCE del proyecto, no a repetir el primer mensaje.
**Warning signs:** Títulos derivados que mencionan "claude-mem" / "compound learning" en proyectos no relacionados.

## Code Examples

### Prompt de derivación mínimo (D-07)
```javascript
// src/cli/dashboard/enrich.js — prompt NUEVO, mínimo (NO copiar la prosa del orquestador, D-07)
function buildDerivePrompt({ contextLabel, contextBody }) {
  return [
    'Derive a concise task title and a one-paragraph description for a coding session,',
    'based ONLY on the project context below. The title must reflect the PROJECT SCOPE',
    '(what the project is about) — NOT the directory name, NOT the latest commit.',
    'Return ONLY the structured fields requested.',
    '',
    `## ${contextLabel}`,
    contextBody,
  ].join('\n');
}
// contextLabel/contextBody:
//   GSD     → label "Project memory (GSD)", body = capped PROJECT.md + ROADMAP.md + STATE.md
//   non-GSD → label "Recent activity + intent", body = `git log --oneline -20` + firstUserPrompt(...)
```
La shell-safety NO requiere charset-restriction (D-07/D-13): el prompt va como argv literal a `execFile`; metacaracteres inertes. El `--json-schema` fuerza la salida estructurada (mejor que pedir JSON en prosa).

### Lectura de memoria GSD (capped, never-throws)
```javascript
// src/cli/dashboard/enrich.js
import { join } from 'node:path';
function readCapped(readFileFn, path, cap) {
  try { return readFileFn(path, 'utf8').slice(0, cap); } catch { return ''; }
}
function gsdContext({ cwd, readFileFn }) {
  const p = (f) => join(cwd, '.planning', f);
  const parts = [
    readCapped(readFileFn, p('PROJECT.md'), 3000),
    readCapped(readFileFn, p('ROADMAP.md'), 2000),
    readCapped(readFileFn, p('STATE.md'), 2000),
  ].filter(Boolean);
  return parts.join('\n\n---\n\n');
}
```

### git log non-GSD (DI del exec, never-throws)
```javascript
// Usar el MISMO spawnFn DI; git log es barato y rápido (no es el LLM)
function gitLog({ cwd, spawnFn }) {
  return new Promise((resolve) => {
    try {
      spawnFn('git', ['-C', cwd, 'log', '--oneline', '-20'], { timeout: 3000 },
        (err, stdout) => resolve(err ? '' : (stdout || '').slice(0, 2000)));
    } catch { resolve(''); }
  });
}
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Título = `basename(cwd)` (Phase 56 determinista) | Derivación LLM con fail-open a basename (esta fase) | Phase 62 | Título refleja alcance del proyecto; basename solo en fallo |
| At-adopt por el orquestador (ORCH-01) | At-adopt por el dashboard (ORCH-02) | Phase 62 supersede Phase 57 | El dashboard YA tiene las coordenadas (disuelve F1 del UAT) |
| Pedir JSON en prosa al modelo | `--json-schema` structured output | claude 2.1.x | `result` JSON estricto directo, parse robusto |

**Deprecated/outdated:**
- El camino at-adopt de ORCH-01 (orquestador): inalcanzable (coordenadas irresolubles). Queda como code-complete/UAT-failed; NO se toca (CONTEXT "Fuera de alcance").
- `config.claude.binary`: path obsoleto/inexistente; no usar para resolver el spawn.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A2 | Caps de contexto (3000/2000/2000/1500 chars) son razonables | Pitfall 4 | Coste/latencia; valores afinables, no bloqueantes |
| A3 | Las latencias medidas (15-22s) son representativas en runtime real del operador | Pitfall 1 | Si en la máquina del operador son menores, un timeout de 25s sigue siendo seguro (techo, no piso) |
| A4 | Aceptar el primer prompt sintético (agente/slash) como señal best-effort es aceptable en v1 | Pitfall 5 | Calidad del título non-GSD; mitigado por git log + prompt que pide alcance |
| A5 | `--json-schema` está soportado de forma estable en la versión de `claude` de todos los devs | Pattern 2 | Verificado en 2.1.191; si un dev tiene una versión vieja sin `--json-schema`, el spawn caería a fail-open (no rompe). El planner puede degradar a parse-de-fence como fallback secundario |

> **A1 RESUELTA (verificado):** `kodo adopt --description` YA está registrado en `src/cli.js:250` y enhebrado por `src/cli/adopt.js:174` → `adoptSession` → `createTask`. NO requiere cambio en el CLI. El único trabajo del carril shell es que `runAdopt` (dashboard/adopt.js) inserte el par `--description` en el argv + el wiring `onAdopt` de index.js lo pase. [VERIFIED]

## Open Questions (RESOLVED)

1. **¿Mostrar la descripción completa en el confirm o solo el título?**
   - What we know: D-08 dice "muestra `{title, description}` propuestos"; el confirm actual solo muestra el ref.
   - What's unclear: cuánto espacio vertical hay en el footer/overlay para la descripción.
   - Recommendation: mostrar título completo + descripción truncada (1-2 líneas) en el confirm; el operador confirma o Esc.
   - **RESOLVED (2026-06-25):** título truncado + descripción a 1-2 líneas con ellipsis `…`. Implementado en UI-SPEC §Visuals y en Plan 62-03 (SessionTable.js, confirm extendido).

2. **¿Invalidar una derivación obsoleta si el operador pulsa Esc mientras `mode==='deriving'`?**
   - What we know: el `await onDerive` puede seguir en vuelo cuando el operador cancela.
   - What's unclear: si conviene el patrón `overlayReqRef` (App.js:347) para descartar el resultado tardío.
   - Recommendation: usar un token de generación (espejo de `overlayReqRef`) para que un resultado que llega tras Esc no reabra el confirm. Bajo riesgo (never-throws), pero limpio.
   - **RESOLVED (2026-06-25):** sí, vía token de generación (espejo de `overlayReqRef`). Un resultado que llega tras Esc se descarta y no reabre el confirm. Implementado en Plan 62-03 (App.js, estado `deriving` + cancelación con token).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `claude` CLI (en PATH) | Derivador LLM (D-01) | ✓ | 2.1.191 | fail-open → basename(cwd) (D-03/D-15) |
| `claude -p --json-schema` | Parse robusto (Pattern 2) | ✓ | 2.1.191 | degradar a parse-de-fence (A5) o fail-open |
| `claude-haiku-4-5` (modelo) | Derivación barata (D-01) | ✓ | n/a | fail-open si el modelo no resuelve |
| `git` | git log non-GSD (D-05) | ✓ (asumido en máquina de dev) | — | contexto vacío → derivación con menos señal |
| `node:*` builtins | Todo el módulo | ✓ | runtime del proyecto | — |

**Missing dependencies with no fallback:** Ninguna — todo tiene fail-open a basename (D-03).
**Missing dependencies with fallback:** `claude` ausente → basename; `--json-schema` no soportado → parse-de-fence o fail-open.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (builtin) + `node:assert/strict` |
| Config file | none — `package.json` script `"test": "node --test $(find test -name '*.test.js' -type f)"` |
| Quick run command | `node --test test/dashboard/enrich.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ORCH-02 | Parse del envelope feliz → `{title,description}` | unit | `node --test test/dashboard/enrich.test.js` | ❌ Wave 0 |
| ORCH-02 | `is_error:true` en envelope → `{}` (fail-open) | unit | idem | ❌ Wave 0 |
| ORCH-02 | stdout no-JSON / `result` no-JSON → `{}` (parse-fail) | unit | idem | ❌ Wave 0 |
| ORCH-02 | `spawnFn` cb con ENOENT → `{}` (claude ausente) | unit | idem | ❌ Wave 0 |
| ORCH-02 | `spawnFn` cb con err.killed (timeout) → `{}` | unit | idem | ❌ Wave 0 |
| ORCH-02 | `spawnFn` throw síncrono → `{}` (never-throws) | unit | idem | ❌ Wave 0 |
| ORCH-02 | Rama GSD: lee PROJECT/ROADMAP/STATE capped | unit | idem (readFileFn fake) | ❌ Wave 0 |
| ORCH-02 | Rama non-GSD: usa git log + primer prompt | unit | idem (existsSyncFn=false, readFileFn fake) | ❌ Wave 0 |
| ORCH-02 | transcript: primer `user` en línea variable, salta `queue-operation` | unit | idem (transcript fixture) | ❌ Wave 0 |
| ORCH-02 | transcript: content array con tool_result-only → saltado | unit | idem | ❌ Wave 0 |
| ORCH-02 | transcript ausente (ENOENT) → '' | unit | idem | ❌ Wave 0 |
| ORCH-02 | `runAdopt` inserta `--description` cuando presente, lo omite si vacío | unit | `node --test test/dashboard/adopt.test.js` | ⚠️ existe, extender |
| ORCH-02 | argv literal: title/description con metacaracteres → un solo arg (injection-inerte) | unit | idem (fakeExec captura argv) | ⚠️ existe, extender |
| ORCH-02 | App.js: `mode 'deriving'` entre arm y confirm; onDerive fusiona en armedSurface | unit | `node --test test/dashboard/app-*.test.js` | ❌ Wave 0 |
| ORCH-02 | App.js: Esc en confirm cancela (v1 no-editable, D-09) | unit | idem | ⚠️ ya cubierto por confirm existente |

### Sampling Rate
- **Per task commit:** `node --test test/dashboard/enrich.test.js` (+ el test del archivo tocado)
- **Per wave merge:** `npm test` (suite completa)
- **Phase gate:** suite verde antes de `/gsd:verify-work`. **Test manual/UAT obligatorio:** el comportamiento LLM (calidad del título derivado, derive-then-confirm en vivo) NO es determinista → requiere HUMAN-UAT contra una sesión ad-hoc real (igual que ORCH-01), incluyendo el caso que originó la fase (ROMAN-194 / scp-cmri: el título debe reflejar el proyecto, no `scp-cmri`).

### Wave 0 Gaps
- [ ] `test/dashboard/enrich.test.js` — cubre el parse del envelope, fail-open (ENOENT/timeout/parse-fail/throw), ramas GSD/non-GSD, parsing del transcript. Usa `spawnFn`/`readFileFn`/`existsSyncFn` fakes (NO invoca `claude` real).
- [ ] Fixtures de transcript `.jsonl` (sintéticos): primer `user` en línea variable, `queue-operation` intercaladas, content string vs array, tool_result-only, ausente.
- [ ] Extender `test/dashboard/adopt.test.js` — assert del par `--description` en argv (presente/omitido) + injection-inerte con metacaracteres.
- [ ] App.js: test del estado `'deriving'` + onDerive DI (fusión en armedSurface) — patrón de los tests `app-*.test.js` existentes.
- [ ] Framework install: ninguno (node:test builtin).

## Security Domain

> `security_enforcement` no aparece explícito en config.json → tratado como habilitado. Esta fase tiene una superficie de seguridad acotada (un spawn argv-literal + lectura de fs local), pero la trust boundary local→externa (la tarea creada en Plane/GitHub) ya está defendida.

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | El derivador no autentica (usa la sesión `claude` del operador) |
| V3 Session Management | no | — |
| V4 Access Control | no | Acción local del operador en su propia máquina |
| V5 Input Validation | yes | El `{title,description}` derivado pasa por `sanitizeAdoptionData` (BIDIR-08) ANTES del POST (D-12). El parse del envelope valida tipos (string trim) antes de usar. |
| V6 Cryptography | no | — |

### Known Threat Patterns for {stack: Node CLI spawn + LLM output}
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Inyección de comando shell vía title/cwd/prompt | Tampering | `execFile` argv literal, NO shell (D-13). Metacaracteres inertes — verificado por el patrón de `runAdopt`. T-57-01 no aplica. |
| Leak de rutas/home en el title/description hacia el provider | Information Disclosure | `sanitizeAdoptionData` redacta home/paths en `adoptSession` (BIDIR-08 / D-12) — backstop estructural, ya cubre el output del LLM |
| Output LLM malicioso/hostil (prompt-injection en el transcript) | Tampering | El output solo se usa como `title`/`description` (texto, saneado); el subproceso NO lleva tools → no puede ejecutar nada (D-02). Peor caso: un título raro, saneado por BIDIR-08. |
| Forward de transcript completo al provider | Information Disclosure | `sanitizeAdoptionData` no acepta transcript (T-53-04 structural); el derivador inyecta el transcript SOLO en el prompt local de Haiku, nunca lo persiste ni lo envía al task tracker |
| DoS por derivación colgada | DoS | timeout acotado (~25s) + kill (execFile `timeout` opt) + fail-open; el panel ink nunca se bloquea (never-throws) |

## Sources

### Primary (HIGH confidence)
- Código real del repo (lectura directa): `src/cli/dashboard/adopt.js`, `App.js`, `select.js`, `index.js`; `src/adopt.js`; `src/logger-events.js`; `src/orchestrator/launch.js`; `src/config.js`; `src/cli.js`; `src/cli/adopt.js`; `package.json`; `test/dashboard/focus.test.js`.
- Probe en vivo del CLI `claude` 2.1.191: envelope shape de `claude -p --output-format json`, comportamiento de `--json-schema`, latencias reales (8.7-21.9s), `--help` (flags `-p`/`--output-format`/`--json-schema`/`--model`).
- Inspección de transcripts reales en `~/.claude/projects/*/*.jsonl` (8 archivos): formato de líneas, posición variable del primer `user`, content string vs array, líneas `queue-operation`, prompts sintéticos.
- `.planning/REQUIREMENTS.md` §ORCH-02; `.planning/phases/57-orquestador-asistido/57-HUMAN-UAT.md` (F1/F2); `62-CONTEXT.md` (D-01..D-15).

### Secondary (MEDIUM confidence)
- Caps de contexto sugeridos (Pitfall 4): heurística, no medida.

### Tertiary (LOW confidence)
- Ninguna — todos los claims load-bearing se verificaron en vivo o por lectura de código.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — builtins + CLI verificado en vivo.
- Architecture: HIGH — todos los puntos de inserción y assets reusables leídos en el código real.
- Pitfalls: HIGH — los tres pitfalls críticos (timeout, fence markdown, binary inexistente) verificados empíricamente.
- Validation: HIGH — runner confirmado, patrón DI de fakes confirmado en tests existentes.

**Research date:** 2026-06-25
**Valid until:** 2026-07-25 (estable; salvo que cambie el envelope de `claude` o el formato del transcript — verificar latencias y `--json-schema` si la versión de `claude` cambia de major).
