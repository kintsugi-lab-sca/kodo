# Phase 84: Superficies de captura — skill, sync, conteo ambient - Pattern Map

**Mapped:** 2026-07-26
**Files analyzed:** 8 (3 nuevos de `src/`+`.claude/`, 2 modificados de `src/`, 3 de `test/`)
**Analogs found:** 8 / 8 (7 exactos o de rol, 1 auto-analog)

Todo lo citado aquí está **verificado leyendo el fichero en esta sesión**, no copiado de RESEARCH.

---

## File Classification

| Fichero nuevo/modificado | Rol | Data flow | Analog más cercano | Calidad del match |
|---|---|---|---|---|
| `src/cli/dashboard/inbox-count.js` **(nuevo)** | dashboard leaf | file-I/O (read-only, síncrono) | `src/cli/dashboard/tasks.js` (tríada DI + HOME perezoso) **+** `src/cli/dashboard/progress.js` (regex constante + JSDoc anti-ReDoS) | exacto (partido en dos: estructura ← `tasks.js`, regex ← `progress.js`) |
| `.claude/skills/kodo-capture/SKILL.md` **(nuevo)** | prompt/skill markdown | request-response (shell-out) | `.claude/skills/worktree-cleanup/SKILL.md` (frontmatter + `SKILL.md` mayúsculas) | exacto en forma; `kodo-orchestrate/skill.md` es **contra-ejemplo** (sin frontmatter) |
| `src/cli/skill-sync.js` **(modificado)** | thin CLI handler | batch (bucle + agregación) | **su propia forma actual** (gate → delegar → render/JSON → exit code) | auto-analog |
| `src/cli/dashboard/App.js` **(modificado)** | React container | event-driven (render + poll) | el cableado de `readTasksFn` (`:506`, `:742`) y el de `anyGsd`/`anyProgress`/`anyNext` (`:801-807`, `:2052-2054`) | exacto |
| `src/cli/dashboard/SessionTable.js` **(modificado)** | presentational component | render puro | el header actual `:908-914` + el patrón de colapso `...(anyGsd ? [...] : [])` `:1011` | exacto |
| `test/dashboard-inbox-count.test.js` **(nuevo)** | test unit + render ink | file-I/O + render | `test/dashboard-status-line.test.js` (harness ink + `injectProps`) + `test/inbox-cli.test.js:930-960` (`seedLargeInbox`, el fixture de 1500) | rol-match |
| `test/kodo-capture-skill.test.js` **(nuevo)** | test golden estático + integración | file-I/O + subprocess | `test/inbox-format-golden.test.js` (el golden contra el que compara) + `test/skill-sync.test.js` (molde `spawnSync` + HOME sandbox) | rol-match |
| `test/skill-sync.test.js` **(modificado)** | test integración | subprocess | su propio `makeFixture()` `:39-56` | auto-analog |

**NO se tocan (verificado en CONTEXT D-06 y en el mapa de RESEARCH):** `src/skill/sync.js` · `src/cli/dashboard/usePoll.js` · `src/inbox/store.js` · `src/server.js` · `src/orchestrator/launch.js` · `src/hooks/stop.js`.

---

## Pattern Assignments

### `src/cli/dashboard/inbox-count.js` (dashboard leaf, file-I/O)

**Analog primario:** `src/cli/dashboard/tasks.js` — **confirmado**: es el único leaf del dashboard que combina resolución HOME-relative perezosa con la tríada de DI. `progress.js` **no** resuelve HOME (recibe `worktreeBase` del caller, `:105-108`) y solo inyecta `readFileFn`. La afirmación de RESEARCH es correcta.

**Imports — los tres únicos permitidos** (`tasks.js:22-24`):

```js
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
```

**Cabecera del módulo — el comentario que declara las prohibiciones** (`tasks.js:1-20`, forma a replicar cambiando el sujeto):

```js
// @ts-check
//
// src/cli/dashboard/tasks.js — Phase 75 Plan 01 Task 1 (LIVE-05; D-01/D-02).
//
// Reader LEAF, SÍNCRONO y NEVER-THROWS del bloque `tasks` de `~/.kodo/state.json`.
// Molde LITERAL de `readLightPlan` (plan.js:65-78): never-throws + DI de HOME
// (`kodoDir`/`homedirFn`/`readFileFn`). Importa SOLO builtins (node:fs/node:path/node:os).
//
// PROHIBIDO importar `loadState`/`src/config.js`: ...
//
// Color-isolation (invariante D-12 Phase 34): este módulo NO importa `picocolors` ni
// `src/cli/format.js`.
```

Para `inbox-count.js` el bloque PROHIBIDO cambia de sujeto: **`src/inbox/store.js`** (importa `../cli/format.js` → picocolors, cadena verificada) y **`src/config.js`** (evalúa `homedir()` en el cuerpo del módulo).

**Core pattern — resolución perezosa + never-throws de cuerpo entero** (`tasks.js:39-48`, copiar literal cambiando el fichero y el cuerpo del `try`):

```js
export function readTasks(deps = {}) {
  const readFileFn = deps.readFileFn || ((p) => readFileSync(p, 'utf-8'));
  const kodoDir = deps.kodoDir || join((deps.homedirFn || homedir)(), '.kodo');
  try {
    const state = JSON.parse(readFileFn(join(kodoDir, 'state.json')));
    return state && typeof state.tasks === 'object' && state.tasks !== null ? state.tasks : {};
  } catch {
    return {}; // ENOENT / JSON corrupto / cualquier otro fallo → {} (never-throws)
  }
}
```

Los tres elementos a copiar: (a) la tríada `readFileFn` / `kodoDir` / `homedirFn`; (b) el `try` que envuelve **todo** el cuerpo con `catch` sin binding; (c) el comentario de la rama de fallo enumerando los modos (aquí: ausente / EACCES / EISDIR / binario → `0`).

**Analog secundario — la regex como constante de módulo con su JSDoc** (`progress.js:28-33` y `:39-44`):

```js
// Regex de frontmatter CONSTANTE: aísla el PRIMER bloque `--- ... ---` (non-greedy).
// ... No deriva de input externo → sin ReDoS.
const FRONTMATTER_RE = /^\uFEFF?\s*---\r?\n([\s\S]*?)\r?\n---/;
```

**Fuente de verdad de la gramática a especializar — `LINE_RE` (`src/inbox/store.js:126-127`, verificada verbatim):**

```js
const LINE_RE =
  /^- \[([ x])\] ([0-9a-z]+) · (.+) · ([^·]*) · (\d{4}-\d{2}-\d{2}) · ([^·]*?)(?: · (enrutada|descartada)(?: → (.*))?)?$/;
```

La regex del leaf es esta misma restringida a `- [ ]` y sin grupos de captura. **No un prefijo** (RESEARCH §Pitfall 6: prefijo 7 vs oráculo 2).

**Path perezoso — el precedente que el leaf replica sin importar** (`store.js:141-148`, `defaultInboxPaths`): `join(homedir(), '.kodo')` + `INBOX_FILENAME`. Su JSDoc `:130-138` explica por qué no es constante de módulo; ese razonamiento se reproduce en el leaf.

---

### `src/cli/dashboard/App.js` (React container, event-driven) — MODIFICADO

**Analog:** el cableado de `readTasksFn`, end-to-end en el mismo fichero.

**1. Prop con default real** (`App.js:504-506`):

```js
  // Phase 75 (LIVE-05): reader del bloque `tasks` de ~/.kodo/state.json. Default = readTasks real
  // (never-throws → {}); inyectable para aislar el HOME en tests (mismo patrón DI que fetchFn/loadConfigFn).
  readTasksFn = readTasks,
```

**2. Invocación en el cuerpo del render, con el comentario que documenta la cadencia real** (`App.js:735-742`) — es exactamente la advertencia del Pitfall 7 (corre por render, no por tick), y ya está escrita en el repo:

```js
  // Phase 75 (LIVE-05, D-02): lee el bloque `tasks` de ~/.kodo/state.json. Esta lectura vive en
  // el cuerpo del componente, que React re-ejecuta en CADA render (75/WR-02) — no solo en los
  // ticks de usePoll: cada pulsación de tecla en filtro, cada scroll de overlay y cada cambio de
  // `mode` dispara una lectura síncrona (readFileSync). En la práctica hace piggyback sobre el
  // tick de usePoll que refresca /status (cero loop nuevo, cero watcher), pero NO está limitada a
  // ese tick. never-throws → {} ...
  const tasks = readTasksFn({});
```

**3. Flag estructural derivado del set SIN filtrar** (`App.js:801-807`) — el precedente literal de D-23:

```js
  const anyGsd = deriveAnyGsd(enriched);
  const anyProgress = deriveAnyProgress(enriched);
  const anyNext = deriveAnyNext(enriched);
```

⚠ **Matiz que el planner debe conservar:** el conteo **no** se deriva de `filtered` ni de `enriched` — viene del filesystem, así que no tiene el problema del parpadeo bajo `/`. Se calcula como `tasks` (paso 2), no como los `any*` (paso 3). Lo que se hereda de los `any*` es **la política de colapso en el render**, no el sitio de cómputo.

**4. Paso de props a `SessionTable`, con comentario de una línea por prop** (`App.js:2052-2054`):

```js
        anyGsd, // TUI-18 D-08: flag estructural GSD (sobre `sorted`, no `filtered`) → drop columna phase/mode
        anyProgress, // PROG-03 D-06: flag estructural progreso (sobre `enriched` sin filtrar) → drop columna prog
        anyNext, // LIVE-05 Pitfall 4: flag estructural NEXT: (sobre `enriched` sin filtrar) → drop columna next
```

---

### `src/cli/dashboard/SessionTable.js` (presentational, render puro) — MODIFICADO

**Analog:** el header actual, **verificado**: es un `<Box flexDirection="row">` con dos hijos, el segundo condicional con separador de 3 espacios dentro del string (`SessionTable.js:908-914`):

```js
  const indicator = h(LiveIndicator, { connected, lastGoodCount, lastGoodAt, lastAttemptAt, unauthorized, unauthorizedMessage });
  const label = countsLabel(counts);

  // Header: indicador live (D-10) + contadores (D-11, omitidos si todos en cero / lista vacía).
  const header = h(
    Box,
    { flexDirection: 'row' },
    indicator,
    label ? h(Text, null, `   ${label}`) : null,
  );
```

El tercer hijo se añade **al final**, con la misma forma ternaria y el mismo `'   '` embebido en el template (UI-SPEC `sep-header`). **Ni `width`, ni `marginLeft`, ni `<Box>` nuevo.**

**Patrón de colapso alternativo (spread de array) — cuándo NO usarlo** (`SessionTable.js:1009-1011`):

```js
    // Cuando `anyGsd === false` se omite el elemento (no se renderiza un Box vacío) → ink recupera
    ...(anyGsd ? [h(Box, { width: COLS.phasemode }, h(Text, { dimColor: true }, 'phase/mode'))] : []),
```

Este es el molde de **columnas de tabla**. Para el header, el molde correcto es el ternario `x ? h(...) : null` de `:913`, que ya es lo que hace `label`.

**Color solo por nombre ink** — `LiveIndicator` `:144-164` es la prueba: `h(Text, { color: 'yellow' }, ...)`, `{ color: 'green' }`, `{ dimColor: true }`. Cero picocolors, cero ANSI. `LiveIndicator` **no se modifica**: el conteo es hermano, no una rama nueva de su cadena de precedencia.

**Prop nueva + JSDoc** — molde de la documentación de `anyProgress` (`SessionTable.js:786-790`) y del default en la destructuración (`:832-834`):

```js
  anyGsd = true,
  anyProgress = false,
  anyNext = false,
```

El conteo entra igual con default retro-compatible (`inboxOpen = 0` → no se pinta nada → los 7 tests de dashboard existentes siguen verdes sin tocarlos).

---

### `src/cli/skill-sync.js` (thin CLI handler, batch) — MODIFICADO

**Analog:** su propia forma actual. Estructura verificada: DI en `:52-60` → paths en `:62-63` → `try` con `cleanupFn` en `finally` `:65,99-103` → gate exit 2 `:67-70` → invocación + mapeo de error `:72-83` → branch `--json`/human `:85-97` → `renderHuman` privado `:116-131`.

**Lo que NO se toca (literales anclados por test):**

```js
// :68 — comparado con assert.equal BYTE A BYTE en test/skill-sync.test.js:536-539
err('Error: not a kodo repository (no .claude/skills/kodo-orchestrate/skill.md found)\n');
```

```js
// :77 y :81 — el prefijo está anclado por assert.match(result.stderr, /^Error: filesystem error: /)
// en test/skill-sync.test.js:526 (SKILL-04 #3). VERIFICADO.
err(`Error: filesystem error: ${result.error || 'unknown'}\n`);
```

⚠ **Discrepancia detectada entre los dos documentos upstream — el planner debe resolverla explícitamente:**
- RESEARCH §Code Example 2 propone `Error: filesystem error [${s.name}]: ...` → **el `:` se desplaza y el assert anclado `/^Error: filesystem error: /` se pone ROJO.**
- UI-SPEC §Superficie A propone `Error: filesystem error: [{skill}] {mensaje}` → **preserva el prefijo anclado.**

**La forma de UI-SPEC es la correcta.** Es contrato de copy y además es la única que mantiene verde `test/skill-sync.test.js:526`.

**Estructura del payload `--json` — el orden de claves ES el contrato** (`:85-94`, a extender aditivamente):

```js
    if (opts.json === true) {
      // D-06b: single-line JSON byte-deterministic (LOG-12 + DX-06 invariante).
      /** @type {Record<string, any>} */
      const payload = {
        status: result.status,
        files_changed: result.files_changed,
      };
      if (opts.prune === true) payload.files_pruned = result.files_pruned ?? 0;
      if (result.symlink_replaced === true) payload.symlink_replaced = true;
      write(JSON.stringify(payload) + '\n');
    } else {
      renderHuman(result, dest, write, fmt);
    }
```

**`renderHuman` — la firma a extender con el nombre de la skill** (`:116-131`). Los cuatro literales de su cuerpo (`⚠ Legacy symlink replaced at`, `No drift — … up to date`, `Synced N file(s) to`, `Pruned N foreign file(s)`) son **byte-idénticos tras el prefijo** (UI-SPEC). Solo se antepone `${fmt.dim(`${name}:`)} `.

**Gate case-tolerante (D-07) — el sitio a cambiar en el otro fichero** (`src/skill/sync.js:66-68`, verificado):

```js
    // 1. Validar source: skill.md DEBE existir (D-07 traducción a 'error').
    if (!existsSync(join(source, 'skill.md'))) {
      return { status: 'error', files_changed: 0, error: 'source skill not found' };
    }
```

⚠ **Tensión con D-06.** El CONTEXT dice «`src/skill/sync.js` NO cambia su firma ni su contrato» y §Integration Points dice «`src/cli/skill-sync.js`: único fichero que cambia». Pero RESEARCH §Pitfall 5 recomienda aplicar D-07 **también** en `sync.js:67`. Sin ese cambio, en Linux `kodo-capture/SKILL.md` pasaría el gate del handler y luego `syncSkill` devolvería `source skill not found`. **Aplicar D-07 en `sync.js:67` no cambia firma ni contrato** (es una condición interna más permisiva), así que es compatible con D-06 leído literalmente — pero el planner debe declararlo, no dejarlo al ejecutor.

---

### `.claude/skills/kodo-capture/SKILL.md` (prompt markdown, request-response)

**Analog de forma:** `.claude/skills/worktree-cleanup/SKILL.md` — **confirmado**: `SKILL.md` en mayúsculas, frontmatter con `name` + `description` larga en español que incluye el «cuándo usarla»:

```yaml
---
name: worktree-cleanup
description: Audita y limpia worktrees acumulados en este repo (...). Úsalo cuando el usuario pida limpiar worktrees, cuando se acumulen tras varias sesiones de agentes, o cuando aparezcan worktrees huérfanos en `git worktree list`.
---

# Worktree Cleanup

Audita los worktrees de este repo y elimina solo los que sean **demostrablemente seguros**. ...

## Principios

1. **Dry-run primero, mutación después.** ...
```

Patrón a copiar: `name` + `description` de una frase de qué + una de cuándo · H1 en Title Case · sección `## Principios` con reglas numeradas en negrita.

**Contra-ejemplo verificado:** `.claude/skills/kodo-orchestrate/skill.md:1-3` **no tiene frontmatter** — arranca directo en `# kodo:orchestrate`. **No copiar esa forma.** Sin `description`, Claude no sabe cuándo auto-cargarla y CAPT-02 pide captura mid-session.

**Invariante estructural (D-10):** el fichero contiene **exactamente una** línea de comando, en bloque cercado con marcador estable. La prosa que menciona `kodo capture` no debe ser detectable por el contador del test (anclar a inicio de línea dentro del bloque, nunca a la subcadena).

---

### `test/kodo-capture-skill.test.js` (golden estático + integración)

**Analog A — el golden contra el que compara** (`test/inbox-format-golden.test.js:1-13, 29-49`). Su cabecera **nombra esta fase explícitamente**:

```js
// ⚠ CONTRATO INTER-FASE — LEER ANTES DE TOCAR NADA DE ESTE FICHERO ⚠
//
// Este golden fija BYTE A BYTE las cinco formas de la línea de `~/.kodo/inbox.md`.
// **Phase 84 (CAPT-02) comparará contra estas cadenas byte a byte**: ...
```

Constantes de identidad inyectada a reutilizar verbatim (`:29-33`) y la línea abierta canónica (`:49`):

```js
const ID = 'a3f9k2';
const TEXT = 'el texto de la idea';
const TAG = 'kodo';
const DATE = '2026-07-25';
const ORIGIN = 'cli';
// forma 1 (abierta):
'- [ ] a3f9k2 · el texto de la idea · kodo · 2026-07-25 · cli'
```

Para el skill-path la única diferencia es el último campo: `· skill`.

**Seams de inyección del writer** (`src/cli/capture.js:50-65`, verificados) — `idFn`, `clockFn`, `pathsFn`, `appendFn`, `cwdFn`, `projectsFn`, `writeFn`, `errFn`, `formatterFn`. El JSDoc lo dice literal:

```js
 * La DI de `idFn` y `clockFn` es lo que hace este handler testeable sin reloj real ni entropía:
 * con ambos fijados, la línea producida es byte-determinista.
```

Y el punto donde se consume `--origin` (`capture.js:113-117`):

```js
  const rawOrigin = typeof opts.origin === 'string' ? opts.origin.trim() : '';
  const origin = rawOrigin === '' ? DEFAULT_ORIGIN : rawOrigin;
  const line = encodeLine({ id, text, tag, date, origin, open: true, estado: null, dest: null }) + '\n';
```

**Analog B — el molde `spawnSync` + HOME sandbox** (`test/skill-sync.test.js:19-33`):

```js
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, ... } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const KODO_BIN = join(REPO, 'bin', 'kodo');
```

Con el comentario de disciplina de `:15-17`: *«Patrón: spawnSync child + HOME override + NO_COLOR=1 … makeFixture siembra DOS tmpdirs … y un afterEach común limpia ambos»*.

---

### `test/dashboard-inbox-count.test.js` (unit + render ink)

**Analog A — el oráculo:** `listCaptures` de `src/inbox/store.js` (importado **solo desde el test**, jamás desde el leaf).

**Analog B — el fixture de 1500 de `83-05`.** ⚠ **Resuelve la Open Question 3 de RESEARCH:** el fixture **está inline**, no extraído como helper. Vive en `test/inbox-cli.test.js` como `seedLargeInbox(home, n, {closedTail})` `:944-960`, con `N = 1500` y `CLOSED_TAIL = 300` declarados en `:1288-1290`. El repo no usa helpers cross-test → **regenerarlo en el test nuevo**. Molde a copiar (`inbox-cli.test.js:947-960`):

```js
  const openCount = n - closedTail;
  /** @type {string[]} */
  const lines = [];
  for (let i = 0; i < n; i++) {
    const id = capIdAt(i);              // i.toString(36).padStart(6, '0')
    const text = `captura sembrada numero ${i} — texto largo y determinista ...`;
    const head = `${id} · ${text} · kodo · 2026-07-25 · cli`;
    lines.push(
      i < openCount ? `- [ ] ${head}` : `- [x] ${head} · enrutada → .planning/todos/TODO-${id}.md`,
    );
  }
```

Y su JSDoc `:933`: *«NO se usa el binario para sembrar: 1500 invocaciones de proceso harían el test inutilizable»*.

**Analog C — render ink** (`test/dashboard-status-line.test.js:24-27, 123`):

```js
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App, { UNAUTHORIZED_MESSAGE } from '../src/cli/dashboard/App.js';
...
const { lastFrame } = render(createElement(App, injectProps(clock, fetchFn)));
await drain();
assert.match(lastFrame(), /● live/, `... \n${lastFrame()}`);
```

El harness `makeFakeClock` (`:38-60`) con `schedule`/`cancel`/`flushTick` y timers no-op es el molde para avanzar el poll sin timers reales. **`injectProps` gana `inboxCountFn`** — el test nuevo lo inyecta siempre; los 7 existentes no se tocan (Regla 3).

---

### `test/skill-sync.test.js` (modificado)

**Analog:** su propio `makeFixture()` (`:39-56`, verificado). Siembra **solo** `kodo-orchestrate`:

```js
function makeFixture() {
  const tmpHome = mkdtempSync(join(tmpdir(), 'kodo-skill-sync-home-'));
  const tmpRepo = mkdtempSync(join(tmpdir(), 'kodo-skill-sync-repo-'));
  mkdirSync(join(tmpHome, '.kodo'), { recursive: true });

  const skillDir = join(tmpRepo, '.claude', 'skills', 'kodo-orchestrate');
  mkdirSync(skillDir, { recursive: true });
  writeFileSync(join(skillDir, 'skill.md'), '# kodo:orchestrate\n\nCanonical body v1.\n', 'utf-8');
  mkdirSync(join(skillDir, 'subdir'), { recursive: true });
  writeFileSync(join(skillDir, 'subdir', 'extra.md'), 'extra content\n', 'utf-8');

  return { tmpHome, tmpRepo, skillDir };
}
```

⚠ **`destOf(tmpHome)` (`:58-60`) también está hardcodeado a `kodo-orchestrate`** — RESEARCH §Pitfall 1 **no** lo menciona. Al sembrar dos skills, el `afterEach` (`:470-478`) hace `chmodSync(destOf(_tmpHome), 0o755)` solo sobre el destino de `kodo-orchestrate`; si un test deja `kodo-capture/` con permisos rotos, el `rmSync` puede fallar. Parametrizar `destOf(tmpHome, name = 'kodo-orchestrate')`.

**Asserts anclados que se rompen** (verificados en el fichero):

| Test | Línea | Assert |
|---|---|---|
| `SKILL-04 #1` | :483-484 | `assert.match(result.stdout, /Synced 2 files? to /)` |
| `SKILL-04 #2` | :500 | `assert.match(second.stdout, /No drift/)` |
| `SKILL-04 #3` | :526 | `assert.match(result.stderr, /^Error: filesystem error: /)` ← **el que dicta la forma del prefijo** |
| `D-04 CLI symlink` | :554 | `assert.match(result.stdout, /Legacy symlink replaced/)` |
| `D-06b --json` | :565 | `assert.match(result.stdout, /^\{"status":"ok","files_changed":2\}\n$/)` ← anclado a ambos extremos |
| `D-05 --prune` | :575+ | `Pruned 1 foreign file` |

**Sobrevive intacto y debe seguir verde:** `SKILL-04 #4` (`:530-543`), con el `assert.equal` byte a byte del literal del gate.

---

## Shared Patterns

### 1. Never-throws de cuerpo entero (leafs del dashboard)
**Fuente:** `src/cli/dashboard/tasks.js:42-47`
**Aplica a:** `inbox-count.js`
`try` que envuelve todo · `catch {}` sin binding · valor neutro (`{}` allí, `0` aquí) · comentario que enumera los modos de fallo cubiertos.

### 2. Color isolation del TUI
**Fuente:** `src/cli/dashboard/SessionTable.js:144-164` (`LiveIndicator`)
**Aplica a:** `inbox-count.js` (no importa nada de color), `SessionTable.js` (el `<Text>` nuevo)
Color **solo** por nombre ink en `<Text>`: `{ color: 'yellow' }`, `{ color: 'green' }`, `{ dimColor: true }`. Blindado automáticamente por `test/format-isolation.test.js` para todo `.js` nuevo bajo `src/cli/dashboard/` — **pero solo imports directos**, de ahí que no importar el store sea una regla y no una comprobación.

### 3. Regex constante de módulo, jamás compilada desde input
**Fuente:** `src/cli/dashboard/progress.js:28-33` · `src/inbox/store.js:120-127`
**Aplica a:** `inbox-count.js`
UPPERCASE_RE en el cuerpo del módulo, JSDoc que declara «no deriva de input externo → sin ReDoS» y, en `store.js`, la medición (`0,4 ms sobre 80 KB sin match`).

### 4. Resolución perezosa de paths HOME-relative
**Fuente:** `src/inbox/store.js:130-148` (`defaultInboxPaths`) · `src/cli/dashboard/tasks.js:41`
**Aplica a:** `inbox-count.js`, todos los tests nuevos
`homedir()` **dentro** de la función. Los tests aíslan por `kodoDir`/`pathsFn` inyectado o por `HOME` sandbox en `spawnSync` — nunca escribiendo en el HOME real (RESEARCH lo registra como riesgo materializado en su propia sesión).

### 5. Thin handler: gate → delegar → render dual → exit code
**Fuente:** `src/cli/skill-sync.js:51-104`
**Aplica a:** `skill-sync.js` (extensión)
DI con defaults resueltos en el cuerpo · `try/finally` externo con `cleanupFn` · **retornar el código, nunca invocar el exit del runtime** (`:44-45`) · branch `--json`/human separado temprano para bytes deterministas.

### 6. `--json` con orden de claves fijo (DX-06)
**Fuente:** `src/cli/skill-sync.js:87-94`
**Aplica a:** el payload agregado con `skills[]`
Objeto literal con orden explícito, condicionales añadidas **después** por asignación. Las claves de nivel superior mantienen su posición.

### 7. Convenciones del repo (verificadas en los 6 ficheros leídos)
`// @ts-check` en la primera línea · comentario de cabecera con fase + IDs de decisión · JSDoc con `@param`/`@returns` en todo export · imports con extensión `.js` · kebab-case · constantes de módulo en UPPERCASE · sin barrel files · prosa y comentarios en español.

---

## No Analog Found

Ninguno. Las 8 superficies tienen precedente directo en el repo.

Lo más cercano a un hueco es el **tokenizador shell-like** que el test de D-14 necesita para convertir la cadena del markdown en argv: no existe helper en el repo (no hay deps y el repo no tiene utilidades de test compartidas). Se escribe inline en `test/kodo-capture-skill.test.js`, siguiendo la convención verificada de que **cada fichero de test siembra lo suyo**.

---

## Hallazgos que el planner debe arbitrar

1. **Forma del prefijo de error por skill.** RESEARCH (`Error: filesystem error [name]:`) rompe el assert de `test/skill-sync.test.js:526`; UI-SPEC (`Error: filesystem error: [name] msg`) lo preserva. **Ganador: UI-SPEC.**
2. **`src/skill/sync.js:67` y D-07.** El gate case-tolerante hace falta en los **dos** sitios o `kodo-capture/SKILL.md` fallará en Linux. Es compatible con D-06 (no cambia firma ni contrato de retorno), pero contradice el literal «único fichero que cambia». Decidir explícitamente.
3. **`destOf()` en `test/skill-sync.test.js:58-60`** está hardcodeado a `kodo-orchestrate` y no aparece en el inventario de Pitfall 1. Parametrizarlo o el `afterEach` deja de restaurar permisos del segundo destino.
4. **Open Question 3 resuelta:** el fixture de 1500 es inline (`test/inbox-cli.test.js:944-960`, `:1288-1290`) → regenerar, no importar.

---

## Metadata

**Ámbito de búsqueda:** `src/cli/`, `src/cli/dashboard/`, `src/skill/`, `src/inbox/`, `.claude/skills/`, `test/`
**Ficheros leídos en esta sesión:** `src/cli/skill-sync.js` (íntegro) · `src/cli/dashboard/tasks.js` (íntegro) · `src/cli/dashboard/progress.js` (íntegro) · `src/cli/dashboard/SessionTable.js` (`:125-175`, `:775-840`, `:895-950`, `:1009-1090` vía grep) · `src/cli/dashboard/App.js` (`:496-512`, `:735-745`, `:795-810`, `:2038-2060`) · `src/skill/sync.js` (`:55-80`) · `src/inbox/store.js` (`:120-150`) · `src/cli/capture.js` (`:50-70`, `:108-150`) · `test/skill-sync.test.js` (`:1-60`, `:470-575`) · `test/inbox-format-golden.test.js` (`:1-90`) · `test/inbox-cli.test.js` (`:925-960`, `:1280-1310`) · `test/dashboard-status-line.test.js` (`:1-60`, `:120-170`) · `.claude/skills/worktree-cleanup/SKILL.md` (`:1-12`) · `.claude/skills/kodo-orchestrate/skill.md` (`:1-8`)
**Fecha de extracción:** 2026-07-26
