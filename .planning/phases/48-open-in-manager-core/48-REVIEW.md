---
phase: 48-open-in-manager-core
reviewed: 2026-06-12T05:45:00Z
depth: standard
files_reviewed: 13
files_reviewed_list:
  - src/cli/dashboard/App.js
  - src/cli/dashboard/index.js
  - src/cli/dashboard/open.js
  - src/config.js
  - src/providers/plane/normalize.js
  - src/providers/plane/provider.js
  - src/providers/registry.js
  - src/server.js
  - test/config.test.js
  - test/dashboard/app-focus.test.js
  - test/dashboard/app-open.test.js
  - test/dashboard/open.test.js
  - test/normalize.test.js
findings:
  critical: 0
  warning: 4
  info: 4
  total: 8
status: issues_found
---

# Phase 48: Code Review Report

**Reviewed:** 2026-06-12T05:45:00Z
**Depth:** standard
**Files Reviewed:** 13
**Status:** issues_found

## Summary

Revisión adversarial del slice "open-in-manager core" (Phase 48): el lanzador puro
`runOpen` (open.js), el handler `o` de App.js, la propagación de `web_url`/`task_url`
desde el provider Plane hasta la sesión, y la presentación del enlace en el dashboard
HTML del server.

El núcleo nuevo (`runOpen`) está bien construido: never-throws verificado, allowlist
http(s) con `execFile` + argv literal `[url]` que neutraliza la flag-injection de `open`
(confirmado empíricamente: una URL `http://-evil` parsea como host, no como flag argv
suelto, y los metacaracteres de shell son inertes sin shell). Los tests cubren los 6
escenarios del discriminante. No se encontraron BLOCKERS.

Sí hay una **asimetría de seguridad load-bearing**: Phase 48 añadió la allowlist de
protocolo al carril TUI (`o`) pero dejó el carril HTML del dashboard (`<a href>` en
server.js) renderizando `task_url`/`t.url` sin validación de protocolo — un `javascript:`
URL sobrevive a `escapeHtml`. Además hay un riesgo de crash en la factory de registry
que esta fase tocó, y dos divergencias de robustez en la cadena de migración/normalización.

## Warnings

### WR-01: Dashboard HTML renderiza `task_url` en `href` sin allowlist de protocolo (asimetría con el guard TUI)

**File:** `src/server.js:206-207`, `src/server.js:277-278`, `src/server.js:261-263`
**Issue:** El carril TUI de Phase 48 (`open.js` + handler `o`) valida explícitamente que
la URL sea `http:`/`https:` antes de lanzarla (allowlist OPEN-03). El carril HTML paralelo
—que renderiza el MISMO dato `task_url`/`t.url` como `<a href>` clickable— NO hace esa
validación. `escapeHtml` solo escapa `& < > " '`; una URL `javascript:alert(document.cookie)`
no contiene ninguno de esos caracteres, así que sobrevive intacta:
`<a class="ref" href="javascript:alert(1)" target="_blank">`. Click → ejecución de script
en el origen del dashboard. La fuente de `task_url` es `web_url`/`base_url` de la config
del provider (operador-controlado) más datos del work item de Plane — "mostly trusted"
según el propio comentario de open.js, pero exactamente la razón por la que el carril TUI
añadió el guard. La fase introdujo el guard en un carril y dejó el simétrico sin cubrir.
**Fix:** Aplicar la misma allowlist en el render del anchor (o, mejor, en un helper
compartido). Ejemplo mínimo en el cliente JS del dashboard:
```js
function safeHref(url) {
  try {
    const p = new URL(url);
    return (p.protocol === 'http:' || p.protocol === 'https:') ? url : null;
  } catch { return null; }
}
// en renderSession / renderPending / renderHistory:
var safe = safeHref(s.task_url);
var refLink = safe
  ? '<a class="ref" href="' + escapeHtml(safe) + '" target="_blank" rel="noopener noreferrer">' + escapeHtml(s.task_ref) + '</a>'
  : '<span class="ref">' + escapeHtml(s.task_ref) + '</span>';
```
(Nota colateral: los `target="_blank"` actuales tampoco llevan `rel="noopener noreferrer"`
— reverse-tabnabbing menor, conviene añadirlo en el mismo fix.)

### WR-02: `config.providers.plane` sin optional chaining puede lanzar TypeError en la factory que esta fase modificó

**File:** `src/providers/registry.js:32`
**Issue:** La factory de plane —que Phase 48 editó para añadir `webUrl: plane.web_url ??
plane.base_url`— accede a `config.providers.plane` SIN optional chaining (`const plane =
config.providers.plane`). El bloque github de al lado (línea 66) sí usa
`config.providers?.github` precisamente para no crashear con una config que carece de la
clave. Una config v2 hand-edited con `provider: 'plane'` pero sin `providers.plane`
(p.ej. operador que migró a github-only y dejó `provider` apuntando a plane) hace
`plane.base_url` → TypeError no capturado dentro de la factory. El `try/catch` de
`registerDefaults` (línea 49) lo traga, pero entonces la factory de plane nunca se
registra y `getProvider('plane')` lanza `Unknown provider: plane` — un error opaco lejos
de la causa. En la práctica `migrateConfig` y `DEFAULT_CONFIG` siempre producen
`providers.plane`, lo que baja la probabilidad, pero la factory que la fase tocó queda más
frágil que su gemela github.
**Fix:**
```js
const plane = config.providers?.plane;
if (!plane) return; // o lanzar un mensaje canónico claro
```
o, como mínimo, simetría con github: `const plane = config.providers?.plane ?? {};` y
dejar que el PlaneClient constructor emita el error canónico.

### WR-03: `migrateConfig` propaga `web_url: undefined` cuando el config v1 carece de `base_url`, degradando la URL de browse a `undefined/...`

**File:** `src/config.js:90-95`, encadenado con `src/providers/plane/normalize.js:78`
**Issue:** `migrateConfig` hace `web_url: planeOld.base_url`. Si un config v1 no tiene
`base_url` (campo no garantizado en el schema viejo), `web_url` queda `undefined`. Luego
la factory hace `plane.web_url ?? plane.base_url` → ambos `undefined` → `webUrl: undefined`.
En `normalizeWorkItem`, `browseHost = context.webUrl ?? context.baseUrl` → `undefined`, y
la URL resultante es la string literal `"undefined/k-lab/browse/KL-42"`. Eso se persiste
como `task_url` y se sirve como `href` (WR-01) y se pasa a `runOpen`, donde `new URL(
"undefined/...")` LANZA → BAD_PROTOCOL (el TUI lo absorbe, bien), pero el HTML pinta un
enlace roto navegable. El comentario de la fase asume que un config migrado tiene
`base_url`; no hay guard.
**Fix:** Validar `base_url` en la migración o no emitir `web_url` cuando es falsy:
```js
...(planeOld.base_url ? { web_url: planeOld.base_url } : {}),
```
y/o que `normalizeWorkItem` omita la url cuando `browseHost` es falsy (mismo patrón que
el guard `identifierUnresolved` ya existente en normalize.js:72-73).

### WR-04: `migrateConfigIfNeeded` escribe a disco con efectos colaterales no guardados ante fallo parcial de I/O

**File:** `src/config.js:115-122`
**Issue:** `migrateConfigIfNeeded` escribe `CONFIG_PATH + '.bak'` y luego `CONFIG_PATH` sin
try/catch. Si la primera escritura (`.bak`) tiene éxito pero la segunda falla (disco lleno,
permisos, EINTR), el config en disco queda en estado intermedio inconsistente y la
excepción se propaga hasta `loadConfig` → su `catch` (línea 131) la traga y devuelve
`DEFAULT_CONFIG`, ocultando que la migración corrompió/no completó la escritura. El operador
pierde silenciosamente su config real y arranca con defaults. Esta ruta no es nueva de
Phase 48 pero la fase la activa más (todo config v1 con `web_url` ahora pasa por aquí).
**Fix:** Envolver la migración en su propio try/catch que, ante fallo de escritura, deje el
config original intacto y emita un warning explícito en vez de caer al fallback silencioso
de `DEFAULT_CONFIG`. Como mínimo, escribir a un archivo temporal y `rename` atómico.

## Info

### IN-01: `console.log` de migración rompe la salida JSON/TUI en consumidores no interactivos

**File:** `src/config.js:120`
**Issue:** `console.log('[kodo] Config migrada...')` se dispara dentro de `loadConfig`, que
es llamado por TODOS los consumidores incluido el dashboard TUI (index.js lo lazy-importa)
y cualquier comando que emita JSON. Un `console.log` a stdout en el primer arranque tras
migrar puede contaminar la salida de un comando que pipea JSON, o ensuciar el frame ink
(aunque index.js entra al alt-screen después). Es informativo pero el canal debería ser
stderr.
**Fix:** `console.error` (o el logger estructurado) en lugar de `console.log`.

### IN-02: Asimetría de estilo entre el success-check de `o` y el de Enter (mantenibilidad)

**File:** `src/cli/dashboard/App.js:576` vs `src/cli/dashboard/App.js:627`
**Issue:** El handler de Enter usa `if (result && !result.ok)` para detectar fallo; el
handler `o` usa la forma inversa `if (!result || result.ok !== false)` para detectar
éxito. Ambos son correctos dado el contrato never-throws, pero la divergencia léxica entre
dos handlers gemelos invita a error en mantenimiento futuro (un lector asume que copian el
mismo patrón). No es un bug — `{ok:true}`, `undefined` (DI degradado) y cualquier shape
no-`{ok:false}` caen a éxito como se pretende.
**Fix:** Alinear ambos al mismo idiom, p.ej. `o`: `if (!result || result.ok)` para éxito
(equivalente bajo el union, más legible y simétrico con el `!result.ok` de Enter).

### IN-03: `resolveWorkItemLabels` confía en el `.name` del primer elemento para discriminar formato

**File:** `src/providers/plane/normalize.js:45-47`
**Issue:** El discriminador "array de objetos vs array de UUIDs" se decide SOLO con
`labelIds[0]`. Un array heterogéneo (`[{name:'x'}, 'uuid-string']`) o un primer objeto sin
`.name` pero con elementos siguientes que sí lo tienen produce un mapeo incorrecto o
`undefined` en el resultado. No es ruta de Phase 48 (label resolution preexistente) y los
datos de Plane son homogéneos en la práctica, pero es una suposición frágil.
**Fix:** Iterar discriminando por elemento, o documentar explícitamente el invariante de
homogeneidad de la respuesta de Plane.

### IN-04: Comentarios de cabecera desproporcionadamente extensos (densidad de mantenimiento)

**File:** `src/cli/dashboard/App.js:1-166`, `src/cli/dashboard/open.js:1-47`
**Issue:** Los bloques de comentario de cabecera (decisiones D-NN, pitfalls, copy literal)
son extensos hasta el punto de que el riesgo de drift comentario↔código es alto: varios
comentarios referencian fases/decisiones que un lector no puede verificar sin abrir
documentos externos. No es un defecto funcional, pero la densidad dificulta la revisión y
envejece mal. Observación de calidad, no acción obligatoria.
**Fix:** Considerar mover la justificación de decisiones (D-NN) a los docs de fase y dejar
en el código solo el "qué/por qué" mínimo necesario para mantenerlo.

---

_Reviewed: 2026-06-12T05:45:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
