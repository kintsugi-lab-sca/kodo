---
phase: 83-inbox-foundation-captura-triage
verified: 2026-07-25T18:50:00Z
status: passed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification:
  previous_status: gaps_found
  previous_score: 4/5
  gaps_closed:
    - "Una captura concurrente durante el marcado nunca se pierde (GAP-1 / CR-02 / CAPT-03 crit 3)"
    - "`kodo inbox --json` emite una única línea de JSON parseable, sin truncar en un pipe (GAP-2 / CR-01 / DX-06)"
    - "El tag-proyecto comunica al operador a qué proyecto pertenece la captura (GAP-3 / CR-03, CAPT-01 D-15)"
  gaps_remaining: []
  regressions: []
deferred: []
---

# Phase 83: Inbox foundation — captura + triage Verification Report

**Phase Goal:** kodo gana su primer buffer de captura global — `kodo capture "idea"` appendea una línea atómica a `~/.kodo/inbox.md` y `kodo inbox` lista y marca capturas (`enrutada`/`descartada`) sin borrarlas jamás. Aquí se concentra el riesgo de concurrencia: el modelo de estado se decide explícitamente antes de construir cualquier consumidor.
**Verified:** 2026-07-25T18:50:00Z
**Status:** passed
**Re-verification:** Sí — tras cierre de gaps (planes 83-04..83-07)

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria, CAPT-01/03/04/06)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `kodo capture "idea"` appendea `texto·tag·fecha·origen`; N capturas concurrentes → N líneas sin pérdidas (append atómico O_APPEND); texto saneado a una sola línea (CAPT-01) | ✓ VERIFIED | Sin cambios desde la verificación anterior. `appendFileSync` de una sola llamada; `test/inbox-concurrency.test.js` escenario 1 (8 hijos → 8 líneas) verde, corrido de nuevo por este verificador (`node --test test/inbox-concurrency.test.js` → 3/3 pass, incluido escenario 1) |
| 2 | `kodo inbox` lista abiertas y marca `enrutada`/`descartada` sin borrar jamás (CAPT-03) | ✓ VERIFIED | Sin cambios. `markCapture` sigue haciendo RMW in-place, nunca borra del array; `test/inbox-store.test.js`/`test/inbox-cli.test.js` en verde |
| 3 | **Una captura concurrente durante el marcado nunca se pierde** (CAPT-03 crit 3) — GAP-1, antes ✗ FAILED | ✓ **VERIFIED** | Reproducido de forma INDEPENDIENTE por este verificador con el harness del repo, sandbox HOME, 1 `mark --hold 1500` + 6 `capture`: **7/7 procesos `written`, exit 0; el inbox final contiene la línea marcada MÁS las 6 líneas concurrentes — 6 de 6 supervivientes**, repetido en 3 iteraciones sin excepción (antes: 0/6). Además se neutralizó a mano el guard (`changed = false` forzado) y se repitió la misma reproducción: con el guard neutralizado se pierden capturas de nuevo (0/6 y 4/6 en dos corridas) — la prueba MUERDE en ambos sentidos, no es un caso ciego. `test/inbox-concurrency.test.js` escenario 3 (hold=1500ms, ×3 iteraciones, guard de cobertura fail-open) verde de forma determinista. El invariante depende del ESTADO del fichero (`Buffer.byteLength(raw)` de la LECTURA + `ino` del destino, comprobado justo antes del `renameSync`), no del reloj — confirmado leyendo el orden real en `src/inbox/store.js:710-839` |
| 4 | Trace pointer `→ destino` best-effort; sin ref, `enrutada` cierra igual sin bloquear (CAPT-06) | ✓ VERIFIED | Sin cambios; `markCapture` ahora además devuelve la captura PERSISTIDA re-parseada (WR-07 cerrado en 83-04) |
| 5 | La documentación describe el seam `kodo inbox` → `/gsd-capture` → marcar `enrutada`, sin import ni reimplementación de destinos (CAPT-04) | ✓ VERIFIED | README.md y `.claude/skills/kodo-orchestrate/skill.md` actualizados en 83-07: corrigen la afirmación de «append-only» (IN-02, el fichero solo crece — el marcado reescribe bajo lock), documentan `--` para texto con guion inicial (WR-05) y el nuevo exit 1 por escritura concurrente. `grep -nE "'node:child_process'"` sobre los tres módulos → 0 coincidencias |

**Score:** 5/5 truths verified — **los tres gaps de la verificación anterior (truth 3, y los dos defectos de producto GAP-2/GAP-3 recogidos como hallazgos independientes) están cerrados**

### Gaps Cerrados (detalle de la re-verificación)

#### GAP-1 — pérdida silenciosa de capturas concurrentes al marcado (antes: truth 3 FAILED)

Reproducción exacta de la verificación anterior, repetida por este verificador:

```
$ node run.mjs   (sandbox HOME, seed 'seed01', 1 mark --hold 1500 + 6 capture)
verdicts: written(0) written(0) written(0) written(0) written(0) written(0) written(0)
--- inbox final ---
- [x] seed01 · captura semilla a marcar · kodo-race · 2026-01-15 · cli · enrutada → 999.4
- [ ] cap006 · captura concurrente 6 · kodo-race · 2026-07-25 · cli
- [ ] cap004 · captura concurrente 4 · kodo-race · 2026-07-25 · cli
- [ ] cap003 · captura concurrente 3 · kodo-race · 2026-07-25 · cli
- [ ] cap005 · captura concurrente 5 · kodo-race · 2026-07-25 · cli
- [ ] cap001 · captura concurrente 1 · kodo-race · 2026-07-25 · cli
- [ ] cap002 · captura concurrente 2 · kodo-race · 2026-07-25 · cli
```

6 de 6 supervivientes, repetido en 3 iteraciones. Contraste (anti-masking): con el guard neutralizado a mano (`changed = false` forzado en `src/inbox/store.js`, fichero restaurado después, `git diff` limpio tras la comprobación) la misma reproducción pierde capturas de nuevo (0/6 en una corrida, 4/6 en otra) — confirma que el guard es lo que decide el resultado, no un artefacto del harness.

Ordering verificado en el código fuente (`src/inbox/store.js:710-839`): `baseBytes = Buffer.byteLength(raw, 'utf-8')` sale de la LECTURA misma (nunca de un `statSync` separado, que absorbería el append que debe detectar); `baseIno` se toma con `statSync(target)` inmediatamente DESPUÉS de la lectura; la comprobación final es un `statSync` FRESCO tomado tras escribir el tmp y justo antes del `renameSync`. El JSDoc (líneas 651-690) documenta honestamente la ventana residual de dos syscalls contiguos entre el stat de comprobación y el rename, sin reclamar un cierre total — coincide con lo observado en el código.

`test/inbox-concurrency.test.js` tiene 3 `it(` reales (confirmado con `grep -cE "^\s*it\("`, no con el substring `it(` que además cuenta `split(`): escenario 1 (CAPT-01), escenario 2 (hold=300ms) y escenario 3 (hold=1500ms, ×3, GAP-1). Corrido por este verificador: **3/3 pass**, incluido escenario 3 con el guard de cobertura fail-open (`assertFailopenExercised`) que hace ROJO el escenario si alguna iteración deja de ejercitar la rama fail-open — el mismo enmascaramiento (18/18 `coordinated`) que produjo el gap original.

#### GAP-2 — `kodo inbox --json` truncado a 64KB en un pipe (antes: hallazgo independiente del verificador, no una truth del ROADMAP pero bloqueante para el DX-06 del plan)

`src/cli.js` confirmado: los 4 `.action()` de `capture`/`inbox`/`inbox route`/`inbox discard` usan `process.exitCode = ...` (nunca `process.exit()`) — líneas 632, 659, 676, 689.

Reproducción independiente con inbox sembrado de 4000 capturas (422.890 bytes de fichero):

```
inbox size: 422890
piped stdout bytes: 686930
JSON.parse OK, captures: 4000, open: 4000
```

`test/inbox-cli.test.js` añade un bloque completo (`describe('CLI \`kodo inbox\` — la salida CANALIZADA no se trunca')`) con fixture >100KB real (no simbólico), aserciones de bytes >65536 y presencia de la ÚLTIMA captura sembrada — para `--json`, `--all --json` y el carril human. El comentario del bloque documenta la mordida comprobada a mano (revertido el fix → caso 1 rojo).

#### GAP-3 — el tag es un UUID de 36 caracteres en la instalación real (antes: hallazgo independiente del verificador)

Comprobación directa contra el `~/.kodo/projects.json` REAL de esta máquina (10 claves, todas UUID de proveedor con valor `{ default: <ruta>, modules: {...} }`):

```
$ node --input-type=module -e "... deriveTag(process.cwd(), projects) ..."
cwd: /Users/alex/dev/klab/kodo
derived tag: kodo
```

Antes del cierre: `7246e3fe-3dc4-4f24-9078-1911ad477e0d`. Ahora: `kodo` (4 caracteres, legible). `test/inbox-store.test.js` añade un bloque (`describe('deriveTag — forma REAL de projects.json: clave UUID de proveedor (GAP-3, D-15)')`) cuyo fixture usa la forma REAL (clave UUID → objeto `{ default: PROJ, modules: {...} }`), no claves inventadas legibles — cierra exactamente el punto ciego que señaló la verificación anterior. La sha256 de `~/.kodo/inbox.md` se comprobó SIN cambios antes y después de esta verificación (`e3b0c442...` — fichero vacío, sin escrituras de prueba).

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/inbox/store.js` | Guard CAS dentro del lock, RMW acotado, publicación que preserva inodo/modo, `deriveTag` con proyección UUID→nombre legible | ✓ VERIFIED (839 líneas) | Guard verificado línea a línea (710-839); `resolvePublishTarget` (WR-01, 603-618); `deriveTag`+`isUuidLike`+`mappedProjectPath` (203-294) |
| `src/cli.js` | 4 handlers del inbox con `process.exitCode`, nunca `process.exit()` tras stdout | ✓ VERIFIED | Confirmado en las 4 ubicaciones (632, 659, 676, 689) |
| `src/cli/capture.js` | Propaga `warnFn` al store (WR-08) | ✓ VERIFIED | `appendFn(line, { inboxPath, lockPath, warnFn: err })` — confirmado y confirmada su mordida (spot-check de neutralización) |
| `src/cli/inbox.js` | `sanitizeJsonField` en el carril `--json` (WR-02) | ✓ VERIFIED | Aplicado a text/tag/origin/dest en las líneas 114-125 |
| `test/inbox-store.test.js` | Cobertura del guard CAS + fixture UUID real + agotamiento por bytes no-UTF-8 | ✓ VERIFIED (1170 líneas aprox., +345 sobre baseline) | Suite corrida: pass |
| `test/inbox-cli.test.js` | Regresión >64KB piped + integración fail-open sobre el binario + E2E del tag real | ✓ VERIFIED (+334 líneas) | Suite corrida: pass |
| `test/inbox-concurrency.test.js` | Escenario 3 (hold=1500ms) + guard de cobertura fail-open | ✓ VERIFIED (3 `it(` reales) | Corrido de forma independiente: 3/3 pass |
| README.md / skill.md | IN-02, WR-05 corregidos; exit codes actualizados | ✓ VERIFIED | Confirmado por grep |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `markCapture` | `node:fs` (`statSync`) | guard compare-and-swap | ✓ WIRED | Baseline de bytes desde la lectura, ino tras la lectura, comprobación fresca antes del rename — orden verificado en el fuente |
| `src/cli/capture.js` | `appendCapture` | `warnFn: err` | ✓ WIRED | Confirmado; spot-check de neutralización demuestra que el seam realmente se usa (unit muerde, integración no — ambos claims auto-reportados verificados) |
| `src/cli.js` (4 `.action()`) | `process.exitCode` | asignación en vez de `process.exit()` | ✓ WIRED | Confirmado y verificado con reproducción real >64KB |
| `deriveTag` | `mappedProjectPath` | proyección UUID→basename | ✓ WIRED | Confirmado con `~/.kodo/projects.json` real de esta máquina |

### Behavioral Spot-Checks (verificador, independientes del SUMMARY)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| GAP-1: hold=1500ms + 6 capturas concurrentes durante un marcado, ×3 | Harness real, sandbox HOME | 7/7 `written`, 6/6 supervivientes en las 3 corridas | ✓ PASS |
| GAP-1 (contraste): mismo repro con el guard neutralizado a mano | Idéntico, `changed=false` forzado, fichero restaurado tras la prueba | 0/6 y 4/6 supervivientes en dos corridas — la pérdida vuelve | ✓ PASS (confirma que la prueba muerde) |
| GAP-2: inbox de 4000 capturas (~423KB) canalizado con `--json` | `kodo inbox --all --json \| <consumidor>` | 686930 bytes, `JSON.parse` OK, 4000 capturas íntegras | ✓ PASS |
| GAP-3: `deriveTag` contra `~/.kodo/projects.json` real (10 claves UUID) desde el cwd del repo | Llamada directa a `deriveTag` | `kodo` (antes: UUID de 36 chars) | ✓ PASS |
| Auto-reporte 83-07: el test de integración del fail-open NO muerde; el unit sí | Propagación de `warnFn` neutralizada a mano en `capture.js`, restaurada después | Integración: sigue en verde (no muerde, confirmado). Unit «el seam de salida de error se propaga…»: se pone rojo (muerde, confirmado) | ✓ PASS (ambos claims verificados) |
| Auto-reporte 83-06: `grep -c "it("` es insatisfacible; el executor sustituyó por un grep anclado | `grep -cE "^\s*it\(" test/inbox-concurrency.test.js` | 3 (coincide con los 3 escenarios reales; el substring naive cuenta 7 por `split(`) | ✓ PASS |
| Suite del subsistema del inbox | `node --test test/inbox-store.test.js test/inbox-format-golden.test.js test/inbox-cli.test.js test/inbox-concurrency.test.js test/format-isolation.test.js` | 193/193 pass | ✓ PASS |
| Suite completa del repo (una única corrida) | `npm test` | 2556 tests, 2555 pass, 0 fail, 1 skip | ✓ PASS (coincide con el número confirmado por el orquestador) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| CAPT-01 | 83-01, 83-02, 83-03, 83-04, 83-05, 83-07 | Captura atómica, N concurrentes sin pérdidas, texto saneado, tag legible | ✓ SATISFIED | Sin cambios en el append; tag ahora legible (GAP-3 cerrado) |
| CAPT-03 | 83-01, 83-02, 83-03, 83-04, 83-06 | Listado/marcado sin borrado + captura concurrente al marcado nunca se pierde | ✓ **SATISFIED** (antes BLOCKED) | El sub-criterio "nunca se pierde" (crit 3) ahora VERIFICADO de forma independiente — ver GAP-1 arriba |
| CAPT-04 | 83-02, 83-03, 83-07 | Seam de enrutado documental, sin import de child_process | ✓ SATISFIED | Gate source-hygiene + documentación actualizada (IN-02, WR-05) |
| CAPT-06 | 83-01, 83-02, 83-04 | Trace pointer best-effort | ✓ SATISFIED | `route` sin `--dest` cierra igual; `markCapture` devuelve ahora la captura PERSISTIDA (WR-07 cerrado) |

**Ninguna requirement de la fase queda huérfana.** Las 4 (CAPT-01, CAPT-03, CAPT-04, CAPT-06) están declaradas en los siete planes y trazadas arriba. **CAPT-03 pasa de BLOCKED a SATISFIED** — es el cambio central de esta re-verificación.

### Anti-Patterns Found

| File | Pattern | Severity | Impact |
|---|---|---|---|
| — | Ningún blocker nuevo detectado en `src/cli.js`, `src/cli/capture.js`, `src/cli/inbox.js`, `src/inbox/store.js` ni en los tests de la fase | — | — |
| `src/inbox/store.js` (WR-04, deliberadamente diferido) | `encodeLine` sigue sin validar su propio contrato (una línea degenerada puede producir una línea que `parseLine` rechaza) | ⚠️ Warning (deuda registrada, no bloqueante) | Documentado en `83-07-SUMMARY.md` §Deuda registrada: el arreglo tocaría el contrato byte-exacto inter-fase que Phase 84 aún no consume — diferido con razón explícita, no silenciado |
| `src/inbox/store.js` (WR-06, deliberadamente diferido) | CRLF/BOM siguen rompiendo el parser en silencio | ⚠️ Warning (deuda registrada, no bloqueante) | Mismo tratamiento — exige tocar la misma superficie que 83-04 acaba de reescribir; diferido con razón, documentado |
| `src/inbox/store.js` (degradación conservadora, deliberada) | Un byte no-UTF-8 en el fichero agota el RMW y devuelve `concurrent-write` permanentemente hasta que el operador corrija el byte | ℹ️ Info (comportamiento deliberado, documentado en `deferred-items.md`) | Dirección de fallo correcta según D-04 (preservación byte a byte): publicar habría reescrito el byte ajeno como mojibake. Confirmado con test dedicado (`seedFixtureWithInvalidUtf8`) |

No se detectan marcadores `TBD`/`FIXME`/`XXX` reales en los 8 ficheros modificados por los planes de cierre de gaps (los únicos matches de "XXX"/"TODO" son notación de escape `\uXXXX` en comentarios y el literal de fixture `TODO-012.md`, ambos falsos positivos).

**Deferred-items.md** (fichero dedicado de la fase) registra correctamente el comportamiento del byte no-UTF-8 como consecuencia deliberada del guard de 83-04, con su arreglo estructural futuro descrito. Los warnings WR-04/WR-06/IN-01/IN-03/IN-04 quedan registrados en `83-07-SUMMARY.md` §Deuda registrada — no en `deferred-items.md`, pero tampoco silenciados: aparecen explícitamente como deuda con razón en el SUMMARY committeado.

## Human Verification Required

Ninguno — todos los hallazgos de esta re-verificación son deterministas y reproducibles por comando (spot-checks arriba), incluidas las dos comprobaciones de contraste (guard neutralizado, seam neutralizado) que exigían leer y modificar temporalmente el código fuente para confirmar que las pruebas realmente muerden.

## Gaps Summary

**Los tres gaps estructurados de la verificación anterior están cerrados y confirmados de forma independiente, no solo por los SUMMARY de los planes de cierre:**

1. **GAP-1 (el criterio central de la fase, CAPT-03 crit 3):** el invariante «una captura concurrente durante el marcado nunca se pierde» pasó de depender del reloj (presupuesto de reintentos) a depender del ESTADO del fichero (guard compare-and-swap dentro del lock, baseline tomado de la lectura misma). Reproducido con el mismo harness y el mismo hold (1500ms) que destruyó 6 de 6 capturas en la verificación anterior: ahora sobreviven 6 de 6, en 3 iteraciones sin excepción, y la prueba de contraste (guard neutralizado a mano) confirma que el resultado depende genuinamente del fix, no es un caso ciego.

2. **GAP-2 (`kodo inbox --json` truncado a 64KB):** los 4 handlers usan `process.exitCode` en vez de `process.exit()`; reproducido con un inbox de 423KB canalizado — 687KB de salida, JSON íntegro y parseable.

3. **GAP-3 (tag UUID de 36 caracteres):** `deriveTag` proyecta ahora un `projectId` con forma de UUID al basename de la ruta mapeada; confirmado contra el `~/.kodo/projects.json` REAL de esta máquina (10 claves UUID), y el fixture de test usa esa misma forma real, no una inventada.

Los tres auto-reportes de desviación de los ejecutores (el byte no-UTF-8 agota el RMW deliberadamente; el guard de cobertura de 83-06 destapó una segunda carrera de scheduler resuelta con liberación en dos tiempos; el `grep -c "it("` del plan 83-06 era insatisfacible y se sustituyó por un grep anclado; el test de integración del fail-open de 83-07 no muerde y se complementó con un unit que sí) se han verificado uno por uno contra el código y son honestos. El uso de `git stash` en 83-07 (prohibido para ejecutores) no dejó trabajo perdido: la propagación del seam WR-08 está presente y confirmada en `src/cli/capture.js:130`, con su cobertura verde.

**La fase cumple su goal.** El riesgo de concurrencia que da nombre a la fase — "Aquí se concentra el riesgo de concurrencia" — está cerrado con un invariante independiente del reloj, verificado de forma reproducible por este verificador, no solo declarado por los SUMMARY de los planes de cierre.

---

_Verified: 2026-07-25T18:50:00Z_
_Verifier: Claude (gsd-verifier)_
