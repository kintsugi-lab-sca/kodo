---
phase: 83-inbox-foundation-captura-triage
reviewed: 2026-07-25T11:25:05Z
depth: standard
files_reviewed: 10
files_reviewed_list:
  - src/inbox/store.js
  - src/cli/capture.js
  - src/cli/inbox.js
  - src/cli.js
  - test/inbox-store.test.js
  - test/inbox-format-golden.test.js
  - test/inbox-cli.test.js
  - test/inbox-concurrency.test.js
  - test/helpers/lock-race-child.mjs
  - .claude/skills/kodo-orchestrate/skill.md
findings:
  critical: 3
  warning: 8
  info: 4
  total: 15
status: issues_found
---

# Phase 83: Code Review Report

**Reviewed:** 2026-07-25T11:25:05Z
**Depth:** standard
**Files Reviewed:** 10
**Status:** issues_found

## Summary

Los invariantes duros declarados de la fase se cumplen: `src/inbox/store.js` no importa
`src/config.js` (ni transitivamente — `dashboard/select.js` no tiene imports), no usa
`writeFileAtomic`, publica con tmp único `<path>.tmp.<pid>.<uuid>` + `renameSync`, appendea con
`appendFileSync` (`O_APPEND`), usa `withFileLock` (nunca `src/gsd/lock.js`), ninguno de los tres
módulos importa `node:child_process`, no hay dependencias npm nuevas (4 de producción) y el color
solo entra por `createFormatter`. 145 tests unit/CLI pasan.

Lo que NO se sostiene es el nivel por debajo de esos invariantes. Los dos puntos que los ejecutores
se auto-reportaron son **ambos incorrectos y se han reproducido**:

1. El carril `--json` NO es seguro por construcción: `JSON.stringify` escapa C0 pero **no** C1 ni
   DEL, y ambos salen verbatim (verificado con `od -c`).
2. `CAPTURE_LOCK_RETRIES = 50` **es un artefacto de calibración del test**. La ventana de marcado
   real medida sobre un inbox de 50 000 capturas (5,8 MB) es de **20 ms**; el hold de 300 ms del
   test es 15× esa cota. Con un hold de 1500 ms —apenas por encima del nuevo presupuesto— **las 6
   capturas concurrentes se destruyen silenciosamente, 6 de 6, con exit 0 en los 7 procesos**. El
   lost-update de D-01 no se cerró: se movió el umbral de 160 ms a 1000 ms. Peor: con el
   presupuesto nuevo, el escenario D-21.2 ya **nunca** entra por la rama fail-open (medido:
   `coordinated` en 18/18 hijos, 3 iteraciones), así que el test de regresión dejó de cubrir
   exactamente el camino que perdía datos.

Además hay dos defectos de producto verificados en ejecución real que ningún test podía atrapar
porque todos los fixtures son sintéticos: `kodo inbox --json` se **trunca a 64 KB** al canalizarse
(JSON inválido), y el `tag` derivado del cwd resulta ser un **UUID de 36 caracteres** en la
configuración real del operador.

## Critical Issues

### CR-01: `kodo inbox --json` emite JSON truncado (inválido) al canalizarse — el carril máquina se rompe a partir de 64 KB

**File:** `src/cli.js:637` (también `:616`, `:654`, `:668`)
**Issue:** Los cuatro handlers nuevos hacen `process.exit(runXxxCli(...))` inmediatamente después
de que el handler haya escrito en `process.stdout`. En macOS (plataforma del proyecto) las
escrituras de `process.stdout` a un **pipe son asíncronas**; `process.exit()` aborta el proceso sin
drenar el buffer. Reproducido con un inbox de 4000 capturas (355 KB):

```
run 1..5  piped bytes = 65536   (siempre exactamente el buffer de pipe)
to-file   bytes       = 514930  (redirección a fichero: correcto)
JSON.parse -> "Expected ':' after property name in JSON at position 65536"
```

El carril `--json` está anunciado como «scriptable, byte-determinista» (`src/cli/inbox.js:8`,
`src/cli.js:640`) y `.claude/skills/kodo-orchestrate/skill.md` instruye explícitamente al
orquestador a usar `kodo inbox --json` «si lo vas a procesar como datos». Un consumidor que haga
`kodo inbox --all --json | jq` recibirá JSON inválido, o —peor— un `jq` tolerante podría no fallar
de forma obvia. Y como CAPT-03 prohíbe borrar nada, el fichero crece monótonamente: cruzar 64 KB no
es un caso límite, es una certeza a plazo (≈500-600 capturas con `--all`). El render human sufre lo
mismo al canalizarlo a `less`/`head`.

Los tests no lo detectan porque `spawnSync` con fixtures de 1-3 capturas nunca supera el buffer.

**Fix:** no llamar a `process.exit()` tras escribir en stdout; fijar el código y dejar que Node
drene el stream antes de terminar.

```js
.action(async (opts) => {
  try {
    const { runInboxListCli } = await import('./cli/inbox.js');
    process.exitCode = runInboxListCli({ all: opts.all || false, json: opts.json || false });
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exitCode = 1;
  }
});
```

Aplicar lo mismo a `capture`, `inbox route` y `inbox discard`. Añadir un test de integración con
un inbox sembrado de >64 KB que asserte `JSON.parse(stdout)` tras canalizar la salida.

---

### CR-02: la captura en fail-open sigue siendo destruida por el marcado concurrente — pérdida SILENCIOSA con exit 0

**File:** `src/inbox/store.js:484-490` (fail-open), `src/inbox/store.js:574-589` (RMW del marcado), `src/inbox/store.js:79-101` (la justificación del presupuesto)
**Issue:** El comentario de `CAPTURE_LOCK_RETRIES` afirma que el lost-update «se cerró subiendo el
presupuesto» y que ahora «hace falta un titular patológico (>1 s sosteniendo el lock) para llegar
ahí». Eso describe un umbral temporal, no un invariante: la rama fail-open appendea **fuera del
lock** y el `renameSync` del marcado publica un buffer leído ANTES de ese append, así que la pérdida
sigue siendo estructuralmente posible. Reproducido con el propio harness del repo
(`test/helpers/lock-race-child.mjs`), 1 `mark --hold 1500` + 6 `capture`:

```
verdicts: written written written written written written written
--- inbox final ---
- [x] seed01 · captura semilla a marcar · kodo-race · 2026-01-15 · cli · enrutada → 999.4
--- supervivientes de las 6 capturas concurrentes: 0 ---
```

Siete procesos reportan éxito, `kodo capture` habría devuelto **exit 0**, y las 6 ideas
desaparecen sin dejar rastro. Esto viola literalmente CAPT-03 criterio 3 y el principio GTD que la
fase declara («una idea perdida es peor que una línea sin coordinar»); el warn del fail-open dice
«appendeada sin coordinación», no «tu captura puede ser destruida».

Que el disparador sea un hold >1 s no lo hace teórico: el TTL del lock es de 10 s
(`state-lock.js:36`), así que **cualquier** proceso vivo que tome el lock del inbox y se atasque
(swap, contención de disco, volumen de red, `SIGSTOP`, un `kodo` colgado) abre la ventana durante
segundos sin que el ladrón de locks pueda intervenir.

**Fix:** hacer el invariante independiente del reloj. Dentro del lock, justo antes de publicar,
verificar que el fichero no ha cambiado desde la lectura fresca; si cambió, rehacer el RMW (o
abortar sin publicar):

```js
// tras `raw = readFileSync(inboxPath, 'utf-8')`
const before = statSync(inboxPath);           // size + mtimeMs + ino
// ... localizar, sustituir, construir `out` ...
const now = statSync(inboxPath);
if (now.size !== before.size || now.mtimeMs !== before.mtimeMs || now.ino !== before.ino) {
  return { ok: false, reason: 'lock-timeout' }; // o reintentar el RMW, acotado
}
writeFileSync(tmp, out);
renameSync(tmp, inboxPath);
```

Corregir además el comentario de `CAPTURE_LOCK_RETRIES`: hoy afirma un cierre que no existe y
dejará al siguiente mantenedor creyendo que el riesgo está resuelto.

---

### CR-03: el `tag` del inbox es un UUID de 36 caracteres en la configuración real — la columna que da sentido al triage es ilegible

**File:** `src/inbox/store.js:214-227` (`deriveTag`), `src/cli/capture.js:110`
**Issue:** `deriveTag` devuelve `resolveProjectId(cwd, projects).projectId`, es decir la **clave**
de `~/.kodo/projects.json`. En la instalación real todas las claves son UUIDs del proveedor
(10 de 10 comprobadas), y el valor es solo la ruta. Ejecutando `kodo capture` desde este mismo repo
la línea escrita es:

```
- [ ] sspuoj · una idea · 7246e3fe-3dc4-4f24-9078-1911ad477e0d · 2026-07-25 · cli
```

Todo el material de la fase (golden `test/inbox-format-golden.test.js:31`, los 15 vectores, D-05,
la ayuda del CLI) muestra `kodo` / `ROMAN` como tag, y todos los tests inyectan fixtures sintéticos
del tipo `{ kodo: '/x/y/kodo' }`, así que ningún test toca el formato real de `projects.json`. El
resultado en producción: la columna de tag del listado ocupa 36 caracteres, deforma la tabla de
`formatTable` y no comunica nada al operador — que es exactamente la función del campo (D-15).
Irónicamente el *fallback* (`basename(cwd)`, usado solo cuando NO hay match) sí es legible.

**Fix:** proyectar el projectId a un nombre humano antes de usarlo como tag, con `basename(cwd)`
como fallback cuando el id no sea legible. Mínimo viable sin ampliar superficie:

```js
const r = resolveProjectId(cwd, projects ?? {});
if (r && typeof r === 'object' && typeof r.projectId === 'string') {
  // Un projectId con forma de UUID no es un tag humano: usar el basename de la ruta mapeada.
  const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(r.projectId);
  return isUuid ? fallback : r.projectId;
}
```

Y añadir un test con la forma REAL de `projects.json` (claves UUID → valor string de ruta), no solo
con claves inventadas legibles.

## Warnings

### WR-01: `markCapture` destruye la identidad del inodo — un `inbox.md` symlinkeado se rompe y los permisos se resetean a 0644

**File:** `src/inbox/store.js:586-589`
**Issue:** `writeFileSync(tmp)` + `renameSync(tmp, inboxPath)` publica un inodo NUEVO. Dos efectos
reproducidos:

1. **Symlink destruido con divergencia silenciosa.** Con `~/.kodo/inbox.md` → `dotfiles/inbox.md`
   (un montaje plausible: el fichero se anuncia como markdown human-editable), `kodo capture`
   escribe a través del symlink correctamente, pero el primer `route`/`discard` lo **sustituye por
   un fichero regular**. A partir de ahí el fichero destino del operador queda congelado y kodo
   escribe en otro sitio, sin aviso:
   ```
   after discard: SYMLINK DESTROYED -> now a regular file
   target real:  - [ ] sym001 ... (sin marcar)   ← congelado
   inbox.md:     - [x] sym001 ... · descartada   ← inodo nuevo
   ```
2. **Modo del fichero perdido.** `chmod 600 ~/.kodo/inbox.md` seguido de `kodo inbox discard <id>`
   devuelve el fichero a `rw-r--r--` (0644). En una máquina multiusuario eso reexpone el contenido.
   D-20 dice que el inbox no es un secreto, pero degradar en silencio una decisión explícita del
   operador es otra cosa.

**Fix:** resolver el destino real y preservar el modo antes de publicar:

```js
import { realpathSync } from 'node:fs';
let target = inboxPath;
try { target = realpathSync(inboxPath); } catch { /* no existe aún → el propio path */ }
let mode;
try { mode = statSync(target).mode & 0o777; } catch { /* fichero nuevo → default */ }
const tmp = target + '.tmp.' + process.pid + '.' + randomUUID();
writeFileSync(tmp, out, mode !== undefined ? { mode } : undefined);
renameSync(tmp, target);
```

---

### WR-02: el carril `--json` emite C1 (U+009B/U+009D) y DEL verbatim — la justificación auto-reportada es falsa

**File:** `src/cli/inbox.js:91-119` (comentario en `:93-95`)
**Issue:** El comentario afirma que el texto puede ir verbatim porque «`JSON.stringify` ya escapa
todo byte de control C0 a `\uXXXX`, dejándolo inerte». `JSON.stringify` escapa C0 (< 0x20) pero
**no** escapa `\x7f` (DEL) ni el rango C1 `\x80-\x9f`. Sembrando el fichero human-editable con
U+009B (CSI de un byte), U+009D (OSC de un byte) y DEL:

```
--json : ... "text":"idea 302 233 31m ROJO 302 233 0m 302 235 52;c;aGk= 177 fin" ...
human  : ... idea31m ROJO0m 52;c;aGk=  fin ...      (limpio)
```

Los bytes `302 233` son la codificación UTF-8 de U+009B; xterm en modo UTF-8 los interpreta como
C1 por defecto (`allowC1Printable` = false), y ese es precisamente el vector que
`stripControlChars` documenta haber cerrado para el carril human (WR-02 de Phase 78,
`format.js:84-86`). El modelo de amenaza de T-83-09 —«el fichero es human-editable POR DISEÑO, una
línea con OSC-52 pegada a mano se ejecutaría en el terminal del operador»— se aplica igual al
carril `--json`, que además es el que la skill del orquestador manda usar y cuya salida un LLM
reemite hacia el terminal. `test/inbox-cli.test.js:471` asserta el strip para el render human; no
existe la aserción equivalente para `--json`.

**Fix:** sanear el rango que `JSON.stringify` no cubre, sin tocar el resto (no rompe el
determinismo ni introduce ANSI):

```js
const j = (/** @type {string} */ s) => String(s).replace(/[\x7f-\x9f]/g, '');
const o = { id: c.id, text: j(c.text), tag: j(c.tag), date: c.date, origin: j(c.origin), open: c.open };
// ... y `dest: c.dest === null ? null : j(c.dest)` en la rama --all
```

Añadir el test espejo de `test/inbox-cli.test.js:446-475` sobre la rama `--json`.

---

### WR-03: la subida del presupuesto de reintentos apagó la cobertura del test de D-21.2 en lugar de arreglar el fallo

**File:** `src/inbox/store.js:103` + `test/inbox-concurrency.test.js:52,150-250`
**Issue:** Con `CAPTURE_LOCK_RETRIES = 50` (~1000 ms) y `WINDOW_MS = 300`, todas las capturas del
escenario 2 obtienen el lock. Instrumentando los hijos para que reporten la rama tomada:

```
iter 1: captures=[coordinated ×6] survivors=6
iter 2: captures=[coordinated ×6] survivors=6
iter 3: captures=[coordinated ×6] survivors=6
```

Cero entradas por la rama fail-open en 18 hijos. El test que existía para demostrar que «una
captura concurrente durante el marcado nunca se pierde» **ya no ejecuta el código que la perdía**;
verifica el camino coordinado, que nunca estuvo en duda. La cabecera del propio fichero admite
«(a) subir el presupuesto» como arreglo, pero el efecto medible es enmascaramiento: el caso rojo
volvió verde porque dejó de alcanzarse, no porque se corrigiera (ver CR-02, donde con hold=1500 ms
se pierden 6 de 6).

Además la constante está justificada con una cota inventada: la sección crítica REAL del marcado
sobre un inbox de 50 000 capturas (5,8 MB) mide **20,3 ms** (100 → 0,6 ms; 1000 → 1,0 ms;
10 000 → 4,9 ms). El default de 160 ms ya cubría 8× el peor caso realista; los 1000 ms solo existen
para superar el hold artificial de 300 ms del test.

**Fix:** tras aplicar CR-02, mantener el escenario con hold=300 ms **y añadir un tercer escenario
con hold por encima del presupuesto** (p. ej. 1500 ms) que asserte que ninguna captura se pierde —
ese es el caso que hoy falla. Reconsiderar entonces si `CAPTURE_LOCK_RETRIES` puede volver al
default, y reescribir el comentario de `:79-101` para que refleje la medición real en lugar de una
narrativa de cierre.

---

### WR-04: `encodeLine` produce líneas que su propio `parseLine` rechaza — captura permanentemente invisible

**File:** `src/inbox/store.js:298-320`
**Issue:** `encodeLine` es el contrato byte-exacto que Phase 84 consume, y no valida nada. Medido:

```
texto vacio        -> UNPARSEABLE  "- [ ] a3f9k2 ·  · kodo · 2026-07-25 · cli"
texto solo espacios-> UNPARSEABLE
id con mayusculas  -> UNPARSEABLE  "- [ ] A3F9K2 · x · kodo · 2026-07-25 · cli"
id con guion       -> UNPARSEABLE
fecha invalida     -> UNPARSEABLE  "- [ ] a3f9k2 · x · kodo · ayer · cli"
date undefined     -> UNPARSEABLE  "- [ ] a3f9k2 · x · kodo · undefined · cli"
```

Una línea así se escribe en disco, se excluye de `listCaptures`, no se puede marcar (`not-found`) y
se cuenta para siempre como «no parseable»: la captura está perdida en la práctica pero ocupa
sitio. El único guardián es el gate de texto vacío de `src/cli/capture.js:97`, un nivel por encima
y solo en ese call-path; `date` no pasa por ningún saneo y viene de un `clockFn` inyectable.
Phase 84 puede consumir `encodeLine` directamente (es lo que el golden promete) sin ese gate.

**Fix:** hacer que el codec garantice su propio contrato — mismo nivel que el golden:

```js
export function encodeLine(capture) {
  const text = sanitizeText(capture.text);
  if (text === '') throw new TypeError('encodeLine: texto vacío tras el saneo');
  if (!/^[0-9a-z]+$/.test(String(capture.id))) throw new TypeError('encodeLine: id inválido');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(capture.date))) throw new TypeError('encodeLine: fecha inválida');
  ...
}
```

Alternativa si se prefiere no lanzar: añadir al golden una aserción
`parseLine(encodeLine(c)) !== null` para toda entrada degradada y devolver `null` en ese caso, con
el caller mapeando a exit 2.

---

### WR-05: una captura cuyo texto empieza por `-` se rechaza con `unknown option` y la idea se pierde

**File:** `src/cli.js:601-620`
**Issue:** `.argument('<text>')` deja que commander interprete cualquier token inicial con guion
como opción:

```
$ kodo capture "-x revisar el flag"
error: unknown option '-x revisar el flag'      exit=1     (nada escrito)
$ kodo capture -- "--all revisar"
✓ Capturado benkfw                              exit=0
```

Para una herramienta cuyo contrato es «capturar sin pensar», un texto pegado desde una lista
markdown (`- revisar X`) o que empiece por `-1`/`--` falla con un error que no menciona el
problema real y **la idea se pierde**. El riesgo se agrava con CAPT-02: la skill de Phase 84
shellea a este mismo writer; si no interpone `--`, cualquier texto generado por el LLM que empiece
por guion aborta la captura.

**Fix:** documentarlo y blindar el contrato de Phase 84. Mínimo: añadir `--` en la ayuda del
comando y en el ejemplo de `.claude/skills/kodo-orchestrate/skill.md`, y hacer que la skill de
captura emita siempre `kodo capture -- "<texto>"`. Añadir un test de integración
`kodo capture -- "-1 en la métrica"` → exit 0. Si se quiere aceptar la forma sin `--`, capturar el
`CommanderError` de opción desconocida en el comando `capture` y tratar el token como texto.

---

### WR-06: CRLF y BOM en el fichero human-editable rompen el parser en silencio

**File:** `src/inbox/store.js:136-137` (`LINE_RE`), `src/inbox/store.js:375` (`split('\n')`)
**Issue:** El fichero se anuncia como human-editable, pero solo tolera LF y ausencia de BOM.
Medido:

```
- [ ] aaa111 · idea · kodo · 2026-07-25 · cli\r          -> origin: "cli\r"   (control en campo estructurado)
- [x] bbb222 · idea · kodo · 2026-07-25 · cli · descartada\r -> null          (cae de la traza)
\ufeff- [ ] ccc333 · idea · kodo · 2026-07-25 · cli      -> null
```

Un editor configurado con CRLF (o un fichero sincronizado desde Windows) hace que **todas las
capturas cerradas desaparezcan del listado** contadas como «no parseables», mientras las abiertas
cuelan un `\r` dentro del campo `origin`. Y `markCapture` sobre una línea CRLF la re-codifica con
`sanitizeField`, que elimina el `\r`: el fichero queda con terminadores mezclados.

**Fix:** normalizar en el borde de lectura sin tocar el disco:

```js
for (const line of raw.split('\n')) {
  const l = line.replace(/^\ufeff/, '').replace(/\r$/, '');
  ...
}
```

Aplicar la misma normalización en el bucle de localización de `markCapture` (manteniendo el array
`lines` original intacto para el round-trip byte a byte de D-04).

---

### WR-07: `markCapture` devuelve una captura que NO es la persistida — la confirmación del CLI miente

**File:** `src/inbox/store.js:573`, `src/cli/inbox.js:243`
**Issue:** `const updated = { ...found, open: false, estado, dest: dest ?? null }` guarda el `dest`
CRUDO, mientras `encodeLine(updated)` escribe `sanitizeDest(dest)` (recortado a `MAX_DEST_LEN`).
El CLI imprime la confirmación a partir del objeto devuelto, no de lo persistido:

```
$ kodo inbox route aaa111 --dest <250 chars>
CLI dice dest len = 250
fichero dest len  = 200
```

Lo mismo aplica a `descartada` (el objeto devuelto conserva un `dest` que `encodeLine` descarta) y
a un `text` de más de `MAX_TEXT_LEN` en una línea hand-editada larga (el objeto devuelve el texto
completo; el fichero, el recortado). El operador recibe confirmación de un trace pointer que no
está en el fichero.

**Fix:** devolver lo que realmente se escribió, re-parseando la línea publicada:

```js
const encoded = encodeLine(updated);
lines[idx] = encoded;
const persisted = parseLine(encoded) ?? updated;
// ... publicar ...
return { ok: true, capture: persisted };
```

---

### WR-08: el warn del fail-open esquiva el seam de DI del handler y escribe directo a `process.stderr`

**File:** `src/inbox/store.js:456`, `src/cli/capture.js:83,125`
**Issue:** `appendCapture` define `warn = warnFn || ((s) => process.stderr.write(s))`, y
`runCaptureCli` **nunca** inyecta `warnFn` — pasa solo `{ inboxPath, lockPath }`. Consecuencia: el
único mensaje que el operador ve en la rama fail-open (D-03) no pasa por el `errFn` inyectable del
handler, así que el carril unit no puede observarlo y la cabecera del store («Módulo de lógica: no
emite eventos NDJSON ni hace `process.exit`; el caller (CLI) decide») queda contradicha por el
propio módulo. Los tests que afirman «exactamente UN warn» (`test/inbox-store.test.js:389`) solo lo
comprueban inyectando `warnFn` a mano, cosa que producción no hace: nadie verifica el
comportamiento real del binario en esa rama.

**Fix:** propagar el seam desde el handler:

```js
result = appendFn(line, { inboxPath, lockPath, warnFn: err });
```

y añadir al test de integración un caso con el lock ocupado que asserte el warn en `stderr` con
exit 0.

## Info

### IN-01: seam de test `_afterReadFn` en la firma pública de producción

**File:** `src/inbox/store.js:530-533,577`
**Issue:** El plan declara «ensanchar la ventana … SIN código de test en producción», pero
`_afterReadFn` es exactamente eso: un hook de test en la firma exportada de `markCapture`,
ejecutado dentro de la sección crítica. Es una decisión defendible (la alternativa —mockear fs— es
peor), pero la prosa que la justifica se contradice a sí misma y confundirá a quien lea el módulo.
**Fix:** reformular el comentario («seam de test explícito, prefijado con `_`, no forma parte del
contrato público») en vez de afirmar que no hay código de test en producción.

### IN-02: la skill llama «append-only» a un fichero que el marcado reescribe entero

**File:** `.claude/skills/kodo-orchestrate/skill.md` (sección «Triage del inbox de capturas»)
**Issue:** «nada se degrada por quedarse ahí — el fichero es append-only y la traza es permanente».
`markCapture` hace un read-modify-write del fichero completo con `renameSync`; append-only describe
solo `kodo capture`. Un agente que asuma append-only puede inferir garantías de concurrencia que no
existen (justo el escenario de CR-02).
**Fix:** «el fichero solo crece: cerrar es una transición de estado, nunca un borrado».

### IN-03: la cadena de saneo está duplicada tres veces

**File:** `src/inbox/store.js:243-281`
**Issue:** `sanitizeText`, `sanitizeField` y `sanitizeDest` repiten
`stripForKeystroke(s).replace(/[\u2028\u2029]/g, ' ')`. Si el conjunto de caracteres a neutralizar
cambia (ver WR-02), hay que tocarlo en tres sitios y es fácil olvidar uno.
**Fix:** extraer `const base = (s) => stripForKeystroke(s).replace(/[\u2028\u2029]/g, ' ')` y
componer las tres variantes sobre él.

### IN-04: `--origin` es una opción pública sin validación, documentada como «USO INTERNO», con default duplicado

**File:** `src/cli.js:605-609`, `src/cli/capture.js:72,113-114`
**Issue:** El campo `origin` es la única señal de procedencia que Phase 84 va a consumir, y
cualquiera puede fijarlo (`kodo capture x --origin skill`). No hay frontera de privilegio detrás,
así que el impacto es nulo hoy, pero conviene no tratarlo como dato de confianza más adelante.
Además el default `'cli'` está declarado dos veces (commander y `DEFAULT_ORIGIN`), así que
`rawOrigin === ''` en `capture.js:114` es código muerto por el carril CLI.
**Fix:** restringir el vocabulario a `cli|skill` (`.choices(['cli','skill'])` o validación en el
handler) y dejar el default en un único sitio.

---

_Reviewed: 2026-07-25T11:25:05Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
