# Phase 87: Aislamiento de color transitivo en el TUI - Mapa de patrones

**Mapeado:** 2026-08-05
**Ficheros analizados:** 11 (1 creado · 10 modificados)
**Análogos encontrados:** 11 / 11
**Precedencia:** donde CONTEXT.md y RESEARCH.md discrepan, **manda RESEARCH.md** (8 call sites, no 5; el guard estático ve **3** ficheros rojos, no 4).

---

## Clasificación de ficheros

| Fichero nuevo/modificado | Rol | Flujo de datos | Análogo más cercano | Calidad del match |
|---|---|---|---|---|
| `src/cli/sanitize.js` **(CREAR)** | utility / módulo-contrato hoja | transform (puro, sin I/O) | `src/session/handoff.js` + `src/tasks/pending.js` | **exacto** (tercero de la serie) |
| `test/format-isolation.test.js` (guard transitivo ISO-01) | test / guard estático | batch (lectura del árbol) | `test/check-isolation.test.js:101-114` + `:176-190` | **exacto** (generalizado de 1 a N entries) |
| `test/format-isolation.test.js` (source-grep dinámico ISO-01/04) | test / guard estático | batch | `test/check-isolation.test.js:192-228` (WR-03) | **exacto** |
| `test/format-isolation.test.js` (`stripComments`) | test / helper | transform | `test/check-isolation.test.js:23-29` | **ANTI-ANÁLOGO** — se copia la forma, NO el orden |
| `test/format-isolation.test.js` (guard de hoja ISO-03) | test / guard estático | batch | `test/check-isolation.test.js:241-258` (`handoff.js`) y `:269-285` (`pending.js`) | exacto + 1 divergencia medida (allowlist) |
| `test/format-isolation.test.js` (convergencia D-14) | test / guard estático | batch | `test/check-isolation.test.js:292-300` (ORCH-05) | **exacto** |
| `test/format-isolation.test.js` (cabecera honesta ISO-04) | test / documentación | — | `test/check-isolation.test.js:10-17` (Phase 85, ya retirado ahí) | **exacto** |
| `src/cli/dashboard/App.js:73` · `markdown.js:27` · `src/hooks/stop.js:16` · `src/inbox/store.js:46` · `src/session/manager.js:12` | call site (sustitución de path pura) | — | entre ellos mismos | trivial |
| `src/cli/inbox.js:36` · `src/cli/capture.js:38` | call site (**partir el import en dos**) | — | ninguno en el repo — forma nueva | ver §Sin análogo |
| `test/dashboard-format.test.js:27` | test / import | — | igual que los anteriores | trivial |
| `test/manager.test.js:835` y `:867` | test / guard source-grep | batch | `test/manager.test.js:828-869` (el propio bloque, se toca solo el ancla de path) | **exacto** |

---

## Asignaciones de patrón

### `src/cli/sanitize.js` (CREAR — utility, módulo-contrato hoja)

**Análogos:** `src/session/handoff.js:1-27` (Phase 74) y `src/tasks/pending.js:1-21` (Phase 76). Son los **dos precedentes exactos** del repo: módulos de cero imports creados para que un leaf pueda importar lógica compartida sin arrastrar grafo. `sanitize.js` es el tercero.

**Patrón de cabecera a copiar** (`src/session/handoff.js:1-16`):

```js
// @ts-check
//
// src/session/handoff.js — Phase 74 Plan 01. El módulo ÚNICO dueño del contrato de
// formato del handoff (D-13): writer y parser viven JUNTOS porque ...
//
// ── CERO IMPORTS (restricción estructural, NO negociable) ─────────────────────────
// Ni `node:fs`, ni `node:path`, ni `node:os`, ni `../config.js`, ni `./state.js`.
// Todo lo que necesite llega por parámetro. Mismo contrato que `src/logger-noop.js`.
// Razón dura: la Phase 75 importará este parser desde `src/cli/dashboard/plan.js`,
// que es un LEAF deliberado; un import de `config.js` ... arrastraría su grafo entero
// hasta el dashboard y rompería LOG-12.
// ... Guardián runtime: `test/check-isolation.test.js` asserta cero imports.
```

Idéntica estructura en `src/tasks/pending.js:10-16`, que además **nombra a `handoff.js` como su molde** («Mismo contrato que `src/session/handoff.js` y `src/logger-noop.js`»). La cabecera nueva debe hacer lo mismo y nombrar a los dos.

**Elementos obligatorios de la cabecera** (los tres análogos los tienen todos):
1. `// @ts-check` en la línea 1.
2. Path + fase + plan + requisito (`— Phase 87 Plan 0X (ISO-02)`).
3. Bloque `── CERO IMPORTS (restricción estructural, NO negociable) ───` con la **razón dura** (qué arista reabre si deja de ser hoja), no solo la regla.
4. Nombrar el guardián: `Aseverado por test/format-isolation.test.js`.
5. Bloque adicional propio de esta fase: `── PROHIBIDO el shim de re-export (D-02) ───` (texto en `87-RESEARCH.md` §Code 6).

**Cuerpo — copiar VERBATIM `src/cli/format.js:60-123`.** Bloque contiguo de 64 líneas: JSDoc + cuerpo de `stripControlChars` (`:60-87`), línea en blanco (`:88`), JSDoc + cuerpo de `stripForKeystroke` (`:89-123`). **No se reescribe una sola regex** (D-17 / Pitfall 7). Los límites verificados:

```js
 :57-58   fin de visibleWidth()        ← NO se mueve (D-03)
 :60-87   stripControlChars (JSDoc + cuerpo)
 :89-123  stripForKeystroke (JSDoc + cuerpo, llama a la anterior)
 :125-…   JSDoc de padCell()           ← NO se mueve
```

Criterio de verificación: `diff <(sed -n '60,123p' format.js@HEAD) <(sed -n '<rango>p' src/cli/sanitize.js)` → vacío.

**Lo que NO se copia de los análogos:** `handoff.js:18-22` prohíbe toda construcción de regex (anti-ReDoS del parser de markdown). `sanitize.js` **es** regex por definición; esa restricción no aplica y copiarla sería falsa.

---

### `test/format-isolation.test.js` — guard transitivo ISO-01 (test, batch)

**Análogo:** `test/check-isolation.test.js:176-190` (guard de prohibición sobre la salida de `walkImports`) generalizado de 1 entry a N.

**Helpers que NO se tocan** (ya viven en el fichero objetivo, D-05 / §Don't Hand-Roll):

`test/format-isolation.test.js:40-52` — `walkImports`, se reutiliza tal cual, **leyendo el fuente crudo** (nada de `stripComments` dentro, Pitfall 4):

```js
function walkImports(entry, visited = new Set()) {
  if (visited.has(entry)) return visited;
  if (!existsSync(entry)) return visited; // imports a archivos inexistentes no crashean el walker
  visited.add(entry);
  const src = readFileSync(entry, 'utf-8');
  for (const spec of extractImports(src)) {
    if (!spec.startsWith('.')) continue;
    const resolved = resolve(dirname(entry), spec);
    walkImports(resolved, visited);
  }
  return visited;
}
```

También se reutilizan `extractImports` (`:23-28`) y `listJsFiles` (`:59-71`). El único código genuinamente nuevo son las ~14 líneas de BFS de `findChainToPicocolors` (código completo, ya ejecutado, en `87-RESEARCH.md` §Code 2).

**Patrón de assert de prohibición** (`test/check-isolation.test.js:221-227` — el idioma del repo: `assert.deepEqual(violations, [], msg)` para que el mensaje **liste los violadores**):

```js
    assert.deepEqual(
      violations,
      [],
      `un fichero del grafo de check.js carga un logger prohibido por import() dinámico ` +
        `(LOG-12 se rompería con los guards estáticos en verde) vía:\n  ${violations.join('\n  ')}\n` +
        `Full graph from check.js:\n  ${[...graph].map((p) => relative(REPO, p)).join('\n  ')}`,
    );
```

**Divergencia obligatoria (D-07):** el mensaje imprime la **cadena** (BFS más corta), no el grafo. El molde del propio fichero objetivo (`:214-219`, TUI-04) imprime el conjunto — para `App.js` serían 24 líneas de ruido (Pitfall 5). Guard completo escrito y validado en `87-RESEARCH.md` §Code 3.

**El test directo actual NO se toca** (`test/format-isolation.test.js:200-221`, TUI-04). D-08: el endurecido es **aditivo**.

---

### `test/format-isolation.test.js` — source-grep de `import()` dinámico (ISO-01/ISO-04)

**Análogo literal:** `test/check-isolation.test.js:192-228` (Phase 85 D-09 / WR-03). Se copia **el patrón completo, incluida su justificación escrita**, que es lo que hace el precedente LOCKED:

**Comentario de justificación** (`check-isolation.test.js:198-207`, adaptar `logger`→`picocolors`):

```js
  // Por qué es un grep aparte y no una mejora del walker: seguir aristas dinámicas dentro
  // de `walkImports` mete `github/provider.js` y `github/normalize.js` en la clausura
  // ... y pone ROJOS dos guards vecinos — y la reacción natural a un rojo espurio es
  // debilitarlos. El refuerzo se acota a un source-grep sobre la MISMA lista de ficheros
  // que el walker ya devuelve, sin tocarlo.
  //
  // `stripComments` es obligatorio y va ANTES del match: ...
  // El assert está anclado al PATRÓN DE IMPORT, nunca al identificador suelto: prosa que
  // mencione logger.js no puede poner roja la suite.
```

**Cuerpo** (`check-isolation.test.js:208-220`):

```js
  it('ningún fichero del grafo de check.js hace import() DINÁMICO de un logger prohibido (WR-03)', () => {
    const graph = walkImports(join(SRC, 'check.js'));
    const violations = [];
    for (const file of graph) {
      const stripped = stripComments(readFileSync(file, 'utf-8'));
      for (const m of stripped.matchAll(DYNAMIC_LOGGER_IMPORT_RE)) {
        const specifier = m[1];
        if (LOGGER_ALLOWLIST_RE.test(specifier)) continue;
        violations.push(`${relative(REPO, file)} → import('${specifier}')`);
      }
    }
```

**Adaptaciones medidas:**
- Entrada: de `walkImports(check.js)` a la **unión de las 16 clausuras** del dashboard (32 ficheros).
- Regex constante (molde `check-isolation.test.js:33`): `const DYNAMIC_PICOCOLORS_RE = /\bimport\s*\(\s*['"]([^'"]*picocolors[^'"]*)['"]\s*\)/g;` — anclada al **patrón de import**, nunca al identificador suelto (Pitfall 6: `dashboard/format.js:17`, `markdown.js:13` e `inbox-count.js:21` mencionan `picocolors` en prosa).
- **Sin allowlist** — no hay equivalente legítimo de `logger-noop.js` aquí (D-16: la única allowlist admitida es la de D-13).

---

### `test/format-isolation.test.js` — `stripComments` (**ANTI-ANÁLOGO**)

**El molde tiene un bug medido. Se copia la FORMA, no el ORDEN.**

**Lo que NO se copia** (`test/check-isolation.test.js:21-29`, y su origen `test/dispatcher-isolation.test.js:24-30`):

```js
// stripComments verbatim de test/dispatcher-isolation.test.js:24-30 — filtra
// comentarios para asserts source-hygiene sobre código (no documentación).
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')      // ← BUG: bloques ANTES de las líneas `//`
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}
```

Un comentario **de línea** que contenga `/*` (p. ej. la glob `src/cli/dashboard/**` de `markdown.js:14`) abre un bloque falso que se traga el fichero. Medido: 3 ficheros de `src/` pierden el **100%** de sus imports; uno de ellos es `markdown.js`, leaker primario de esta fase. Con un `await import('picocolors')` inyectado ahí, el verbatim da **0 hits (guard CIEGO)** y el corregido **1 (ROJO)**.

**Lo que sí se copia:** el orden corregido de `87-RESEARCH.md` §Code 1 (líneas `//` → bloques `/* */` → líneas `*`), **con el bloque de comentario de la medición encima** (Pitfall 3). Sin ese comentario, un lector futuro «arregla» la divergencia devolviendo el bug.

**Duplicar, no extraer** (recomendación de RESEARCH §OQ-1): `check-isolation.test.js` y `dispatcher-isolation.test.js` conservan su versión con bug — su corrección está **diferida con trigger escrito**. Un helper compartido obligaría a tocar los tres ficheros, que es justo lo que el diferido evita.

---

### `test/format-isolation.test.js` — guard de hoja ISO-03 (D-13)

**Análogo doble y literal:** `test/check-isolation.test.js:241-258` (`handoff.js`) y `:269-285` (`pending.js`). Los dos comparten estructura exacta:

```js
// Phase 74 D-13: `src/session/handoff.js` es el módulo único dueño del contrato de
// handoff ... y debe seguir siendo una HOJA de cero imports —
// el mismo contrato que `logger-noop.js` de arriba.
//
// Por qué existe este guard y no basta con la disciplina: la tentación natural es meter
// el I/O del plan DENTRO de handoff.js «porque es su fichero». Eso lo degradaría de hoja
// a nodo con fs y arrastraría `config.js` ... sin que ningún test lo dijera.
describe('D-13: handoff contract isolation (import-graph)', () => {
  it('src/session/handoff.js exists and has zero imports', () => {
    const handoffPath = join(SRC, 'session', 'handoff.js');
    assert.equal(
      existsSync(handoffPath),
      true,
      'src/session/handoff.js must exist after Plan 74-01 — otherwise this isolation test passes trivially',
    );
    const src = readFileSync(handoffPath, 'utf-8');
    const imports = extractImports(src);
    assert.deepEqual(
      imports,
      [],
      `handoff.js must have zero imports (including node: builtins) so Phase 75 can import its ` +
        `parser from the dashboard leaf without pulling in the graph (D-13), found: ${imports.join(', ')}`,
    );
  });
});
```

**Estructura de 4 partes a replicar:** (1) comentario con la **razón dura** de por qué existe el guard y qué degradación previene · (2) `assert.equal(existsSync(p), true, '… otherwise this isolation test passes trivially')` — el anti-vacuidad · (3) `assert.deepEqual(imports, [], msg)` con `found: …` en el mensaje · (4) el mensaje nombra al **consumidor** que la pureza protege.

**Divergencia única y medida (D-13):** los dos moldes exigen cero imports **incluidos builtins**; `dashboard/format.js:25` importa `basename` de `node:path`, así que aquí hay una allowlist de **un** elemento. Se escribe con su medición (la clausura sigue siendo 1). **Tercer assert añadido** — `walkImports(p).size === 1` — que es el que muerde de verdad: los dos primeros son de forma, ese es de alcanzabilidad. Código completo en `87-RESEARCH.md` §Code 4.

**Este guard aplica a DOS ficheros:** `src/cli/dashboard/format.js` (ISO-03) y el nuevo `src/cli/sanitize.js` (cuya pureza también hay que congelar — sin allowlist, cero imports a secas, como los moldes).

---

### `test/format-isolation.test.js` — aserto positivo de convergencia (D-14)

**Análogo literal:** `test/check-isolation.test.js:287-300` (ORCH-05):

```js
  // Phase 76 Plan 02 (ORCH-05 / D-09): CONVERGENCE — positive assertion that check.js
  // actually consumes the shared module. The prohibition guards above ... prove pending.js
  // drags nothing in (it's a zero-import leaf); this one proves check.js truly routes its
  // pending read through it, so the convergence is observable and cannot silently regress
  // to an inline provider.listPendingTasks() call.
  it('kodo check reaches src/tasks/pending.js in its import graph (convergence, ORCH-05)', () => {
    const graph = walkImports(join(SRC, 'check.js'));
    const pendingPath = join(SRC, 'tasks', 'pending.js');
    assert.ok(
      graph.has(pendingPath),
      `check.js must transitively import src/tasks/pending.js (converged pending read lane, ORCH-05).\n` +
        `Graph from check.js:\n  ${[...graph].map((p) => relative(REPO, p)).join('\n  ')}`,
    );
  });
```

**Sustitución:** `check.js` → `src/cli/dashboard/select.js`, `pending.js` → `src/cli/dashboard/format.js`. El comentario mantiene la estructura «los guards de prohibición de arriba prueban X; este prueba Y, y por eso la convergencia no puede regresar en silencio».

---

### `test/format-isolation.test.js:10-16` y `:31-34` — cabecera honesta (ISO-04)

**Análogo:** `test/check-isolation.test.js:10-17` — el **mismo comentario ya corregido** en la Phase 85, en el fichero hermano:

```js
// Estas dos regex cubren SOLO imports estáticos, a propósito. El repo SÍ usa `import()`
// dinámico — `src/providers/registry.js:27,28,57,58` y `src/session/state.js:247` — así que
// el walker de abajo tiene un punto ciego deliberado; lo cubre el guard de source-grep del
// final de este fichero (Phase 85 / DEBT-07 WR-03).
```

Y su reflejo en el JSDoc del walker (`check-isolation.test.js:51-59`), que además **cita el dato tranquilizador con su verificación**.

**Lo que se retira** (`format-isolation.test.js:14` y `:33`, los dos comentarios que dan nombre a OQ-1):

```js
:14  // No cubre `import()` dinámico — el repo no lo usa (verificado en 06-RESEARCH A3).
:33  * No sigue dynamic import() (el repo no los usa — verificado por grep en 06-RESEARCH A3).
```

**Texto de sustitución:** `87-RESEARCH.md` §Code 5, con los números **corregidos por RESEARCH**: 128 `import()` literales en **26** ficheros (no 30) y **0** con specifier computado, escrito como **medición fechada** (2026-08-05), nunca como garantía. La estructura de 3 bloques (CUBRE / NO CUBRE — punto ciego residual nombrado / MEDICIÓN FECHADA, NO GARANTÍA) sigue el registro de la Phase 86 D-17/D-18.

---

### Los 8 call sites (sustitución de import)

**Sin análogo de patrón — es un edit mecánico.** Las 8 líneas verificadas hoy:

```
src/cli/dashboard/App.js:73     import { stripControlChars } from '../format.js';
src/cli/dashboard/markdown.js:27 import { stripControlChars } from '../format.js';
src/hooks/stop.js:16            import { stripForKeystroke } from '../cli/format.js';
src/inbox/store.js:46           import { stripForKeystroke } from '../cli/format.js';
src/session/manager.js:12       import { stripForKeystroke, stripControlChars } from '../cli/format.js';
test/dashboard-format.test.js:27 import { stripControlChars, stripForKeystroke } from '../src/cli/format.js';
src/cli/inbox.js:36             import { createFormatter, stripControlChars } from './format.js';   ← PARTIR
src/cli/capture.js:38           import { createFormatter, stripForKeystroke } from './format.js';   ← PARTIR
```

**Seis son sustitución de path pura.** Los **dos últimos** requieren **partir el import en dos** — `createFormatter` se queda en `./format.js`, el saneador pasa a `./sanitize.js`. Esa forma no tiene precedente en el repo; es la única del lote que no es buscar-y-reemplazar.

**Criterio de verificación del lote** (Pitfall 1):
`grep -rnE "^import .*(stripControlChars|stripForKeystroke)" src test | grep "cli/format"` → **0 hits**.

---

### `test/manager.test.js:835` y `:867` (test / guard source-grep)

**Análogo:** el propio bloque en el que viven (`test/manager.test.js:828-869`). El edit es **solo el ancla de path** dentro del regex; el resto del assert no se toca.

**Forma actual** (`:834-837`):

```js
    assert.ok(
      /import\s*\{[^}]*\bstripForKeystroke\b[^}]*\}\s*from\s*['"]\.\.\/cli\/format\.js['"]/.test(source),
      'manager.js debe importar stripForKeystroke desde ../cli/format.js (carril de keystroke, WR-02)',
    );
```

Idéntica en `:866-869` para `stripControlChars`. Cambia `\.\.\/cli\/format\.js` → `\.\.\/cli\/sanitize\.js`, y el mensaje en consonancia. También hay que actualizar el comentario de `:830-833` («carril canónico (cli/format.js)») y el de `:864-865`.

**Lo que NO cambia** (crítico para no leerse como relajación de DEBT-04): los asserts de interpolación (`:842-845`, `:871-873`) y los **negativos de regresión** (`:847-850`, `:856-859`) quedan intactos. El guard sigue exigiendo import canónico + saneo de los mismos tres campos; **solo cambia cuál es el carril canónico**. El planner debe escribir esa distinción en el commit (RESEARCH §A3).

**No se toca `test/inbox-cli.test.js:866`:** ancla al **identificador** (`/stripControlChars/`), no al path — sobrevive al movimiento. Verificado 75/0 sobre la simulación.

---

## Patrones compartidos

### 1. Assert de prohibición con lista de violadores
**Fuente:** `test/check-isolation.test.js:108-113` · `:221-227` · `test/format-isolation.test.js:214-219`
**Aplica a:** todos los guards nuevos de ISO-01 e ISO-03.

`assert.deepEqual(violadores, [], msg)` — nunca `assert.equal(x.length, 0)`. Razón: el mensaje de `deepEqual` sobre un array **lista los violadores**, que es lo que hace el guard accionable.

### 2. Anti-vacuidad (`existsSync` antes del assert)
**Fuente:** `test/check-isolation.test.js:244-248` · `:272-276` · `test/format-isolation.test.js:74-79`
**Aplica a:** los guards de hoja de `sanitize.js` y `dashboard/format.js`.

```js
    assert.equal(
      existsSync(path),
      true,
      '… must exist after Plan XX-YY — otherwise this isolation test passes trivially',
    );
```

Un guard sobre un fichero inexistente pasa trivialmente. El molde lo dice literalmente en el mensaje.

### 3. Regex constantes, nunca compiladas desde input
**Fuente:** `test/check-isolation.test.js:31-34`
**Aplica a:** `DYNAMIC_PICOCOLORS_RE`.

```js
// Regex CONSTANTES (anti-ReDoS: jamás compiladas desde input). Clases `[^'"]*` que no
// retroceden sobre sí mismas; operan solo sobre fuentes del propio repo.
```

### 4. Anclaje al PATRÓN DE IMPORT, nunca al identificador suelto
**Fuente:** `test/check-isolation.test.js:206-207` · `test/manager.test.js:835`
**Aplica a:** los dos guards nuevos de `picocolors` y a los 2 asserts de `manager.test.js`.

Lección `83-05` (`STATE.md:101`). Crítico aquí: hay prosa con la palabra `picocolors` en `dashboard/format.js:17`, `markdown.js:13` e `inbox-count.js:21`.

### 5. El comentario lleva la MEDICIÓN, no la preferencia
**Fuente:** `src/tasks/pending.js:10-21` · `test/check-isolation.test.js:192-207` · `:235-240`
**Aplica a:** `stripComments` corregido, la allowlist de D-13, la cabecera honesta de ISO-04.

Todos los comentarios de guard del repo dicen **qué degradación previenen y por qué la disciplina no basta**, con números verificados. Una divergencia respecto a un molde se documenta con su medición citada — nunca como estilo.

### 6. Cabecera de módulo-hoja
**Fuente:** `src/session/handoff.js:1-16` · `src/tasks/pending.js:1-16`
**Aplica a:** `src/cli/sanitize.js`.

Ver §`src/cli/sanitize.js` — los 5 elementos obligatorios.

---

## Sin análogo

| Fichero / elemento | Rol | Flujo | Razón |
|---|---|---|---|
| `findChainToPicocolors` (BFS con mapa de padres) | test / helper | transform | **Ningún guard del repo reconstruye el camino** — todos imprimen el `Set` del walker. Son ~14 líneas nuevas; el código ya está escrito y ejecutado en `87-RESEARCH.md` §Code 2. Es lo único genuinamente nuevo de la fase. |
| Import partido en dos (`src/cli/inbox.js:36`, `src/cli/capture.js:38`) | call site | — | Ningún precedente: los 6 restantes son sustitución de path. `createFormatter` se queda; el saneador migra. |
| Guard transitivo **por N entries** | test / guard | batch | Los 4 guards de `check-isolation.test.js` tienen **un** entry (`check.js`). Aquí son 16. La generalización es un `for` sobre `listJsFiles(SRC).filter(f => f.includes('/cli/dashboard/'))` — el filtro ya existe en `format-isolation.test.js:210`. |

---

## Notas de disciplina para el planner

1. **8 call sites, no 5** (Pitfall 1). CONTEXT §D-01 dice 5; RESEARCH §Hallazgo 2 lo corrige y manda. Los 3 omitidos (`capture.js`, `stop.js`, `store.js`) fallan en **tiempo de carga** sin shim.
2. **El guard estático ve 3 ficheros rojos, no 4** (Pitfall 8). `index.js` solo aparece siguiendo aristas dinámicas, que D-06 excluye del walker a propósito; queda cubierto por la iteración por-entry de D-05.
3. **`stripComments` NO va dentro de `walkImports`** (Pitfall 4). Medido: es un no-op hoy con el corregido, y una catástrofe con el verbatim (clausura de `markdown.js` 3 → 1).
4. **Tres comentarios en zona gris** (`src/cli/dashboard/inbox-count.js:9-14`, `test/dashboard-inbox-count.test.js:7-8`) quedan **falsos** tras ISO-01/ISO-02. RESEARCH §Runtime State Inventory: o se corrigen en la fase, o van a `deferred-items.md` **con trigger escrito**. Dejarlos sin más reabre el pecado que esta fase corrige.

---

## Metadata

**Ámbito de búsqueda de análogos:** `src/session/`, `src/tasks/`, `src/cli/`, `src/cli/dashboard/`, `src/hooks/`, `src/inbox/`, `test/*isolation*.test.js`, `test/manager.test.js`
**Ficheros leídos para extracción:** 8
**Fecha de extracción:** 2026-08-05
