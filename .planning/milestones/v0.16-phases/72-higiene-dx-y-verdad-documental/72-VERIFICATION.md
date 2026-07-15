---
phase: 72-higiene-dx-y-verdad-documental
verified: 2026-07-13T13:33:42Z
status: passed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
human_verification:

  - test: "Lanzar el orquestador real (`kodo orchestrate`) en cmux+claude y comprobar que `process.env.KODO_ORCHESTRATOR === '1'` llega al proceso del hook `stop.js` (dogfooding)."
    expected: "El auto-commit de `.claude/skills/kodo-orchestrate/` dispara SOLO en la sesión orquestadora; una sesión normal del repo kodo ya no genera commits fantasma."
    why_human: "La inyección del marcador se hace como prefijo de un command-string enviado por `cmux.send` a un shell real (Pattern 3) — no hay spawn con env explícito. El código confirma la inyección (`launch.js:256`) y el gate (`stop.js:253`), y el test unitario cubre el gate con un git stub, pero la propagación real shell→proceso-hijo en un workspace cmux+claude real solo se puede confirmar lanzando el orquestador de verdad (72-01-SUMMARY D5, Open Question #1/A2, confianza MEDIA). El modo de fallo es seguro por diseño (sin var → skip, cero commits fantasma), así que esto no bloquea el goal, pero la fase lo dejó explícitamente pendiente de confirmación empírica."
---

# Phase 72: Higiene, DX y verdad documental Verification Report

**Phase Goal:** Saldar la higiene mecánica y la deriva documental: quitar features muertas, blindar el auto-commit del stop hook contra commits fantasma, mover los efectos de cierre al hook correcto, endurecer la config, aplicar el batch de BAJAS y reconciliar el README con la realidad del código. Es la ola paralelizable y de menor riesgo.
**Verified:** 2026-07-13T13:33:42Z
**Status:** human_needed
**Re-verification:** No — initial verification

**Context:** Verificado contra HEAD (`2adfebd`), es decir DESPUÉS del code-review (`72-REVIEW.md`: 1 Critical + 7 Warnings) y de la pasada de fixes (`72-REVIEW-FIX.md`: CR-01 + 6 warnings corregidos en `1ff783b..3f3c8ea`; WR-06 no-fix deliberado). Todas las comprobaciones de este informe leen el código y corren los tests en ese estado, no en el estado pre-review.

## Goal Achievement

### Observable Truths (Success Criteria del ROADMAP, literales)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | El stop hook solo auto-commitea si `KODO_ORCHESTRATOR=1` está presente y con pathspec completo `-- .claude/skills/kodo-orchestrate/` (HYG-01) | ✓ VERIFIED | `src/hooks/stop.js:253` gate `!== '1'` → return sin commit; `:283` `git add`/`git commit` ambos con `-- .claude/skills/kodo-orchestrate/`; `src/orchestrator/launch.js:256` inyecta `'KODO_ORCHESTRATOR=1'` como primer elemento de `claudeCmd`. Test `test/hooks/stop-idempotency.test.js` (describe HYG-01) y `test/skill-auto-commit.test.js` (casos A/B/C) verdes; WR-07 fix (`beforeEach` limpia la env var heredada) confirmado presente. |
| 2 | `kodo up --url` y `startHealthLoop` ya no existen (borrados, no cableados); README no los promete; coloreado/notify/nudge disparan en `SessionEnd`, no en `Stop` (HYG-02, HYG-03, HYG-04) | ✓ VERIFIED | `kodo up --help` (ejecutado) no lista `--url`; `dashboard --help` sí lo conserva. `grep -n "startHealthLoop\|stopHealthLoop\|runHealthCheck\|healthInterval" src/session/health.js` → 0 matches; `checkHealth`/`actOnHealth` intactas. `src/hooks/session-end.js:176-201` invoca `setColor`/`notify`/nudge (`buildStopNudgeText`) DESPUÉS de `performTerminalCleanup` (:159) y de `runReviewBackstop` (:126); `src/hooks/stop.js` ya no contiene esas tres llamadas (solo `cmux.notify` interno de `handleOrchestratorStop`, no relacionado). Test de secuencia `session-end.test.js` asserta `['backstop', 'setColor', 'notify']` (orden LOCKED D-08) — pasa. README (`grep -n "up --url\|60s\|health check cada"` → 0 matches). |
| 3 | Batch de endurecimiento de config aplicado (`__proto__`/`constructor`/`prototype` rechazado, chmod 0600 si `*_secret`, `split`→`indexOf`+`slice`, B5, B7) y el dashboard hace strip de `\x1b` en contenido externo (HYG-05, HYG-07) | ✓ VERIFIED | `src/cli/config-args.js:17,33` `FORBIDDEN_KEYS` + rechazo pre-walk; `src/config.js:9,222` `deepMerge` también filtra `FORBIDDEN_KEYS` (WR-01 fix, cierra el vector hermano que el review encontró abierto); `src/config.js:41-49` strip de comillas emparejadas (B5); `src/config.js:260` `deepMerge(structuredClone(DEFAULT_CONFIG), parsed)` + validación vía `config-validate.js` con warn NDJSON (B7); `src/config.js:135-142` chmod 0600 pre-rename condicional a `/_secret"\s*:/` (M5), y `:194` el `.bak` de migración también pasa por `writeFileAtomic` (WR-04 fix). `src/cli/format.js:80-86` `stripControlChars` elimina CSI + C0/C1/DEL incluyendo `\r` (WR-02 fix ampliado); cableado en `src/cli/dashboard/App.js` en 3 puntos: `:726-727` (task_ref/summary, WR-03 fix) y `:1715-1716` (proyección de comentarios). Suite `test/config-hardening.test.js` (22/22), `test/config.test.js` (CR-01 repro incluido), `test/config-migration-atomic.test.js`, `test/dashboard-format.test.js`, `test/dashboard-table.test.js` — todas verdes. |
| 4 | Batch de BAJAS mecánicas (B1, B2, B3, B4, B8, B9, B12 + M12) aplicado en diffs de 1-5 líneas (HYG-06) | ✓ VERIFIED | B1 `src/labels.js:29` whitelist con `'opus'`; B3 `src/gsd/verification.js:228` `!==`; B12a `:126-132` strip de `#` inline; B4 `src/gsd/verify.js:189` `dirPrefix` derivado del pad real; M12 `src/gsd/roadmap.js:33` regex `[-–—]`; B2 `src/providers/plane/client.js:11` `config.providers.plane`; B8 `:302` regex `^([A-Za-z][A-Za-z0-9]*)-(\d+)$`; B12c `:271-272` `isNameConflict409` estrechado a `already exists`; B9 `src/hooks/install.js:21` `isKodoHookCommand` (ruta canónica, no substring); B12d `src/providers/registry.js:66-81` guard + mensaje canónico. B12b (throttle epoch-vs-delta) diferido con nota explícita en `72-03-SUMMARY.md §Deferred Items`, amparado por D-02 del CONTEXT (sub-item de un grab-bag, diferible si excede presupuesto) — no es un gap, es scope-decision documentada. Todos los tests por hallazgo (`labels`, `gsd-verification`, `gsd-roadmap`, `plane-provider`, `hooks/install`, `registry`) verdes. |
| 5 | El README refleja la realidad POST-72 (stop hook real, `SessionEnd`/backstop, auto-commit gated, sin features borradas) (HYG-08) | ✓ VERIFIED | `git show 01588bd --stat` → `README.md | 13 ++++++++-----` (8 inserciones / 5 borrados, delta puro, no reescritura — consistente con D-04). Diagrama (:26-28) atribuye la transición a `SessionEnd`/backstop; «Al cerrar» (:269) describe el backstop de `SessionEnd`, no un efecto per-turn; tabla de arquitectura (:282) distingue `Stop` (estado ligero) de `SessionEnd` (backstop + cleanup + efectos); auto-commit (:258-261) menciona el gate `KODO_ORCHESTRATOR` y el pathspec de la skill. `grep -n "up --url\|60s\|health check cada" README.md` → 0 matches (ya eran verdaderos, sin cambio). Checkpoint humano de la Task 2 del plan 05 registrado como `approved` en el SUMMARY. |

**Score:** 5/5 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/hooks/stop.js` | Gate KODO_ORCHESTRATOR + pathspec; sin efectos de cierre | ✓ VERIFIED | Gate en `:253`, pathspec en `:283`, efectos ausentes (solo `cmux.notify` del auto-commit) |
| `src/orchestrator/launch.js` | Prefijo `KODO_ORCHESTRATOR=1` en `claudeCmd` | ✓ VERIFIED | `:256` |
| `src/hooks/session-end.js` | Efectos setColor/notify/nudge tras el backstop, never-throws | ✓ VERIFIED | `:176-201`, secuencia testeada |
| `src/cli.js` | Option `--url` de `up` eliminada; `setNestedValue`/parsers endurecidos (delegado a config-args.js) | ✓ VERIFIED | `up` sin `--url` (`:87-96`); `dashboard` la conserva (`:392-400`) |
| `src/cli/config-args.js` | `FORBIDDEN_KEYS` + parsers `indexOf`/`slice` (extraído, no en plan original pero documentado como auto-fix necesario) | ✓ VERIFIED | Creado en Plan 02, justificado en SUMMARY (cli.js ejecuta `program.parse()` al import) |
| `src/session/health.js` | Loop de health eliminado; `checkHealth`/`actOnHealth` conservadas | ✓ VERIFIED | grep 0 matches del loop; funciones vivas presentes |
| `src/config.js` | `loadEnvFile`/`loadConfig`/`writeFileAtomic` endurecidos + `loadRawConfig`/`needsSetup` (CR-01) | ✓ VERIFIED | Todos los símbolos presentes y testeados |
| `src/labels.js` | Whitelist opus/sonnet/haiku | ✓ VERIFIED | `:29` |
| `src/gsd/verification.js` | must_haves `!==`; YAML inline `#` manejado | ✓ VERIFIED | `:228`, `:126-132` |
| `src/gsd/verify.js` | Match de fase desacoplado del pad-2 | ✓ VERIFIED | `:189` |
| `src/gsd/roadmap.js` | Regex de header acepta `[-–—]` | ✓ VERIFIED | `:33` |
| `src/providers/plane/client.js` | `config.providers.plane.*`; regex de identificador; 409 estrecho; throttle (diferido) | ✓ VERIFIED (3/4; B12b diferido documentado) | `:11`, `:302`, `:271-272` |
| `src/hooks/install.js` | Match por ruta canónica | ✓ VERIFIED | `isKodoHookCommand` `:21` |
| `src/providers/registry.js` | Factory GitHub con guard y mensaje canónico | ✓ VERIFIED | `:66-81` |
| `src/cli/format.js` | Helper exportado `stripControlChars` | ✓ VERIFIED | `:80-86` |
| `src/cli/dashboard/App.js` | Proyección de comentarios (y task_ref/summary, WR-03) pasa por `stripControlChars` | ✓ VERIFIED | `:726-727`, `:1715-1716` |
| `README.md` | Claims reconciliados con el estado POST-72 | ✓ VERIFIED | Delta 8+/5− en `01588bd`, claims confirmados por grep/lectura directa |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `launch.js` (claudeCmd) | `stop.js` (`handleOrchestratorStop`) | env var prefijo → gate `process.env.KODO_ORCHESTRATOR` | ✓ WIRED (código); ⚠️ propagación real shell→hook pendiente de confirmación empírica | Gate y prefijo confirmados en código; test unitario cubre el gate directo, no el shell real de cmux — ver Human Verification |
| `session-end.js` (efectos) | `runReviewBackstop` (DELIV-04) | orden de ejecución en `runSessionEndHook` | ✓ WIRED | Test de secuencia asserta `['backstop', 'setColor', 'notify']` |
| `stop.js` (`buildStopNudgeText`) | `session-end.js` (nudge) | import estático `from './stop.js'` | ✓ WIRED | `session-end.js:23`; función sigue exportada y usada en tests de `stop.test.js` |
| `config-args.js` (`FORBIDDEN_KEYS`) | `config.js` (`deepMerge`) | import directo | ✓ WIRED | `config.js:9` — cierra WR-01 (vector hermano de M3) |
| `format.js` (`stripControlChars`) | `dashboard/App.js` (proyección) | import + 3 callsites | ✓ WIRED | `App.js:72,726,727,1715,1716` |
| `needsSetup` | `loadRawConfig` (5º seam, CR-01) | inyección de `_loadRawConfig` default | ✓ WIRED | Test repro CR-01 pasa: config mergeado completo pero crudo sin `base_url` → `needsSetup()===true` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|---------------------|--------|
| `needsSetup(providerName)` | gate estructural (3) | `loadRawConfig()` (parse + migrate, SIN deep-merge) | Sí — lee el JSON crudo de disco, no el merge con defaults | ✓ FLOWING |
| `mergeAndValidateConfig` | config runtime | `deepMerge(structuredClone(DEFAULT_CONFIG), parsed)` + `config-validate.js` | Sí — valida contra los 11 campos editables reales | ✓ FLOWING |
| Proyección de comentarios/task_ref/summary en dashboard | `stripControlChars(...)` | `comments.map`, `enriched` map de rows | Sí — el saneo se aplica sobre datos reales del provider, no un stub | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| `up --help` no lista `--url` | `node src/cli.js up --help` | Solo `-h, --help` | ✓ PASS |
| `dashboard --help` conserva `--url` | `node src/cli.js dashboard --help` | `--url <baseUrl>` presente | ✓ PASS |
| Gate + pathspec del auto-commit (unit) | `node --test test/hooks/stop-idempotency.test.js test/skill-auto-commit.test.js` | 3/3 + suite verde | ✓ PASS |
| Secuencia backstop→efectos (unit) | `node --test test/hooks/session-end.test.js` | assert `['backstop','setColor','notify']` | ✓ PASS |
| CR-01 repro (needsSetup pre-merge) | `node --test --test-name-pattern="CR-01" test/config.test.js` | 1/1 pass | ✓ PASS |
| Config hardening (M3/M14/B5/B7/M5) | `node --test test/config-hardening.test.js` | 22/22 pass | ✓ PASS |
| BAJAS batch (labels/verification/verify/roadmap/plane/install/registry) | `node --test test/labels.test.js test/gsd-verification.test.js test/gsd-roadmap.test.js test/plane-provider.test.js test/hooks/install.test.js test/registry.test.js` | 67/67 pass | ✓ PASS |
| Suite completa | `npm test` | 2027 tests, 2025 pass, 1 fail (`gsd-lock-race`, flaky timing), 1 skip | ✓ PASS (fallo pre-existente confirmado no relacionado — ver abajo) |
| `gsd-lock-race` en aislamiento | `node --test test/gsd-lock-race.test.js` | 4/4 pass | ✓ PASS (confirma flake de concurrencia, no regresión de la fase) |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|----------|
| HYG-01 | 72-01 | Gate `KODO_ORCHESTRATOR` + pathspec en el auto-commit | ✓ SATISFIED | `stop.js:253,283`, `launch.js:256` |
| HYG-02 | 72-02 | `kodo up --url` eliminado | ✓ SATISFIED | `cli.js:87-96` |
| HYG-03 | 72-02 | `startHealthLoop` eliminado | ✓ SATISFIED | `health.js` (0 matches del loop) |
| HYG-04 | 72-01 | Efectos de cierre movidos a `SessionEnd` | ✓ SATISFIED | `session-end.js:176-201` |
| HYG-05 | 72-02 | Batch de endurecimiento de config (M3/M5/M14/B5/B7) | ✓ SATISFIED | `config.js`, `config-args.js` |
| HYG-06 | 72-03 | Batch de BAJAS mecánicas (B1-B12+M12) | ✓ SATISFIED (B12b diferido con nota) | ver tabla de artefactos |
| HYG-07 | 72-04 | Dashboard strip de `\x1b` | ✓ SATISFIED | `format.js:80-86`, `App.js` |
| HYG-08 | 72-05 | README reconciliado con la realidad POST-72 | ✓ SATISFIED | `README.md`, commit `01588bd` |

Los 8 IDs de REQUIREMENTS.md para Phase 72 (`HYG-01`..`HYG-08`) están cubiertos por exactamente un plan cada uno. Sin requirements huérfanos (`grep -n "Phase 72" .planning/REQUIREMENTS.md` no lista IDs adicionales fuera de los 8 declarados en los frontmatter de los planes).

### Anti-Patterns Found

Ningún `TBD`/`FIXME`/`XXX` en los 18 ficheros de código tocados por la fase. Los matches de `TODO`/`PLACEHOLDER`/`not available` encontrados son falsos positivos: la palabra española «TODO» (= "all", p. ej. «TODO el bloque add+commit») o comentarios de error-handling pre-existentes («Config or provider module not available — skip»), no marcadores de deuda. Ningún hallazgo bloqueante.

### Code Review Findings (post-fix)

El code-review adversarial (`72-REVIEW.md`) encontró 1 Critical + 7 Warnings sobre el estado pre-fix. La pasada de fixes (`72-REVIEW-FIX.md`, commits `1ff783b..3f3c8ea`) corrigió el Critical y 6 de los 7 Warnings, todos verificados en este informe contra el código real (no solo contra las narrativas de los SUMMARY):

- **CR-01** (deep-merge mataba `needsSetup`) → `loadRawConfig` + 5º seam — verificado con test repro pasando.
- **WR-01** (`deepMerge` reabría prototype pollution) → `FORBIDDEN_KEYS` filtrado en `deepMerge` — verificado en código.
- **WR-02** (`stripControlChars` no cubría C1 ni `\r`) → regex ampliado — verificado en código.
- **WR-03** (task_ref/summary sin sanear) → saneados en `App.js:726-727` — verificado en código.
- **WR-04** (`.bak` de migración world-readable con secreto) → hereda `writeFileAtomic` — verificado en código.
- **WR-05** (`--set` pinneaba todos los defaults) → `config-set-raw.test.js` verificado pasando.
- **WR-07** (test del gate flaky con env heredada) → `beforeEach` limpia la var — verificado en código.
- **WR-06** (efectos de cierre dependen de un `SessionEnd` limpio) → **no-fix deliberado**, documentado como decisión aceptada (dirección del audit D-08 del CONTEXT). No es un gap de esta fase: es el comportamiento intencional de HYG-04. El propio review lo señala como «acción de verificación operativa» (UAT), no un bug de código — coincide con el ítem D5 de human verification de este informe (confirmar en dogfooding que el ciclo de cierre real dispara correctamente).

### Human Verification Required

### 1. Propagación empírica de `KODO_ORCHESTRATOR=1` al proceso del hook (D5, 72-01)

**Test:** Lanzar el orquestador real (`kodo orchestrate`) en un workspace cmux+claude real y observar, desde dentro del hook `stop.js` en esa sesión, que `process.env.KODO_ORCHESTRATOR === '1'`.
**Expected:** El auto-commit de `.claude/skills/kodo-orchestrate/` dispara SOLO en esa sesión orquestadora; una sesión normal del repo kodo (dev) no genera commits fantasma.
**Why human:** La variable se inyecta como prefijo de un command-string enviado a un shell real vía `cmux.send` (no hay `spawn` con `env` explícito — Pattern 3). El código confirma la inyección y el gate, y el test unitario cubre el gate con un git stub aislado, pero la propagación real shell→proceso-hijo en un entorno cmux+claude vivo solo se puede confirmar dogfooding. Modo de fallo seguro por diseño: si la propagación fallara, el gate hace skip (cero commits fantasma), así que esto no bloquea el goal — pero la propia fase lo dejó anotado como pendiente de confirmación (72-01-SUMMARY §Next Phase Readiness, D5) y el CONTEXT de la fase lo pide explícitamente en `<verification>` del plan 01.

### Gaps Summary

Ningún gap bloqueante. Las 5 Success Criteria del ROADMAP para Phase 72 están verificadas contra el código en HEAD (`2adfebd`, post-review-fix), con evidencia de grep/lectura directa y suites de test pasando (incluida la re-verificación específica de los 7 hallazgos corregidos por el pase de review). El único ítem pendiente es una confirmación empírica de dogfooding (D5) que la propia fase declaró como fuera del alcance de un test unitario y cuyo modo de fallo es seguro por diseño — se enruta a verificación humana, no a gap. B12b (throttle epoch-vs-delta) queda diferido con nota explícita amparada por la decisión D-02 del CONTEXT — scope-decision documentada, no gap. WR-06 (dependencia de un SessionEnd limpio) es la dirección deliberada del audit, con no-fix explícito y razonado en `72-REVIEW-FIX.md` — no gap.

---

_Verified: 2026-07-13T13:33:42Z_
_Verifier: Claude (gsd-verifier)_
