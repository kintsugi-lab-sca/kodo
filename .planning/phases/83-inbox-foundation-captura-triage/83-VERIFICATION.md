---
phase: 83-inbox-foundation-captura-triage
verified: 2026-07-25T12:00:00Z
status: gaps_found
score: 4/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
gaps:
  - truth: "Una captura concurrente durante el marcado nunca se pierde (ROADMAP SC3 / CAPT-03 crit 3)"
    status: failed
    reason: >
      El invariante NO es independiente del reloj. `appendCapture` hace fail-open FUERA del lock
      tras agotar `CAPTURE_LOCK_RETRIES` (50) × `CAPTURE_LOCK_BACKOFF_MS` (20) ≈ 1000ms, y
      `markCapture` publica con `renameSync` un buffer leído ANTES de esos appends fuera-de-lock.
      El fix de 83-03 (subir el presupuesto de 160ms a 1000ms) no cierra el lost-update: solo aleja
      el umbral. Reproducido de forma independiente por este verificador con el harness del propio
      repo (`test/helpers/lock-race-child.mjs`), 1 `--kind mark --hold 1500` + 6 `--kind capture`:
      los 7 procesos reportan éxito (`written`, exit 0) y el inbox final contiene solo la línea
      marcada — las 6 capturas concurrentes desaparecen sin dejar rastro. El TTL del lock es de 10s
      (`state-lock.js:36`), así que cualquier proceso que sostenga el lock del inbox más de ~1s
      (contención de disco, swap, `SIGSTOP`, un `kodo` colgado) abre esta ventana en producción, no
      solo en un test artificial. El test de regresión de 83-03 (`test/inbox-concurrency.test.js`,
      hold=300ms) ya NO ejercita la rama fail-open (medido por el reviewer: 18/18 hijos
      `coordinated`), así que deja de cubrir exactamente el camino que pierde datos — el patrón que
      el propio repo prohíbe por nombre (DEBT-04, Phase 82: "una carrera nunca se pone verde
      enmascarándola").
    artifacts:
      - path: "src/inbox/store.js"
        issue: "appendCapture (fail-open ~L484-490) y markCapture (RMW ~L574-589) no tienen ninguna comprobación de que el fichero no cambió entre la lectura fresca y el rename — el lock por sí solo no basta porque el fail-open de la captura escribe deliberadamente FUERA del lock"
    missing:
      - "Un guard de compare-and-swap dentro del lock del marcado (p. ej. statSync antes/después de tamaño+mtime+ino) que aborte o reintente el RMW si el fichero cambió desde la lectura fresca, en vez de publicar ciegamente sobre una lectura obsoleta"
      - "Un tercer escenario de concurrencia con hold POR ENCIMA del presupuesto (p. ej. 1500ms) que assert que ninguna captura se pierde — es el caso que hoy falla y que el test actual dejó de cubrir tras la recalibración"
      - "Corregir el comentario JSDoc de CAPTURE_LOCK_RETRIES (store.js ~L79-101), que afirma un cierre del riesgo que no existe"
  - truth: "`kodo inbox --json` emite una única línea de JSON parseable, sin ANSI y byte-determinista entre ejecuciones (must_have de 83-02-PLAN.md, DX-06)"
    status: failed
    reason: >
      Los cuatro handlers nuevos de `src/cli.js` llaman `process.exit(runXxxCli(...))`
      inmediatamente después de escribir en `process.stdout`. En una pipe (no un TTY), las
      escrituras de stdout son asíncronas; `process.exit()` aborta el proceso sin drenar el buffer
      de 64KB. Reproducido de forma independiente por este verificador: con un inbox de 4000
      capturas (~430KB), `kodo inbox --json | <consumidor>` produce exactamente 65536 bytes y
      `JSON.parse` falla con "Unterminated string in JSON at position 65536". Como CAPT-03 prohíbe
      borrar nada, el fichero solo crece — cruzar 64KB no es un caso límite, es una certeza a
      plazo (~500-600 capturas con `--all`). El propio README y `.claude/skills/kodo-orchestrate/skill.md`
      instruyen a usar `kodo inbox --json` como carril de datos.
    artifacts:
      - path: "src/cli.js"
        issue: "Los 4 `.action()` de capture/inbox/route/discard hacen process.exit(código) inmediatamente tras escribir en stdout, sin dejar que Node drene el pipe"
    missing:
      - "Reemplazar process.exit(code) por process.exitCode = code en los 4 handlers registrados en src/cli.js, dejando que el runtime drene stdout antes de terminar"
      - "Un test de integración con un inbox sembrado >64KB que verifique JSON.parse(stdout) tras canalizar la salida"
  - truth: "El tag-proyecto comunica al operador a qué proyecto pertenece la captura (propósito declarado de D-15 en 83-01-PLAN.md, dentro de CAPT-01 SC1)"
    status: failed
    reason: >
      `deriveTag` devuelve la CLAVE de `~/.kodo/projects.json` cuando hay match. En la
      configuración real del operador las 10 claves comprobadas son UUIDs de proveedor de 36
      caracteres — el valor (la ruta) es lo legible, no la clave. Ningún test del plan ejercita la
      forma real de `projects.json` (todos los fixtures usan claves legibles inventadas como
      `{kodo: '/x/y/kodo'}`), así que el defecto es invisible a la suite pero reproducible en este
      repo mismo (`kodo capture` desde este cwd escribe `7246e3fe-3dc4-4f24-9078-1911ad477e0d` como
      tag). Deforma la columna de `formatTable` y no comunica nada al operador — que es
      precisamente la función del campo.
    artifacts:
      - path: "src/inbox/store.js"
        issue: "deriveTag (~L214-227) usa projectId crudo como tag sin proyectar un nombre humano"
    missing:
      - "Detectar projectId con forma de UUID y usar basename(cwd) como fallback en ese caso (el fallback YA es legible), o proyectar el valor mapeado de projects.json en vez de la clave"
      - "Un test con la forma REAL de projects.json (claves UUID → valor string de ruta)"
deferred: []
---

# Phase 83: Inbox foundation — captura + triage Verification Report

**Phase Goal:** kodo gana su primer buffer de captura global — `kodo capture "idea"` appendea una línea atómica a `~/.kodo/inbox.md` y `kodo inbox` lista y marca capturas (`enrutada`/`descartada`) sin borrarlas jamás. Aquí se concentra el riesgo de concurrencia: el modelo de estado se decide explícitamente antes de construir cualquier consumidor.
**Verified:** 2026-07-25T12:00:00Z
**Status:** gaps_found
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (ROADMAP Success Criteria, CAPT-01/03/04/06)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | `kodo capture "idea"` appendea `texto·tag·fecha·origen`; N capturas concurrentes → N líneas sin pérdidas (append atómico O_APPEND); texto saneado a una sola línea (CAPT-01) | ✓ VERIFIED | `appendFileSync` de una sola llamada (`grep -n appendFileSync src/inbox/store.js`); `test/inbox-concurrency.test.js` escenario 1 (8 hijos → 8 líneas, ids deterministas, 0 pérdidas) pasa en verde localmente (147/147 tests del subsistema); `stripForKeystroke` + neutralización U+2028/U+2029 confirmados en `encodeLine`. Nota: WR-06 (CRLF/BOM rompen el parser en silencio) es un defecto real pero no contradice esta truth literal |
| 2 | `kodo inbox` lista abiertas y marca `enrutada`/`descartada` sin borrar jamás — traza permanente (CAPT-03) | ✓ VERIFIED | Ninguna ruta de borrado: `markCapture` sustituye la línea in-place vía RMW, nunca la elimina del array; confirmado por code review (0 findings de borrado) y por `test/inbox-store.test.js`/`test/inbox-cli.test.js` (discard/route conservan la línea) |
| 3 | **Una captura concurrente durante el marcado nunca se pierde** (CAPT-03 crit 3) | ✗ **FAILED** | Reproducido de forma independiente por este verificador (ver `gaps` arriba): con un hold de 1500ms (por encima del presupuesto recalibrado de ~1000ms), 6 de 6 capturas concurrentes se destruyen, exit 0 en los 7 procesos. El TTL del lock (10s) hace esta ventana alcanzable por cualquier titular patológico del lock, no solo por el hold artificial del test. El fix de 83-03 recalibra el umbral, no cierra el invariante — coincide con el hallazgo independiente del orquestador (CR-02) |
| 4 | Trace pointer `→ destino` best-effort; sin ref, `enrutada` cierra igual sin bloquear (CAPT-06) | ✓ VERIFIED | `route <id>` sin `--dest` cierra con exit 0 (`test/inbox-cli.test.js`); con `--dest` añade el sufijo `→ dest`. WR-07 (la confirmación del CLI puede mostrar un `dest` más largo que el persistido, por no re-parsear tras `encodeLine`) es un defecto de UX menor, no bloquea el comportamiento best-effort en sí |
| 5 | La documentación describe el seam `kodo inbox` → `/gsd-capture` → marcar `enrutada`, sin import ni reimplementación de destinos (CAPT-04) | ✓ VERIFIED | README.md:186-227 y `.claude/skills/kodo-orchestrate/skill.md:379-418` documentan el flujo idéntico de 3 pasos; `grep -nE "'node:child_process'" src/inbox/store.js src/cli/capture.js src/cli/inbox.js` → 0 coincidencias, confirmado independientemente |

**Score:** 4/5 truths verified — **truth 3 (el criterio de concurrencia que da nombre al riesgo central de la fase) FAILED**

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/inbox/store.js` | Codec, parser, reader never-throws, append O_APPEND, marcado RMW | ✓ VERIFIED (existe, sustantivo: 609 líneas, min 200) | 9/9 exports esperados presentes; cero import de `config.js`; pero contiene el defecto estructural de la truth 3 |
| `src/cli/capture.js` | Thin handler de `kodo capture` | ✓ VERIFIED (142 líneas, min 70) | Gate de texto vacío, `--origin` inyectable, sin `process.exit` en el handler (el exit vive en `cli.js`, donde está el defecto CR-01) |
| `src/cli/inbox.js` | Thin handler de `kodo inbox`/`route`/`discard` | ✓ VERIFIED (266 líneas, min 110) | `--json` separado antes del formatter; render human saneado con `stripControlChars` |
| `src/cli.js` | Registro commander | ✓ VERIFIED (contiene `kodo capture`, `kodo inbox`) | Pero los 4 `.action()` nuevos usan `process.exit()` post-stdout-write — la causa raíz de CR-01 |
| `test/inbox-store.test.js` | Unit del store | ✓ VERIFIED (667 líneas, min 150) — pasa 147/147 en el subsistema | |
| `test/inbox-format-golden.test.js` | Golden byte-exacto | ✓ VERIFIED (142 líneas, min 40) | |
| `test/inbox-cli.test.js` | Integración CLI | ✓ VERIFIED (1066 líneas, min 150) | |
| `test/inbox-concurrency.test.js` | Escenarios D-21 | ⚠️ VERIFIED pero **con cobertura degradada** (251 líneas, min 120) | Pasa en verde, pero tras la recalibración de 83-03 ya no ejercita la rama fail-open (18/18 `coordinated` medido por el reviewer) — deja de cubrir el camino que pierde datos |
| `README.md` | Superficie CLI + seam documentado | ✓ VERIFIED | `kodo capture` (≥2), `kodo inbox route`/`discard` (≥1 c/u), `inbox.md`/`inbox.lock` documentados |
| `.claude/skills/kodo-orchestrate/skill.md` | Sección operativa de triage | ✓ VERIFIED | `kodo inbox` (≥2), flujo de 3 pasos idéntico al README |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/inbox/store.js` | `src/session/state-lock.js` | `withFileLock` | ✓ WIRED | ≥2 usos confirmados (captura + marcado) |
| `src/inbox/store.js` | `src/cli/format.js` | `stripForKeystroke` | ✓ WIRED | Confirmado en los 3 sanitizadores |
| `src/inbox/store.js` | `src/cli/dashboard/select.js` | `resolveProjectId` | ✓ WIRED | Confirmado, pero ver truth 3 de gaps (CR-03: el resultado no se proyecta a un tag legible) |
| `src/cli/capture.js` | `src/inbox/store.js` | `appendCapture`/`encodeLine` | ✓ WIRED | |
| `src/cli/inbox.js` | `src/inbox/store.js` | `listCaptures`/`markCapture` | ✓ WIRED | |
| `src/cli.js` | `src/cli/capture.js`, `src/cli/inbox.js` | `await import()` perezoso | ✓ WIRED | Pero el `.action()` que envuelve la llamada usa `process.exit()` en vez de `process.exitCode` — ver CR-01 |

### Behavioral Spot-Checks (verificador, independientes del SUMMARY)

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Truth 3: hold=1500ms (por encima del presupuesto recalibrado) + 6 capturas concurrentes durante un marcado | Harness real (`lock-race-child.mjs`), sandbox HOME, 1 `mark --hold 1500` + 6 `capture` | 7/7 procesos "written" (exit 0); inbox final: **1 línea** (solo la marcada); 0 de 6 capturas sobreviven | ✗ FAIL — confirma CR-02 de forma independiente |
| `kodo inbox --json` sobre un inbox de ~430KB (4000 capturas), canalizado a un consumidor no-TTY | `appendCapture` × 4000 vía store, luego `node bin/kodo inbox --json \| <parser>` | stdout truncado a exactamente 65536 bytes; `JSON.parse` falla con "Unterminated string ... at position 65536" | ✗ FAIL — confirma CR-01 de forma independiente |
| Suite del subsistema del inbox | `node --test test/inbox-store.test.js test/inbox-format-golden.test.js test/inbox-cli.test.js test/inbox-concurrency.test.js` | 147/147 pass | ✓ PASS (pero no prueba el invariante de la truth 3 — ver arriba) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| CAPT-01 | 83-01, 83-02, 83-03 | Captura atómica, N concurrentes sin pérdidas, saneo a una línea | ✓ SATISFIED | Escenario 1 (captura pura, sin marcado concurrente) verificado; O_APPEND de una sola llamada confirmado |
| CAPT-03 | 83-01, 83-02, 83-03 | Listado/marcado sin borrado + captura concurrente al marcado nunca se pierde | ✗ **BLOCKED** | El sub-criterio "nunca se pierde" (crit 3 del ROADMAP) FALLA — ver truth 3. El resto de CAPT-03 (no-borrado, listado) sí está satisfecho |
| CAPT-04 | 83-02, 83-03 | Seam de enrutado documental, sin import de child_process | ✓ SATISFIED | Gate source-hygiene + documentación en README/skill.md confirmados |
| CAPT-06 | 83-01, 83-02 | Trace pointer best-effort | ✓ SATISFIED (con defecto menor WR-07 no bloqueante) | `route` sin `--dest` cierra igual; con `--dest` añade el sufijo |

**Ninguna requirement de la fase queda huérfana** — las 4 (CAPT-01, CAPT-03, CAPT-04, CAPT-06) están declaradas en los tres planes y trazadas arriba. CAPT-03 queda **BLOCKED** por el sub-criterio de concurrencia, aunque el resto de su superficie (listado/marcado sin borrado) esté satisfecho.

### Anti-Patterns Found

Heredados del propio `83-REVIEW.md` (`status: issues_found`, 3 Critical / 8 Warning / 4 Info) y confirmados de forma independiente por este verificador donde fue barato hacerlo:

| File | Pattern | Severity | Impact |
|---|---|---|---|
| `src/inbox/store.js` (fail-open + RMW) | Invariante dependiente del reloj, no del estado del fichero (CR-02) | 🛑 Blocker | Pérdida silenciosa de datos con exit 0 — viola literalmente CAPT-03 crit 3. **Confirmado independientemente por este verificador** |
| `src/cli.js` (4 `.action()`) | `process.exit()` inmediatamente tras `process.stdout.write()` en un pipe (CR-01) | 🛑 Blocker | JSON inválido en `--json` a partir de ~64KB (~500-600 capturas), cierto a plazo dado que CAPT-03 prohíbe borrar. **Confirmado independientemente por este verificador** |
| `src/inbox/store.js` (`deriveTag`) | Uso de la clave cruda de `projects.json` como tag sin proyección a nombre legible (CR-03) | 🛑 Blocker (calidad de producto) | El campo que debía comunicar el proyecto al operador es un UUID de 36 caracteres en la instalación real; ningún test cubre la forma real del fichero |
| `test/inbox-concurrency.test.js` + `CAPTURE_LOCK_RETRIES` | Recalibración del presupuesto de producción para evitar la rama que el test ejercitaba (WR-03) | ⚠️ Warning | El test sigue verde pero deja de cubrir el camino de pérdida de datos — la forma exacta de "enmascaramiento" que DEBT-04 (Phase 82) prohíbe por precedente explícito, aunque no viole la letra literal de la prohibición del plan ("no relajar el assert ni reducir hijos") |
| `src/inbox/store.js` (`markCapture` publish) | Publicación por tmp+rename destruye la identidad del inodo — symlink roto + permisos reseteados a 0644 (WR-01) | ⚠️ Warning | Degradación silenciosa de una decisión explícita del operador (montaje symlink o `chmod 600`) |
| `src/cli/inbox.js` (`--json`) | C1 (`\x80-\x9f`) y DEL no escapados por `JSON.stringify`, salen verbatim (WR-02) | ⚠️ Warning | El mismo vector de terminal-injection que T-83-09 cierra para el carril human queda abierto en `--json`, el carril que la skill del orquestador instruye usar |
| `src/inbox/store.js` (`encodeLine`) | Codec no valida su propio contrato — puede producir líneas que su `parseLine` rechaza (WR-04) | ⚠️ Warning | Una captura mal formada queda invisible para siempre, contando como "no parseable" |
| `src/cli.js` (`.argument('<text>')`) | Texto que empieza por `-` interpretado como opción por commander (WR-05) | ⚠️ Warning | Pérdida de captura por error de usuario común (texto pegado desde una lista markdown) |
| `src/inbox/store.js` (parser) | CRLF/BOM rompen el parser en silencio (WR-06) | ⚠️ Warning | Capturas cerradas desaparecen del listado si el fichero se edita con terminadores Windows |
| `src/inbox/store.js`/`src/cli/inbox.js` | `markCapture` devuelve el objeto pre-saneo, no lo persistido (WR-07) | ⚠️ Warning | La confirmación del CLI puede mentir sobre el `dest`/`text` realmente escrito |
| `src/inbox/store.js`/`src/cli/capture.js` | El warn del fail-open no pasa por el seam de DI del handler (WR-08) | ⚠️ Warning | Producción nunca ejercita el `warnFn` real; solo lo hacen los tests que lo inyectan a mano |

No se detectan marcadores `TBD`/`FIXME`/`XXX` sin referencia en los ficheros modificados por la fase (el único match de "TODO" es la palabra española "todo", falso positivo).

## Human Verification Required

Ninguno — todos los hallazgos de esta verificación son deterministas y reproducibles por comando (ver spot-checks arriba), no requieren juicio humano sobre UX/visual.

## Gaps Summary

**El criterio central que da nombre al riesgo de esta fase — "Aquí se concentra el riesgo de concurrencia" (texto literal del goal) — no está cerrado.** El plan 83-03 detectó correctamente el lost-update real (0/6 supervivientes con el presupuesto por defecto) pero lo cerró subiendo el umbral de reintentos en vez de hacer el invariante independiente del reloj. Este verificador reprodujo el mismo lost-update con un hold ligeramente mayor (1500ms vs. el presupuesto recalibrado de ~1000ms), confirmando de forma independiente el hallazgo CR-02 del `83-REVIEW.md`. Dado el TTL de 10s del lock (`state-lock.js:36`), cualquier titular real del lock que se atasque más de ~1s —no un caso de laboratorio— reproduce la pérdida total y silenciosa (exit 0) de todas las capturas concurrentes.

Adicionalmente, dos defectos de producto verificados en ejecución real (no solo en el código): `kodo inbox --json` se trunca a 64KB en un pipe (JSON inválido, cierto a plazo por el crecimiento monótono del inbox), y el `tag` deriva en un UUID de 36 caracteres en la configuración real del operador, vaciando de sentido la columna que existe precisamente para comunicar el proyecto.

Los 8 warnings adicionales del `83-REVIEW.md` (symlink/permisos rotos, C1/DEL sin escapar en `--json`, codec que no valida su propio contrato, texto con guion inicial rechazado por commander, CRLF/BOM, confirmación que miente, warn que esquiva el DI) no son bloqueantes por sí solos para el goal de la fase, pero conviene resolverlos en el mismo ciclo de cierre dado que varios tocan la misma superficie de concurrencia y saneo.

**Recomendación:** cerrar con `/gsd-plan-phase --gaps` sobre los 3 gaps estructurados arriba antes de dar la fase por completa. El fix de CR-02 (guard de estado dentro del lock, no solo presupuesto de tiempo) es el que decide si el modelo de estado D-01 realmente cumple lo que el ROADMAP promete.

---

_Verified: 2026-07-25T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
