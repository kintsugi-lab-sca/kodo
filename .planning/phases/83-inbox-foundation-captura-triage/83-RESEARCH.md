# Phase 83: Inbox foundation — captura + triage - Research

**Researched:** 2026-07-25
**Domain:** Buffer de captura append-only sobre filesystem local (Node.js CLI, cero deps) — concurrencia `O_APPEND` + RMW bajo lock advisory, codec de línea human-editable
**Confidence:** HIGH

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Decisiones heredadas (LOCKED — no re-discutir)**
- **Cero deps npm nuevas** — `node:fs` + `node:crypto` built-in cubren todo (invariante cross-milestone).
- **Cero endpoints nuevos en `src/server.js`** desde v0.10 — el inbox es filesystem, no HTTP.
- **La primitiva de lock es `withFileLock` (`src/session/state-lock.js:215`), NUNCA `src/gsd/lock.js`** — así lo fija el `Depends on` del ROADMAP §Phase 83 y lo delimitó el boundary de Phase 82. `src/gsd/lock.js` coordina locks de fases GSD por repo; su carrera de 2º orden abierta (R-82-01) es ajena a esta fase.
- **Delete duro prohibido** — solo transiciones de estado. La traza permanente ES el valor del feature.

**Modelo de estado del marcado (CAPT-03 crit 3)**
- **D-01 (LOCKED):** **lock compartido `withFileLock`** sobre un lockfile hermano (`~/.kodo/inbox.lock`), tomado por **ambos** carriles. El marcado es el **único** escritor que reescribe el fichero; la captura solo appendea.
  - *Descartada — event-log append-only puro*: rompe CAPT-06 (el trace pointer va «en su línea») y degrada la legibilidad human-editable que justifica el §Out of Scope del editor TUI.
  - *Descartada — marcado in-place posicional (`pwrite` de token de ancho fijo)*: CAPT-06 la mata — el trace pointer `→ destino` es de longitud variable y va en la propia línea, así que el marcado tiene que reescribir de todos modos.
- **D-02:** la captura toma el lock **y** appendea con `appendFileSync` (flag `'a'` → `O_APPEND`), **nunca** `writeFileAtomic` (CAPT-01 literal). Dos capas independientes: el lock protege contra el RMW del marcado; el `O_APPEND` garantiza por sí solo que N capturas concurrentes producen N líneas aunque el lock no estuviera. Patrón ya en producción en `src/logger.js:318`.
- **D-03:** **fail-open de la captura ante `lock-timeout`.** Agotado el presupuesto (8 retries × 20 ms), `kodo capture` **appendea igual** y emite un warn a stderr. Riesgo residual explícito y acotado: solo se pierde si el timeout coincide además con la ventana read→rename de un marcado concurrente.
- **D-04 (invariante):** el marcado, **dentro del lock**, hace RMW con lectura fresca y escritura vía `writeFileAtomic` (temp+rename intra-fs, `src/config.js:135`). **Toda línea distinta de la marcada se preserva BYTE A BYTE** — incluidas las que no parsean.

**Formato de línea e identidad**
- **D-05:** formato **checklist markdown**: `- [ ] a3f9k2 · el texto de la idea · kodo · 2026-07-25 · cli`. Cierres: `- [x] … · enrutada → .planning/todos/TODO-012.md` · `- [x] … · enrutada` · `- [x] … · descartada`. El checkbox marca abierta/cerrada; el sufijo discrimina cuál de los dos cierres.
- **D-06:** identidad por **ID corto opaco** generado en la captura (`node:crypto`, cero deps), primer campo de la línea. Handle del marcado (`kodo inbox route <id>`). *Descartados: índice de línea (el fichero es human-editable), hash del contenido (dos capturas iguales colisionan).*
- **D-07:** fecha `YYYY-MM-DD` **local** (dato humano, no ISO-UTC).
- **D-08:** **parseo anclado a la cola.** Separador ` · ` (U+00B7 con espacios). El parser ancla el ID al principio y los **3 campos estructurados al final** (tag · fecha · origen [· estado [→ destino]]); todo lo que queda en medio es el texto, verbatim.

**Seam de enrutado (CAPT-04, CAPT-06)**
- **D-09 (LOCKED):** el seam es **puramente documental**. `kodo inbox` **NO invoca** `gsd-capture`. Flujo: `kodo inbox` → el operador (o el LLM en sesión) ejecuta `/gsd-capture …` → `kodo inbox route <id> [--dest <ref>]`.
- **D-10:** `--dest` es **OPCIONAL** — best-effort literal de CAPT-06; sin ref, la línea queda `enrutada` sin destino y el marcado nunca se bloquea.
- **D-11:** `--dest` es una string libre saneada con `stripForKeystroke`. kodo **no valida que exista ni interpreta su forma**.

**Superficie CLI**
- **D-12:** subcomandos planos: `kodo capture "<texto>"` · `kodo inbox` (abiertas) · `kodo inbox --all` · `kodo inbox route <id> [--dest <ref>]` · `kodo inbox discard <id>`. Human coloreado vía `createFormatter`; `--json` byte-determinista (DX-06).
- **D-13:** exit codes deterministas, espejo de `skill sync`: `0` ok/noop · `1` error de fs · `2` id inexistente o captura ya cerrada.
- **D-14:** **sin** filtros `--project` / `--open` — CAPT-F1 diferido a v2.
- **Color isolation (Phase 14 D-07):** los módulos nuevos NUNCA importan el paquete de color directamente — solo `createFormatter`.

**Derivación de `tag-proyecto` y `origen`**
- **D-15:** el tag sale de `resolveProjectId(cwd, projects)` (`src/cli/dashboard/select.js:407`). **Sin match → `basename(cwd)`**.
- **D-16:** `origen` tiene vocabulario `cli` | `skill`. `kodo capture` acepta `--origin <valor>` (**interno**, no anunciado en el help principal) con default `cli`. Existe ya en esta fase porque CAPT-02 exige que el skill de Phase 84 produzca una línea byte-idéntica shelleando a `kodo capture`.
- **D-17:** **sin** `--project` de override.

**Robustez del reader y del fichero**
- **D-18:** reader **leaf never-throws**: fichero ausente → listado vacío con copy explícita, jamás un throw. Una línea que no parsea se **preserva byte a byte** en disco y se **excluye** del listado estructurado.
- **D-19:** `~/.kodo/inbox.md` se crea on-demand (`mkdirSync` recursivo). **Sin cabecera ni preámbulo markdown**.
- **D-20:** permisos por defecto (umask). El `0600` está reservado al carril de credenciales.

**Validación**
- **D-21:** test de concurrencia con **procesos reales + barrier file** (patrón `test/gsd-lock-race.test.js`): (1) N capturas concurrentes → exactamente N líneas; (2) **caso mixto** capturas concurrentes **durante** un marcado → la captura sobrevive al RMW.
- **D-22:** **golden test del formato de línea** con clock y generador de ID inyectados (determinismo). Phase 84 comparará byte a byte contra él.

### Claude's Discretion

Longitud y alfabeto exactos del ID corto (p. ej. 4-6 chars base36 desde `randomBytes`) · nombre exacto del lockfile · organización de módulos (`src/inbox/*.js` de lógica pura + `src/cli/inbox.js` thin handler, espejo de `skill-sync.js` → `src/skill/sync.js`) · regex concreta del parser anclado a cola · copy exacta de los mensajes y del listado · N del test de concurrencia · si el listado human numera filas o muestra solo IDs.

### Deferred Ideas (OUT OF SCOPE)

- **CAPT-F1** — filtros `--project` / `--open` en `kodo inbox`: v2.
- **CAPT-F2** — archival/rotación del inbox: v2.
- **Phase 84** (no re-abrir aquí): `/kodo-capture` mid-session (CAPT-02), `kodo skill sync` multi-skill (CAPT-05), conteo ambient en el dashboard TUI (CAPT-07).
- **R-82-01** — carrera de 2º orden en `stealLock` con holder VIVO: ajena por construcción.
- **Riesgo residual de D-03**: documentado y aceptado. Si se materializa, el fix es subir el presupuesto de reintentos de la captura, **nunca** debilitar el test de D-21.
- **Out of Scope de REQUIREMENTS.md:** NLP/quick-add parsing · auto-routing en captura · múltiples inboxes · editor TUI in-place · endpoint `GET /inbox` · delete duro · reimplementar routing de `gsd-capture` · deps npm nuevas.

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Descripción | Research Support |
|----|-------------|------------------|
| **CAPT-01** | `kodo capture "idea"` appendea a `~/.kodo/inbox.md` una línea `texto · tag-proyecto · fecha · origen`; append atómico bajo concurrencia (N → N líneas, cero pérdidas); texto saneado a una línea con `stripForKeystroke` | §Atomicidad `O_APPEND` verificada empíricamente (12 procesos × 50 appends × 5 tamaños de línea, 0 pérdidas, 0 líneas partidas) · §Contrato exacto de `stripForKeystroke` probado sobre 15 vectores · §Pitfall 1 (cap de longitud) · §Pitfall 5 (`KODO_DIR` cacheado al import) |
| **CAPT-03** | `kodo inbox` lista abiertas y marca `enrutada`/`descartada` sin borrar; una captura concurrente durante el marcado nunca se pierde | §**CONFLICTO D-04 vs invariante cross-milestone** (headline) · §Template canónico lock+RMW+unique-tmp-rename (`src/hooks/session-end.js:325-391`) · §Pitfall 2 (lock robable a los 10 s) · §Validation Architecture (escenario mixto D-21.2) |
| **CAPT-04** | El enrutado lo hace `gsd-capture` — seam documental, sin import de código GSD | §Seam de enrutado — `SKILL.md` de `gsd-capture` leído: es un skill de Claude Code sin contrato de retorno máquina-legible; destinos reales enumerados para la copy de `--dest` |
| **CAPT-06** | Trace pointer `→ destino` best-effort en la línea de una captura enrutada; sin ref no bloquea | §Codec de línea (gramática verificada) · §Parser anclado a cola validado contra `--dest` con `·` embebidos y contra dos vectores de forgery |

</phase_requirements>

---

## Summary

Esta fase no tiene incógnitas de dominio externo: **cero deps nuevas, cero API externa, cero framework nuevo**. Todo lo que necesita ya está en el repo y fue leído en esta pasada. Lo que sí tiene es un puñado de garantías de sistema que hay que verificar en lugar de asumir, y **un conflicto documental real** entre `83-CONTEXT.md` D-04 y un invariante cross-milestone de `STATE.md` que el planner debe arbitrar antes de escribir la primera tarea.

Las dos garantías load-bearing quedan **verificadas empíricamente en esta sesión**, no asumidas. (1) `appendFileSync` de Node sobre APFS/macOS es atómico bajo concurrencia real: 12 procesos × 50 appends produjeron exactamente 600 líneas, 600 únicas, **cero líneas partidas**, a longitudes de 100 B, 4090 B, 8200 B, 65600 B y 200000 B — muy por encima de `PIPE_BUF`. La garantía de CAPT-01 es sólida en el carril `O_APPEND` incluso sin lock, que es exactamente la premisa de D-02/D-03. (2) commander@13.1.0 soporta la forma que exige D-12: un comando padre con `.action()` **y** subcomandos — `kodo inbox`, `kodo inbox --all`, `kodo inbox --json` caen en el handler padre, y `route <id>` / `discard <id>` en los suyos, sin conflicto. Además se validó una regex concreta de parser anclado a cola contra 15 vectores incluidos dos intentos de forgery (texto de usuario que imita la cola estructurada) y una sonda ReDoS de 80 KB: resuelve correctamente los 15 y no muestra backtracking catastrófico (0,4 ms en el peor caso).

El hallazgo que más impacto tiene en el plan es el **conflicto sobre `writeFileAtomic`**. D-04 dice escribir el RMW del marcado con `writeFileAtomic` de `src/config.js:135`. `STATE.md` §Critical Invariants (línea 100) dice literalmente lo contrario para los paths del inbox — *«cualquier rewrite usa unique-tmp-name + rename — jamás `writeFileAtomic` (fixed tmp)»* — y el research del milestone (`.planning/research/SUMMARY.md`, `PITFALLS.md`) lo descalifica por la misma razón, con precedente vivo: el fix WR-02 de Phase 74 (`src/hooks/session-end.js:325-391`) documenta en comentario por qué `writeFileAtomic` no vale ahí ni siquiera bajo lock — **porque el lock es robable a los 10 s de TTL**. La recomendación es preservar la *semántica* de D-04 (temp+rename intra-fs, preservación byte a byte) cambiando solo el *mecanismo* al template unique-tmp ya probado en el repo.

**Primary recommendation:** montar `src/inbox/store.js` (lógica pura, paths por DI) + `src/cli/capture.js` / `src/cli/inbox.js` (thin handlers, espejo de `skill-sync.js`); el marcado usa `withFileLock` + lectura fresca + **unique-tmp-name + rename** (template `session-end.js:378-386`, NO `writeFileAtomic`); la captura usa `withFileLock` fail-open + `appendFileSync`; el parser ancla la fecha `\d{4}-\d{2}-\d{2}` por la derecha; y `kodo inbox` sanea también **al renderizar**, no solo al escribir.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Append de una captura | Filesystem local (`~/.kodo/inbox.md`, `O_APPEND`) | — | CAPT-01 exige atomicidad de kernel; ninguna capa superior la aporta |
| Exclusión mutua captura↔marcado | Filesystem local (lockfile advisory `O_EXCL`) | — | D-01; `withFileLock` ya es la primitiva del repo |
| Codec de línea (encode/parse) | Lógica pura (`src/inbox/store.js`) | — | Contrato inter-fase con Phase 84 (D-22); debe ser testeable sin I/O ni proceso |
| Derivación de `tag-proyecto` | Lógica pura (`resolveProjectId`, `src/cli/dashboard/select.js:407`) | `basename(cwd)` como fallback | D-15; el módulo es puro (cero imports) → reuso sin acoplamiento |
| Saneo del texto | Lógica pura (`stripForKeystroke`, escritura) + render (`stripControlChars`, lectura) | — | Defensa en profundidad: el fichero es human-editable, el saneo de escritura no cubre líneas hand-edited (ver §Security Domain) |
| Parseo de argv, exit codes, `--json` | CLI thin handler (`src/cli/inbox.js`) | — | Patrón `skill-sync.js`; D-12/D-13 |
| Enrutado («a dónde va») | **Fuera de kodo** — skill `gsd-capture` | — | CAPT-04/D-09; seam documental, cero import |
| Persistencia HTTP / endpoint | **Ninguna** | — | Invariante «cero endpoints nuevos desde v0.10» |

---

## ⚠ CONFLICTO — RESUELTO 2026-07-25

> **RESUELTO.** Gana el invariante: el marcado usa **unique-tmp-name + `renameSync`**
> (`<path>.tmp.<pid>.<randomUUID>`, patrón `src/hooks/session-end.js:375`), **NO**
> `writeFileAtomic`. `83-CONTEXT.md` D-04 lleva la corrección post-research (commit
> `ce8257c`) y los tres PLAN.md la blindan por construcción (`src/inbox/store.js` no
> importa `src/config.js` en absoluto, con gate `grep` de source-hygiene). La sección
> se conserva por su análisis técnico — **no re-arbitrar**.

### `writeFileAtomic` (D-04) vs. unique-tmp-name (invariante cross-milestone)

Tres fuentes del propio proyecto se contradecían. Arbitrado en plan-phase; queda como registro del porqué.

| Fuente | Autoridad | Dice |
|--------|-----------|------|
| `83-CONTEXT.md` D-04 | Decisión de fase (LOCKED) | *«el marcado … hace RMW con lectura fresca y escritura vía `writeFileAtomic` (temp+rename intra-fs, `src/config.js:135`)»* |
| `.planning/STATE.md:100` §Critical Invariants to Preserve (cross-milestone) | **Invariante cross-milestone** | *«Lock del inbox (v0.19): … cualquier rewrite usa unique-tmp-name + rename — **jamás `writeFileAtomic` (fixed tmp)** para paths del inbox»* |
| `.planning/research/SUMMARY.md` + `PITFALLS.md` | Research del milestone (HIGH) | *«must not use `config.js`'s `writeFileAtomic` because its tmp name is fixed (`path + '.tmp'`) and two concurrent writers will clobber each other; instead clone the unique-tmp-name … pattern from `src/hooks/session-end.js:331-389`, which already solved this exact class of bug (WR-02, Phase 74)»* |

**Por qué el invariante gana técnicamente.** `writeFileAtomic` usa un tmp de nombre FIJO (`path + '.tmp'`, `src/config.js:136`). Bajo D-01 el marcado está serializado por `withFileLock`, así que *a primera vista* dos marcadores no pueden compartir el tmp. Pero el comentario del fix WR-02 —escrito en este mismo repo, por esta misma razón— explica el hueco exacto: [VERIFIED: `src/hooks/session-end.js:375-379`]

> *«Bajo el lock sería seguro, pero el lock es ROBABLE tras el TTL de 10 s (`state-lock.js:36`), así que la garantía no es absoluta (T-74-14). Y además acoplaría a config.js.»*

Es decir: un marcado que tarde >10 s (fichero grande, disco lento, proceso suspendido con `SIGSTOP`, breakpoint de debugger) ve su lock robado por `acquireLock`; el ladrón entra en su propio RMW y ambos escriben `inbox.md.tmp`; el `renameSync` del primero puede publicar bytes parciales del segundo. Con nombre único esa clase desaparece por construcción.

**Segundo defecto de reutilizar `writeFileAtomic` aquí, no cubierto por el invariante:** contiene un heurístico orientado a JSON — `const hasSecret = /"[^"]*_secret"\s*:/.test(data)` [VERIFIED: `src/config.js:137`]. Una captura cuyo texto contenga la subcadena `"api_key_secret":` haría que el inbox entero se chmodee a `0600`, contradiciendo D-20 («permisos por defecto (umask)»). Es un falso positivo de baja probabilidad pero de efecto silencioso y persistente.

**Recomendación (HIGH confidence):** conservar D-04 en su *semántica* — RMW con lectura fresca dentro del lock + temp+rename intra-fs + preservación byte a byte de toda línea no marcada — y sustituir el *mecanismo* por el template unique-tmp local al módulo del inbox. Es el mismo patrón, el mismo nivel de atomicidad, sin el acoplamiento a `config.js` ni el falso positivo `*_secret`, y satisface el invariante cross-milestone sin tocar `src/config.js`.

```js
// src/inbox/store.js — template canónico, clonado de src/hooks/session-end.js:378-386 (fix WR-02).
const tmp = inboxPath + '.tmp.' + process.pid + '.' + randomUUID();
try {
  writeFileSync(tmp, out);
  renameSync(tmp, inboxPath);
} catch (err) {
  rmSync(tmp, { force: true }); // sin residuo de tmp perdido
  throw err;
}
```

---

## Standard Stack

Cero paquetes nuevos. Todo es reuso in-repo o built-in de Node.

### Core

| Módulo | Ubicación | Propósito | Por qué es el estándar aquí |
|--------|-----------|-----------|-----------------------------|
| `appendFileSync` | `node:fs` (precedente vivo: `src/logger.js:318`) | Append `O_APPEND` de la línea de captura | Único mecanismo que da atomicidad multi-proceso sin lock; **verificado empíricamente** (ver §Code Examples) [VERIFIED: prueba de 12 procesos ejecutada en esta sesión] |
| `withFileLock` | `src/session/state-lock.js:215` | Exclusión mutua captura↔marcado (D-01) | Never-throws, retorna `{ok:false,reason:'lock-timeout'}` tras 8×20 ms; release en `finally`; ya probado en CONC-01 con 10 procesos [VERIFIED: código leído en pleno] |
| `acquireLock` / `releaseLock` | `src/session/state-lock.js:61` / `:180` | Base de `withFileLock` — defaults `retries:8`, `backoffMs:20`, `ttlMs:10_000` | `acquireLock` hace `mkdirSync(dirname(lockPath), {recursive:true})` (`:71`) → si el lockfile es hermano de `inbox.md`, **tomar el lock ya crea `~/.kodo/`** (regalo para D-19) [VERIFIED] |
| `stripForKeystroke` | `src/cli/format.js:114` | Saneo del texto a una sola línea (CAPT-01, D-02, D-11) | Colapsa `\n`/`\r`/`\t` reales **y** sus formas de escape literal; elimina CSI/C0/C1/DEL. Invariante cross-milestone `STATE.md:103` [VERIFIED: 15 vectores probados] |
| `stripControlChars` | `src/cli/format.js:80` | Saneo del carril de **render** al listar | Necesario porque el fichero es human-editable: el saneo de escritura no cubre líneas hand-edited (ver §Security Domain) |
| `createFormatter` | `src/cli/format.js:179` | Render human coloreado + contrato de bytes para `--json` | Color isolation obligatoria — `test/format-isolation.test.js` blinda que solo `format.js` importe `picocolors` [VERIFIED] |
| `resolveProjectId` | `src/cli/dashboard/select.js:407` | Derivación cwd→projectId, nearest-ancestor, never-throws (D-15) | El módulo tiene **cero imports** (verificado por grep) → reuso sin ningún acoplamiento transitivo ni riesgo de color isolation [VERIFIED] |
| `loadProjects` | `src/config.js:323` | Carga `~/.kodo/projects.json` para alimentar `resolveProjectId` | Ya hace `ensureDir()` + try/catch → `{}` ante JSON corrupto |
| `randomBytes` / `randomUUID` | `node:crypto` | ID corto opaco (D-06) + sufijo del tmp único | CSPRNG; convención del repo (`state-lock.js:10`) |
| `commander` | `^13.0.0` (instalado, 13.1.0) | Registro de `capture` e `inbox` en `src/cli.js` (D-12) | Soporte de comando-padre-con-acción + subcomandos **verificado empíricamente** en esta sesión |

### Supporting

| Módulo | Ubicación | Propósito | Cuándo se usa |
|--------|-----------|-----------|---------------|
| `node:test` + `node:assert/strict` | built-in | Suite de tests (175 ficheros hoy) | Todos los tests; `npm test` = `node --test $(find test -name '*.test.js' -type f)` |
| `spawn` (`node:child_process`) | built-in | Tests de carrera con procesos reales (D-21) | Molde: `test/gsd-lock-race.test.js` + `test/helpers/lock-race-child.mjs` |
| `Atomics.wait` sobre `SharedArrayBuffer` | built-in | Sleep síncrono / barrier spin en los tests | Ya usado en `state-lock.js:47` y en el helper de carrera |
| `basename` (`node:path`) | built-in | Fallback del tag cuando no hay match (D-15) | Solo en el carril de derivación del tag |

### Alternatives Considered

| En lugar de | Se podría usar | Tradeoff |
|-------------|----------------|----------|
| unique-tmp + rename local al módulo | `writeFileAtomic` de `src/config.js:135` | **Descartado** — viola `STATE.md:100`; ventana de clobber si el lock se roba a los 10 s; falso positivo `*_secret` que chmodearía el inbox a 0600 contra D-20 |
| `resolveProjectId` (`select.js:407`) | `resolveProjectPath` (`src/cli/adopt.js:43`) | `adopt.js` resuelve projectId→path (dirección contraria) e **importa `format.js`**; `select.js` es puro y va en la dirección correcta. CONTEXT lo cita solo como «referencia de estilo» |
| ID base36 de 6 chars | UUID completo / hex de 6 | UUID rompe la legibilidad de la línea (D-05); hex6 tiene ~3 % de colisión a 1000 capturas vs. 0,02 % de base36×6 (calculado en esta sesión) |
| Regex tail-anchored con `(.+)` greedy | Split por ` · ` + reensamblado del medio | Equivalentes; la regex se validó contra 15 vectores incluidos 2 forgeries y no muestra ReDoS. El split es más legible pero exige lógica manual para el sufijo opcional |
| `appendFileSync` sin lock (event-log) | — | **Descartado en discuss-phase (D-01)**; no re-abrir |

**Installation:**

```bash
# Ninguna. Invariante cross-milestone: cero deps npm nuevas.
# Verificación de que el plan no lo rompe:
git diff --stat package.json package-lock.json   # debe salir vacío
```

---

## Package Legitimacy Audit

**No aplica — esta fase no instala ningún paquete externo.**

El invariante cross-milestone «Cero nuevas dependencias npm» (`STATE.md:107`) y la fila explícita del §Out of Scope de `REQUIREMENTS.md` («Deps npm nuevas (lockfile/markdown/uuid) — invariante cero-deps; `node:fs` + `node:crypto` cubren todo») cierran esta superficie. Todas las dependencias del plan son:

- **built-ins de Node** (`node:fs`, `node:crypto`, `node:path`, `node:os`, `node:test`, `node:child_process`) — sin registro, sin riesgo de slopsquatting.
- **`commander@^13.0.0`** — ya instalado y en uso (13.1.0 verificado en `node_modules`); no se añade, no se actualiza.

**Packages removed due to [SLOP] verdict:** ninguno.
**Packages flagged as suspicious [SUS]:** ninguno.

**Guardarraíl para el planner:** cualquier tarea que proponga `npm install` es un fallo de plan, no una decisión de implementación. Considerar un test source-hygiene que asserte que `package.json` `dependencies` sigue teniendo exactamente 4 claves.

---

## Architecture Patterns

### System Architecture Diagram

```
                          ┌──────────────────────────────────┐
  cwd (cualquiera)  ─────▶│  kodo capture "idea"             │
                          │  src/cli/capture.js (thin)       │
                          └────────────┬─────────────────────┘
                                       │ argv → validar texto no vacío
                                       │ --origin (interno, default 'cli')
                                       ▼
                       ┌───────────────────────────────────────┐
                       │  derivación (pura)                    │
                       │  loadProjects() ─▶ resolveProjectId() │
                       │    {projectId} ──────────▶ tag        │
                       │    {error:'none'|'ambiguous'}         │
                       │             └──▶ basename(cwd) ▶ tag  │
                       │  clock() ─▶ YYYY-MM-DD local          │
                       │  newId()  ─▶ base36 opaco             │
                       │  stripForKeystroke(texto) ─▶ 1 línea  │
                       └───────────────┬───────────────────────┘
                                       │ encodeLine(...) → "- [ ] id · … \n"
                                       ▼
                       ┌───────────────────────────────────────┐
                       │  appendCapture()  src/inbox/store.js  │
                       │                                       │
                       │  withFileLock(~/.kodo/inbox.lock)     │
                       │    └─▶ appendFileSync(inbox.md, line) │
                       │                                       │
                       │  {ok:false,'lock-timeout'} (D-03)     │
                       │    └─▶ FAIL-OPEN: appendea igual      │
                       │        + warn a stderr                │
                       └───────────────┬───────────────────────┘
                                       │  O_APPEND (atómico, kernel)
                                       ▼
                    ╔══════════════════════════════════════════╗
                    ║   ~/.kodo/inbox.md   (append-only)       ║
                    ║   human-editable · sin cabecera          ║
                    ║   ~/.kodo/inbox.lock (advisory O_EXCL)   ║
                    ╚═══════╤══════════════════════════╤═══════╝
                            │ readFileSync             │ RMW bajo lock
                            ▼                          ▼
        ┌───────────────────────────────┐   ┌──────────────────────────────────┐
        │ listCaptures()   (never-throws)│   │ markCapture(id, estado, dest?)   │
        │  ENOENT ─▶ []                  │   │                                  │
        │  split('\n') ─▶ parseLine()    │   │ withFileLock(inbox.lock)         │
        │   match   ─▶ capture struct    │   │  ├─ readFileSync  (FRESCO)       │
        │   no match─▶ descartada del    │   │  ├─ localizar línea POR ID       │
        │             listado, INTACTA   │   │  │    no existe   ─▶ exit 2      │
        │             en disco (D-18)    │   │  │    ya cerrada  ─▶ exit 2      │
        └───────────────┬───────────────┘   │  ├─ reemplazar SOLO esa línea     │
                        │                   │  │    (resto BYTE A BYTE, D-04)   │
                        ▼                   │  ├─ writeFileSync(tmp único)      │
        ┌───────────────────────────────┐   │  └─ renameSync(tmp → inbox.md)    │
        │ render  src/cli/inbox.js      │   │                                  │
        │  --json ─▶ 1 línea determin.  │   │ {ok:false} ─▶ exit 1 + stderr    │
        │  human  ─▶ createFormatter    │   │              (NO fail-open aquí)  │
        │           + stripControlChars │   └──────────────────────────────────┘
        └───────────────┬───────────────┘                    ▲
                        │                                    │
                        ▼                                    │
        ┌───────────────────────────────────────┐            │
        │  OPERADOR / LLM en sesión             │            │
        │  lee el id, decide destino            │            │
        │  ejecuta  /gsd-capture …              │            │
        │  ┌─────────────────────────────────┐  │            │
        │  │ gsd-capture (skill Claude Code) │  │            │
        │  │ .planning/todos/ · notes ·      │  │            │
        │  │ ROADMAP 999.x · seeds/SEED-NNN  │  │            │
        │  │ SIN contrato de retorno máquina │  │            │
        │  └─────────────────────────────────┘  │            │
        │  copia la ref a mano (si la hay)      │            │
        │  kodo inbox route <id> [--dest <ref>] ├────────────┘
        └───────────────────────────────────────┘
              ▲ SEAM DOCUMENTAL (D-09) — cero import, cero exec
```

### Recommended Project Structure

```
src/
├── inbox/
│   └── store.js            # lógica pura + I/O del inbox; paths por DI (SoSoT)
│                           #   encodeLine / parseLine / listCaptures
│                           #   appendCapture / markCapture
├── cli/
│   ├── capture.js          # thin handler `kodo capture` (argv→gate→delegar→render)
│   └── inbox.js            # thin handler `kodo inbox [--all|--json] route|discard`
└── cli.js                  # +2 registros commander, lazy `await import()`

test/
├── inbox-store.test.js     # unit: codec, parser, listCaptures, markCapture (DI de paths)
├── inbox-cli.test.js       # integration: spawnSync bin/kodo, exit codes, --json golden
├── inbox-format-golden.test.js  # D-22: línea byte-exacta con clock+id inyectados
└── inbox-concurrency.test.js    # D-21: procesos reales + barrier (2 escenarios)
test/helpers/
└── lock-race-child.mjs     # +2 kinds: `capture` y `mark` (extender, NO duplicar)
```

### Pattern 1: Thin CLI handler + lógica pura en módulo aparte

**What:** El fichero de `src/cli/` solo hace argv → gate → delegar → render → exit code. Toda la lógica vive en un módulo hermano importable y testeable sin proceso.
**When to use:** Todo subcomando nuevo. Es el patrón canónico del repo.
**Example:** [VERIFIED: `src/cli/skill-sync.js` leído en pleno]

```js
// src/cli/inbox.js — espejo estructural de src/cli/skill-sync.js
// @ts-check
// Color isolation (Phase 14 D-07): este archivo NUNCA importa picocolors — solo createFormatter.

import { listCaptures, markCapture, INBOX_PATH, INBOX_LOCK } from '../inbox/store.js';
import { createFormatter } from './format.js';

/**
 * @typedef {{ all?: boolean, json?: boolean }} RunInboxCliOpts
 * @typedef {{
 *   listFn?: typeof listCaptures,
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 *   inboxPath?: string,
 * }} RunInboxCliDeps
 */

/**
 * @param {RunInboxCliOpts} opts
 * @param {RunInboxCliDeps} [deps]
 * @returns {number} exit code (D-13: 0 ok/noop · 1 fs error · 2 id inexistente/ya cerrada)
 */
export function runInboxListCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err   = deps.errFn   || ((s) => process.stderr.write(s));
  const fmt   = (deps.formatterFn || (() => createFormatter(process.stdout)))();
  // … gate → delegar → render → return code (NUNCA process.exit: bin/kodo hace el exit)
}
```

**Nota D-07 (`skill-sync.js:52`):** el handler **retorna** el código, nunca invoca `process.exit`. `src/cli.js` (el caller) ejecuta el exit con el valor retornado. Ver los `.action()` existentes en `src/cli.js:510-522` para el molde exacto.

### Pattern 2: RMW bajo lock con unique-tmp + rename (fix WR-02)

**What:** Leer fresco *dentro* del lock, mutar en memoria, escribir a un tmp de nombre único, renombrar. Nunca un tmp de nombre fijo.
**When to use:** Cualquier reescritura de fichero completo que pueda concurrir. Es literalmente el caso de `markCapture`.
**Example:** [VERIFIED: `src/hooks/session-end.js:329-390`, template completo leído]

```js
// src/inbox/store.js
import { readFileSync, writeFileSync, renameSync, rmSync, existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { withFileLock } from '../session/state-lock.js';

/**
 * Marca una captura como `enrutada`/`descartada` preservando BYTE A BYTE toda
 * línea que no sea la marcada (D-04) — incluidas las que no parsean.
 *
 * @param {string} id
 * @param {'enrutada'|'descartada'} estado
 * @param {{ dest?: string|null, inboxPath: string, lockPath: string }} o
 * @returns {{ ok: true } | { ok: false, reason: 'not-found'|'already-closed'|'lock-timeout'|'fs' }}
 */
export function markCapture(id, estado, o) {
  const r = withFileLock(o.lockPath, () => {
    // a. Lectura FRESCA dentro del lock — no antes (anti-clobber, D-02 de state.js).
    if (!existsSync(o.inboxPath)) return { ok: false, reason: 'not-found' };
    const raw = readFileSync(o.inboxPath, 'utf-8');

    // b. `split('\n')` + `join('\n')` es round-trip exacto: preserva CRLF residual,
    //    líneas vacías y la ausencia/presencia de newline final. NO usar trim().
    const lines = raw.split('\n');
    let hit = -1;
    for (let i = 0; i < lines.length; i++) {
      const p = parseLine(lines[i]);
      if (p && p.id === id) { hit = i; break; }
    }
    if (hit === -1) return { ok: false, reason: 'not-found' };
    const cur = parseLine(lines[hit]);
    if (!cur.open) return { ok: false, reason: 'already-closed' };  // D-13 exit 2

    // c. SOLO esa línea cambia. El resto del array no se toca.
    lines[hit] = encodeLine({ ...cur, open: false, estado, dest: o.dest ?? null });
    const out = lines.join('\n');

    // d. unique-tmp + rename (fix WR-02) — NUNCA writeFileAtomic (tmp fijo).
    const tmp = o.inboxPath + '.tmp.' + process.pid + '.' + randomUUID();
    try {
      writeFileSync(tmp, out);
      renameSync(tmp, o.inboxPath);
    } catch (err) {
      rmSync(tmp, { force: true });
      return { ok: false, reason: 'fs' };
    }
    return { ok: true };
  });
  // El marcado NO hace fail-open (a diferencia de la captura, D-03): sin lock no reescribe.
  return r.ok ? r.value : { ok: false, reason: 'lock-timeout' };
}
```

### Pattern 3: Reader leaf never-throws

**What:** Todo consumidor de filesystem colapsa cualquier fallo a estado vacío en vez de lanzar (D-18).
**When to use:** `listCaptures` y cualquier lectura que alimente el render.
**Example:**

```js
/**
 * @param {{ inboxPath: string }} o
 * @returns {{ captures: Capture[], unparsed: number }} nunca lanza (D-18)
 */
export function listCaptures(o) {
  let raw;
  try {
    raw = readFileSync(o.inboxPath, 'utf-8');
  } catch {
    return { captures: [], unparsed: 0 }; // ENOENT, EACCES, EISDIR → vacío
  }
  const captures = [];
  let unparsed = 0;
  for (const line of raw.split('\n')) {
    if (line === '') continue;
    const p = parseLine(line);
    if (p) captures.push(p);
    else unparsed++;   // preservada en disco, excluida del listado (D-18)
  }
  return { captures, unparsed };
}
```

### Pattern 4: Comando padre commander con acción + subcomandos

**What:** `kodo inbox` ejecuta el listado; `kodo inbox route <id>` / `kodo inbox discard <id>` ejecutan sus handlers.
**Verificación empírica (esta sesión, commander 13.1.0):**

```
inbox                                       => PARENT-ACTION {}
inbox --all                                 => PARENT-ACTION {"all":true}
inbox --json                                => PARENT-ACTION {"json":true}
inbox route a3f9k2                          => ROUTE a3f9k2 {}
inbox route a3f9k2 --dest .planning/todos/… => ROUTE a3f9k2 {"dest":".planning/todos/T-1.md"}
inbox discard c4d8n5                        => DISCARD c4d8n5
```

```js
// src/cli.js — mismo molde que `gsd` / `sidebar` / `skill`, pero con .action() en el padre.
const inbox = program
  .command('inbox')
  .description('Triage del inbox de capturas (~/.kodo/inbox.md)')
  .option('--all', 'Incluir también las capturas cerradas (traza permanente)')
  .option('--json', 'Emitir el listado como JSON (scriptable, byte-determinista)')
  .action(async (opts) => {
    const { runInboxListCli } = await import('./cli/inbox.js');
    process.exitCode = runInboxListCli(opts);
  });

inbox
  .command('route <id>')
  .description('Marcar una captura como enrutada (opcionalmente con trace pointer)')
  .option('--dest <ref>', 'Trace pointer al destino (best-effort; kodo no lo valida)')
  .action(async (id, opts) => { /* … */ });

inbox
  .command('discard <id>')
  .description('Marcar una captura como descartada (nunca la borra)')
  .action(async (id) => { /* … */ });
```

**Nota:** ni `capture` ni `inbox` deben llamar a `ensureConfig()` — mismo precedente que `skill sync`, `gsd doctor` y `sidebar doctor` (`src/cli.js:512`, `:466`, `:490`). El inbox es filesystem local, no necesita provider configurado.

### Anti-Patterns to Avoid

- **`writeFileAtomic` de `config.js` para el inbox:** tmp de nombre fijo → clobber si el lock se roba a los 10 s; además chmodea a 0600 si el texto contiene `"…_secret":`. Ver §CONFLICTO.
- **Localizar la línea por índice o byte-offset:** el fichero es human-editable y append-only concurrente; cualquier offset se invalida. Localizar **siempre por ID** (D-06).
- **`raw.trim().split('\n')` o `.filter(Boolean)` antes de reescribir:** destruye líneas vacías y el newline final → viola la preservación byte a byte de D-04. Round-trip exacto: `split('\n')` … `join('\n')`, sin trim.
- **`import` estático de `src/config.js` (o de cualquier módulo que lo importe) en un test que sobreescribe `HOME`:** `KODO_DIR` se evalúa al *module-load* (`src/config.js:11`). Ver §Pitfall 5.
- **`process.exit()` dentro del handler CLI:** rompe el contrato D-07 del repo. Retornar el código; `src/cli.js` lo aplica.
- **Importar `picocolors` desde `src/inbox/*` o `src/cli/capture.js`/`inbox.js`:** `test/format-isolation.test.js` lo pone rojo automáticamente (walker sobre todo `src/`).
- **Renderizar el texto crudo del fichero sin sanear:** el fichero es human-editable; una línea con OSC-52 hand-pegada se ejecuta en el terminal del operador al hacer `kodo inbox`. Ver §Security Domain.
- **Exec/spawn de `gsd-capture` desde `kodo inbox`:** viola D-09 y CAPT-04. El seam es documental.

---

## Don't Hand-Roll

| Problema | No construyas | Usa | Por qué |
|----------|---------------|-----|---------|
| Exclusión mutua entre procesos | Un lockfile propio con `existsSync` + `writeFileSync` | `withFileLock` (`src/session/state-lock.js:215`) | Ya resuelve `O_EXCL`, retry con backoff, TTL, detección de PID muerto, steal con CAS + guarda ABA, release ownership-checked por token, y never-throws. Reimplementarlo es reintroducir la clase de bug que Phase 82 acaba de cerrar |
| Saneo del texto a una línea | `text.replace(/\n/g,' ')` | `stripForKeystroke` (`src/cli/format.js:114`) | El replace ingenuo deja pasar CSI, OSC, C1 (`\x80-\x9f`), DEL y las secuencias de escape *literales* `\n`/`\r`/`\t`. Es exactamente el residuo que WR-02 (Phase 78) corrigió |
| Neutralizar escapes al renderizar | Un strip ANSI propio | `stripControlChars` (`src/cli/format.js:80`) | El regex CSI de `visibleWidth` no cubre OSC; `stripControlChars` es el strip amplio ya auditado (HYG-07/M4) |
| Escritura no corruptiva | `writeFileSync` directo sobre `inbox.md` | unique-tmp + `renameSync` (template `session-end.js:378-386`) | Un `writeFileSync` directo deja el fichero a medias si el proceso muere; el lector vería un inbox truncado |
| Resolución cwd → proyecto | Recorrer `projects.json` a mano | `resolveProjectId` (`src/cli/dashboard/select.js:407`) | Ya hace nearest-ancestor con boundary de separador (`/home/op/kodo-sibling` no matchea `/home/op/kodo`), soporta el shape `{default, modules}` y es never-throws sobre `projects.json` corrupto (CR-01 Phase 56) |
| Generación de ID | `Math.random().toString(36)` | `randomBytes` (`node:crypto`) | `Math.random` no es CSPRNG y colisiona antes; `node:crypto` es la convención del repo (`state-lock.js:10`) |
| Atomicidad del append | Lock + read + write | `appendFileSync` (`O_APPEND`) | El kernel ya lo garantiza. Verificado: 12 procesos × 50 líneas × 5 tamaños → 0 pérdidas, 0 líneas partidas |
| Parseo de markdown | Un parser de markdown | `split('\n')` + una regex | El fichero es una lista pura sin cabecera (D-19). Tratarlo como log de líneas, no como documento. Además: cero deps |
| Arnés de test multi-proceso | Un helper nuevo | Extender `test/helpers/lock-race-child.mjs` con 2 `--kind` nuevos | Ya resuelve el barrier file, el spin bounded, el never-throws y la disciplina «import dinámico POST-HOME». Seis fases lo comparten |

**Key insight:** en esta fase la tentación no es «traer una librería» (el invariante lo prohíbe), sino **reimplementar una primitiva que el repo ya endureció a base de bugs reales** — el lock (CR-01/Phase 82), el tmp único (WR-02/Phase 74), el saneo de keystroke (WR-02/Phase 78) y la resolución cwd→proyecto (CR-01/Phase 56). Cada una de esas cuatro lleva un fix cicatrizado dentro. Un reimplemento «más simple» es un retroceso a la versión pre-fix.

---

## Common Pitfalls

### Pitfall 1: Confiar en la atomicidad de `O_APPEND` para una línea arbitrariamente larga

**Qué sale mal:** La garantía POSIX es que cada `write(2)` bajo `O_APPEND` hace seek-al-final atómicamente. Pero `appendFileSync` de Node hace *loop* sobre escrituras parciales; si el buffer excede lo que el FS escribe en un syscall, la línea puede entrelazarse con la de otro escritor.
**Por qué pasa:** El texto de la captura viene de argv y no tiene cota. Un `kodo capture "$(cat archivo.txt)"` mete megabytes.
**Verificación empírica en esta sesión (APFS/macOS, Node 22.22.3):** 12 procesos concurrentes × 50 appends, con barrier, a longitudes de 100 B / 4090 B / 8200 B / 65600 B y 6 procesos a 200000 B → **en los 5 casos: líneas = esperadas, únicas = esperadas, líneas partidas = 0.** La atomicidad aguanta muy por encima de `PIPE_BUF`.
**Cómo evitarlo:** aun así, **imponer una cota explícita a la longitud del texto** (p. ej. 1000 chars, truncando o rechazando con exit 2) para que el `write` sea inequívocamente único, y documentar en un comentario que la garantía asume filesystem local (`~/.kodo`) — `O_APPEND` **no** es atómico sobre NFS. [CITED: `.planning/research/PITFALLS.md:18`]
**Señales de alarma:** líneas del inbox que no parsean con fragmentos de otra captura dentro.

### Pitfall 2: Asumir que el lock hace innecesario el tmp único

**Qué sale mal:** «El marcado está bajo `withFileLock`, luego solo hay un escritor, luego `path + '.tmp'` es seguro.» Falso: `acquireLock` **roba** el lock cuando `Date.now() - held.acquired_at > ttlMs` (10 s por defecto, `state-lock.js:36,87`), aunque el holder siga vivo. Un marcado lento (fichero grande, disco saturado, proceso con `SIGSTOP`, debugger) pierde su lock mientras sigue en su RMW; el ladrón escribe el mismo tmp; el `renameSync` del primero publica bytes del segundo.
**Por qué pasa:** el TTL existe para no bloquear ante procesos zombis; su precio es que la exclusión no es absoluta. El repo ya documenta esto textualmente en `session-end.js:375-379` (T-74-14).
**Cómo evitarlo:** unique-tmp-name (`path + '.tmp.' + process.pid + '.' + randomUUID()`) siempre, con `rmSync(tmp,{force:true})` en el `catch` para no dejar residuo.
**Señales de alarma:** `inbox.md.tmp` huérfano en `~/.kodo/`; una captura reaparece o desaparece tras un marcado.

### Pitfall 3: `resolveProjectId` tiene DOS modos de fallo, no uno

**Qué sale mal:** D-15 dice «Sin match → `basename(cwd)`». Pero la firma real es `{ projectId } | { error: 'none' | 'ambiguous' }` [VERIFIED: `select.js:407-447`]. Un código que solo compruebe `error === 'none'` lanzará `undefined` como tag cuando dos projectIds tengan paths de igual longitud en `projects.json`.
**Por qué pasa:** el caso `ambiguous` es raro (config no determinista) y no se menciona en CONTEXT.
**Cómo evitarlo:** tratar **cualquier** shape sin `projectId` como fallback a `basename(cwd)`. La forma robusta: `const tag = ('projectId' in r) ? r.projectId : basename(cwd)`.
**Señales de alarma:** líneas con tag `undefined` en el inbox.

### Pitfall 4: El tag y el origen pueden contener el separador ` · `

**Qué sale mal:** El tag sale de `projectId` (clave de `projects.json`, operator-editable) o de `basename(cwd)` (nombre de directorio arbitrario). Cualquiera de los dos puede contener `·`. Si un campo *estructurado* lleva el separador, el parseo anclado a cola de D-08 se rompe — y a diferencia del texto (que es libre por diseño), aquí no hay ancla que lo salve.
**Por qué pasa:** D-08 protege el texto pero no dice nada del tag.
**Cómo evitarlo:** en `encodeLine`, sanear tag y origen con `stripForKeystroke` **y además** eliminar/sustituir `·` y colapsar espacios: `stripForKeystroke(tag).replace(/·/g, '-').replace(/\s+/g, ' ').trim()`. Los campos estructurados **nunca** contienen el separador; solo el texto y `--dest` (que va al final) pueden.
**Señales de alarma:** un proyecto cuyo directorio lleva `·` produce líneas que no parsean.

### Pitfall 5: `KODO_DIR` se evalúa al module-load — los tests escriben en el `~/.kodo` real

**Qué sale mal:** `src/config.js:11` hace `const KODO_DIR = join(homedir(), '.kodo')` **en el cuerpo del módulo**. Un test que haga `import { ... } from '../src/inbox/store.js'` estáticamente y luego `process.env.HOME = sandbox` ya llegó tarde: el path quedó fijado al home real del operador. El test contaminaría el inbox de verdad.
**Por qué pasa:** es una fuga de aislamiento conocida y documentada en el repo (`config.js:116-118`, obs. 21811/22683) que ya mordió en Phase 74 — el helper de carrera lo advierte explícitamente: *«The import MUST stay dynamic and POST-HOME (RESEARCH §Pitfall 6)»* [VERIFIED: `test/helpers/lock-race-child.mjs:98-102`].
**Cómo evitarlo — dos capas:**
1. **DI de paths en `src/inbox/store.js`.** Toda función recibe `{ inboxPath, lockPath }` como parámetro; el default (`join(KODO_DIR,'inbox.md')`) se resuelve **en el call-site del CLI**, no en el módulo puro. Así los unit tests no necesitan tocar `HOME` en absoluto.
2. **En los tests de proceso real** (D-21), spawn con `env: { ...process.env, HOME: sandbox }` y **`await import()` dinámico** dentro del child, después de que el env esté puesto. Nunca `import` estático.

**Señales de alarma:** aparecen capturas de test (`idea de test`, `writer-3`) en el `~/.kodo/inbox.md` del operador tras correr `npm test`.

### Pitfall 6: El saneo de escritura no protege el render

**Qué sale mal:** `stripForKeystroke` se aplica en `kodo capture`. Pero D-19 y el §Out of Scope establecen que el fichero **es human-editable**, y D-18 que las líneas ajenas se preservan intactas. Un operador que pegue a mano una línea con OSC-52 (`\x1b]52;c;…\x07`) verá esa secuencia **ejecutada en su terminal** al hacer `kodo inbox` — escritura al portapapeles desde el listado.
**Por qué pasa:** el modelo de amenaza de CAPT-01 ("saneo en escritura") asume que kodo es el único escritor. El diseño dice explícitamente que no lo es.
**Cómo evitarlo:** aplicar `stripControlChars` (carril de render) al texto y al `dest` **también en el render de `kodo inbox`**. Coste: cero (función pura ya existente). Es defensa en profundidad, alineada con el invariante `STATE.md:103`.
**Señales de alarma:** el listado del inbox mueve el cursor, cambia colores que el formatter no puso, o el portapapeles cambia solo.

### Pitfall 7: `- [x]` sin sufijo de estado (hand-edit)

**Qué sale mal:** D-05 define que el checkbox marca abierta/cerrada y el sufijo discrimina *cuál* de los dos cierres. Un humano puede marcar `- [x]` a mano sin añadir sufijo. ¿Qué hace `parseLine`? ¿Y `kodo inbox route <id>` sobre esa línea — es «ya cerrada» (exit 2) o marcable?
**Por qué pasa:** el fichero es human-editable por diseño; este estado es alcanzable.
**Cómo evitarlo:** decidirlo explícitamente y testearlo. Recomendación coherente con D-05: **el checkbox es la autoridad** de abierta/cerrada → `- [x]` sin sufijo se lista como cerrada con cierre desconocido, y `route`/`discard` sobre ella devuelven `already-closed` (exit 2). No re-escribirla (D-04: preservación byte a byte).
**Señales de alarma:** una línea hand-checked reaparece en el listado de abiertas.

### Pitfall 8: Texto vacío tras el saneo

**Qué sale mal:** `stripForKeystroke` coacciona con `String(s)` y no hace trim. Verificado en esta sesión: `''` → `''`, `'   '` → `'   '`, `null` → `'null'`, `42` → `'42'`. Un `kodo capture ""` o `kodo capture "   "` escribiría una línea sin contenido útil, y `kodo capture "\n"` una línea con un espacio.
**Por qué pasa:** commander pasa el argumento tal cual; no hay validación.
**Cómo evitarlo:** validar en `src/cli/capture.js` **después** del saneo: si `stripForKeystroke(texto).trim() === ''` → stderr canonical + exit code. D-13 no cubre este caso; el planner debe asignarle un código (recomendación: `2`, coherente con «entrada inválida» del resto del repo).
**Señales de alarma:** líneas `- [ ] a3f9k2 ·  · kodo · 2026-07-25 · cli`.

### Pitfall 9: `writeFileAtomic` de `config.js` no crea el directorio

**Qué sale mal:** `writeFileAtomic` y `appendFileSync` fallan con ENOENT si `~/.kodo/` no existe. `ensureDir` de `config.js:97` **no está exportado** (verificado por grep) y además está hardcodeado a `KODO_DIR`.
**Cómo evitarlo:** `mkdirSync(dirname(inboxPath), { recursive: true })` en el propio `store.js`, **fuera** de la sección crítica (el mkdir no necesita el lock — patrón `session-end.js:325`). **Regalo:** `acquireLock` ya hace `mkdirSync(dirname(lockPath), {recursive:true})` (`state-lock.js:71`), así que si el lockfile es hermano de `inbox.md`, tomar el lock crea el directorio gratis. Aun así hacerlo explícito: en el path fail-open de D-03 el lock puede no haberse tomado.
**Señales de alarma:** `kodo capture` falla en una máquina limpia y funciona tras el primer `kodo config`.

### Pitfall 10: U+2028 / U+2029 sobreviven al saneo

**Qué sale mal:** verificado en esta sesión: `stripForKeystroke` elimina C0, C1, DEL, CSI y U+0085 (NEL), pero **U+2028 (LINE SEPARATOR), U+2029 (PARAGRAPH SEPARATOR), U+00A0 (NBSP) y U+200B (ZWSP) sobreviven**.
**Impacto real: BAJO.** También verificado: una cadena con U+2028 embebido pasa `.split('\n')` como UNA sola línea — la integridad de línea del fichero **no** se rompe, porque el codec parte por `\n`. El efecto se limita a que algunos renderers de markdown pinten un salto visual.
**Cómo evitarlo:** no bloquear la fase por esto. Si se quiere cerrar, añadir en `encodeLine` un `.replace(/[\u2028\u2029]/g, ' ')` — NO en `stripForKeystroke`, que es compartido con el carril keystroke y tiene goldens byte-idénticos que no conviene mover en esta fase.

> Nota de higiene documental: en este fichero los caracteres invisibles se escriben SIEMPRE en notación de escape (`\u2028`), nunca literales — un documento de research con invisibles embebidos dispara los detectores de inyección del pipeline.

---

## Code Examples

### Prueba empírica de atomicidad `O_APPEND` (ejecutada en esta sesión)

```js
// appender.mjs — N procesos, barrier file, 50 appends cada uno
import { appendFileSync, existsSync } from 'node:fs';
const [,, file, barrier, idx, lenStr] = process.argv;
const sab = new Int32Array(new SharedArrayBuffer(4));
while (!existsSync(barrier)) Atomics.wait(sab, 0, 0, 1);   // barrier spin
const pad = 'x'.repeat(Math.max(0, Number(lenStr) - 20));
for (let i = 0; i < 50; i++) appendFileSync(file, `- [ ] ${idx}-${i} ${pad}\n`);
```

**Resultados (Node v22.22.3, APFS local, macOS Darwin 25.5.0):** [VERIFIED: ejecutado en esta sesión]

| Longitud de línea | Procesos | Esperadas | Obtenidas | Únicas | Partidas |
|-------------------|----------|-----------|-----------|--------|----------|
| 100 B | 12 | 600 | 600 | 600 | **0** |
| 4090 B | 12 | 600 | 600 | 600 | **0** |
| 8200 B | 12 | 600 | 600 | 600 | **0** |
| 65600 B | 8 | 400 | 400 | 400 | **0** |
| 200000 B | 6 | 300 | 300 | 300 | **0** |

Detección de líneas partidas: `grep -cvE '^- \[ \] [0-9]+-[0-9]+ x*$'`. La premisa de CAPT-01 y de D-02/D-03 queda confirmada en el entorno real de desarrollo.

### Parser anclado a la cola (D-08) — validado contra 15 vectores

```js
/**
 * Gramática de la línea (D-05, D-08):
 *   - [ ] <id> · <texto> · <tag> · <YYYY-MM-DD> · <origen>
 *   - [x] <id> · <texto> · <tag> · <YYYY-MM-DD> · <origen> · enrutada[ → <dest>]
 *   - [x] <id> · <texto> · <tag> · <YYYY-MM-DD> · <origen> · descartada
 *
 * El `(.+)` del texto es GREEDY: empuja las anclas al match más a la DERECHA,
 * que es exactamente la semántica «anclado a la cola» de D-08. La fecha
 * `\d{4}-\d{2}-\d{2}` es el ancla desambiguadora; `[^·]*` en tag/origen exige
 * que esos campos NO contengan el separador (ver Pitfall 4).
 */
const LINE_RE =
  /^- \[([ x])\] ([0-9a-z]+) · (.+) · ([^·]*) · (\d{4}-\d{2}-\d{2}) · ([^·]*?)(?: · (enrutada|descartada)(?: → (.*))?)?$/;
```

**Vectores verificados en esta sesión (todos correctos):**

| Vector | Resultado |
|--------|-----------|
| `- [ ] a3f9k2 · el texto de la idea · kodo · 2026-07-25 · cli` | abierta, texto íntegro |
| `- [x] a3f9k2 · el texto · kodo · 2026-07-25 · cli · enrutada → .planning/todos/TODO-012.md` | cerrada, `dest` correcto |
| `- [x] b7c1m0 · otra idea · ROMAN · 2026-07-25 · cli · enrutada` | cerrada, `dest: null` (CAPT-06 best-effort) |
| `- [x] c4d8n5 · idea que no va · kodo · 2026-07-25 · cli · descartada` | cerrada, descartada |
| texto **con** ` · ` embebidos | `text: "idea · con · separadores"` — verbatim |
| **FORGERY**: texto = `idea falsa · kodo · 2026-07-25 · cli · descartada` | tag/fecha/origen reales ganan; el forgery queda dentro del texto |
| **FORGERY**: fecha falsa en el texto (`nota del 2026-01-01 · x · y`) | ancla la fecha real (la de más a la derecha) |
| texto que **termina** en `descartada` | no se confunde con el sufijo de estado |
| `--dest` con ` · ` dentro (`a · b · c`) | `dest: "a · b · c"` completo |
| línea hand-written (`esto lo escribi a mano`), heading (`## Notas`), fecha inválida (`ayer`), línea vacía | NO-MATCH → excluida del listado, **preservada en disco** (D-18) |

**Sonda ReDoS:** línea de 80 038 B que matchea → 0,0 ms; línea de 80 019 B que NO matchea (peor caso de backtracking) → **0,4 ms**. Sin backtracking catastrófico. [VERIFIED: ejecutado en esta sesión]

### Captura con fail-open (D-03)

```js
/**
 * Appendea una captura. `O_APPEND` garantiza N→N por sí solo; el lock protege
 * además contra el RMW del marcado. Fail-open ante lock-timeout (D-03): una
 * idea perdida es peor que una línea escrita sin coordinación.
 *
 * @param {string} line - línea completa ya codificada, terminada en '\n'
 * @param {{ inboxPath: string, lockPath: string, warnFn?: (s:string)=>void }} o
 * @returns {{ ok: true, coordinated: boolean }}
 */
export function appendCapture(line, o) {
  mkdirSync(dirname(o.inboxPath), { recursive: true });   // fuera de la sección crítica
  const r = withFileLock(o.lockPath, () => {
    appendFileSync(o.inboxPath, line);                     // flag 'a' por defecto = O_APPEND
  });
  if (r.ok) return { ok: true, coordinated: true };

  // D-03 fail-open: el presupuesto (8 × 20 ms ≈ 160 ms) se agotó. Appendeamos igual.
  // Riesgo residual ACEPTADO y documentado: solo se pierde si además coincide con la
  // ventana read→rename de un marcado concurrente (orden de ms).
  appendFileSync(o.inboxPath, line);
  (o.warnFn || ((s) => process.stderr.write(s)))(
    '[kodo:inbox] lock-timeout — captura appendeada sin coordinación (fail-open)\n',
  );
  return { ok: true, coordinated: false };
}
```

**Nota:** `withFileLock` ya emite su propio `console.warn('[kodo:lock] lock.timeout …')` cuando no se le inyecta `opts.logger.warn` (`state-lock.js:217-223`). Para no duplicar ruido en stderr, inyectar `{ logger: { warn: () => {} } }` y emitir el mensaje de inbox una sola vez, o al revés — decidir explícitamente en el plan.

### ID corto opaco (D-06, Claude's Discretion)

```js
/**
 * ID corto opaco de 6 chars base36. `randomBytes(6)` da 2^48; `.toString(36)`
 * ~10 chars; `.slice(-6)` toma los dígitos de MENOR peso (uniformes; el sesgo
 * por 2^48 mod 36^6 es ~1e-5, despreciable). `.slice(0,6)` sería SESGADO.
 *
 * Espacio: 36^6 ≈ 2.18e9. Colisión (birthday) a 1000 capturas ≈ 0.023 %.
 * Comparativa medida: hex de 6 chars (16^6 ≈ 1.7e7) da ≈ 2.98 % — 130× peor.
 *
 * @returns {string} 6 chars de [0-9a-z]
 */
export function newCaptureId() {
  return randomBytes(6).readUIntBE(0, 6).toString(36).padStart(6, '0').slice(-6);
}
```

**Contrato con el parser:** `([0-9a-z]+)` — cualquier longitud casa, así que subir a 7-8 chars en el futuro no rompe las líneas ya escritas. **Colisión al marcar:** si dos capturas comparten ID, `markCapture` marca la primera. Recomendación: aceptarlo (probabilidad medida) y documentarlo, o hacer que la captura reintente si el ID ya existe en el fichero (coste: una lectura completa por captura — contradice «capture is instantaneous and dumb»). El planner debe elegir.

### Test de concurrencia — escenario mixto (D-21.2, el que justifica D-01)

```js
// test/inbox-concurrency.test.js — molde: test/gsd-lock-race.test.js
//
// Escenario 2 (CAPT-03 crit 3, el invariante literal): un marcado en curso +
// N capturas concurrentes → las N capturas sobreviven al RMW.
//
// Cómo forzar la ventana de forma determinista: el child `mark` inyecta un
// `holdMs` DENTRO de la sección crítica, entre la lectura fresca y el rename
// (vía una var de entorno que store.js lee SOLO en test, o mejor: vía DI de un
// hook `_afterReadFn` en markCapture — preferible, cero código de test en prod).
// Los children `capture` esperan el barrier y appendean durante ese hold.
//
// Aserción sobre el AGREGADO, nunca sobre quién gana:
//   - el fichero final contiene las N líneas de captura (0 pérdidas)
//   - + la línea marcada, con su estado
//   - + toda línea pre-existente, BYTE A BYTE (D-04)
```

**Extender `test/helpers/lock-race-child.mjs`** con dos `--kind` nuevos (`capture`, `mark`) en vez de crear un helper nuevo: ya resuelve barrier, spin bounded, never-throws y la disciplina de import dinámico POST-HOME. Seis fases lo comparten; el header del fichero lista los consumidores y debe actualizarse.

### Seam de enrutado — copy documental (CAPT-04, D-09)

`gsd-capture` es un **skill de Claude Code**, no un binario. Su `SKILL.md` [VERIFIED: `~/.claude/skills/gsd-capture/SKILL.md` leído] declara `allowed-tools: Read, Write, Edit, Bash, Glob, Grep, AskUserQuestion` y enruta por flag:

| Flag | Destino | Ref típica para `--dest` |
|------|---------|--------------------------|
| (ninguno) | Todo estructurado en `.planning/todos/` | `.planning/todos/TODO-012.md` |
| `--note` | Fichero de nota timestamped | `.planning/notes/2026-07-25-idea.md` |
| `--backlog` | Sección backlog de `ROADMAP.md` (numeración 999.x) | `999.4` |
| `--seed` | `.planning/seeds/SEED-NNN-slug.md` | `SEED-012` |

No devuelve valor máquina-legible por ningún canal — confirma D-09 y D-10 (`--dest` opcional y no validado). Flujo a documentar en README + `.claude/skills/kodo-orchestrate/`:

```
1. kodo inbox                          → lista abiertas con su <id>
2. /gsd-capture …                      → el operador/LLM enruta (kodo NO participa)
3. kodo inbox route <id> --dest <ref>  → marca enrutada + trace pointer (si hay ref)
   kodo inbox route <id>               → marca enrutada sin destino (best-effort, CAPT-06)
   kodo inbox discard <id>             → marca descartada
```

---

## State of the Art

| Enfoque anterior | Enfoque actual | Cuándo cambió | Impacto en esta fase |
|------------------|----------------|---------------|----------------------|
| `writeFileAtomic` con tmp de nombre fijo para todo writer | unique-tmp-name + rename para writers concurrentes | Phase 74 (fix WR-02) | El template a clonar es `session-end.js:378-386`, no `config.js:135` |
| `stripControlChars` como saneador universal | Dos carriles: render (`stripControlChars`, preserva `\n`) vs keystroke (`stripForKeystroke`, los colapsa) | Phase 78 (WR-02) | CAPT-01 exige el carril **keystroke** al escribir; el render del listado necesita el de **render** |
| `stealLock` con ventana move-aside→`O_EXCL` | steal-guard publicado atómicamente vía `linkSync` | Phase 82 (esta misma milestone) | Ajeno: es `src/gsd/lock.js`. El inbox usa `withFileLock` (`state-lock.js`), que ya tenía CAS + guarda ABA |
| Mutadores de `state.json` con load→mutate→save fuera de lock | Todo mutador funnel a `withStateLock` con re-lectura fresca **dentro** del lock | Phase 70 (CONC-01, D-02) | El orden «lock → leer fresco → mutar → escribir» es el patrón obligatorio de `markCapture` |
| `kodo skill sync` single-skill (`kodo-orchestrate`) | Generalización multi-skill | **Phase 84** (CAPT-05) | Fuera de boundary. No adelantar |

**Deprecado / no usar:**
- `src/gsd/lock.js` para cualquier cosa del inbox — es el lock GSD por repo, con su propia carrera de 2º orden abierta (R-82-01). Prohibido explícitamente por ROADMAP, CONTEXT y STATE.
- `writeFileAtomic` para paths del inbox — ver §CONFLICTO.
- `ANSI_*` / `COLOR_BY_LEVEL` exportados desde `logger.js` — retirados en Phase 22; `test/format-isolation.test.js` lo asserta.

---

## Project Constraints (from CLAUDE.md)

**No existe `./CLAUDE.md` ni `./.claude/CLAUDE.md` en este repo** (verificado). Las restricciones de proyecto vienen de `.planning/codebase/CONVENTIONS.md` y de `STATE.md` §Critical Invariants:

**Convenciones de código (`.planning/codebase/CONVENTIONS.md`):**
- `// @ts-check` en la primera línea de todo fichero fuente.
- JSDoc con `@param`/`@returns` en todo export; `@typedef` para shapes.
- Ficheros en kebab-case; funciones en camelCase; constantes de path en UPPERCASE.
- Todos los imports llevan extensión `.js` explícita (ESM puro).
- Orden de imports: built-ins `node:*` → externos → relativos.
- Sin barrel files.
- 2 espacios de indentación.
- Prefijos de log `[kodo:*]`.
- No hay linter configurado; el type-check es JSDoc vía `// @ts-check`.

**Invariantes cross-milestone aplicables (`STATE.md:93-107`):**
- Cero endpoints nuevos en `src/server.js`. · Cero deps npm nuevas.
- Color isolation: `picocolors` solo desde `src/cli/format.js`.
- `--json` byte-determinista (DX-06).
- Escritura no corruptiva (temp+rename atómico).
- Contenido no confiable hacia terminal/keystroke SIEMPRE saneado.
- **Lock del inbox:** `withFileLock`, nunca `src/gsd/lock.js`; appends `O_APPEND`; rewrites unique-tmp-name + rename, **jamás `writeFileAtomic`**.

---

## Environment Availability

| Dependencia | Requerida por | Disponible | Versión | Fallback |
|-------------|---------------|------------|---------|----------|
| Node.js | Todo | ✓ | v22.22.3 (`engines: >=20`) | — |
| `node:fs` (`appendFileSync`, `renameSync`, `mkdirSync`) | Append + RMW | ✓ | built-in | — |
| `node:crypto` (`randomBytes`, `randomUUID`) | ID corto + tmp único | ✓ | built-in | — |
| `node:test` + `node:assert/strict` | Suite (175 ficheros) | ✓ | built-in | — |
| `node:child_process` (`spawn`) | Tests de carrera (D-21) | ✓ | built-in | — |
| `SharedArrayBuffer` + `Atomics.wait` | Sleep síncrono / barrier | ✓ | built-in (ya usado en `state-lock.js:47`) | — |
| `commander` | Registro de subcomandos | ✓ | 13.1.0 (instalado) | — |
| `picocolors` (vía `createFormatter`) | Render human | ✓ | ^1.1.1 (instalado) | `NO_COLOR` / no-TTY → sin ANSI |
| Filesystem local en `~/.kodo` | Atomicidad `O_APPEND` | ✓ | APFS (`/dev/disk3s1s1`, local, journaled) | **Ninguno sobre NFS** — documentar la premisa |
| `gsd-capture` (skill) | Seam documental (CAPT-04) | ✓ | `~/.claude/skills/gsd-capture/SKILL.md` | No es dependencia de runtime: el seam es documental (D-09), kodo nunca lo invoca |

**Dependencias ausentes sin fallback:** ninguna.
**Dependencias ausentes con fallback:** ninguna.

---

## Validation Architecture

### Test Framework

| Propiedad | Valor |
|-----------|-------|
| Framework | `node:test` (built-in, Node v22.22.3) + `node:assert/strict` |
| Fichero de config | Ninguno — sin `jest.config`/`vitest.config`; el runner es el built-in |
| Comando de run rápido | `node --test test/inbox-store.test.js test/inbox-format-golden.test.js` |
| Comando de suite completa | `npm test` (= `node --test $(find test -name '*.test.js' -type f)`, 175 ficheros hoy) |
| Comando del carril lento | `node --test test/inbox-concurrency.test.js` (procesos reales — segundos, no ms) |

### Phase Requirements → Test Map

| Req | Comportamiento | Tipo | Comando automatizado | ¿Existe? |
|-----|----------------|------|----------------------|----------|
| CAPT-01 | N capturas concurrentes → exactamente N líneas, 0 pérdidas (D-21.1) | integration multi-proceso | `node --test test/inbox-concurrency.test.js` | ❌ Wave 0 |
| CAPT-01 | `stripForKeystroke` colapsa `\n`/`\t`/escapes literales → la línea escrita nunca contiene `\n` interior | unit | `node --test test/inbox-store.test.js` | ❌ Wave 0 |
| CAPT-01 | Texto vacío / solo whitespace tras saneo → exit code determinista, no escribe (Pitfall 8) | integration CLI | `node --test test/inbox-cli.test.js` | ❌ Wave 0 |
| CAPT-01 | Primer run en `HOME` limpio crea `~/.kodo/` + `inbox.md` sin cabecera (D-19) y no lanza | integration CLI (sandbox HOME) | `node --test test/inbox-cli.test.js` | ❌ Wave 0 |
| CAPT-03 | `kodo inbox` lista solo abiertas; `--all` incluye cerradas | integration CLI | `node --test test/inbox-cli.test.js` | ❌ Wave 0 |
| CAPT-03 | `route`/`discard` marcan sin borrar — la línea sigue en el fichero con su estado | unit + integration | `node --test test/inbox-store.test.js` | ❌ Wave 0 |
| CAPT-03 | **Captura concurrente DURANTE el marcado sobrevive al RMW** (D-21.2 — el invariante literal de crit 3) | integration multi-proceso | `node --test test/inbox-concurrency.test.js` | ❌ Wave 0 |
| CAPT-03 | Toda línea no marcada se preserva BYTE A BYTE, incluidas las que no parsean (D-04/D-18) | unit (fixture con basura + hand-edits + línea vacía + sin newline final) | `node --test test/inbox-store.test.js` | ❌ Wave 0 |
| CAPT-03 | Fichero ausente → listado vacío, never-throws (D-18) | unit | `node --test test/inbox-store.test.js` | ❌ Wave 0 |
| CAPT-03 | `route`/`discard` sobre id inexistente o ya cerrada → exit 2 (D-13) | integration CLI | `node --test test/inbox-cli.test.js` | ❌ Wave 0 |
| CAPT-04 | El código de kodo NO importa ni ejecuta `gsd-capture` (seam documental) | source-hygiene | `node --test test/inbox-cli.test.js` (grep sobre `src/inbox/` + `src/cli/{capture,inbox}.js`: sin `gsd-capture`, sin `spawn`/`exec`) | ❌ Wave 0 |
| CAPT-06 | `route --dest <ref>` → `· enrutada → <ref>`; `route` sin `--dest` → `· enrutada` y **no falla** | unit + golden | `node --test test/inbox-format-golden.test.js` | ❌ Wave 0 |
| CAPT-06 | Parser tail-anchored: texto con ` · `, forgery de cola, `--dest` con ` · ` | unit (tabla de vectores de §Code Examples) | `node --test test/inbox-store.test.js` | ❌ Wave 0 |
| D-22 | **Golden byte-exacto de la línea** con clock e id inyectados — referencia para Phase 84 | golden | `node --test test/inbox-format-golden.test.js` | ❌ Wave 0 |
| Cross | `src/inbox/**` y los handlers CLI no importan `picocolors` | source-hygiene (ya automático) | `node --test test/format-isolation.test.js` | ✅ existe (walker sobre todo `src/`) |
| Cross | `--json` byte-determinista, sin ANSI (DX-06) | integration CLI | `node --test test/inbox-cli.test.js` | ❌ Wave 0 |
| Cross | `package.json` `dependencies` sin claves nuevas (invariante cero-deps) | source-hygiene | `node --test test/inbox-cli.test.js` | ❌ Wave 0 |

### Sampling Rate

- **Por commit de tarea:** `node --test test/inbox-store.test.js test/inbox-format-golden.test.js` (unitarios + golden, sub-segundo).
- **Por merge de wave:** `npm test` completa.
- **Gate de fase:** `npm test` verde **incluyendo** `test/inbox-concurrency.test.js`, más una corrida repetida del escenario mixto (precedente Phase 82: *«100/100 bajo carga 4×»*) antes de `/gsd-verify-work`. Una carrera que pasa una vez no prueba nada.

### Wave 0 Gaps

- [ ] `test/inbox-store.test.js` — unit del codec/parser/list/mark con DI de paths (sin tocar `HOME`) — cubre CAPT-01, CAPT-03, CAPT-06
- [ ] `test/inbox-format-golden.test.js` — D-22, contrato inter-fase con Phase 84 — cubre CAPT-01, CAPT-06
- [ ] `test/inbox-cli.test.js` — integration `spawnSync bin/kodo` con `HOME` sandbox: exit codes 0/1/2, `--json` determinista, source-hygiene — cubre CAPT-03, CAPT-04
- [ ] `test/inbox-concurrency.test.js` — D-21 escenarios 1 y 2 con procesos reales + barrier — cubre CAPT-01, CAPT-03
- [ ] `test/helpers/lock-race-child.mjs` — **extender** con `--kind capture` y `--kind mark` (import dinámico POST-HOME obligatorio) + actualizar el header con los nuevos consumidores
- [ ] Instalación de framework: **ninguna** — `node:test` es built-in y `npm test` ya está cableado

---

## Security Domain

### Applicable ASVS Categories

| Categoría ASVS | Aplica | Control estándar |
|----------------|--------|------------------|
| V2 Authentication | no | Superficie CLI local, sin identidad |
| V3 Session Management | no | Sin sesiones |
| V4 Access Control | parcial | Permisos por umask (D-20); el inbox no es secreto. El `0600` sigue reservado a `~/.kodo/.env` (boundary PERSIST-04) |
| **V5 Input Validation** | **sí** | `stripForKeystroke` al escribir (texto y `--dest`) + `stripControlChars` al renderizar; validación de texto no vacío; cota de longitud; los campos estructurados nunca contienen el separador |
| V6 Cryptography | parcial | `randomBytes`/`randomUUID` de `node:crypto` (CSPRNG). **Nunca `Math.random`** para el ID ni para el sufijo del tmp |
| V7 Error Handling / Logging | sí | Reader leaf never-throws (D-18); mensajes de error canónicos a stderr; el warn de fail-open (D-03) debe ser visible, no swallowed |
| V12 File & Resources | sí | El path del inbox es **construido**, jamás derivado de input; el `<id>` se usa para *matchear una línea*, nunca para componer un path; unique-tmp + rename intra-fs; `rmSync` del tmp en el `catch` |
| V13 API / Web Service | no | Cero endpoints nuevos (invariante) |

### Known Threat Patterns

| Patrón | STRIDE | Mitigación estándar |
|--------|--------|---------------------|
| Inyección de escapes de terminal (OSC-52 → portapapeles, CSI → reescritura de pantalla) en el texto capturado | Tampering | `stripForKeystroke` en escritura **+ `stripControlChars` en render** — write-only no basta porque el fichero es human-editable (Pitfall 6) |
| Forgery de los campos estructurados desde el texto del usuario (imitar ` · tag · fecha · origen · descartada`) | Spoofing | Parseo anclado a la cola con ancla de fecha `\d{4}-\d{2}-\d{2}` (D-08) — **verificado contra 2 vectores de forgery en esta sesión** |
| ReDoS en el parser sobre una línea patológica (fichero human-editable, sin cota de tamaño) | DoS | Regex sin nesting de cuantificadores; **medido: 0,4 ms sobre 80 KB sin match**. Precedente del repo: `applyFilter`/`grepLogs` nunca compilan regex desde input (T-36-01) |
| Path traversal vía `<id>` o `--dest` | Tampering | El `<id>` nunca se usa para componer un path (solo para matchear líneas); `--dest` es texto opaco que kodo no interpreta ni resuelve (D-11) |
| Lost update: captura concurrente clobbereada por el RMW del marcado | Tampering / DoS (pérdida de datos) | `withFileLock` compartido (D-01) + lectura fresca dentro del lock + unique-tmp; **probado por D-21.2** |
| Fuga de secretos al inbox | Information Disclosure | El inbox es umask por diseño (D-20). **No** reutilizar el heurístico `*_secret` de `writeFileAtomic` — su falso positivo chmodearía el fichero a 0600 contra D-20 (ver §CONFLICTO) |
| Contaminación del `~/.kodo` real desde los tests | Tampering | DI de paths + `HOME` sandbox + import dinámico POST-HOME (Pitfall 5) |

---

## Assumptions Log

| # | Claim | Sección | Riesgo si es falso |
|---|-------|---------|--------------------|
| A1 | La atomicidad `O_APPEND` medida en APFS/macOS se mantiene en ext4/Linux para líneas cortas | Pitfall 1, Code Examples | BAJO — la garantía POSIX es del kernel, no del FS, y `PIPE_BUF`(4096) es cota inferior universal. Se midió muy por encima. Sobre NFS **sí** falla, pero `~/.kodo` es local |
| A2 | `- [x]` sin sufijo de estado debe tratarse como «cerrada, cierre desconocido» y `route`/`discard` devolver exit 2 | Pitfall 7 | MEDIO — es una interpretación de D-05, no una decisión registrada. Elegir la contraria (marcable) también es defendible. **Requiere confirmación del planner** |
| A3 | El texto vacío tras saneo debe salir con exit 2 (no 1) | Pitfall 8 | BAJO — D-13 no cubre el caso; cualquiera de los dos es coherente. **Requiere decisión del planner** |
| A4 | Una colisión de ID corto es aceptable a la probabilidad medida (0,02 % a 1000 capturas con base36×6) y no exige reintento en la captura | Code Examples | BAJO — la alternativa (leer el fichero entero en cada captura para verificar unicidad) contradice «capture is instantaneous and dumb». **Requiere confirmación del planner** |
| A5 | El marcado **no** hace fail-open ante `lock-timeout` (a diferencia de la captura) y devuelve exit 1 | Pattern 2 | MEDIO — D-03 solo habla de la captura. Un marcado fail-open reintroduciría exactamente la carrera que D-01 cierra, así que la asimetría parece intencionada — pero **no está escrita**. Confirmar |
| A6 | La cota de longitud del texto (≈1000 chars) es la magnitud correcta | Pitfall 1 | BAJO — cualquier valor entre 500 y 4000 sirve; es Claude's Discretion de facto |
| A7 | Extender `lock-race-child.mjs` es preferible a crear un helper nuevo | Code Examples | BAJO — decisión de estilo; el fichero ya sirve a 6 fases |
| A8 | El sufijo de estado en español (`enrutada`/`descartada`) es literal en el fichero, no localizable | Codec | BAJO — así aparece en los ejemplos de D-05 |

---

## Open Questions (TODAS RESUELTAS — 2026-07-25)

> **Las 7 quedaron cerradas en plan-phase.** #1 en `83-CONTEXT.md` D-04 (enmienda post-research,
> commit `ce8257c`); #2–#7 en `83-01-PLAN.md` §Contract decisions, cada una con criterio de
> aceptación testable y referenciada desde `83-02` y `83-03`. Resoluciones abajo, inline.
> **No re-arbitrar ninguna.**

1. **`writeFileAtomic` (D-04) vs unique-tmp-name (`STATE.md:100`) — ¿cuál gana?** — **RESUELTA: unique-tmp-name.** `83-CONTEXT.md` D-04 enmendado; blindado por construcción (`store.js` no importa `config.js`, con gate `grep`).
   - Lo que sabemos: las dos fuentes se contradicen literalmente; el research del milestone y el comentario del fix WR-02 en el propio repo respaldan unique-tmp; el invariante de `STATE.md` es cross-milestone (autoridad superior a una decisión de fase).
   - Lo que no está claro: si D-04 citó `writeFileAtomic` como *mecanismo* o solo como *referencia semántica* de «temp+rename intra-fs».
   - Recomendación: **conservar la semántica de D-04, cambiar el mecanismo a unique-tmp local al módulo.** Registrarlo como enmienda explícita en el PLAN (no dejarlo al ejecutor). Si el mantenedor prefiere D-04 literal, hay que enmendar `STATE.md:100` — no ignorarlo en silencio.

2. **[RESUELTA — `{open:false, estado:null}`; `route`/`discard` → `already-closed` exit 2, sin reescribir la línea]** **Semántica de `- [x]` sin sufijo (hand-edit).** Ver A2. Afecta a `parseLine`, al listado y a los exit codes. Decidir y testear.

3. **[RESUELTA — NO: exit 1, fichero intacto; asimetría deliberada frente a D-03, escrita en el código]** **¿Hace fail-open el marcado ante `lock-timeout`?** Ver A5. Recomendación: **no** (exit 1 + stderr). Registrarlo.

4. **[RESUELTA — exit 2, cero escritura]** **Exit code del texto vacío.** Ver A3. D-13 no lo cubre.

5. **[RESUELTA — sin reintento; gana la primera línea que casa (~0,023 % a 1000 capturas)]** **¿Reintenta la captura ante colisión de ID?** Ver A4. Recomendación: no reintentar, documentar la probabilidad.

6. **[RESUELTA — warn único: `withFileLock` recibe `{logger:{warn:()=>{}}}`; el mensaje accionable lo emite `appendCapture`]** **Doble warn en el fail-open de D-03.** `withFileLock` ya emite `console.warn('[kodo:lock] lock.timeout …')` salvo que se le inyecte `opts.logger.warn`. Decidir si se silencia el del lock y se emite solo el de inbox (recomendado: sí, mensaje único y accionable).

7. **[RESUELTA — en `src/inbox/store.js`, como resolvedor perezoso `defaultInboxPaths()`, nunca constante de módulo (cierra además el Pitfall 5)]** **¿Se exporta `INBOX_PATH` desde `src/config.js` o vive en `src/inbox/store.js`?** El research del milestone proponía `config.js`; CONTEXT lo deja en Claude's Discretion. Recomendación: **en `src/inbox/store.js`**, para no ampliar la superficie de `config.js` (que es el módulo con la fuga de aislamiento de `KODO_DIR`) y para mantener el DI limpio.

---

## Sources

### Primary (HIGH confidence — código leído en pleno en esta sesión)
- `src/session/state-lock.js:1-231` — `acquireLock` (CAS steal + guarda ABA, defaults 8×20 ms, TTL 10 s, `mkdirSync` del dirname), `releaseLock` (ownership-checked por token), `withFileLock` (never-throws, release en `finally`)
- `src/hooks/session-end.js:315-400` — template canónico lock + RMW + unique-tmp + rename, **con el comentario que descalifica `writeFileAtomic` incluso bajo lock** (T-74-14)
- `src/config.js:90-175,615` — `ensureDir` (privado, no exportado), `writeFileAtomic` (tmp fijo + heurístico `*_secret`), exports de `KODO_DIR`
- `src/cli/format.js:56-178` — `visibleWidth`, `stripControlChars`, `stripForKeystroke`, `createFormatter`
- `src/cli/dashboard/select.js:380-447` — `resolveProjectId`; **cero imports** (verificado por grep)
- `src/cli/skill-sync.js` (completo) — thin CLI handler canónico: gate → delegar → render → return code, con DI de `writeFn`/`errFn`/`formatterFn`
- `src/cli.js:402-522` — molde de registro commander de `doctor`/`gsd`/`sidebar`/`skill`, con `await import()` lazy y sin `ensureConfig()`
- `src/logger.js:300-340` — `appendFileSync` como sink append-only en producción
- `test/gsd-lock-race.test.js` + `test/helpers/lock-race-child.mjs` — molde de carrera con procesos reales + barrier; **advertencia explícita del import dinámico POST-HOME**
- `test/format-isolation.test.js` — walker transitivo de imports; asserta `picocolors` solo desde `format.js`
- `test/state/state-writers-concurrency.test.js:1-60` — patrón de aislamiento de `HOME` para tests concurrentes
- `package.json` — 4 deps, `node:test` como runner, `engines: >=20`
- `~/.claude/skills/gsd-capture/SKILL.md` — confirma D-09 (skill LLM sin contrato de retorno) y enumera los destinos reales

### Primary (HIGH confidence — verificación empírica ejecutada en esta sesión)
- Carrera `O_APPEND`: 12 procesos × 50 appends × 5 longitudes (100 B → 200 KB) → 0 pérdidas, 0 líneas partidas
- commander 13.1.0: comando padre con `.action()` + subcomandos → 6 formas de invocación resueltas correctamente
- `stripForKeystroke` sobre 15 vectores (newline real/literal, tab, CR, CSI, OSC-52, `·`, U+2028/2029/0085/200B/00A0, vacío, whitespace, no-string)
- Parser tail-anchored sobre 15 vectores incluidos 2 forgeries + sonda ReDoS de 80 KB (0,4 ms)
- Entropía de ID: base36×6 → 0,023 % de colisión a 1000 items vs. hex6 → 2,98 %

### Primary (HIGH confidence — documentos de planificación del proyecto)
- `.planning/STATE.md:93-107` — §Critical Invariants to Preserve, incluida la línea 100 del lock del inbox
- `.planning/REQUIREMENTS.md` — CAPT-01/03/04/06 literales, §Out of Scope (9 exclusiones), §v2 (CAPT-F1/F2)
- `.planning/research/SUMMARY.md` (169 líneas) + `PITFALLS.md` — research del milestone, con la descalificación de `writeFileAtomic` y las premisas de `O_APPEND`
- `.planning/codebase/CONVENTIONS.md` — convenciones de naming, estilo, imports y error handling
- `.planning/phases/83-inbox-foundation-captura-triage/83-CONTEXT.md` — D-01..D-22

### Secondary (MEDIUM confidence)
- Semántica POSIX de `O_APPEND` para appends concurrentes (conocimiento general de sistemas, **corroborado empíricamente** en esta sesión para el entorno objetivo)
- No-atomicidad de `O_APPEND` sobre NFS [CITED: `.planning/research/PITFALLS.md:18`] — no verificable en este entorno; irrelevante para `~/.kodo` local

### Tertiary (LOW confidence)
- Ninguna. No se usó WebSearch: la fase no tiene superficie externa (cero deps, cero API), así que toda la evidencia es del repo o de medición directa.

---

## Metadata

**Confidence breakdown:**

| Área | Nivel | Razón |
|------|-------|-------|
| Standard stack | **HIGH** | Cero paquetes externos; cada primitiva citada con fichero:línea leído en pleno; versiones instaladas verificadas en `node_modules` |
| Arquitectura | **HIGH** | El patrón (pure core + thin CLI) es el del repo, con dos implementaciones de referencia leídas completas (`skill-sync.js` → `sync.js`, `session-end.js`) |
| Concurrencia | **HIGH** | Verificada empíricamente con procesos reales en el entorno objetivo, no asumida; los dos modos de fallo (tmp fijo bajo lock robado, RMW vs append) están documentados en el propio repo con su fix |
| Codec / parser | **HIGH** | Regex concreta ejecutada contra 15 vectores incluidos forgeries y sonda ReDoS |
| Pitfalls | **HIGH** | 8 de 10 verificados por ejecución o por lectura de código; los 2 restantes (NFS, colisión de ID) son cálculo cerrado o cita del research del milestone |
| Decisiones abiertas | **MEDIUM** | 7 preguntas abiertas, todas de contrato (no de mecanismo). La #1 (conflicto `writeFileAtomic`) es bloqueante para el plan |

**Research date:** 2026-07-25
**Valid until:** ~2026-08-24 (30 días — dominio estable: built-ins de Node y código propio del repo; el único vector de caducidad es que el repo cambie `state-lock.js`, `format.js` o `select.js`)

---

*Phase: 83-Inbox foundation — captura + triage*
