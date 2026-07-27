---
phase: 72
slug: higiene-dx-y-verdad-documental
status: validated
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-13
---

# Phase 72 — Validation Strategy

> Per-phase validation contract reconstruido retroactivamente (backfill Nyquist Phase 85, NYQ-02).
> Cobertura **citada** de `72-VERIFICATION.md` (passed 5/5 must-haves, verificado a HEAD `2adfebd` post code-review-fix) + los 5 SUMMARY de plan + `72-UAT.md` + `72-SECURITY.md`.
> **Sin re-ejecutar la suite** — cada dimensión referencia el resultado empírico ya registrado.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (runner nativo, `node --test`) + `node:assert/strict` |
| **Config file** | none — runner nativo sin config externa, convención `test/**/*.test.js` |
| **Quick run command** | `node --test test/hooks/stop-idempotency.test.js test/skill-auto-commit.test.js test/config-hardening.test.js` |
| **Full suite command** | `npm test` (`node --test $(find test -name '*.test.js' -type f)`) |
| **Estimated runtime** | no re-medido en el backfill (**D-12**); la corrida citada de `npm test` cubrió **2027 tests** |
| **Evidencia citada** | `72-VERIFICATION.md` (2026-07-13T13:33:42Z, status passed, score 5/5 must-haves, `behavior_unverified: 0`, `overrides_applied: 0`) + `72-UAT.md` (`status: complete`, 1/1 pass, 2026-07-14) + `72-SECURITY.md` (`status: secured`, `threats_open: 0`, 15/15 threats closed) |

---

## Sampling Rate

- **Evidencia primaria:** `72-VERIFICATION.md` — verificación inicial passed, 5/5 observable truths (las Success Criteria literales del ROADMAP) + 17/17 required artifacts + 6/6 key-links + 3/3 data-flow traces, con `behavior_unverified: 0`. Verificado contra HEAD `2adfebd`, es decir **después** del code-review (`72-REVIEW.md`: 1 Critical + 7 Warnings) y de la pasada de fixes (`72-REVIEW-FIX.md`, `1ff783b..3f3c8ea`); las comprobaciones leen el código y corren los tests en ese estado, no en el pre-review.
- **Política Nyquist (backfill):** la cobertura ES la cita a la evidencia preexistente; no se re-corre la suite (**D-12**).
- **UAT humano bloqueante:** `72-UAT.md` — **1/1 pass**, `status: complete` (`passed: 1`, `issues: 0`, `skipped: 0`). El único item humano de la fase (propagación empírica de `KODO_ORCHESTRATOR=1`) se confirmó por dogfooding el **2026-07-14** con lanzamiento real del orquestador. Ver §Manual-Only Verifications.
- **Nota sobre la suite completa citada:** la corrida de `npm test` del `72-VERIFICATION.md` dio **2027 tests: 2025 pass, 1 fail, 1 skip**. El fallo es `gsd-lock-race`, flake de temporización **pre-existente y ajeno a la fase**, confirmado como tal por el propio informe al correrlo en aislamiento (**4/4 pass**). Se cita tal cual, sin redondearlo a «suite verde».

---

## Per-Task Verification Map (dimensión → cobertura citada)

| Requirement | Plan | Dimensión / Secure Behavior | Test Type | Automated Command | Evidencia citada (fichero + resultado) | Status |
|-------------|------|-----------------------------|-----------|-------------------|----------------------------------------|--------|
| HYG-01 | 72-01 | (T-72-01 high / T-72-02 low) El stop hook auto-commitea **solo** con `KODO_ORCHESTRATOR=1` presente, y el pathspec `-- .claude/skills/kodo-orchestrate/` acota **ambos** pasos (`add` y `commit`) — no puede arrastrar el working tree del operador. Sin la var: skip, cero commits fantasma (fail-safe) | unit (DI con git stub) | `node --test test/hooks/stop-idempotency.test.js test/skill-auto-commit.test.js` | `72-VERIFICATION.md` Observable Truths → Truth #1 ✓ VERIFIED (`src/hooks/stop.js:253` gate `!== '1'` → return; `:283` pathspec en `add` y `commit`; `src/orchestrator/launch.js:256` inyecta el prefijo; fix WR-07 —`beforeEach` limpia la env var heredada— confirmado presente); §Behavioral Spot-Checks → «Gate + pathspec del auto-commit (unit)» → **3/3 + suite verde** ✓ PASS. `72-SECURITY.md` T-72-01 **closed** | ✅ green |
| HYG-02 | 72-02 | `kodo up --url` deja de existir: **borrado, no cableado en silencio** — y la opción homónima de `dashboard` se conserva intacta (la eliminación no se pasa de frenada). Requirement de ausencia: se verifica por la superficie real del CLI | guard CLI (verificación por ausencia) | `node src/cli.js up --help` (sin `--url`) + `node src/cli.js dashboard --help` (con `--url`) | `72-VERIFICATION.md` Truth #2 ✓ VERIFIED y §Behavioral Spot-Checks → «`up --help` no lista `--url`» → «Solo `-h, --help`» ✓ PASS y «`dashboard --help` conserva `--url`» → «`--url <baseUrl>` presente» ✓ PASS (ambos **ejecutados** en la verificación); §Required Artifacts → `src/cli.js` `:87-96` sin `--url`, `:392-400` con ella ✓ VERIFIED | ✅ green |
| HYG-03 | 72-02 | `startHealthLoop` y su maquinaria (`stopHealthLoop`, `runHealthCheck`, `healthInterval`) desaparecen del módulo, mientras `checkHealth`/`actOnHealth` —las funciones que sí se usan— quedan vivas. Otro requirement de ausencia: el riesgo es borrar de más o dejar el loop muerto cableado | guard source-grep | `grep -n "startHealthLoop\|stopHealthLoop\|runHealthCheck\|healthInterval" src/session/health.js` → **0 matches** | `72-VERIFICATION.md` Truth #2 ✓ VERIFIED («`grep` → 0 matches; `checkHealth`/`actOnHealth` intactas»); §Required Artifacts → `src/session/health.js` «Loop de health eliminado; `checkHealth`/`actOnHealth` conservadas» ✓ VERIFIED. Además el README dejó de prometer el loop: `grep -n "up --url\|60s\|health check cada" README.md` → **0 matches** | ✅ green |
| HYG-04 | 72-01 | (T-72-03 low) Los efectos de cierre (`setColor`, `notify`, nudge `buildStopNudgeText`) se disparan en `SessionEnd` y **no** en `Stop` — dejan de ser per-turn — y lo hacen **después** del backstop y del cleanup, en el orden LOCKED por D-08, con cada efecto en su propio try/catch (never-throws: un efecto cmux caído no tumba el cierre) | unit (aserción de secuencia) | `node --test test/hooks/session-end.test.js` | `72-VERIFICATION.md` Truth #2 ✓ VERIFIED (`src/hooks/session-end.js:176-201` tras `performTerminalCleanup` `:159` y `runReviewBackstop` `:126`; `src/hooks/stop.js` ya no contiene esas tres llamadas); §Behavioral Spot-Checks → «Secuencia backstop→efectos (unit)» → assert `['backstop','setColor','notify']` ✓ PASS; §Key Link Verification → `session-end.js` → `runReviewBackstop` ✓ WIRED y `buildStopNudgeText` importado en `session-end.js:23` ✓ WIRED. `72-SECURITY.md` T-72-03 **closed** | ✅ green |
| HYG-05 | 72-02 | (T-72-04 / T-72-05 high · T-72-06 medium · T-72-07 low) Batch de endurecimiento de config: `__proto__`/`constructor`/`prototype` rechazados en `config-args.js` **y también** en `deepMerge` (el vector hermano que el review destapó, WR-01); chmod 0600 pre-rename cuando hay `*_secret`, extendido al `.bak` de migración (WR-04); parseo con `indexOf`+`slice` que preserva `=`/`:` internos y strip conservador de comillas emparejadas (B5/M14); deep-merge con validación y warn-and-fallback (B7); y el gate de setup evaluando el JSON **crudo** vía `loadRawConfig`, no el merge con defaults (CR-01) | unit | `node --test test/config-hardening.test.js test/config.test.js test/config-migration-atomic.test.js test/cli/config-set-raw.test.js` | `72-VERIFICATION.md` Truth #3 ✓ VERIFIED (`config-args.js:17,33`; `config.js:9,222` filtro en `deepMerge`; `:41-49` strip de comillas; `:135-142` chmod 0600 pre-rename; `:194` `.bak` por `writeFileAtomic`; `:260` `deepMerge(structuredClone(DEFAULT_CONFIG), parsed)`); §Behavioral Spot-Checks → «Config hardening (M3/M14/B5/B7/M5)» **22/22 pass** ✓ PASS y «CR-01 repro (needsSetup pre-merge)» **1/1 pass** ✓ PASS; §Data-Flow Trace → `needsSetup` lee «el JSON crudo de disco, no el merge con defaults» ✓ FLOWING; §Code Review Findings → CR-01 y WR-01/02/04/05 re-verificados contra el código real. `72-SECURITY.md` T-72-04/05/06/07 **closed** | ✅ green |
| HYG-06 | 72-03 | (T-72-08 / T-72-10 / T-72-11 low) Batch de BAJAS mecánicas aplicado en diffs de 1–5 líneas, cada hallazgo con su test: whitelist de modelo con `opus` (B1), comparación `!==` en must_haves y strip de `#` inline en YAML (B3/B12a), match de fase desacoplado del pad-2 (B4), regex de header con guiones tipográficos (M12), namespace `config.providers.plane` (B2), regex de identificador (B8), `isNameConflict409` estrechado a `already exists` para no tragarse 409 ajenos (B12c), match de hook por **ruta canónica** en vez de substring (B9) y guard con mensaje canónico en la factory de GitHub (B12d) | unit (uno por hallazgo) | `node --test test/labels.test.js test/gsd-verification.test.js test/gsd-roadmap.test.js test/plane-provider.test.js test/hooks/install.test.js test/registry.test.js` | `72-VERIFICATION.md` Truth #4 ✓ VERIFIED (los 10 anclajes de línea listados uno a uno: `labels.js:29`, `gsd/verification.js:228` y `:126-132`, `gsd/verify.js:189`, `gsd/roadmap.js:33`, `plane/client.js:11`, `:302`, `:271-272`, `hooks/install.js:21`, `providers/registry.js:66-81`); §Behavioral Spot-Checks → «BAJAS batch» → **67/67 pass** ✓ PASS. **B12b (throttle epoch-vs-delta) queda DIFERIDO**, no cubierto: nota explícita en `72-03-SUMMARY.md` §Deferred Items amparada por D-02 del CONTEXT — scope-decision documentada, riesgo residual low (`72-SECURITY.md` T-72-09 **closed** + AR-72-03), **no un hueco silencioso** | ✅ green |
| HYG-07 | 72-04 | (T-72-12 high · T-72-13 low) El dashboard no deja que contenido externo del provider pinte secuencias de control en el terminal del operador: `stripControlChars` elimina CSI + C0/C1 + `\x7f` incluyendo `\r` (ampliado por WR-02) y está cableado en los **3** callsites de la proyección, incluidos `task_ref` y `summary` que el review encontró sin sanear (WR-03) — con esto queda neutralizado OSC-52. El fallback `JSON.stringify` de shapes raras pasa por el mismo strip | unit | `node --test test/dashboard-format.test.js test/dashboard-table.test.js` | `72-VERIFICATION.md` Truth #3 ✓ VERIFIED (`src/cli/format.js:80-86`; cableado en `src/cli/dashboard/App.js:726-727` y `:1715-1716`); §Key Link Verification → `format.js` → `App.js` ✓ WIRED (`App.js:72,726,727,1715,1716`); §Data-Flow Trace → «el saneo se aplica sobre datos reales del provider, no un stub» ✓ FLOWING; ambas suites declaradas verdes en Truth #3. `72-SECURITY.md` T-72-12/13 **closed** | ✅ green |
| HYG-08 | 72-05 | (T-72-14 low, repudiación documental) El README refleja la realidad POST-72 y deja de prometer lo que ya no existe: la transición se atribuye a `SessionEnd`/backstop y no a un efecto per-turn, la tabla de arquitectura distingue `Stop` (estado ligero) de `SessionEnd` (backstop + cleanup + efectos), y el auto-commit se describe con su gate y su pathspec. Pasada **DELTA claim-a-claim**, no reescritura (D-04) | doc guard (artefacto) + checkpoint humano | `grep -c "up --url\|60s\|health check cada" README.md` → **0** | `72-VERIFICATION.md` Truth #5 ✓ VERIFIED (`git show 01588bd --stat` → `README.md | 13 ++++++++-----`, **8 inserciones / 5 borrados** — delta puro, consistente con D-04; anclajes `:26-28`, `:258-261`, `:269`, `:282` confirmados por lectura directa; grep de claims muertos → 0 matches); §Required Artifacts → `README.md` «Claims reconciliados con el estado POST-72» ✓ VERIFIED; checkpoint humano de la Task 2 del plan 05 registrado como **approved** en `72-05-SUMMARY.md`. `72-SECURITY.md` T-72-14 **closed** | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky / manual-only*

---

## Wave 0 Requirements

Infraestructura existente (`node:test` nativo) cubre todos los requirements — sin framework install y sin fixture compartido. Los ficheros de test se extendieron in-place sobre suites que ya existían (`config.test.js`, `dashboard-format.test.js`, `hooks/session-end.test.js`, `labels.test.js`, …) más los añadidos por la fase (`config-hardening.test.js`, `skill-auto-commit.test.js`, `hooks/stop-idempotency.test.js`, `cli/config-set-raw.test.js`). Dos de los ocho requirements —HYG-02 y HYG-03— son **requirements de ausencia** y su verificación natural no es un `it()` nuevo sino la superficie real del CLI y un grep sobre el módulo: así están citados, sin disfrazar un guard de unit test. `wave_0_complete` se conserva en `false` tal y como llegaba (**D-14**: ante duda no se re-deriva un flag de proceso ya cerrado).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Evidencia |
|----------|-------------|------------|-----------|
| Propagación empírica de `KODO_ORCHESTRATOR=1` desde el lanzamiento del orquestador hasta el proceso del hook `stop.js` (D5): el auto-commit de `.claude/skills/kodo-orchestrate/` dispara **solo** en la sesión orquestadora, y una sesión normal del repo no genera commits fantasma | HYG-01 | Manual-only **por naturaleza**: la variable se inyecta como prefijo de un command-string enviado a un shell real vía `cmux.send`, no hay `spawn` con `env` explícito. El código confirma inyección y gate, y el unit test cubre el gate con un git stub aislado, pero la propagación shell→proceso-hijo en un workspace cmux+claude vivo solo se confirma haciendo dogfooding. **Modo de fallo seguro por diseño:** sin la var el gate hace skip → cero commits fantasma, así que nunca bloqueó el goal. | `72-UAT.md` test 1 → **`result: passed`** (2026-07-14, operador, lanzamiento real de `kodo orchestrate`: auto-commit de la skill con pathspec OK y sesión normal sin commit fantasma). UAT **1/1 pass, 0 issues, 0 skipped**, `status: complete`. Contraparte automatizada también verde y citada: `72-VERIFICATION.md` Truth #1 ✓ VERIFIED con `stop.js:253,283` + `launch.js:256` y Spot-Check **3/3**. `72-SECURITY.md` cierra T-72-02 con AR-72-01 apoyándose precisamente en este UAT. **Este item quedó cumplido, no diferido.** |

---

## Validation Sign-Off

- [x] Cada requirement (HYG-01..08) mapeado a ≥1 cita de evidencia real en `72-VERIFICATION.md`
- [x] Continuidad de sampling: cobertura verde para las 8 dimensiones de riesgo (gate + pathspec del auto-commit, borrado de `up --url`, borrado del health loop, efectos de cierre en `SessionEnd`, endurecimiento de config, batch de BAJAS, strip de secuencias de control en el dashboard y reconciliación del README)
- [x] Wave 0 cubre todas las referencias MISSING (ninguna — infra nativa suficiente; HYG-02/HYG-03 se verifican por ausencia, declarado como tal)
- [x] Sin watch-mode flags
- [x] Ninguna fase declarada N/A — evidencia empírica real citada; el diferimiento de B12b se declara explícito en la fila de HYG-06 en vez de disolverse en el verde
- [x] `nyquist_compliant` fijado a **true** en el frontmatter

**Approval:** validated 2026-07-27 (backfill Phase 85, NYQ-02)

---

## Reconstruction Audit 2026-07-27 (Phase 85 NYQ-02)

| Metric | Count |
|--------|-------|
| Requirements audited | 8 (HYG-01..08), uno por plan de origen sobre los 5 planes |
| COVERED (automated unit / guard) | 8 (6 por unit test, 2 —HYG-02 y HYG-03— por guard de ausencia sobre la superficie real del CLI y del módulo) |
| PARTIAL | 0 |
| MISSING | 0 |
| Manual-only (by design) | 1 item (propagación real de `KODO_ORCHESTRATOR=1` vía `cmux.send`) — **cumplido**: `72-UAT.md` **1/1 pass** el 2026-07-14 |
| Tests citados (no re-corridos) | **92 pass / 0 fail** entre los spot-checks nominales de la fase (22 config-hardening + 67 batch de BAJAS + 3 gate del auto-commit), más las suites de secuencia y de dashboard declaradas verdes en las Truths; sobre suite completa **2027 tests: 2025 pass / 1 skip / 1 fail** — el fail es el flake pre-existente `gsd-lock-race`, **4/4 pass** en aislamiento y ajeno a esta fase |

**Nota Nyquist:** La lógica de riesgo de la fase (un auto-commit que solo dispara bajo marcador de rol y acotado por pathspec en sus dos pasos, la eliminación real —no el cableado muerto— de dos features prometidas, los efectos de cierre movidos al hook correcto y ordenados tras el backstop con try/catch individual, el cierre de la prototype pollution en **ambos** caminos de escritura de config, el chmod 0600 extendido al `.bak` con secreto, el gate de setup leyendo el JSON crudo, el estrechamiento de predicados que antes eran substring, y el strip de secuencias de control sobre todo el contenido externo que llega al terminal) está cubierta por tests unitarios deterministas con DI y por guards de ausencia sobre la superficie real, ya verde y verificada en `72-VERIFICATION.md` (passed 5/5, `behavior_unverified: 0`) contra HEAD `2adfebd`, es decir **después** de que el code-review adversarial encontrara 1 Critical + 7 Warnings y de que la pasada de fixes cerrara el Critical y 6 de los 7 —con los dos residuos, WR-06 y B12b, declarados como decisiones razonadas y no como huecos—. El único item no automatizable, la propagación real del marcador a través de `cmux.send`, es manual **por naturaleza** y quedó **cumplido** por UAT humano (`72-UAT.md` 1/1 pass, 2026-07-14), que es además la evidencia sobre la que `72-SECURITY.md` cierra T-72-02. **Sin re-ejecutar la suite** — cobertura citada de `72-VERIFICATION.md` + los 5 SUMMARY de plan (`72-01` a `72-05`) + `72-UAT.md` + `72-SECURITY.md`. Fase declarada **nyquist-compliant**.
