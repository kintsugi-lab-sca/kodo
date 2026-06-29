# Phase 63: Editor de configuración en el dashboard — fundación + ajustes comunes - Research

**Researched:** 2026-06-29
**Domain:** TUI ink (text-input controlado in-house) + escritura atómica de config en Node + máquina de modos del dashboard
**Confidence:** HIGH (todo verificado contra el código real del repo y los tipos instalados de ink 6.8.0)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Text-input **in-house mínimo**, NO añadir dependencia. Extiende el patrón filter-mode con cursor visible + buffer controlado. Preserva color-isolation, no-JSX/no-build (`React.createElement`), DI-testeable con `ink-testing-library`.
- **D-02:** Tecla **`e`** (edit) abre el overlay desde `mode:'list'`. El planner re-verifica colisión (hoy `e` está libre).
- **D-03:** Dos estados nuevos: **`'config'`** (lista de campos navegable, valor read-only) y **`'config-edit'`** (editando con el text-input). Gateados en `useInput` **antes** del mode-gate de filtro, espejo del sub-modo overlay/picker (Phase 39/56).
- **D-04:** Config **congelada en snapshot al abrir** (molde `overlaySnapshot`), no re-leída bajo el poll. El poll de `/status` sigue corriendo por debajo.
- **D-05:** Flujo **two-level**: `mode:'config'` → ↑/↓ mueven cursor (clamp sin wrap, molde `adoptCursor`), `Enter` entra a `config-edit` precargando el valor, `Esc` cierra preservando `selectedTaskId`. `mode:'config-edit'` → edición; `Enter` valida y guarda (inválido → footer rojo + NO escribe, sigue editando); `Esc` cancela sin guardar y vuelve a `config`.
- **D-06:** **Módulo de validadores PUROS nuevo** (sug. `src/config-validate.js`), no-I/O, never-throws, contrato `{ok:true,value}` | `{ok:false,error}`. Corre **antes** de `saveConfig`.
- **D-07:** Reglas: `max_parallel`/`idle_threshold_min`/`stuck_threshold_min` → entero positivo; `default_model` ∈ `{opus, sonnet, haiku}`; `states.trigger/review/done` → string no-vacío (trim); `cmux.colors.*` ∈ set conocido de colores cmux. El planner fija el set exacto.
- **D-08:** **Escritura atómica temp+rename** como helper reusado por `saveConfig`/`saveProjects`. Preserva firma y formato (`JSON.stringify(cfg, null, 2) + '\n'`). El planner decide refactor in-place vs wrapper.
- **D-09:** El editor escribe **directo al filesystem** importando `saveConfig` en el proceso ink. NO shell-out a `kodo config`, NO endpoint en `server.js`.
- **D-10:** Tras guardar con éxito → **footer transitorio** (molde `focusError`/`footerColor`) verde/ámbar con aviso "reinicia server/daemon para aplicar".
- **D-11 (PERSIST-04):** El editor NUNCA muestra ni edita API keys. Lista de campos restringida explícitamente a la del dominio. Keys viven solo en `~/.kodo/.env`.
- **D-12 (UX-04):** Degradación never-throws. Config ilegible → `loadConfig` cae a `DEFAULT_CONFIG`; escritura fallida → footer rojo + panel montado + `config.json` previo intacto. Cero throws al árbol React.

### Claude's Discretion

- Tecla exacta si `e` colisiona (hoy libre).
- Layout/render del overlay (agrupación por sección claude/states/server/cmux, columnas).
- Set exacto de colores cmux válidos; si los campos enum se editan free-text+validate o cycle-through (recomendado: free-text+validate en v1).
- Ubicación/firma exacta del módulo de validadores y del helper de escritura atómica.
- Caps de longitud del buffer del text-input.
- Si `states.*` se edita solo para el provider activo o todos (recomendado: solo el activo).

### Deferred Ideas (OUT OF SCOPE)

- Editor de **proyectos** (`projects.json` / `listProjects()`) → Phase 64.
- Edición de API keys / `provider` activo / `base_url` / `workspace_slug` / `api_key_env` → CFGF-03 (v2).
- Hot-reload de config en server/daemon → CFGF-01 (v2).
- Endpoint nuevo en `server.js`.
- `kodo config` CLI no-lineal → CFGF-02 (v2).
- cmux.colors con cycle-through → mejora UX v2.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| UX-01 | Abre editor desde el dashboard con tecla dedicada (overlay) | Tecla `e` libre verificada; molde de apertura de overlay = handler `a`/`c`/`l`/`p` en `App.js` |
| UX-02 | Campo editable en ink con cursor, backspace, confirmación | ink 6.8.0 `useInput` Key tiene `leftArrow`/`rightArrow`/`backspace`/`delete` (verificado en `.d.ts`); patrón de buffer+cursor abajo |
| UX-03 | Cancelar sin guardar (`Esc`) preservando selección por `task_id` | `selectedTaskId` + `resolveSelection` re-derivan la fila gratis al volver (no se toca al abrir/cerrar overlay) |
| UX-04 | Degrada con gracia (never-throws), panel ink montado, mensaje al footer | `focusError`/`footerColor` + `loadConfig` ya never-throws; deep-clone del snapshot (Pitfall 1) |
| CFG-01 | Editar `claude.default_model` y `claude.max_parallel` | Campos en `DEFAULT_CONFIG.claude`; model pasa a `claude --model` (launch.js:198, manager.js:310) |
| CFG-02 | Editar `states.trigger/review/done` del provider activo | `providers[config.provider].states` (config.js:40-43) |
| CFG-03 | Editar `server.idle_threshold_min`/`stuck_threshold_min` | `DEFAULT_CONFIG.server` (config.js:62-66) |
| CFG-04 | Editar `cmux.colors` (running/done/error/review) | `DEFAULT_CONFIG.cmux.colors`; set válido verificado del binario cmux (16 named + hex) |
| CFG-05 | Validación pre-escritura; inválido → mensaje, no escribe | Módulo puro `config-validate.js` (D-06/D-07); molde `mapDismissResult` (puro, never-throws) |
| PERSIST-01 | Persistir a `config.json` preservando formato y migración | `saveConfig` + `migrateConfig`/`migrateConfigIfNeeded` (config.js) |
| PERSIST-02 | Escritura local sin endpoint nuevo en `server.js` | Import directo de `saveConfig` en el proceso ink (molde DI de index.js) |
| PERSIST-03 | Aviso de reinicio tras guardar | Footer transitorio `focusError`/`footerColor` verde/ámbar (molde Phase 37/42) |
| PERSIST-04 | API keys nunca editadas ni mostradas | Lista de campos restringida por construcción; keys solo en `.env` (`loadEnvFile`) |
| PERSIST-05 | Escritura no-corruptiva (archivo previo preservado si falla) | Helper atómico temp+rename (D-08); `rename(2)` atómico en mismo FS |
</phase_requirements>

## Summary

Esta fase es **casi 100% trabajo de patrones internos verificables** — no introduce dependencias nuevas (D-01 in-house está LOCKED) y reusa la infraestructura ya madura del dashboard. La investigación confirma empíricamente los cinco unknowns de mayor riesgo: (1) ink 6.8.0 expone en `useInput(input, key)` los flags `leftArrow`/`rightArrow`/`backspace`/`delete`/`upArrow`/`downArrow` (verificado en los `.d.ts` instalados), suficiente para un text-input controlado con cursor sin dependencia; (2) la escritura atómica es el patrón estándar `writeFileSync(tmp)` + `renameSync` en el mismo directorio/filesystem; (3) la máquina de modos de `App.js` tiene un orden de gating claro y precedentes directos (overlay/confirm/deriving) para insertar `config`/`config-edit`; (4) el set de validación de `default_model` y de colores cmux está confirmado contra el código y contra el binario cmux real; (5) el cableado DI de `index.js` ya inyecta funciones puras (`projects`, `onAdopt`, `onDerive`) y extenderlo con `loadConfig`/`saveConfig` es mecánico.

El **mayor riesgo no es técnico sino de integración fina**: dos pitfalls reales aparecen. Primero, `loadConfig()` cuando el archivo no existe devuelve `{...DEFAULT_CONFIG}` (spread **superficial**) — mutar campos anidados del snapshot (p.ej. `snapshot.claude.default_model`) contaminaría el `DEFAULT_CONFIG` del módulo. El snapshot DEBE deep-clonarse (`structuredClone`) antes de aplicar ediciones. Segundo, el `clear-on-any-input` del `focusError` corre al inicio de `useInput` y **consume cualquier tecla**; si el mensaje de validación rojo de `config-edit` se emite vía `focusError`, la siguiente pulsación se "gasta" en limpiarlo en vez de seguir editando. El prompt de validación debe DERIVARSE de un estado dedicado (espejo del `DISMISS_CONFIRM`/`DERIVE_PROGRESS` que se derivan de `mode`, no de `focusError` — Pitfall 4 de Phase 42/56).

**Primary recommendation:** Construir el text-input como `{ buffer: string, cursor: number }` gestionado en `App.js` (estado local), renderizado con `<Text inverse>` para el carácter bajo el cursor (color-isolation intacta), insertando `config`/`config-edit` como sub-modos gateados ANTES del gate de filtro. Crear `src/config-validate.js` (validadores puros never-throws) y un helper de escritura atómica compartido (`src/config.js` interno) reusado por `saveConfig`/`saveProjects`. Inyectar `loadConfig`/`saveConfig` en `App` por props DI espejo de `onAdopt`. Deep-clonar el snapshot y derivar el error de validación de un estado separado, no de `focusError`.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Captura de teclado / edición de texto | Browser/Client (TUI ink, `App.js useInput`) | — | El text-input es interacción pura de terminal; `useInput` es la única superficie de entrada |
| Render del overlay + cursor + footer | Browser/Client (TUI ink, `SessionTable.js`) | — | Presentación; color-isolation vía props de `<Text>` |
| Validación pre-escritura | Lógica pura (`src/config-validate.js`) | — | Función pura no-I/O, never-throws; reusable por Phase 64 |
| Snapshot de config al abrir | Database/Storage local (`loadConfig`) | Lógica pura | Lectura de `~/.kodo/config.json`; deep-clone antes de editar |
| Escritura atómica no-corruptiva | Database/Storage local (`saveConfig` + helper temp+rename) | — | Filesystem local; cero endpoint, cero server |
| Cableado DI | Frontend Server (proceso `runDashboard`/`index.js`) | — | `index.js` resuelve e inyecta `loadConfig`/`saveConfig` en `App` |

**Nota de tier:** Todo el carril es **local + determinista (0 tokens, sin red, sin provider)**. No hay tier de API/backend involucrado — esto es deliberado (D-09: escritura directa al filesystem, `server.js` intacto). El editor de proyectos (Phase 64) sí tocará el tier de provider vía `listProjects()`.

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `ink` | `^6.8.0` (instalado: 6.8.0) | TUI React; `useInput`/`Box`/`Text` | Ya es el motor del dashboard; `useInput` Key expone todos los flags necesarios `[VERIFIED: node_modules/ink/build/hooks/use-input.d.ts]` |
| `react` | `^19.2.0` | Estado del componente (`useState`/`useRef`) | Ya en uso; `React.createElement` plano (no-JSX) |
| `node:fs` | builtin (Node 22.22.3) | `writeFileSync`/`renameSync`/`existsSync` | `renameSync` da el rename atómico del helper temp+rename `[VERIFIED: node --version]` |
| `node:test` + `ink-testing-library` | builtin + `^4.0.0` | Tests TUI herméticos | Patrón establecido (`test/dashboard-*.test.js`) |

### Supporting
| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `structuredClone` | builtin (global, Node 22) | Deep-clone del snapshot de config | OBLIGATORIO antes de mutar el snapshot (Pitfall 1) |

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Text-input in-house | `ink-text-input` | DESCARTADO (D-01 LOCKED): dependencia nueva + superficie de color/JSX ajena al repo; el in-house es ~40 líneas reusando el molde filter-mode |
| `renameSync` plano | `write-file-atomic` (npm) | DESCARTADO: dependencia nueva para algo que `node:fs` ya hace; el repo es minimalista (4 deps prod) |
| `structuredClone` | `JSON.parse(JSON.stringify(x))` | `structuredClone` es builtin, más rápido y correcto; el config es JSON-safe así que ambos sirven, preferir el builtin |

**Installation:**
```bash
# NINGUNA. D-01 LOCKED: cero dependencias nuevas. package.json se mantiene en 4 deps prod
# (commander, ink, picocolors, react) + 1 devDep relevante (ink-testing-library).
```

**Version verification:** `ink@6.8.0` instalado y verificado; `react@19.2.0`; Node `v22.22.3` (>= engines `>=20.0.0`). El `Key` interface de `useInput` se inspeccionó directamente en `node_modules/ink/build/hooks/use-input.d.ts` — no es conocimiento de training, es el tipo real instalado.

## Package Legitimacy Audit

> **No aplica instalación de paquetes nuevos.** D-01 está LOCKED en in-house y la fase no añade dependencias. El `package.json` permanece intacto.

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| (ninguno nuevo) | — | — | — | — | — | — |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

Las dependencias existentes (`ink`, `react`, `picocolors`, `commander`) ya están instaladas y verificadas en milestones previos; esta fase no las toca.

## Architecture Patterns

### System Architecture Diagram

```
                         tecla `e` (mode:'list')
                                 │
                                 ▼
                     ┌────────────────────────┐
   loadConfig() ───► │  snapshot = structured  │   (D-04: congelado al abrir;
   (~/.kodo/         │  Clone(loadConfig())    │    el poll /status sigue por
    config.json)     └────────────┬───────────┘    debajo SIN tocar el overlay)
                                  │
                                  ▼
                     ┌────────────────────────┐
                     │   mode:'config'         │ ◄── ↑/↓ cursor (clamp sin wrap)
                     │   lista de campos       │ ── Esc ──► mode:'list'
                     │   (valor read-only)     │            (selectedTaskId intacto, UX-03)
                     └────────────┬───────────┘
                          Enter   │   (precarga valor en buffer)
                                  ▼
                     ┌────────────────────────┐
                     │   mode:'config-edit'    │ ◄── chars / ←→ / backspace / delete
                     │   buffer + cursor       │ ── Esc ──► mode:'config' (sin guardar)
                     └────────────┬───────────┘
                          Enter   │
                                  ▼
                     ┌────────────────────────┐
                     │  validate(field, value) │  (src/config-validate.js, puro)
                     └──────┬──────────┬───────┘
                    {ok:false}     {ok:true,value}
                         │              │
                         ▼              ▼
              footer rojo        setNestedValue(clon, field, value)
              (estado dedicado,         │
               NO focusError)           ▼
              sigue en edición    saveConfig(clon)  ──► helper atómico:
                                        │              writeFileSync(<path>.tmp)
                                        │              + renameSync(tmp → path)
                                        ▼
                                footer verde/ámbar (focusError/footerColor)
                                "reinicia server/daemon" + mode:'config'
```

### Recommended Project Structure
```
src/
├── config.js              # MOD: helper atómico interno; saveConfig/saveProjects lo reusan
├── config-validate.js     # NUEVO: validadores puros never-throws {ok,value}|{ok,error}
└── cli/dashboard/
    ├── App.js             # MOD: estados config/config-edit + buffer/cursor + handlers
    ├── SessionTable.js    # MOD: render del overlay de config + footer de validación/guardado
    └── index.js           # MOD: inyecta loadConfig/saveConfig en <App> (espejo de projects/onAdopt)

test/
├── config-validate.test.js   # NUEVO: tabla de casos válidos/inválidos por campo
├── config-atomic.test.js     # NUEVO: temp+rename, archivo previo intacto en fallo
└── dashboard-config.test.js  # NUEVO: render+stdin.write del overlay (molde dashboard-overlay.test.js)
```

### Pattern 1: Text-input controlado in-house (buffer + cursor)
**What:** Estado `{ buffer: string, cursor: number }` en `App.js`. `useInput` inserta/borra en `cursor` y mueve el cursor clamp.
**When to use:** `mode === 'config-edit'`.
**Example:**
```js
// Source: VERIFIED contra ink 6.8.0 Key interface + molde filter-mode de App.js:729-753
// Estados (junto a los demás useState de App.js):
const [buffer, setBuffer] = useState('');
const [cursor, setCursor] = useState(0);

// Dentro de useInput, rama `if (mode === 'config-edit') { ... }`:
if (key.escape) { setMode('config'); return; }            // cancela sin guardar (D-05)
if (key.return) { /* validar + guardar — ver Pattern 4 */ return; }
if (key.leftArrow)  { setCursor((c) => Math.max(0, c - 1)); return; }
if (key.rightArrow) { setCursor((c) => Math.min(buffer.length, c + 1)); return; }
if (key.backspace || key.delete) {
  // Nota: muchos terminales mandan backspace como `key.delete` (App.js ya trata ambos
  // juntos en filter-mode). Borra el char ANTERIOR al cursor.
  if (cursor > 0) {
    setBuffer((b) => b.slice(0, cursor - 1) + b.slice(cursor));
    setCursor((c) => c - 1);
  }
  return;
}
// Char imprimible: insertar en la posición del cursor (no append ciego como filter-mode)
if (input && !key.ctrl && !key.meta) {
  setBuffer((b) => b.slice(0, cursor) + input + b.slice(cursor));
  setCursor((c) => c + input.length); // input puede ser multi-char si hay paste
  return;
}
```
**Render del cursor (en SessionTable.js, color-isolation intacta):**
```js
// El carácter bajo el cursor se invierte con la prop `inverse` de <Text> (NO picocolors).
// Si cursor === buffer.length, se pinta un bloque al final (espacio inverso).
const left  = buffer.slice(0, cursor);
const under = buffer[cursor] ?? ' ';
const right = buffer.slice(cursor + 1);
h(Text, null, left, h(Text, { inverse: true }, under), right);
```

### Pattern 2: Escritura atómica temp+rename
**What:** Escribe a un fichero temporal en el MISMO directorio y luego `renameSync` (atómico en el mismo filesystem).
**When to use:** Toda escritura de `config.json`/`projects.json`.
**Example:**
```js
// Source: VERIFIED node:fs (Node 22.22.3) + POSIX rename(2) semantics
import { writeFileSync, renameSync } from 'node:fs';

/**
 * Escritura atómica: si falla la serialización o el write, el fichero previo
 * queda intacto (PERSIST-05). rename(2) es atómico cuando origen y destino están
 * en el MISMO filesystem (el .tmp se crea en el mismo dir → garantizado).
 * @param {string} path  destino final
 * @param {string} data  contenido ya serializado (incluye el \n final)
 */
function writeFileAtomic(path, data) {
  const tmp = path + '.tmp';
  writeFileSync(tmp, data);   // si lanza, `path` no se tocó
  renameSync(tmp, path);      // swap atómico; el lector nunca ve un archivo a medias
}

// saveConfig pasa a:
export function saveConfig(config) {
  ensureDir();
  writeFileAtomic(CONFIG_PATH, JSON.stringify(config, null, 2) + '\n');
}
```
**Notas verificadas:**
- `rename(2)` es atómico **solo en el mismo filesystem**. El `.tmp` en el mismo dir que el destino garantiza esto. Un rename cross-filesystem da `EXDEV` y degrada a copy (no atómico) — por eso NO usar `os.tmpdir()`.
- macOS/APFS (el dev usa darwin) cumple la garantía de atomicidad de `rename`.
- `fsync` (vía `openSync`/`fsyncSync`/`closeSync` del fichero y del dir) añade durabilidad ante **corte de energía**, pero NO es necesario para crash-safety ante un crash de proceso — el rename solo ya garantiza "todo o nada". Recomendación: omitir fsync en v1 (simplicidad); el config no es dato crítico de pérdida-de-datos.

### Pattern 3: Inserción de modos en la máquina `useInput`
**What:** Orden de gating dentro del callback de `useInput` (App.js:502-991).
**Orden ACTUAL verificado (early-return en cada rama):**
```
1. focusError != null   → clear-on-any-input (consume la tecla)   [App.js:510]
2. mode === 'overlay'    → scroll / picker adopt                   [App.js:518]
3. mode === 'deriving'   → spinner, solo Esc cancela               [App.js:630]
4. mode === 'confirm'    → double-confirm dismiss/adopt            [App.js:645]
5. mode === 'filter'     → text-append del query                  [App.js:729]
6. mode === 'list'       → q / c / l / p / d / o / a / ↑↓ / Enter  [App.js:755]
```
**Inserción recomendada:** añadir las ramas `config`/`config-edit` ENTRE el bloque `confirm` (4) y `filter` (5), espejo del orden CONTEXT D-03 ("antes del mode-gate de filtro"). La tecla `e` se añade como handler nuevo en la rama `mode === 'list'` (paso 6), junto a `c`/`l`/`p`.
```js
// Tras el bloque if (mode === 'confirm') {...}, ANTES de if (mode === 'filter') {...}:
if (mode === 'config') {
  if (key.escape) { setMode('list'); setConfigField(null); return; } // UX-03: selectedTaskId intacto
  if (key.upArrow)   { setFieldCursor((i) => Math.max(0, i - 1)); return; }
  if (key.downArrow) { setFieldCursor((i) => Math.min(FIELDS.length - 1, i + 1)); return; }
  if (key.return) {
    const field = FIELDS[fieldCursor];
    setBuffer(String(getByPath(snapshot, field.path))); // precarga el valor actual (D-05)
    setCursor(getByPath(snapshot, field.path).length);
    setConfigEditError(null);
    setMode('config-edit');
    return;
  }
  return; // traga el resto mientras navega la lista
}
if (mode === 'config-edit') { /* Pattern 1 */ }
```

### Pattern 4: Validación derivada de estado dedicado (NO focusError)
**What:** El error de validación en `config-edit` se guarda en un estado propio (`configEditError`) y se renderiza derivándolo de `mode === 'config-edit'`, NO vía `focusError`.
**Why:** El `clear-on-any-input` del `focusError` (App.js:510) consume la siguiente tecla. Si el error rojo fuera `focusError`, tras un valor inválido la primera pulsación se gastaría en limpiar el mensaje en vez de editar (Pitfall 4 de Phase 42/56 — el `DISMISS_CONFIRM`/`DERIVE_PROGRESS` ya se derivan de `mode` precisamente por esto).
**Example:**
```js
const [configEditError, setConfigEditError] = useState(/** @type {string|null} */ (null));

// En el Enter de config-edit:
const res = validateField(FIELDS[fieldCursor], buffer); // src/config-validate.js, never-throws
if (!res.ok) {
  setConfigEditError(res.error); // sigue en config-edit (D-05), render rojo derivado de mode
  return;
}
const next = structuredClone(snapshot);        // Pitfall 1: deep-clone
setByPath(next, FIELDS[fieldCursor].path, res.value);
try {
  await onSaveConfig(next);                     // never-throws; ver Pattern 2
  setSnapshot(next);                            // refresca el snapshot congelado
  setFocusError(CONFIG_SAVED_RESTART);          // footer verde/ámbar (D-10) — AQUÍ sí focusError
  setFooterColor('yellow');
  setConfigEditError(null);
  setMode('config');                            // vuelve a la lista
} catch {                                       // defensa en profundidad (onSaveConfig es never-throws)
  setConfigEditError(CONFIG_SAVE_FAILED);       // config.json previo intacto (D-08/PERSIST-05)
}
```
El footer de guardado-OK usa `focusError` porque ahí SÍ queremos clear-on-any-input (es transitorio y ya estamos de vuelta en `mode:'config'`).

### Anti-Patterns to Avoid
- **Mutar el snapshot sin deep-clone:** `loadConfig()` sin fichero devuelve `{...DEFAULT_CONFIG}` (spread superficial); `snapshot.claude.x = y` contaminaría el `DEFAULT_CONFIG` del módulo y envenenaría TODO el proceso. Siempre `structuredClone`.
- **Emitir el error de validación vía `focusError`:** lo come el clear-on-any-input. Usar estado dedicado derivado de `mode`.
- **Append ciego del char (como filter-mode):** filter-mode hace `q + input` (siempre al final). El text-input con cursor debe insertar en `cursor`, no al final.
- **`.tmp` en `os.tmpdir()`:** cross-filesystem → rename no atómico (`EXDEV`). El `.tmp` va en el mismo dir que el destino.
- **Añadir un endpoint `POST /config` en server.js:** viola "cero endpoints desde v0.10" (D-09).
- **Editar `states` de TODOS los providers:** recomendado solo el activo (`config.providers[config.provider].states`).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Snapshot congelado bajo poll vivo | Lógica nueva de freeze | Molde `overlaySnapshot` (App.js:392) | Ya resuelto: el poll no re-escribe el snapshot |
| Cursor navegable con clamp sin wrap | Tu propio clamp | Molde `adoptCursor` (App.js:354, 531-537) | `Math.max(0, i-1)` / `Math.min(len-1, i+1)` ya probado |
| Footer transitorio multicolor | Objeto {text,color} nuevo | `focusError` + `footerColor` (App.js:324-331) | Ya hace verde/ámbar/rojo derivado de estado |
| Set-by-dot-path | Parser nuevo | `setNestedValue` (cli.js:511) como modelo | Precedente exacto; PERO hazlo puro (sin mutar) sobre el clon |
| Preservar selección al cerrar | Re-buscar la fila | `selectedTaskId` + `resolveSelection` | UX-03 gratis: no se toca el id al abrir/cerrar |
| Migración de schema al guardar | Re-migrar | `migrateConfigIfNeeded` ya corre en `loadConfig` | El snapshot ya está migrado al leerlo |
| Copy literal-estable de mensajes | Strings inline | Constantes EXPORTADAS (molde `DISMISS_*`/`OVERLAY_*`) | Tests las importan y asserean equality → mata drift |

**Key insight:** El 80% de esta fase es ENSAMBLAR moldes existentes, no inventar. El único componente genuinamente nuevo es el text-input con cursor (Pattern 1), y ese reusa el esqueleto del filter-mode. El `setNestedValue` existente MUTA su input — para el editor conviene una variante pura (`setByPath(clon, path, value)` que retorna sin tocar el original), pero la lógica de split-by-dot es idéntica.

## Common Pitfalls

### Pitfall 1: Spread superficial de DEFAULT_CONFIG contamina el módulo
**What goes wrong:** `loadConfig()` sin fichero devuelve `{...DEFAULT_CONFIG}` (config.js:127) — los objetos anidados (`claude`, `server`, `cmux`, `providers`) son REFERENCIAS COMPARTIDAS con el `DEFAULT_CONFIG` del módulo. Mutar `snapshot.claude.default_model` muta el default global del proceso.
**Why it happens:** Spread JS es shallow; sólo el primer nivel se copia.
**How to avoid:** `const snapshot = structuredClone(loadConfig())` SIEMPRE antes de editar. Idealmente deep-clonar también dentro del helper de guardado por defensa en profundidad.
**Warning signs:** Tests que pasan aislados pero contaminan el estado de otros tests del mismo runner; valores "pegados" entre aperturas del editor.

### Pitfall 2: focusError clear-on-any-input se come la tecla de edición
**What goes wrong:** Si el error de validación se emite vía `setFocusError`, la rama de App.js:510 consume la siguiente pulsación para limpiarlo — el operador "pierde" una tecla al seguir editando tras un valor inválido.
**Why it happens:** El clear-on-any-input es el PRIMER gate del `useInput` y hace early-return.
**How to avoid:** Estado dedicado `configEditError` derivado de `mode === 'config-edit'` (Pattern 4), espejo de cómo `DISMISS_CONFIRM` se deriva de `mode === 'confirm'`.
**Warning signs:** "Tengo que pulsar dos veces" tras un error de validación.

### Pitfall 3: backspace vs delete según terminal
**What goes wrong:** Algunos terminales/emuladores mandan la tecla Backspace como `key.delete` y otros como `key.backspace`. Tratar solo uno deja el borrado roto en ciertos entornos.
**Why it happens:** Divergencia histórica `\x7f` (DEL) vs `\b` (BS) en terminales.
**How to avoid:** Tratar `key.backspace || key.delete` juntos (App.js:741 ya lo hace en filter-mode). En tests, `\x7f` es lo que `ink-testing-library` interpreta como backspace.
**Warning signs:** El borrado funciona en la terminal del dev pero no en CI o en otro emulador.

### Pitfall 4: Rename cross-filesystem no es atómico
**What goes wrong:** Si el `.tmp` se crea en `os.tmpdir()` y el destino está en `~/.kodo/`, pueden estar en filesystems distintos → `renameSync` lanza `EXDEV` o (en libs que lo manejan) degrada a copy no-atómico.
**Why it happens:** `rename(2)` POSIX solo es atómico intra-filesystem.
**How to avoid:** Crear el `.tmp` en el MISMO directorio que el destino (`path + '.tmp'`).
**Warning signs:** `EXDEV` en algún entorno; archivos `.tmp` huérfanos.

### Pitfall 5: Testabilidad del cursor en lastFrame()
**What goes wrong:** `lastFrame()` de `ink-testing-library` incluye códigos ANSI cuando se usa `<Text inverse>`. Asertar la POSICIÓN del cursor por su styling es frágil.
**Why it happens:** El inverse se serializa como secuencias ANSI en el frame.
**How to avoid:** Asertar sobre el CONTENIDO del buffer (`assert.match(lastFrame(), /valor-esperado/)`) y testear la posición del cursor indirectamente (p.ej. tras `←←` + insertar un char, el char aparece en medio). Opcionalmente exponer una constante/función de render del buffer para asserts deterministas. NO asertar bytes ANSI exactos del cursor.
**Warning signs:** Tests que rompen al cambiar la versión de ink o el modo de color.

### Pitfall 6: default_model — alias vs id completo
**What goes wrong:** Validar `default_model` contra `{opus, sonnet, haiku}` es correcto para lo que kodo pasa a `claude --model` (launch.js:198, manager.js:310 usan `config.claude.default_model` literal). PERO `claude --model` también acepta ids completos (`claude-haiku-4-5`, como usa enrich.js:70 para OTRA cosa). Si el operador ya tiene un id completo en su config, rechazarlo sería una regresión.
**Why it happens:** El set conocido es más estricto que lo que el binario acepta.
**How to avoid (discreción del planner):** o (a) set estricto `{opus, sonnet, haiku}` documentado como "valores soportados por kodo" (CONTEXT D-07), aceptando que un id completo manual se rechaza; o (b) set + passthrough de cualquier string `claude-*`. Recomendación: (a) en v1 por simplicidad y simetría con CONTEXT; documentar el límite.
**Warning signs:** Un operador con `default_model: 'claude-opus-4-x'` no puede re-guardar su config.

## Code Examples

### Validador puro never-throws (molde mapDismissResult)
```js
// Source: src/config-validate.js (NUEVO) — contrato D-06 {ok,value}|{ok,error}
// VERIFIED: set de colores cmux extraído del binario real (ver State of the Art)
const CMUX_COLORS = new Set([
  'Red','Crimson','Orange','Amber','Olive','Green','Teal','Aqua',
  'Blue','Navy','Indigo','Purple','Magenta','Rose','Brown','Charcoal',
]);
const MODELS = new Set(['opus', 'sonnet', 'haiku']);

/** @returns {{ok:true,value:any}|{ok:false,error:string}} */
export function validatePositiveInt(raw) {
  const s = String(raw).trim();
  if (!/^\d+$/.test(s)) return { ok: false, error: 'debe ser un entero' };
  const n = Number(s);
  if (!Number.isInteger(n) || n < 1) return { ok: false, error: 'debe ser un entero positivo' };
  return { ok: true, value: n };
}
export function validateModel(raw) {
  const s = String(raw).trim();
  return MODELS.has(s) ? { ok: true, value: s } : { ok: false, error: `modelo debe ser uno de: ${[...MODELS].join(', ')}` };
}
export function validateNonEmpty(raw) {
  const s = String(raw).trim();
  return s.length > 0 ? { ok: true, value: s } : { ok: false, error: 'no puede estar vacío' };
}
export function validateCmuxColor(raw) {
  const s = String(raw).trim();
  return CMUX_COLORS.has(s) ? { ok: true, value: s } : { ok: false, error: `color desconocido (ver lista cmux)` };
}
```

### Test hermético del overlay (molde dashboard-overlay.test.js)
```js
// Source: VERIFIED patrón test/dashboard-overlay.test.js:171-237
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App from '../src/cli/dashboard/App.js';

const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
try {
  await clock.flushTick();         // primer poll → datos
  stdin.write('e');                // abre el overlay de config (mode:'config')
  await new Promise(r => setImmediate(r));
  stdin.write('\r');               // Enter → entra a config-edit del primer campo
  stdin.write('5');                // teclea
  stdin.write('\x7f');             // backspace
  stdin.write('\x1b[D');           // ← (left arrow)
  stdin.write('3');                // inserta en medio
  stdin.write('\r');               // Enter → valida + guarda
  assert.match(lastFrame(), /reinicia|reiniciar/i);  // footer de aviso (D-10)
  stdin.write('\x1b');             // Esc → vuelve a list
} finally {
  unmount();
}
```
**Códigos de tecla para `stdin.write`:** char literal (`'5'`), Enter `'\r'`, Escape `'\x1b'`, backspace `'\x7f'`, ←`'\x1b[D'` →`'\x1b[C'` ↑`'\x1b[A'` ↓`'\x1b[B'`.

### Cableado DI en index.js (molde projects/onAdopt)
```js
// Source: VERIFIED src/cli/dashboard/index.js:148-198
// saveConfig ya NO se importa hoy — añadir al lazy import existente de config.js:
const { loadConfig, saveConfig, loadProjects } = await import('../../config.js');
// ... en createElement(App, { ... }):
//   snapshot inicial lo toma App al pulsar `e` llamando loadConfigFn(); o se inyecta el config ya leído.
loadConfigFn: () => loadConfig(),
onSaveConfig: async (cfg) => { try { saveConfig(cfg); return { ok: true }; } catch (e) { return { ok: false, error: String(e?.message ?? e) }; } },
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Overlays read-only (`c`/`l`/`p`) | Overlay read-WRITE con text-input | Phase 63 (esta) | 2ª ruptura consciente de "TUI read-only" tras el dismiss (v0.10) |
| `saveConfig` = `writeFileSync` plano (config.js:139) | temp+rename atómico | Phase 63 (D-08) | Crash-safety: `config.json` nunca a medias (PERSIST-05) |
| Config editable solo vía wizard `kodo config` lineal | Editor no-lineal en el dashboard | Phase 63 | El operador edita ajustes comunes sin re-correr el wizard |

**Set de colores cmux VERIFICADO** (extraído del binario `/Applications/cmux.app/Contents/Resources/bin/cmux workspace-action --help` `[VERIFIED: binario cmux instalado]`):
`Red, Crimson, Orange, Amber, Olive, Green, Teal, Aqua, Blue, Navy, Indigo, Purple, Magenta, Rose, Brown, Charcoal` — 16 colores nombrados + `#RRGGBB` hex. Los defaults de kodo (`Amber`/`Green`/`Crimson`/`Blue`) están todos en el set. **Decisión de discreción para el planner:** aceptar solo los 16 nombrados (simple) o también hex (más permisivo). Recomendación v1: solo nombrados (el set discreto valida limpio y es lo que usan los defaults).

**Set de `default_model`:** kodo pasa `config.claude.default_model` literal a `claude --model` (launch.js:198, manager.js:310). El default es `opus`. Set de validación CONTEXT D-07: `{opus, sonnet, haiku}` (ver Pitfall 6 sobre ids completos).

**Deprecated/outdated:** nada relevante; el stack (ink 6, react 19, node 22) está al día.

## Runtime State Inventory

> Esta NO es una fase de rename/refactor/migración — es feature nueva (editor). El inventario de estado runtime no aplica en su forma de "qué strings quedan cacheados". Sin embargo, hay un punto análogo relevante:

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `~/.kodo/config.json` es el único dato escrito; ya migrado por `loadConfig` al leer | Ninguna migración de datos; solo escritura atómica |
| Live service config | El server/daemon lee config **al arrancar**, NO en vivo (sin hot-reload, CFGF-01 diferido) | El aviso de reinicio (D-10) es la mitigación; NO se notifica al server |
| OS-registered state | Ninguno | None — verificado: el editor no toca Task Scheduler/launchd/pm2 |
| Secrets/env vars | API keys en `~/.kodo/.env` — el editor NUNCA las toca (D-11/PERSIST-04) | None — restricción por construcción (no hay campo editable de keys) |
| Build artifacts | Ninguno | None — no hay rename de paquete ni egg-info |

**Punto crítico:** tras guardar, el server/daemon en marcha sigue con la config VIEJA en memoria hasta reiniciarse. El aviso de reinicio (PERSIST-03/D-10) es la mitigación aceptada por el operador. Esto es correcto y esperado, no un bug.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (builtin, Node 22.22.3) + `ink-testing-library@4.0.0` |
| Config file | none — script `npm test` = `node --test $(find test -name '*.test.js' -type f)` |
| Quick run command | `node --test test/config-validate.test.js` |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| CFG-05 | Validadores puros por campo (int+, model, non-empty, color) | unit | `node --test test/config-validate.test.js` | ❌ Wave 0 |
| PERSIST-05 | Escritura atómica; archivo previo intacto en fallo | unit | `node --test test/config-atomic.test.js` | ❌ Wave 0 |
| PERSIST-01 | `saveConfig` preserva formato `JSON.stringify(...,2)+'\n'` y migración | unit | `node --test test/config-atomic.test.js` | ❌ Wave 0 |
| UX-01/UX-02 | `e` abre overlay; text-input con cursor/backspace/←→ | integration | `node --test test/dashboard-config.test.js` | ❌ Wave 0 |
| UX-03 | `Esc` cierra preservando `selectedTaskId` | integration | `node --test test/dashboard-config.test.js` | ❌ Wave 0 |
| CFG-05 (UI) | Valor inválido → footer rojo, NO escribe, sigue editando | integration | `node --test test/dashboard-config.test.js` | ❌ Wave 0 |
| PERSIST-03 | Tras guardar → footer de aviso de reinicio | integration | `node --test test/dashboard-config.test.js` | ❌ Wave 0 |
| UX-04 | Escritura fallida → footer rojo, panel montado, no crash | integration | `node --test test/dashboard-config.test.js` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `node --test test/config-validate.test.js` (o el fichero tocado)
- **Per wave merge:** `npm test`
- **Phase gate:** `npm test` verde antes de `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/config-validate.test.js` — cubre CFG-05 (tabla válido/inválido por campo, incl. límites: 0, negativos, no-numérico, color desconocido, modelo fuera de set, string vacío/espacios)
- [ ] `test/config-atomic.test.js` — cubre PERSIST-01/05 (formato byte-exacto preservado; simular fallo de write → original intacto; `.tmp` en mismo dir). Usar `HOME` redirigido a tmpdir (Pitfall de aislamiento conocido: `config.js` cachea `KODO_DIR` al import — ver nota abajo)
- [ ] `test/dashboard-config.test.js` — cubre UX-01..04/CFG-05-UI/PERSIST-03 (molde `dashboard-overlay.test.js`: render+`stdin.write`+`lastFrame`)
- [ ] No hace falta instalar framework: `node:test` + `ink-testing-library` ya presentes

**Nota de aislamiento de tests (memoria del proyecto, verificada):** `src/config.js` resuelve `KODO_DIR`/`CONFIG_PATH` al import (líneas 6-8) leyendo `homedir()`. Los tests que redirigen `process.env.HOME` DESPUÉS del import no ven el cambio (KODO_DIR ya cacheado). Para `config-atomic.test.js`: o (a) inyectar el path como argumento al helper atómico (preferido, DI puro), o (b) `import()` dinámico tras setear `HOME`. Recomendación: hacer el helper atómico recibir el `path` como parámetro (ya lo hace en Pattern 2) → testeable sin tocar HOME.

## Security Domain

> `security_enforcement` no está explícitamente en `false` → incluido. Carril 100% local, sin red, sin LLM, sin input de provider.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | El editor es local; no hay auth (proceso del usuario) |
| V3 Session Management | no | Sin sesiones HTTP |
| V4 Access Control | no | Filesystem local con permisos del usuario |
| V5 Input Validation | **yes** | `src/config-validate.js` valida TODO valor antes de escribir (CFG-05) |
| V6 Cryptography | no | No se manejan secretos en este carril (D-11: keys nunca tocadas) |
| V12 File Resources | **yes** | Escritura atómica a paths fijos (`CONFIG_PATH`), sin path construido desde input del usuario |

### Known Threat Patterns for {ink TUI + escritura local de config}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Valor inválido corrompe config | Tampering | Validación pura pre-escritura (CFG-05) + escritura atómica (PERSIST-05) |
| Escritura a medias por crash | Tampering/DoS | temp+rename atómico; original intacto |
| Exposición de API key en la TUI | Info Disclosure | D-11: keys NO son campos editables (excluidas por construcción); viven en `.env` |
| Inyección vía valor de config (p.ej. `default_model`) que llega a `claude --model` | Tampering/Injection | El valor va por `execFile` argv literal (NO shell) en launch.js; validación de set conocido refuerza |
| ReDoS por valor del buffer | DoS | Validadores usan `Set.has` y `/^\d+$/` (regex acotada sobre input corto), nunca regex compilada desde input |

**Nota:** El valor de `default_model` editado acaba como argv de `claude --model` vía `execFile` (sin shell) — injection-inerte por construcción. La validación de set conocido (`{opus,sonnet,haiku}`) es defensa en profundidad adicional.

## Project Constraints (from CLAUDE.md)

> No existe `./CLAUDE.md` ni `./.claude/CLAUDE.md` en el repo kodo (la única CLAUDE.md es la global del usuario). Las restricciones aplicables vienen de los invariantes del proyecto en STATE.md:

- **Cero endpoints nuevos desde v0.10** — el editor escribe local, `server.js` intacto (D-09).
- **TUI never-throws** — panel ink siempre montado ante error (D-12/UX-04).
- **Color isolation** — `picocolors` solo desde `src/cli/format.js`; el dashboard usa color SOLO vía props de `<Text>` de ink. El cursor se pinta con `<Text inverse>`, no con picocolors.
- **Selección por identidad `task_id`** — preservada al entrar/salir del editor (UX-03).
- **API keys solo en `~/.kodo/.env`** — nunca editadas ni mostradas (D-11/PERSIST-04).
- **0 tokens en este carril** — el editor es determinista, sin LLM (a diferencia del `onDerive` de Phase 62).
- **no-JSX/no-build** — `React.createElement` plano.
- **Estilo:** el repo escribe comentarios densos en español + `// @ts-check` en cada módulo; los validadores y el helper atómico deben seguir ese estilo.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Omitir `fsync` es aceptable (rename solo basta para crash-safety de proceso) | Pattern 2 | Bajo — solo pierde durabilidad ante corte de energía; config no es dato crítico. El planner puede añadir fsync si quiere durabilidad total |
| A2 | Set de validación `{opus,sonnet,haiku}` (estricto) es preferible a passthrough de ids completos | Pitfall 6 / D-07 | Medio — un operador con id completo manual no podría re-guardar. CONTEXT D-07 lo fija así; confirmable en discuss si preocupa |
| A3 | `states.*` se edita solo para el provider activo | CONTEXT discreción | Bajo — recomendación explícita de CONTEXT; el planner decide |
| A4 | `ink-testing-library` interpreta `\x7f` como backspace y `\x1b[D/C` como ←/→ | Pattern test | Bajo — comportamiento estándar de parsing de ink; verificable en Wave 0 con un test trivial |

**Nota:** Todos los hechos técnicos centrales (API de `useInput`, atomicidad de rename, máquina de modos, set de colores cmux, uso de `default_model`) están VERIFIED contra el código/binario real. Los ASSUMED arriba son decisiones de diseño con recomendación, no hechos sin verificar.

## Open Questions

1. **¿El helper atómico debe hacer `fsync` para durabilidad ante corte de energía?**
   - Lo que sabemos: rename solo garantiza "todo o nada" ante crash de proceso (PERSIST-05 cumplido).
   - Lo que no está claro: si el proyecto quiere durabilidad ante corte de energía (necesitaría fsync del fichero + del directorio).
   - Recomendación: omitir en v1 (simplicidad); el config se regenera trivialmente. Documentar como mejora opcional.

2. **¿Set de colores cmux: solo los 16 nombrados o también hex `#RRGGBB`?**
   - Lo que sabemos: el binario acepta ambos; los defaults de kodo usan nombrados.
   - Lo que no está claro: si algún operador quiere hex.
   - Recomendación: solo nombrados en v1 (validación discreta limpia); cycle-through hex diferido a v2 (CONTEXT deferred).

3. **¿`setNestedValue` se reusa (mutante) o se crea variante pura?**
   - Lo que sabemos: `cli.js:511` muta su input; el editor opera sobre un clon.
   - Lo que no está claro: si conviene exportar `setNestedValue` desde un módulo compartido o duplicar la lógica pura.
   - Recomendación: variante pura `setByPath` en `config-validate.js` o un util pequeño; la lógica split-by-dot es trivial. Operar siempre sobre `structuredClone`.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | todo | ✓ | 22.22.3 (>= engines 20) | — |
| ink | TUI + useInput | ✓ | 6.8.0 | — |
| react | estado del componente | ✓ | 19.2.0 | — |
| ink-testing-library | tests TUI | ✓ | 4.0.0 (devDep) | — |
| binario cmux | (solo para verificar set de colores en research) | ✓ | en `/Applications/cmux.app/...` | el set queda hardcodeado en `config-validate.js`, no se consulta el binario en runtime |
| `~/.kodo/config.json` | snapshot del editor | depende del entorno | — | `loadConfig` cae a `DEFAULT_CONFIG` si falta (never-throws) |

**Missing dependencies with no fallback:** ninguna.
**Missing dependencies with fallback:** `~/.kodo/config.json` puede no existir → `loadConfig` devuelve `DEFAULT_CONFIG` (deep-clonar antes de editar, Pitfall 1).

## Sources

### Primary (HIGH confidence)
- `node_modules/ink/build/hooks/use-input.d.ts` — `Key` interface (leftArrow/rightArrow/backspace/delete/upArrow/downArrow) y firma `Handler = (input, key) => void` `[VERIFIED]`
- `src/cli/dashboard/App.js` — máquina de modos completa, filter-mode (729-753), focusError/footerColor (324-331), overlaySnapshot (392), adoptCursor (354/531), handlers de list (755-991) `[VERIFIED]`
- `src/cli/dashboard/index.js` — cableado DI de App (148-198), lazy imports de config.js `[VERIFIED]`
- `src/config.js` — loadConfig/saveConfig/migrateConfig/DEFAULT_CONFIG, spread superficial (127) `[VERIFIED]`
- `src/cli.js` — `kodo config --set` + `setNestedValue` (511) `[VERIFIED]`
- `src/orchestrator/launch.js:198`, `src/session/manager.js:310` — `config.claude.default_model` → `claude --model` `[VERIFIED]`
- binario cmux `workspace-action --help` — set de 16 colores nombrados + hex `[VERIFIED]`
- `test/dashboard-overlay.test.js` — patrón ink-testing-library (render/stdin.write/lastFrame/flushTick) `[VERIFIED]`
- `package.json` — deps (ink/react/picocolors/commander), Node 22.22.3 `[VERIFIED]`

### Secondary (MEDIUM confidence)
- Semántica de `rename(2)` POSIX (atómico intra-filesystem, EXDEV cross-fs) — conocimiento estándar, consistente con `node:fs` `[CITED: POSIX/Node fs docs]`

### Tertiary (LOW confidence)
- Ninguna afirmación central depende de fuentes no verificadas.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — cero deps nuevas; versiones verificadas en node_modules
- Architecture (modos/text-input/atomic): HIGH — todo contrastado contra el código real y los tipos instalados
- Pitfalls: HIGH — derivados de leer el código (spread superficial, clear-on-any-input) y de precedentes documentados (Phase 42/56 Pitfall 4)
- Validación (sets): HIGH — model verificado en launch/manager; colores verificados en el binario cmux

**Research date:** 2026-06-29
**Valid until:** 2026-07-29 (stack estable; reverificar solo si se bumpea ink/react/node)
</content>
</invoke>
