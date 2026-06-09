# Phase 45: Spike — captura de plan no-GSD vía hook - Research

**Researched:** 2026-06-09
**Domain:** Claude Code hooks lifecycle · `ExitPlanMode` tool · permission modes (`bypassPermissions` / `--dangerously-skip-permissions`) · diseño de experimento empírico reproducible
**Confidence:** MEDIUM — el catálogo de eventos y el mecanismo de hooks están bien documentados (HIGH); el comportamiento exacto de `ExitPlanMode` **bajo `--dangerously-skip-permissions`** es justamente lo que el spike debe resolver empíricamente (LOW por diseño — esa es la pregunta de la fase, no un fallo de research).

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01 (método empírico):** El veredicto se obtiene mediante un **experimento real y reproducible**, NO análisis documental. Se instala un **hook de prueba temporal e instrumentado** que vuelca a un fichero de log el **payload completo** recibido por stdin (espejo de cómo `session-start.js` lee stdin), y se lanza una sesión real `claude --dangerously-skip-permissions` que provoque un plan. La evidencia (comando exacto, hook instalado, payload crudo capturado **o su ausencia**) se transcribe literalmente al documento. El hook de prueba se instala/desinstala **manualmente** vía el mismo mecanismo que `src/hooks/install.js` (`~/.claude/settings.json`) y **NO se commitea a producción**.
- **D-02 (eventos a evaluar):** Hipótesis primaria `PostToolUse` con matcher `ExitPlanMode`. Si NO dispara bajo `--dangerously-skip-permissions`, ejecutar **barrido de eventos SOPORTADOS** (`PreToolUse`/`PostToolUse` sobre otras tools, `UserPromptSubmit`, `Stop`, `Notification`) para localizar el evento más cercano que porte plan o intención. El barrido **nunca** desciende a parsear transcript crudo ni rutas internas (D-07).
- **D-03 (veredicto binario):** El documento abre con **VIABLE** o **INVIABLE**. "Capturable" exige DOS condiciones: (a) el payload contiene el **texto del plan**, y (b) es **correlacionable** (`session_id` y/o `cwd` presentes). Disparar sin portar plan o sin correlación = **INVIABLE**.
- **D-04 (contrato si VIABLE):** Si VIABLE, especificar contrato de captura **PROPIO de kodo** (espejo de `session-start.js`): hook recibe payload → extrae plan → kodo persiste en **su propio side**, correlacionado por **`task_id`** vía `findSession` (`session_id`/`cwd` → `task_id`). NUNCA parsing de rutas internas de Claude Code. Define explícitamente: (1) qué evento, (2) qué campo del payload contiene el plan, (3) dónde persiste kodo, (4) cómo correlaciona con `task_id`, (5) cómo el overlay de Phase 44 (`mode:'overlay'`, snapshot congelado, never-throws) se **reusa**. Si INVIABLE, registrar decisión de **diferir PLAN-04 a v2** sin bloquear el milestone.
- **D-05 (entregable):** **`45-SPIKE.md`** en el phase dir con estructura: (1) Veredicto binario arriba; (2) Hipótesis y método; (3) Evidencia reproducible (comandos exactos + payloads crudos o ausencia documentada); (4) Contrato de captura para Phase 46 si VIABLE, o decisión de diferir PLAN-04 a v2 si INVIABLE. **Evidencia > opinión.**
- **D-06 (spike puro):** Cero implementación de producción. El hook de prueba es temporal y se desinstala. El veredicto **gobierna** si Phase 46 se planifica/ejecuta o se corta a v2.
- **D-07 (solo caminos soportados):** El único mecanismo evaluable es un hook **soportado y documentado**. Fuera de scope: transcript JSONL crudo, `~/.claude/plans/`, `~/.claude/todos/`.

### Claude's Discretion

- Tarea/tool concreta usada para forzar un plan en la sesión de prueba (algo que naturalmente invoque plan mode) y el formato exacto del log de instrumentación.
- Si el barrido de eventos (D-02) se ejecuta como **matriz** (varios eventos instrumentados a la vez) o **secuencial**.
- Ubicación exacta del fichero de log temporal (p. ej. `/tmp/kodo-spike-*.log`).

### Deferred Ideas (OUT OF SCOPE)

- **Implementación de captura/persistencia** → Phase 46 (PLAN-04, condicional a este veredicto).
- **Parsear transcript JSONL / `~/.claude/plans/` / `~/.claude/todos/`** → fuera de scope permanente (formato no documentado/frágil).
- **Mostrar todos/Tasks en vivo** → v2 (PLAN-F2): sin fuente soportada.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| PLAN-03 | *(spike — gate de PLAN-04)* Determinar empíricamente si las sesiones kodo no-GSD/quick (lanzadas con `--dangerously-skip-permissions`) emiten un plan capturable vía un hook **soportado** de Claude Code (`PostToolUse` sobre `ExitPlanMode`, o equivalente). Documentar el mecanismo viable o concluir inviable con evidencia. | El research aporta: (1) el catálogo verificado de eventos soportados y sus matchers (§Standard Stack / §Hook Events Catalog); (2) el campo del payload que portaría el plan (`tool_input.plan` para ExitPlanMode); (3) la evidencia documental/comunitaria del comportamiento ExitPlanMode↔hooks↔skip-permissions y **qué solo puede zanjarse empíricamente** (§Common Pitfalls, §Open Questions); (4) el diseño reproducible del experimento (§Experiment Design / §Code Examples); (5) el modelo del contrato de captura si VIABLE (§Architecture Patterns), espejo de `session-start.js`. |
</phase_requirements>

## Summary

Esta fase es un **spike empírico**: el research NO resuelve el veredicto — diseña el experimento que lo resolverá. Lo que el research SÍ establece es el terreno documental contra el que se mide la evidencia.

Tres hechos verificados anclan el experimento:

1. **El catálogo de hooks soportados está documentado** y `PostToolUse`/`PreToolUse` matchean por **nombre de tool** (regex sobre `tool_name`). `ExitPlanMode` es un nombre de tool válido y matcheable. El payload común de todos los eventos incluye `session_id`, `cwd`, `transcript_path`, `hook_event_name`, `permission_mode` — los campos exactos que kodo ya consume en `session-start.js` para correlacionar vía `findSession`. [CITED: code.claude.com/docs/en/hooks]

2. **En el caso normal, `PostToolUse` sobre `ExitPlanMode` SÍ dispara y el payload lleva el plan.** Issue #20397 lo confirma empíricamente ("this hook works fine when i accept the plan without clearing context"); el tool `ExitPlanMode` recibe su contenido en `tool_input.plan` (markdown del plan). [CITED: github.com/anthropics/claude-code/issues/20397]

3. **El crux INVIABLE/VIABLE es la interacción con `--dangerously-skip-permissions`** (= modo `bypassPermissions`). La doc oficial confirma que `bypassPermissions` **deshabilita prompts y safety checks** — y el gate de aprobación de plan es precisamente un prompt. Hay bugs documentados (#32934, v2.1.72) donde combinar skip-permissions con plan mode rompe la transición `ExitPlanMode`. **Si el gate de plan no se activa, `ExitPlanMode` podría no invocarse nunca → el hook nunca dispara.** Esto es exactamente lo que solo el experimento puede zanjar. [CITED: code.claude.com/docs/en/permission-modes] [CITED: github.com/anthropics/claude-code/issues/32934]

**Primary recommendation:** Diseñar el experimento como una **matriz de 2×N**: dos formas de provocar plan mode (arranque con `--permission-mode plan` + skip-permissions vs. toggle `Shift+Tab` en sesión skip-permissions) cruzadas con un `settings.json` de prueba que instrumente **simultáneamente** `PostToolUse:ExitPlanMode`, `PreToolUse:ExitPlanMode`, `UserPromptSubmit`, `Stop` y `Notification`. Cada hook vuelca su payload crudo a `/tmp/kodo-spike-*.log`. El veredicto se lee de qué fichero(s) de log contienen plan + correlación. El comando exacto que fuerza un plan es discreción del executor (D-02 discretion).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Emisión del evento de hook con el plan | Claude Code (host externo) | — | El plan lo genera y emite Claude Code; kodo es consumidor pasivo del payload por stdin. **No es controlable por kodo** — de ahí que sea un spike. |
| Instrumentación temporal (volcar payload) | Hook script de prueba (kodo-side, temporal) | `~/.claude/settings.json` | El hook script lee stdin (espejo `readStdin` de `session-start.js`) y escribe a fichero. Se registra en settings.json como cualquier hook kodo. |
| Correlación sesión → `task_id` | kodo `findSession` (`src/session/state.js`) | `state.json` (sessions + history) | Ya existe y es dual-scan never-throws. El contrato de captura (si VIABLE) la reusa **tal cual**. |
| Persistencia del plan capturado (Phase 46, si VIABLE) | kodo own-side (dir/estado de sesión kodo) | — | NUNCA `~/.claude/plans/`. Invariante D-04/D-07: kodo persiste en su propio lado. |
| Render del plan capturado (Phase 46, si VIABLE) | Overlay `mode:'overlay'` Phase 44 (`src/cli/dashboard/`) | filesystem read (cero endpoints) | Diseñado para reusarse; consume `lines[]` scrollable congelado. |

## Standard Stack

> Nota: esta fase es un **spike** — no instala paquetes externos ni añade dependencias. El "stack" relevante es el **contrato de hooks de Claude Code** (superficie externa que kodo consume) y los módulos kodo existentes que el experimento imita. No hay `npm install`. No aplica `## Package Legitimacy Audit` (cero paquetes nuevos).

### Hook Events Catalog (superficie externa evaluada)

Eventos **soportados y documentados** relevantes al spike. Todos reciben un objeto JSON único por stdin con los campos comunes `session_id`, `transcript_path`, `cwd`, `hook_event_name`, `permission_mode`. [CITED: code.claude.com/docs/en/hooks]

| Evento | Cuándo dispara | Matcher | Campos payload clave | Rol en el spike |
|--------|----------------|---------|----------------------|-----------------|
| `PostToolUse` | Tras una tool call exitosa | Nombre de tool (regex sobre `tool_name`) — p. ej. `ExitPlanMode` | `tool_name`, `tool_input`, `tool_response` (+ comunes) | **Hipótesis primaria (D-02).** Si dispara con matcher `ExitPlanMode`, `tool_input.plan` portaría el markdown del plan. |
| `PreToolUse` | Antes de ejecutar una tool call | Nombre de tool | `tool_name`, `tool_input` (sin `tool_response`) | Fallback: `tool_input.plan` ya presente antes de la ejecución/aprobación. |
| `UserPromptSubmit` | Al enviar el usuario un prompt, antes de procesarlo | Ninguno (siempre) | `prompt` (+ comunes, incl. `permission_mode`) | Fallback de barrido: captura intención, no el plan formal. |
| `Stop` | Cuando Claude termina de responder | Ninguno (siempre) | `permission_mode`, `effort` (+ comunes) | Fallback: dispara siempre pero **sin contexto** que distinga "salida de plan mode" de otro stop (limitación conocida, #21282). kodo ya inyecta este hook. |
| `Notification` | Cuando Claude Code emite una notificación | `permission_prompt`, `idle_prompt`, etc. | `message`, `notification_type` (+ comunes) | Fallback de barrido: podría señalar el prompt de aprobación de plan, pero no porta el plan. |
| `SessionStart` | Inicio/resume de sesión | `startup`/`resume`/`clear`/`compact` | `source` (+ comunes) | **Ya inyectado por kodo** — referencia del patrón de correlación, no candidato de captura. |

**Campo que portaría el plan:** Para el tool `ExitPlanMode`, el argumento es `plan` (markdown del plan propuesto), accesible como `tool_input.plan` en `PreToolUse`/`PostToolUse`. [CITED: github.com/anthropics/claude-code/issues/20397] [ASSUMED — el nombre exacto del campo `plan` proviene de la convención comunitaria/plankit; el experimento debe confirmar el nombre literal volcando el payload crudo]

**Matcher syntax:** El matcher es un regex que filtra qué tool dispara el hook. `"ExitPlanMode"` matchea el tool ExitPlanMode; `"Edit|Write"` matchea cualquiera. Case-sensitive, exacto al nombre del tool. [CITED: code.claude.com/docs/en/hooks]

### Módulos kodo que el experimento imita (no se modifican — spike puro)

| Módulo | Qué aporta al spike | Cómo se usa |
|--------|---------------------|-------------|
| `src/hooks/install.js` (`addHook`/`installHooks`/`uninstallHooks`) | Patrón de escritura/borrado no-clobber en `~/.claude/settings.json` | El hook de prueba se registra con el mismo shape (`hooks[event].push({ hooks: [{ type:'command', command }] })`) y se desinstala con el filtro `command?.includes(...)`. |
| `src/hooks/session-start.js` (`readStdin`, parseo de `input.cwd`/`input.session_id`/`input.transcript_path`) | Plantilla exacta de lectura de stdin con timeout 3s | El script instrumentado del spike vuelca **este mismo `input`** crudo a fichero. |
| `src/session/state.js` (`findSession({ sessionId, cwd })`) | Correlación dual-scan `session_id`/`cwd` → `task_id`, never-throws | El contrato de captura (si VIABLE) la reusa tal cual para mapear el payload del plan a `task_id`. |

### Alternatives Considered

| En vez de | Se podría usar | Tradeoff |
|-----------|----------------|----------|
| Hook soportado | Parsear transcript JSONL / `~/.claude/plans/` | **Prohibido por D-07 / Out of Scope.** Formato no documentado, frágil entre versiones. No evaluable. |
| `PostToolUse:ExitPlanMode` | Eventos genéricos del barrido (D-02) | Solo se desciende al barrido si el primario no dispara; los genéricos rara vez portan el plan completo + correlación a la vez (umbral D-03 de "capturable"). |

## Architecture Patterns

### System Architecture Diagram — flujo del experimento (spike)

```
[Operador]
    │  1. claude --dangerously-skip-permissions [--permission-mode plan]
    ▼
[Sesión Claude Code real]
    │  2. prompt que fuerza un plan (discreción executor)
    ▼
[¿Se activa el gate de plan mode bajo skip-permissions?]  ◄── CRUX EMPÍRICO
    │
    ├── SÍ → Claude invoca tool ExitPlanMode(plan="...")
    │         │
    │         ▼
    │    [Claude Code dispara hooks soportados]
    │         │  payload JSON por stdin: { session_id, cwd, tool_name:'ExitPlanMode',
    │         │                            tool_input:{ plan:'...' }, permission_mode, ... }
    │         ▼
    │    [Hook de prueba instrumentado]  (espejo readStdin de session-start.js)
    │         │  vuelca payload CRUDO →  /tmp/kodo-spike-<event>.log
    │         ▼
    │    [Evidencia: log contiene plan + session_id/cwd?]
    │         ├── SÍ ambos → VIABLE
    │         └── plan ausente / sin correlación → INVIABLE
    │
    └── NO (skip-permissions evita el gate) → ExitPlanMode nunca se invoca
              │
              ▼
         [Barrido D-02: ¿algún otro evento soportado portó el plan?]
              ├── SÍ (plan + correlación) → VIABLE (vía evento alternativo)
              └── ninguno → INVIABLE  → diferir PLAN-04 a v2
```

> El diagrama traza el camino del dato desde el comando del operador hasta el veredicto. El nodo "¿Se activa el gate de plan mode bajo skip-permissions?" es lo que NINGUNA fuente documental zanja — es el output del experimento.

### Pattern 1: Hook instrumentado de volcado de payload (modelo del script de prueba)

**What:** Un script Node de una sola responsabilidad — leer stdin completo y anexarlo crudo a un fichero, sin parsear ni decidir nada. Espejo minimalista de `readStdin` de `session-start.js`.
**When to use:** Como hook de prueba temporal registrado en cada evento instrumentado del barrido (D-02). Se desinstala tras el experimento (D-06).
**Example:**
```javascript
// Source: espejo de readStdin en src/hooks/session-start.js (líneas 185-195)
// Hook de prueba temporal — NO se commitea (D-06). Una sola responsabilidad:
// volcar el payload crudo + timestamp, never-throw (no romper Claude Code).
import { appendFileSync } from 'node:fs';

const LOG = process.env.KODO_SPIKE_LOG || '/tmp/kodo-spike.log';
const STDIN_TIMEOUT = 3000;

function readStdin() {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('{}'), STDIN_TIMEOUT);
    const chunks = [];
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', () => { clearTimeout(timer); resolve(Buffer.concat(chunks).toString()); });
  });
}

(async () => {
  try {
    const raw = await readStdin();
    // Volcado CRUDO — el valor del spike es el payload literal, sin transformar.
    appendFileSync(LOG, `\n===== ${new Date().toISOString()} =====\n${raw}\n`);
  } catch { /* never break Claude Code — espejo del contrato never-throws de kodo */ }
})();
```

### Pattern 2: Registro/desinstalación del hook de prueba en settings.json

**What:** Inserción no-clobber del hook de prueba en `~/.claude/settings.json` y su retirada, exactamente como `addHook`/`uninstallHooks`.
**When to use:** Setup y teardown del experimento. El teardown es **obligatorio** (D-06: el hook es temporal).
**Example:**
```json
// Source: shape producido por addHook() en src/hooks/install.js (líneas 91-109).
// settings.json de prueba — matriz de eventos instrumentados a la vez (D-02 discretion).
{
  "hooks": {
    "PostToolUse": [
      { "matcher": "ExitPlanMode",
        "hooks": [{ "type": "command", "command": "KODO_SPIKE_LOG=/tmp/kodo-spike-posttool-exitplan.log node /abs/path/spike-dump.js" }] }
    ],
    "PreToolUse": [
      { "matcher": "ExitPlanMode",
        "hooks": [{ "type": "command", "command": "KODO_SPIKE_LOG=/tmp/kodo-spike-pretool-exitplan.log node /abs/path/spike-dump.js" }] }
    ],
    "UserPromptSubmit": [
      { "hooks": [{ "type": "command", "command": "KODO_SPIKE_LOG=/tmp/kodo-spike-userprompt.log node /abs/path/spike-dump.js" }] }
    ],
    "Stop": [
      { "hooks": [{ "type": "command", "command": "KODO_SPIKE_LOG=/tmp/kodo-spike-stop.log node /abs/path/spike-dump.js" }] }
    ],
    "Notification": [
      { "hooks": [{ "type": "command", "command": "KODO_SPIKE_LOG=/tmp/kodo-spike-notification.log node /abs/path/spike-dump.js" }] }
    ]
  }
}
```
**Nota crítica de teardown:** Los hooks `SessionStart`/`Stop` de kodo PRODUCCIÓN viven en el mismo `~/.claude/settings.json`. El setup del spike **NO debe clobber-ear** la entrada `Stop` de kodo: o se hace backup del settings.json antes y restore después, o se añade la entrada `Stop` de prueba **junto a** la de kodo (array). El teardown debe dejar el settings.json byte-idéntico al estado previo salvo los hooks kodo legítimos.

### Pattern 3: Contrato de captura propio (modelo a especificar SOLO si VIABLE — D-04)

**What:** El flujo que Phase 46 implementaría si el spike sale VIABLE. Espejo directo de `session-start.js main()`.
**When to use:** En la sección (4) de `45-SPIKE.md` únicamente si el veredicto es VIABLE.
**Example:**
```javascript
// Source: modelo derivado de main() en src/hooks/session-start.js (líneas 197-253).
// Contrato de captura Phase 46 (NO se implementa en el spike — solo se especifica).
async function capturePlanHook() {
  try {
    const input = JSON.parse(await readStdin());           // payload del evento VIABLE
    const cwd = input.cwd || process.cwd();
    const sessionId = input.session_id;
    const result = findSession({ sessionId, cwd });          // (4) correlación → task_id
    if (!result) process.exit(0);                            // no-tracked → silent (never-throws)
    const planText = input.tool_input?.plan;                 // (2) campo del plan (a confirmar)
    if (!planText) process.exit(0);
    // (3) kodo persiste en SU PROPIO side, correlacionado por task_id:
    persistPlanForTask(result.session.task_id, planText);    // NUNCA ~/.claude/plans/
  } catch { /* never break Claude Code */ }
}
// (5) El overlay mode:'overlay' de Phase 44 lee el plan persistido (filesystem, cero endpoints).
```

### Anti-Patterns to Avoid

- **Declarar INVIABLE sin ejecutar el barrido D-02:** Si `PostToolUse:ExitPlanMode` no dispara, **antes** de concluir INVIABLE hay que probar los otros eventos soportados. Saltarse el barrido produce un falso INVIABLE.
- **Volcar payload parseado/transformado en vez de crudo:** El valor del spike es el payload **literal**. Parsear antes de volcar puede ocultar campos inesperados (p. ej. el nombre real del campo del plan si no es `plan`).
- **Clobber-ear los hooks de producción de kodo en settings.json:** El teardown debe preservar `SessionStart`/`Stop` de kodo. Hacer backup/restore del fichero completo es lo más seguro.
- **Confiar en una sola forma de entrar a plan mode:** El bug #32934 muestra que el comportamiento difiere según se entre vía `--permission-mode plan` vs `Shift+Tab`. La matriz debe cubrir ambas.
- **Descender a parsear transcript JSONL / rutas internas** cuando los hooks fallen: prohibido por D-07. Si ningún hook soportado porta el plan, el veredicto es INVIABLE — no se busca un workaround vía rutas internas.

## Don't Hand-Roll

| Problema | No construir | Usar en su lugar | Por qué |
|----------|--------------|------------------|---------|
| Leer stdin del hook con timeout | Un reader de stdin nuevo | `readStdin` de `session-start.js` (verbatim) | Ya resuelve el timeout 3s y el caso de stdin vacío (`'{}'`). El spike lo copia, no lo reinventa. |
| Correlacionar `session_id`/`cwd` → `task_id` | Un lookup ad-hoc en state.json | `findSession({ sessionId, cwd })` | Dual-scan (sessions + history), never-throws, prioridad sessions. Es el contrato canónico. |
| Insertar/quitar hook en settings.json | Edición manual frágil del JSON | Patrón `addHook`/`uninstallHooks` de `install.js` | No-clobber por construcción; el filtro de desinstalación ya existe. |
| Detectar "salida de plan mode" | Inferir desde el evento `Stop` | El tool `ExitPlanMode` vía su matcher | `Stop` dispara siempre sin contexto distintivo (#21282) — no distingue salida de plan de otro stop. |

**Key insight:** Todo el andamiaje que el spike necesita (lectura stdin, correlación, registro de hook) **ya existe** en kodo y es reusable verbatim. El único elemento nuevo es el script de volcado de ~15 líneas, y es desechable. El esfuerzo del spike es **empírico** (lanzar la sesión, leer los logs), no de ingeniería.

## Runtime State Inventory

> Spike puro: el único estado runtime tocado es la entrada temporal en `~/.claude/settings.json`. Inventario para garantizar teardown limpio (D-06).

| Categoría | Items encontrados | Acción requerida |
|-----------|-------------------|------------------|
| Stored data | Ninguno — el spike no escribe a `state.json` de kodo ni a ningún datastore. Solo lee vía `findSession` si se prueba la correlación. | None — verificado: el script de volcado solo hace `appendFileSync` a `/tmp`. |
| Live service config | **`~/.claude/settings.json`**: el spike AÑADE entradas de hook de prueba temporales junto a los `SessionStart`/`Stop` de kodo producción. | **Teardown obligatorio**: backup del settings.json antes / restore después (o borrado quirúrgico de las entradas de prueba). El plan DEBE incluir una tarea de teardown verificada. |
| OS-registered state | Ninguno — no hay tasks de OS, launchd, ni procesos persistentes. | None — verificado. |
| Secrets/env vars | `KODO_SPIKE_LOG` (env var efímera del comando, no persistida). | None — vive solo en la línea de comando del hook de prueba. |
| Build artifacts | Ninguno — no se compila ni instala nada. Los `/tmp/kodo-spike-*.log` son evidencia, no artefactos de build. | Opcional: limpiar `/tmp/kodo-spike-*.log` tras transcribir la evidencia al documento. |

**Canonical question — qué runtime systems quedan con estado tras el experimento:** Solo `~/.claude/settings.json` (entradas de prueba) y `/tmp/kodo-spike-*.log` (evidencia). Ambos los retira el teardown. Cero estado en el repo, cero código de producción commiteado (D-06).

## Common Pitfalls

### Pitfall 1: `--dangerously-skip-permissions` evita el gate de plan → `ExitPlanMode` nunca se invoca
**What goes wrong:** En modo `bypassPermissions` (= `--dangerously-skip-permissions`) "permission prompts and safety checks" se deshabilitan. El gate de aprobación de plan ES un prompt. Si el plan nunca necesita aprobación, Claude podría no invocar nunca el tool `ExitPlanMode` → el hook `PostToolUse:ExitPlanMode` nunca dispara. [CITED: code.claude.com/docs/en/permission-modes]
**Why it happens:** El propósito de skip-permissions es saltarse exactamente los gates que `ExitPlanMode` representa. Hay además un bug documentado (#17544, referido en búsqueda) donde combinar `--dangerously-skip-permissions` con `--permission-mode plan` hace que el flag de bypass **silenciosamente anule** el plan mode entero.
**How to avoid (en el diseño del experimento):** Probar la matriz completa — (a) `--dangerously-skip-permissions` solo, (b) `--dangerously-skip-permissions --permission-mode plan`, (c) skip-permissions + `Shift+Tab` a plan mode. Documentar para CADA combinación si `ExitPlanMode` dispara o no. **Este es el corazón del veredicto** — no asumir, medir.
**Warning signs:** El log `kodo-spike-posttool-exitplan.log` queda vacío tras una sesión que claramente produjo un plan en pantalla.

### Pitfall 2: Confiar en doc desactualizada que dice "los hooks de plan mode no existen"
**What goes wrong:** Issue #21282 (v2.1.20, CERRADO) afirma que `EnterPlanMode`/`ExitPlanMode` son "completely invisible to the hooks system". Tomarlo como verdad actual llevaría a un INVIABLE prematuro.
**Why it happens:** Comportamiento de versión antigua. Issue #20397 (v2.1.17) y #43421 (Ultraplan) muestran que en el caso normal `PostToolUse:ExitPlanMode` **SÍ dispara** y crea el log — contradiciendo #21282. La evidencia comunitaria reciente apunta a que el hook **sí funciona** salvo en casos concretos (clear context, Ultraplan, skip-permissions). [CITED: github.com/anthropics/claude-code/issues/20397]
**How to avoid:** No anclar el veredicto en issues cerrados de versiones viejas. **Verificar la versión de `claude` instalada** (`claude --version`) y transcribirla al documento — el veredicto es válido SOLO para esa versión (los hooks de Claude Code evolucionan rápido).
**Warning signs:** Conclusión que cita #21282 como prueba de INVIABLE sin haber lanzado el experimento.

### Pitfall 3: `PostToolUse:ExitPlanMode` falla específicamente al hacer "clear context"
**What goes wrong:** Issue #20397 (v2.1.17, "closed as not planned") documenta que el hook funciona al aceptar el plan SIN clear context, pero **NO dispara si aceptas el plan y haces clear context**. [CITED: github.com/anthropics/claude-code/issues/20397]
**Why it happens:** El clear-context resetea el flujo antes de que el hook PostToolUse se ejecute.
**How to avoid:** En el escenario de prueba, aceptar el plan **sin** clear context. Documentar esta condición como parte del repro reproducible.
**Warning signs:** El hook dispara en una corrida y no en otra — la diferencia es si se hizo clear context.

### Pitfall 4: El nombre del campo del plan en el payload no es el asumido
**What goes wrong:** Se asume `tool_input.plan`, pero el nombre literal del campo solo está confirmado por convención comunitaria, no por doc oficial citada en este research.
**Why it happens:** La doc oficial no detalla el `tool_input` específico de `ExitPlanMode`.
**How to avoid:** El volcado **crudo** del payload (Pattern 1) revela el nombre real. NO parsear `input.tool_input.plan` ciegamente en el script de prueba — volcar todo y leer el campo real del log.
**Warning signs:** N/A en el spike (el volcado crudo lo previene por construcción). Relevante para el contrato D-04 si VIABLE: el campo (2) debe ser el nombre **verificado en el log**, no el asumido.

## Code Examples

### Comando que arranca la sesión de prueba (matriz)
```bash
# Source: claude permission-modes docs — formas de entrar a plan mode bajo skip-permissions.
# Verificar PRIMERO la versión (el veredicto es version-specific):
claude --version

# (a) skip-permissions solo:
claude --dangerously-skip-permissions

# (b) skip-permissions + plan mode al arrancar (ojo bug #17544: bypass podría anular plan):
claude --dangerously-skip-permissions --permission-mode plan

# (c) skip-permissions, luego Shift+Tab a plan mode dentro de la sesión (bug #32934).
# Dentro de la sesión, un prompt que naturalmente fuerza un plan (discreción executor):
#   p.ej. "Investiga el codebase y proponme un plan para refactorizar X. No edites nada todavía."
```

### Verificación de evidencia tras la corrida
```bash
# ¿Disparó el hook primario y portó el plan?
cat /tmp/kodo-spike-posttool-exitplan.log   # ¿contiene tool_input.plan + session_id/cwd?
# Barrido — qué otros eventos dispararon:
ls -la /tmp/kodo-spike-*.log
for f in /tmp/kodo-spike-*.log; do echo "=== $f ==="; head -c 400 "$f"; echo; done
```

### Teardown obligatorio (D-06)
```bash
# Restaurar settings.json al estado previo (backup hecho en setup).
cp ~/.claude/settings.json.spike-backup ~/.claude/settings.json
# Verificar que los hooks de kodo producción (SessionStart/Stop) siguen intactos:
node -e "const s=require(require('os').homedir()+'/.claude/settings.json'); console.log(JSON.stringify(s.hooks,null,2))"
# Limpiar evidencia efímera (tras transcribirla al documento):
rm -f /tmp/kodo-spike-*.log ~/.claude/settings.json.spike-backup
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| "Plan mode tools son invisibles a hooks" (#21282) | `PostToolUse:ExitPlanMode` SÍ dispara en el caso normal (#20397) | Entre v2.1.17/v2.1.20 — comportamiento divergente por versión | El veredicto es **version-specific**; verificar `claude --version` y anclar la conclusión a esa versión exacta. |
| `TodoWrite` como fuente de progreso | `TodoWrite` deprecado desde v2.1.142 | v2.1.142 | Refuerza por qué `~/.claude/todos/` está fuera de scope (Out of Scope table). |

**Deprecated/outdated:**
- Issue #21282 como evidencia de comportamiento actual: válido solo para v2.1.20, contradicho por evidencia posterior.
- Parsear `~/.claude/plans/`: nunca fue soportado; Ultraplan (#43421) ni siquiera escribe ahí de forma fiable.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | El campo del plan en el payload de `ExitPlanMode` es `tool_input.plan`. | Hook Events Catalog, Code Examples, Pattern 3 | BAJO para el spike (el volcado crudo revela el nombre real). MEDIO para el contrato D-04 si VIABLE: el campo (2) debe ser el verificado en el log, no este asumido. |
| A2 | Existe un tool llamado exactamente `ExitPlanMode` matcheable por nombre en PostToolUse en la versión instalada. | Hook Events Catalog | MEDIO — confirmado en docs + múltiples issues, pero el nombre/existencia exacta depende de versión. El experimento lo verifica al instalar el matcher. |
| A3 | `--dangerously-skip-permissions` PODRÍA evitar el gate de plan y suprimir `ExitPlanMode`. | Summary, Pitfall 1 | NINGUNO — es una hipótesis a probar, no una afirmación. Es literalmente la pregunta del spike. |
| A4 | El comando que fuerza un plan es un prompt en lenguaje natural que pide planificar sin editar. | Code Examples | BAJO — discreción del executor (D-02 discretion); cualquier prompt que active plan mode sirve. |

## Open Questions

> Estas NO son lagunas de research — son precisamente el output empírico que el spike debe producir (por diseño D-01). Se listan para que el plan las convierta en pasos verificables del experimento.

1. **¿Dispara `PostToolUse:ExitPlanMode` bajo `--dangerously-skip-permissions`?**
   - What we know: dispara en el caso normal (sin skip-permissions, sin clear context) — #20397.
   - What's unclear: si el gate de plan se evita bajo bypassPermissions, `ExitPlanMode` podría no invocarse nunca.
   - Recommendation: matriz de 3 formas de entrar a plan mode (Code Examples); medir cada una.

2. **¿Qué campo literal del payload porta el plan?**
   - What we know: convención comunitaria apunta a `tool_input.plan`.
   - What's unclear: nombre exacto en la versión instalada.
   - Recommendation: volcado crudo (Pattern 1) y leer el campo real del log.

3. **¿Está `session_id`/`cwd` presente en el payload de `PostToolUse`?**
   - What we know: son campos comunes a todos los eventos de hook [CITED: docs].
   - What's unclear: nada significativo — alta confianza de que están; el experimento lo confirma trivialmente.
   - Recommendation: el criterio (b) de "capturable" (D-03) se verifica leyendo estos campos del log.

4. **¿Cuál es la versión de `claude` instalada?**
   - Recommendation: `claude --version` al inicio; anclar el veredicto a esa versión (el comportamiento de hooks es version-specific).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `claude` (Claude Code CLI) | Lanzar la sesión de prueba con `--dangerously-skip-permissions` | (verificar en ejecución) | (`claude --version` — transcribir al documento) | Ninguno — sin el CLI el experimento no se puede ejecutar. **Bloqueante si ausente.** |
| `node` | Ejecutar el script de volcado del hook | ✓ (kodo es un proyecto Node) | (proyecto runtime) | Ninguno — pero garantizado por el propio kodo. |
| `~/.claude/settings.json` | Registrar el hook de prueba | (verificar — kodo ya escribe ahí) | — | Si no existe, `claude` lo crea; el setup debe tolerar su ausencia (espejo del fallback `{}` de install.js). |

**Missing dependencies with no fallback:**
- `claude` CLI ausente → el spike no es ejecutable. El plan debe incluir un check `command -v claude` como primer paso (gate).

**Missing dependencies with fallback:**
- `~/.claude/settings.json` ausente → tratable (crear `{}` o dejar que `claude` lo genere), espejo del manejo de `install.js`.

## Validation Architecture

> Esta es una fase **spike** (research/experimento). No produce código de producción ni tests automatizados (D-06). La "validación" es la **reproducibilidad de la evidencia**, no una suite. `nyquist_validation: true` en config se satisface por el rigor del repro documentado, no por tests unitarios (no hay código que testear).

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node:test (suite existente del repo) — **no se invoca en esta fase**; el spike no añade tests |
| Config file | n/a para el spike |
| Quick run command | n/a — la verificación es manual/empírica (lanzar sesión, leer logs) |
| Full suite command | `npm test` (del repo) — **no debe verse afectado**: spike puro, `git diff -- src/ test/` vacío |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| PLAN-03 | Veredicto empírico VIABLE/INVIABLE reproducible | manual-only (experimento) | n/a — repro documentado en `45-SPIKE.md` (comando + payload crudo o ausencia) | ✅ el entregable es el documento, no un test |

**Justificación manual-only:** El comportamiento bajo prueba (emisión de hooks por Claude Code bajo skip-permissions) NO es automatizable desde kodo — depende de un proceso `claude` interactivo externo. El criterio de éxito es que **un tercero pueda reproducir** el experimento siguiendo el documento (D-05: "un lector debe poder reproducir").

### Sampling Rate
- **Per task commit:** n/a (spike doc-only en `src/`; el único commit es el `45-SPIKE.md` + artefactos GSD).
- **Per wave merge:** verificar `git diff -- src/ test/ bin/` vacío (invariante D-06: cero código de producción).
- **Phase gate:** el documento alcanza un veredicto binario con evidencia transcrita; `/gsd:verify-work` valida la presencia de las 4 secciones de D-05.

### Wave 0 Gaps
- None — no se necesita infraestructura de test. El único "setup" es el script de volcado (~15 líneas, desechable) y el backup de `settings.json`.

## Security Domain

> Fase spike — superficie de seguridad mínima. El único toque a estado del sistema es la entrada temporal en `~/.claude/settings.json`. Se incluye por completitud (security_enforcement no está en `false`).

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | El spike no toca auth. |
| V3 Session Management | no | "Session" aquí es sesión de Claude Code, no auth session. |
| V4 Access Control | no | — |
| V5 Input Validation | parcial | El script de volcado **NO parsea** el payload (lo escribe crudo) — no hay superficie de inyección por parseo. El contrato D-04 (Phase 46, si VIABLE) SÍ validaría: tratar `tool_input.plan` como dato no confiable (texto arbitrario del modelo) al persistir/renderizar — el overlay de Phase 44 ya es read-only y never-throws. |
| V6 Cryptography | no | — |

### Known Threat Patterns for {hook script + settings.json}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Hook de prueba rompe el arranque de Claude Code | Denial of Service | Script never-throws (try/catch externo, espejo del contrato kodo). Un fallo del hook nunca debe crashear `claude`. |
| Teardown incompleto deja hooks de prueba activos | Tampering (de la config del usuario) | Backup/restore byte-idéntico de `settings.json`; verificación post-teardown de que solo quedan los hooks kodo producción. |
| Clobber de los hooks `Stop`/`SessionStart` de kodo producción | Tampering | El setup añade entradas de prueba SIN borrar las de kodo; el teardown restaura el backup completo. |
| Plan text como vector de inyección al persistir (Phase 46) | Tampering / Injection | Fuera del scope del spike; nota para D-04: el plan es output del modelo (no confiable) — el overlay read-only never-throws de Phase 44 lo trata como texto plano. |

## Sources

### Primary (HIGH confidence)
- [CITED: code.claude.com/docs/en/hooks] — catálogo de eventos de hook soportados, campos comunes del payload (`session_id`/`cwd`/`transcript_path`/`hook_event_name`/`permission_mode`), matcher syntax (regex sobre `tool_name`), `ExitPlanMode` como tool matcheable.
- [CITED: code.claude.com/docs/en/permission-modes] — `bypassPermissions` = `--dangerously-skip-permissions`; deshabilita prompts y safety checks; cómo se entra a plan mode (`--permission-mode plan`, `Shift+Tab`); approving a plan exits plan mode.
- `src/hooks/session-start.js`, `src/hooks/install.js`, `src/session/state.js`, `src/hooks/stop.js` (codebase kodo) — patrones verbatim de readStdin, addHook/uninstallHooks, findSession dual-scan, contrato never-throws.

### Secondary (MEDIUM confidence)
- [CITED: github.com/anthropics/claude-code/issues/20397] — `PostToolUse:ExitPlanMode` SÍ dispara en el caso normal; falla específicamente al hacer clear context (v2.1.17, closed as not planned).
- [CITED: github.com/anthropics/claude-code/issues/32934] — bug: `ExitPlanMode` falla al transicionar tras `Shift+Tab` en sesión `--dangerously-skip-permissions` (v2.1.72, open, has repro).
- [CITED: github.com/anthropics/claude-code/issues/43421] — Ultraplan no dispara `ExitPlanMode` PostToolUse ni escribe plan local (refuerza fragilidad de rutas internas; closed as not planned).

### Tertiary (LOW confidence — flagged for empirical validation)
- [CITED: github.com/anthropics/claude-code/issues/21282] — afirma que plan mode tools son "invisibles a hooks" (v2.1.20, CERRADO). **Contradicho por #20397** — válido solo para versión antigua. Tratar como evidencia de que el comportamiento es version-specific, NO como verdad actual.
- Nombre exacto del campo `tool_input.plan` — convención comunitaria (plankit, ejemplos de hooks), no doc oficial citada. El experimento lo verifica.
- Bug #17544 (`--dangerously-skip-permissions` + `--permission-mode plan` → bypass anula plan) — referido en resultados de búsqueda, no leído directamente. El experimento lo cubre por la matriz.

## Metadata

**Confidence breakdown:**
- Hook events catalog + matchers + campos comunes del payload: **HIGH** — doc oficial + corroboración en múltiples issues.
- `PostToolUse:ExitPlanMode` dispara en caso normal y porta el plan: **MEDIUM** — confirmado empíricamente por #20397, pero el nombre literal del campo y la versión exacta requieren confirmación en ejecución.
- Comportamiento bajo `--dangerously-skip-permissions` (el crux): **LOW por diseño** — es la pregunta empírica del spike. El research aporta hipótesis fundamentada + diseño de experimento, NO el veredicto.
- Patrones kodo a reusar (readStdin/findSession/addHook): **HIGH** — leídos verbatim del codebase.

**Research date:** 2026-06-09
**Valid until:** 2026-06-16 (7 días — los hooks de Claude Code y el comportamiento de plan mode evolucionan rápido entre versiones; el veredicto del spike debe anclarse a `claude --version` concreta).
