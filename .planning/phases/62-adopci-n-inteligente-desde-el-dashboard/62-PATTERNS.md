# Phase 62: Adopción inteligente desde el dashboard (ORCH-02) - Pattern Map

**Mapped:** 2026-06-25
**Files analyzed:** 5 (2 nuevos, 3 modificados; + 3 assets reusados sin cambios)
**Analogs found:** 5 / 5 (todos con analog directo en el codebase)

## File Classification

| New/Modified File | Role | Data Flow | Closest Analog | Match Quality |
|-------------------|------|-----------|----------------|---------------|
| `src/cli/dashboard/enrich.js` (NUEVO) | service (derivador LLM) | request-response (spawn one-shot) + file-I/O (lectura memoria) | `src/cli/dashboard/adopt.js` (`runAdopt`) | role-match (never-throws + DI exec) |
| `src/cli/dashboard/adopt.js` (MODIFICAR) | service (shell wrapper) | request-response | `runAdopt` línea 123 (par `--title` existente) | exact (espejo literal) |
| `src/cli/dashboard/App.js` (MODIFICAR) | component (TUI ink) | event-driven (keyboard) | handler `a` + estados `confirm` (App.js 512-624) | exact (estado nuevo en máquina existente) |
| `src/cli/dashboard/index.js` (MODIFICAR) | wiring/provider | request-response | wiring `onAdopt` (index.js 175-176) | exact (espejo de prop DI) |
| `test/dashboard/enrich.test.js` (NUEVO) | test | unit | `test/dashboard/adopt.test.js` (`fakeExec`) + `test/adopt.test.js` (`existsSyncFn`/`readFileFn` fakes) | role-match |
| `test/dashboard/adopt.test.js` (EXTENDER) | test | unit | tests `--title` existentes (líneas 83-151) | exact (espejo `--description`) |

**Assets REUSADOS sin modificar** (downstream debe importarlos, NO reimplementarlos):
- `resolveTranscriptPath(projectPath, sessionId)` — `src/logger-events.js:107`
- `isGsdProject(projectPath, existsSyncFn)` — `src/adopt.js:38`
- `sanitizeAdoptionData({cwd,title,description})` — `src/adopt.js:105` (corre dentro de `adoptSession`, NO se invoca desde enrich.js)
- `computeAdoptable` / `resolveProjectId` — `src/cli/dashboard/select.js:341` / `:348` (ya resueltos en confirm-arm; sin cambios)

---

## Pattern Assignments

### `src/cli/dashboard/enrich.js` (service, spawn one-shot + file-I/O) — NUEVO

**Analog primario:** `src/cli/dashboard/adopt.js` (`runAdopt`) — mismo idioma never-throws + `exec` DI sin default (leak guard estructural).

**Imports pattern** (espejo de `src/adopt.js` / `logger-events.js`; SOLO `node:*` + internos puros — color-isolation D-12, verificado por `test/format-isolation.test.js`):
```javascript
// @ts-check
import { join } from 'node:path';
import { resolveTranscriptPath } from '../../logger-events.js'; // NO reinventar el path (D-06)
import { isGsdProject } from '../../adopt.js';                   // NO existsSync ad-hoc (D-04/D-05)
```
> CERO `picocolors`, CERO `src/cli/format.js`, CERO import directo de `node:child_process` (se inyecta por DI — leak guard). `enrich.js` vive bajo `src/cli/dashboard/**` que el walker `test/format-isolation.test.js` escanea.

**Leak guard estructural (DI sin default)** — copiar EXACTO de `adopt.js:95-100`:
```javascript
// El `*Fn` DI NO lleva default → omitirlo produce TypeError visible, no un fallback
// silencioso al binario real. Va ANTES del new Promise (propaga síncronamente).
if (typeof spawnFn !== 'function') {
  throw new TypeError('spawnDerive: `spawnFn` is required (no default — leak guard).');
}
```

**Core pattern — spawn one-shot + parse doble capa, fail-open a `{}`** (RESEARCH Pattern 2; molde never-throws de `runAdopt` líneas 101-170 — `new Promise((resolve) => { try { ... } catch { resolve(FALLBACK) } })`):
```javascript
const SCHEMA = JSON.stringify({
  type: 'object',
  properties: { title: { type: 'string' }, description: { type: 'string' } },
  required: ['title', 'description'],
  additionalProperties: false,
});

export function spawnDerive({ spawnFn, prompt, timeoutMs = 25_000 }) {
  return new Promise((resolve) => {
    try {
      const argv = ['-p', '--model', 'claude-haiku-4-5',
        '--output-format', 'json', '--json-schema', SCHEMA, prompt];
      // 'claude' por PATH (NO config.claude.binary — apunta a binario inexistente, Pitfall 3).
      // execFile-shaped: argv literal, NO shell → injection-inerte (D-13).
      spawnFn('claude', argv, { timeout: timeoutMs }, (err, stdout) => {
        if (err) return resolve({});                          // ENOENT / timeout(killed) / exit≠0
        try {
          const env = JSON.parse(stdout);                     // capa 1: envelope
          if (!env || env.is_error || typeof env.result !== 'string') return resolve({});
          const inner = JSON.parse(env.result);               // capa 2: result JSON estricto (con --json-schema)
          const out = {};
          if (typeof inner.title === 'string' && inner.title.trim()) out.title = inner.title.trim();
          if (typeof inner.description === 'string' && inner.description.trim()) out.description = inner.description.trim();
          resolve(out);
        } catch { resolve({}); }                              // parse-fail → fail-open
      });
    } catch { resolve({}); }                                  // spawn sync-throw → fail-open
  });
}
```
> **Divergencia clave vs runAdopt:** runAdopt resuelve un discriminante `{ok, code, detail}` (necesita mapear códigos a footer); enrich resuelve `{title?, description?}` o `{}` (cualquier fallo es indistinguible — solo importa "hay/no hay derivación"). NO copiar el union AdoptResult.

**Lectura de memoria GSD (capped, never-throws)** — `readFileFn` DI (espejo de `existsSyncFn` en `isGsdProject`/`buildSessionFromAdoption`):
```javascript
function readCapped(readFileFn, path, cap) {
  try { return readFileFn(path, 'utf8').slice(0, cap); } catch { return ''; }
}
function gsdContext({ cwd, readFileFn }) {
  const p = (f) => join(cwd, '.planning', f);
  return [
    readCapped(readFileFn, p('PROJECT.md'), 3000),
    readCapped(readFileFn, p('ROADMAP.md'), 2000),
    readCapped(readFileFn, p('STATE.md'), 2000),
  ].filter(Boolean).join('\n\n---\n\n');
}
```

**Parsing del transcript `.jsonl`** (RESEARCH Pattern 3; usa `resolveTranscriptPath`, NO concatenar el path a mano):
```javascript
export function firstUserPrompt({ cwd, sessionId, readFileFn }) {
  try {
    const raw = readFileFn(resolveTranscriptPath(cwd, sessionId), 'utf8'); // ENOENT → catch → ''
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let o; try { o = JSON.parse(line); } catch { continue; }  // saltar líneas no-mensaje (queue-operation)
      if (o.type !== 'user' || typeof o.message !== 'object') continue;
      const c = o.message.content;
      let text = '';
      if (typeof c === 'string') text = c;
      else if (Array.isArray(c)) {
        const hasToolResult = c.some((b) => b && b.type === 'tool_result');
        const texts = c.filter((b) => b && b.type === 'text').map((b) => b.text);
        if (hasToolResult && texts.length === 0) continue;     // tool_result-only → no es prompt
        text = texts.join(' ');
      }
      if (text && text.trim()) return text.trim().slice(0, 1500);
    }
    return '';
  } catch { return ''; }
}
```

**Rama GSD/non-GSD** — usa `isGsdProject(cwd, existsSyncFn)` (D-04 vs D-05), NO `existsSync('.planning')` ad-hoc.

**Prompt mínimo (D-07)** — prompt NUEVO, NO copiar la prosa de `kodo-orchestrate/skill.md`; en inglés; sin mandato charset/single-quote (la shell-safety la da `execFile` argv literal):
```javascript
function buildDerivePrompt({ contextLabel, contextBody }) {
  return [
    'Derive a concise task title and a one-paragraph description for a coding session,',
    'based ONLY on the project context below. The title must reflect the PROJECT SCOPE',
    '— NOT the directory name, NOT the latest commit.',
    'Return ONLY the structured fields requested.',
    '', `## ${contextLabel}`, contextBody,
  ].join('\n');
}
```

---

### `src/cli/dashboard/adopt.js` (service, request-response) — MODIFICAR

**Analog:** la propia línea `--title` de `runAdopt` (adopt.js:123) — espejo EXACTO.

**Cambio 1 — par `--description` en el argv** (insertar inmediatamente tras el bloque `--title`, línea 123, ANTES de `'--json'` línea 128):
```javascript
...(typeof title === 'string' && title.length > 0 ? ['--title', title] : []),
// NUEVO — espejo literal de --title (T-56-01: cada valor precedido de su flag; injection-safe sin shell):
...(typeof description === 'string' && description.length > 0 ? ['--description', description] : []),
```

**Cambio 2 — firma + JSDoc** (adopt.js:91): añadir `description` al destructuring de `runAdopt({ ..., title, description, timeoutMs })` y un `@param {string} [args.description]` espejo del de `title` (líneas 85-87).

> **Cadena downstream YA verificada (NO tocar):** `src/cli.js:257` registra `.option('--description <d>', ...)`; `src/cli/adopt.js:174` pasa `description: opts.description` a `adoptSession`; `adoptSession` la omite si `undefined` y la enhebra a `createTask`. El único trabajo es que `runAdopt` la inserte en el argv + el wiring de `index.js` la pase.

---

### `src/cli/dashboard/App.js` (component TUI ink, event-driven) — MODIFICAR

**Analog:** el handler `a` + la máquina de estados `mode` (App.js:339, 512-624) y el patrón `overlayReqRef` (App.js:347).

**Cambio 1 — añadir `'deriving'` a la unión `mode`** (App.js:339):
```javascript
const [mode, setMode] = useState(/** @type {'list' | 'filter' | 'overlay' | 'confirm' | 'deriving'} */ ('list'));
```

**Cambio 2 — punto de inserción del derive** (entre `resolveProjectId` OK App.js:524 y `setMode('confirm')` App.js:548). El handler `useInput` YA es `async` y usa `await onAdopt` (App.js:591), así que `await onDerive` es legal y never-throws:
```javascript
setArmedSessionId(surface.sessionId);
setOverlayKind(null);
setMode('deriving');                                          // NUEVO estado (spinner)
const reqId = ++overlayReqRef.current;                        // token de generación (espejo App.js:347) para T5/Esc
const derived = await onDerive?.({ cwd: surface.cwd, sessionId: surface.sessionId }) ?? {}; // never-throws → {}
if (overlayReqRef.current !== reqId) return;                  // derivación obsoleta tras Esc → descartar (T5)
setArmedSurface({
  workspaceRef: surface.workspaceRef, cwd: surface.cwd, sessionId: surface.sessionId,
  projectId: r.projectId,
  title: derived.title ?? surface.title,                       // fusión; fail-open conserva surface.title (T4)
  description: derived.description,
});
setMode('confirm');
return;
```

**Cambio 3 — segundo `a` pasa `description`** (App.js:580-591): `armedSurface` ya viaja completo a `onAdopt(armedSurface)`; solo asegurar que `description` esté en el objeto stasheado (Cambio 2). El handler de `confirm` NO cambia su lógica.

**Cambio 4 — keybindings nuevos** (UI-SPEC §Keybindings): `a` en `deriving` → tragada (return sin efecto); `Esc` en `deriving` → `overlayReqRef.current++` + `setMode('list')` (T5). Esc en `confirm` YA cancela (App.js:619-623, cubre D-09).

**Cambio 5 — constantes literal-estables EXPORTADAS** (espejo de `ADOPT_*` App.js:182-197, en español por mandato CONTEXT):
```javascript
export const DERIVE_PROGRESS = 'derivando título…';
/** @param {string} ref */
export const ADOPT_DERIVED_CONFIRM = (ref) => `adoptar ${ref}? pulsa a de nuevo · Esc cancela`;
/** @param {string} ref */
export const ADOPT_DERIVED_CONFIRM_FALLBACK = (ref) => `adoptar ${ref} (título por defecto)? pulsa a de nuevo · Esc cancela`;
```
> Ellipsis = `…` (un char), NUNCA `...` — convención de `ADOPT_OK`/`OPEN_OK`. Cyan reservado al prompt del confirm; spinner en `dimColor` (neutral). Render del confirm extendido (`título:`/`desc:` truncados) en `SessionTable.js` — extender la cadena de precedencia de footer a `derivingLine ?? confirmLine ?? errorLine ?? filterLine` (UI-SPEC nota 1).

---

### `src/cli/dashboard/index.js` (wiring) — MODIFICAR

**Analog:** el wiring de `onAdopt` (index.js:175-176) — espejo EXACTO de prop DI never-throws.

**Cambio 1 — wiring `onDerive`** (junto a `onAdopt`, índole de `onFocus`/`onOpen`/`onAdoptDiscover`):
```javascript
// Phase 62 (ORCH-02): derivador LLM one-shot never-throws. exec por PATH (execFile real inyectado).
// fail-open a {} → App.js cae a surface.title/basename. Lee fs (readFileSync DI) + isGsdProject.
onDerive: async ({ cwd, sessionId }) =>
  deriveAdoptionMeta({ spawnFn: execImpl, readFileFn: readFileSync, existsSyncFn: existsSync, cwd, sessionId }),
```
**Cambio 2 — `onAdopt` pasa `description`** (index.js:175-176): añadir `description` al destructuring y al objeto `runAdopt({ ..., title, description })`.
> `execImpl` es el `execFile` real ya resuelto en index.js (mismo que usa `onFocus`/`onAdopt`). `readFileSync`/`existsSync` se importan de `node:fs` SOLO en index.js (NO en enrich.js — ahí van por DI).

---

### `test/dashboard/enrich.test.js` (unit) — NUEVO

**Analog primario (fakes de spawn):** `test/dashboard/adopt.test.js` — `fakeExec` shape `(cmd, args, opts, cb) => { setImmediate(() => cb(err, stdout, stderr)); }` (líneas 51-54, 86-89).
**Analog secundario (fakes de fs):** `test/adopt.test.js` — `existsSyncFn: (p) => p.endsWith('.planning/PROJECT.md')` (línea 437), `readFileFn: () => '...'` / `() => { throw }` para ENOENT.

**Imports pattern:**
```javascript
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnDerive, firstUserPrompt, deriveAdoptionMeta } from '../../src/cli/dashboard/enrich.js';
```

**Fake spawn feliz (envelope → result):**
```javascript
const okExec = (cmd, args, opts, cb) => {
  const result = JSON.stringify({ title: 'X scope', description: 'Y' });
  const envelope = JSON.stringify({ type: 'result', is_error: false, result });
  setImmediate(() => cb(null, envelope, ''));
};
```

**Escenarios obligatorios** (RESEARCH Validation §Test Map — NO invocan `claude` real):
- envelope feliz → `{title, description}`
- `is_error:true` → `{}`; stdout no-JSON → `{}`; `result` no-JSON → `{}`
- cb con ENOENT (`{code:'ENOENT'}`) → `{}`; cb con `{killed:true}` (timeout) → `{}`
- `spawnFn` sync-throw → `{}` (never-throws; assert NO reject, molde adopt.test.js:214-234)
- leak guard: omitir `spawnFn` → TypeError (molde adopt.test.js:236-243)
- rama GSD: `existsSyncFn` true → lee PROJECT/ROADMAP/STATE capped (assert por `readFileFn` capturado)
- rama non-GSD: `existsSyncFn` false → git log + `firstUserPrompt`
- transcript: primer `user` en línea variable, salta `queue-operation`, content array tool_result-only saltado, ausente (ENOENT) → `''`

**Fixtures `.jsonl` sintéticos** (RESEARCH Wave 0 Gaps): primer `user` en línea 3+, `queue-operation` intercaladas, content string vs array, tool_result-only.

---

### `test/dashboard/adopt.test.js` (unit) — EXTENDER

**Analog:** los 4 tests de `--title` ya presentes (líneas 83-151) — espejo EXACTO con `--description`.

**Tests a añadir:**
- `description` no vacía → inserta `['--description', desc]` en el argv tras `--title`, antes de `--json` (molde test línea 83-113)
- `description` ausente → omite `--description` (molde línea 129-139)
- `description` vacía `''` → omite (molde línea 141-151)
- injection-inerte: `description` con metacaracteres → un solo arg literal (molde línea 115-127)

---

## Shared Patterns

### never-throws / fail-open
**Source:** `src/cli/dashboard/adopt.js:101-170` (`runAdopt`) — `new Promise((resolve) => { try {...} catch { resolve(FALLBACK) } })`, jamás `reject`.
**Apply to:** `enrich.js` (fail-open a `{}`), `onDerive` wiring. El panel ink permanece montado siempre (D-03/D-13).

### DI sin default (leak guard estructural)
**Source:** `src/cli/dashboard/adopt.js:95-100` — `if (typeof exec !== 'function') throw new TypeError(...)` ANTES del Promise.
**Apply to:** `enrich.js` (`spawnFn` sin default). Los `*Fn` con default (`existsSyncFn = existsSync` en `isGsdProject`, adopt.js:38) son aceptables para helpers internos; el spawn del LLM va SIN default.

### Color isolation (D-12 Phase 34)
**Source:** convención cross-milestone verificada por `test/format-isolation.test.js` (escanea `src/cli/dashboard/**`).
**Apply to:** `enrich.js` y los cambios de `App.js`. CERO `picocolors`/ANSI inline; todo color por prop `color`/`dimColor`/`bold` de `<Text>`. Spinner `dimColor`, prompt confirm `cyan`.

### Constantes literal-estables EXPORTADAS (testeables por equality)
**Source:** `src/cli/dashboard/App.js:182-197` (`ADOPT_*`).
**Apply to:** las nuevas `DERIVE_PROGRESS`/`ADOPT_DERIVED_CONFIRM*` (español; ellipsis `…`).

### DI de fakes en tests
**Source:** `test/dashboard/adopt.test.js:51-54` (`fakeExec` `(cmd,args,opts,cb)`) + `test/adopt.test.js:437` (`existsSyncFn`/`readFileFn`).
**Apply to:** `test/dashboard/enrich.test.js`, extensión de `adopt.test.js`. Para tests de App.js: harness ink-testing-library de `test/dashboard/app-adopt.test.js` (`drain()` 80ms, fake clock líneas 36-70).

---

## No Analog Found

Ninguno. Todos los archivos en alcance tienen analog directo en el codebase. El único código genuinamente nuevo (`enrich.js`: spawn de Haiku + parse del envelope + parsing del transcript) combina patrones ya existentes (never-throws de `runAdopt`, DI de fakes, `resolveTranscriptPath`/`isGsdProject` reusados). La fase es de **integración/wiring**, no de infraestructura nueva.

---

## Metadata

**Analog search scope:** `src/cli/dashboard/`, `src/orchestrator/`, `src/adopt.js`, `src/logger-events.js`, `src/cli.js`, `src/cli/adopt.js`, `test/dashboard/`, `test/adopt.test.js`
**Files scanned:** 11 (lectura directa de los analogs load-bearing)
**Pattern extraction date:** 2026-06-25
