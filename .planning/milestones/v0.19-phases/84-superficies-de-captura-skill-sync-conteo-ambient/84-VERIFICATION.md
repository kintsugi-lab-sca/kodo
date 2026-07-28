---
phase: 84-superficies-de-captura-skill-sync-conteo-ambient
verified: 2026-07-26T09:43:10Z
status: passed
score: 4/5 must-haves verified
behavior_unverified: 1 # CAPT-02 "UI · error" backstop — comportamiento de prompt, no unit-testeable por diseño
overrides_applied: 0
behavior_unverified_items:

  - truth: "UI · error (CAPT-02, 84-02 must_haves, `verification: backstop`): si `kodo` no está en el PATH o `kodo capture` termina con código ≠ 0, el modelo reporta el stderr verbatim y se detiene, sin escribir el inbox a mano."
    test: "Invocar `/kodo-capture \"texto\"` en una sesión real de Claude Code con `kodo` fuera del PATH o forzando un exit ≠ 0 en `kodo capture`."
    expected: "El modelo pega el stderr tal cual en el chat y NO reintenta escribiendo `~/.kodo/inbox.md` a mano."
    why_human: "Un `SKILL.md` es un prompt. La mitad estructural (unicidad de la invocación + igualdad de argv, así que no hay un segundo camino de escritura) está blindada por `test/kodo-capture-skill.test.js`; que el modelo efectivamente obedezca la regla 7 del cuerpo del SKILL.md no es observable sin ejecutar el LLM."
human_verification:

  - test: "Tras `kodo skill sync` con HOME real, abrir una sesión de Claude Code en un repo cualquiera e invocar `/kodo-capture \"prueba UAT 84\"`."
    expected: "`kodo inbox` muestra la línea con origen `skill` y el tag de proyecto correcto; el skill se cargó y `allowed-tools: Bash(kodo capture *)` no disparó un prompt de permiso adicional (assumption A2 de 84-RESEARCH.md)."
    why_human: "Verifica que Claude Code carga la skill de proyecto y que el patrón `allowed-tools` casa la invocación con separador `--`; ningún test automatizado ejecuta el LLM (D6 de 84-02-SUMMARY.md, coverage)."

  - test: "Igual que arriba pero con `kodo` fuera del PATH o forzando un exit ≠ 0 en `kodo capture` (ver `behavior_unverified_items` arriba)."
    expected: "El modelo reporta el stderr verbatim y se detiene, sin escribir el inbox a mano."
    why_human: "Backstop explícito marcado `verification: backstop` en 84-02-PLAN.md; comportamiento de prompt."

  - test: "`kodo capture \"x\"` tres veces, abrir el dashboard TUI y comprobar que `N sin enrutar` aparece junto al indicador de conexión; luego `kodo inbox discard <id>` las tres capturas y comprobar que el elemento DESAPARECE (no `0 sin enrutar`)."
    expected: "El conteo aparece con capturas abiertas y desaparece por completo al llegar a 0 — ninguna franja intermedia con placeholder."
    why_human: "Juicio perceptual sobre un TUI real con el inbox real del operador (D9 de 84-03-SUMMARY.md, coverage); ningún assert de frame cubre la sensación ambient del ciclo completo."

  - test: "Ejecutar la suite de `kodo-capture` y `skill-sync` en un filesystem case-sensitive (Linux, CI, o contenedor)."
    expected: "El test `D-07 case-tolerance` de `test/skill-sync.test.js` sigue en verde cuando el entrypoint real es `SKILL.md` en mayúsculas."
    why_human: "En macOS ese test pasa TRIVIALMENTE porque el filesystem es case-insensitive (`existsSync(join(dir,'skill.md'))` da `true` aunque solo exista `SKILL.md`). Su mordida real solo es observable en un filesystem case-sensitive, no disponible en este entorno de verificación. Documentado como tal en el propio test (`skill-sync.test.js:759`) y en `84-01-SUMMARY.md` (coverage D6, `human_judgment: true`)."
---

# Phase 84: Superficies de captura, skill sync y conteo ambient — Verification Report

**Phase Goal:** La captura mid-session y la presión de triage cierran el ciclo — `/kodo-capture` captura desde dentro de una sesión Claude Code con formato byte-idéntico al CLI, y el operador ve el conteo de capturas sin enrutar como superficie ambient contra el inbox rot.
**Verified:** 2026-07-26T09:43:10Z
**Status:** human_needed
**Re-verification:** No — verificación inicial

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|---|---|---|
| 1 | CAPT-02 — `/kodo-capture` captura mid-session derivando proyecto/tarea del cwd de forma determinista y shelleando a `kodo capture`; formato byte-idéntico al CLI, un solo writer, golden test skill-path↔CLI-path | ✓ VERIFIED | `.claude/skills/kodo-capture/SKILL.md` existe con frontmatter completo; invocación canónica única `kodo capture --origin skill -- '<texto>'` (comillas SIMPLES tras el fix CR-01); `test/kodo-capture-skill.test.js` — 11 tests · 0 fail, incluida la vía in-process (byte-identidad con el golden de Phase 83) y la vía child-process real con texto adversarial |
| 2 | CAPT-05 — `kodo skill sync` distribuye tanto `kodo-orchestrate` como `kodo-capture`; el mecanismo single-skill queda generalizado a multi-skill de forma explícita | ✓ VERIFIED | `KODO_SKILLS = Object.freeze(['kodo-orchestrate', 'kodo-capture'])` en `src/cli/skill-sync.js:43`; `test/skill-sync.test.js` — 26 tests · 0 fail; **e2e ejecutado por este verificador** con `HOME` sandbox: `bin/kodo skill sync --json` → `{"status":"ok","files_changed":2,"skills":[{"name":"kodo-orchestrate",...},{"name":"kodo-capture",...}]}`, y `ls $HOME/.claude/skills/` solo contiene `kodo-capture` y `kodo-orchestrate` (sin `worktree-cleanup`) |
| 3 | CAPT-07 — el operador ve en el dashboard TUI el conteo de capturas sin enrutar, leído de `~/.kodo/inbox.md` (reader leaf never-throws, cero endpoints nuevos en `src/server.js`) | ✓ VERIFIED | `src/cli/dashboard/inbox-count.js` — leaf con 3 imports builtin, `try` de cuerpo entero (incl. resolución del `homedir`, fix WR-01), `OPEN_LINE_RE` constante de módulo; cableado confirmado en `App.js:755` (`inboxOpen = inboxCountFn({})`) y `SessionTable.js:938` (`inboxOpen > 0 ? …yellow… : null`); `test/dashboard-inbox-count.test.js` — 14 tests · 0 fail, incluido el anti-drift contra `listCaptures` y el test de lectura parcial bajo `O_APPEND` concurrente simulado; `git diff d6297e8..HEAD --stat -- src/server.js` vacío |
| 4 | CAPT-02 · UI · empty/error backstop: si `kodo` no está en PATH o el exit ≠ 0, el modelo reporta stderr verbatim y se detiene | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | Mitad estructural blindada (unicidad + igualdad de argv → no hay segundo camino de escritura); la mitad de "el modelo obedece la regla 7" es comportamiento de prompt, marcado `verification: backstop` en 84-02-PLAN.md desde su origen — no cerrable por unit test |
| 5 | CAPT-07 · UI · overflow backstop: en terminal estrecho el indicador de conexión conserva su posición y el conteo es lo que ink envuelve | ✓ VERIFIED | Marcado `verification: backstop` en 84-03-PLAN.md, pero el SUMMARY declara haberlo **cerrado** con un harness de stdout propio pasado a `render` de ink; confirmado en código: `describe('CAPT-07 · backstop de overflow (84-UI-SPEC §UI Considerations)', …)` en `test/dashboard-inbox-count.test.js:463-509`, incluido en los 14 tests verdes. `84-UI-SPEC.md` sigue etiquetándolo `🧪 backstop` — documentación desactualizada, no un hueco de implementación |

**Score:** 4/5 truths verified (1 present, behavior-unverified by design — comportamiento de prompt no unit-testeable)

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `.claude/skills/kodo-capture/SKILL.md` | Skill de proyecto con frontmatter, invocación canónica única, comillas simples | ✓ VERIFIED | Existe, 34 líneas, frontmatter con `name`/`description`/`argument-hint`/`allowed-tools: Bash(kodo capture *)`; invocación con comillas simples (`kodo capture --origin skill -- '<texto>'`) tras el fix CR-01 |
| `src/cli/skill-sync.js` | `KODO_SKILLS` allowlist, bucle por skill, render dual | ✓ VERIFIED | `KODO_SKILLS`/`IDENTITY_SKILL`/`ENTRYPOINTS` en :43/:52/:62; bucle en :134; e2e confirma distribución correcta |
| `src/skill/sync.js` | Gate de entrypoint case-tolerante (`SKILL.md`/`skill.md`) | ✓ VERIFIED | Única condición modificada; los 8 tests unit de la Suite 1 siguen verdes sin tocarse |
| `src/cli/dashboard/inbox-count.js` | Leaf never-throws, 3 imports builtin, path perezoso | ✓ VERIFIED | Confirmado por lectura directa del fichero; `homedir()` y la construcción de `kodoDir` están DENTRO del `try` (fix WR-01, línea :98) |
| `src/cli/dashboard/App.js` / `SessionTable.js` | Prop `inboxCountFn`/`inboxOpen`, render condicional en amarillo | ✓ VERIFIED | `App.js:755` calcula `inboxOpen`; `App.js:2068` lo propaga; `SessionTable.js:938` lo pinta como tercer hijo del header, oculto en 0 |
| `test/kodo-capture-skill.test.js` | Contrato del markdown blindado con golden + ejecución real | ✓ VERIFIED | 11 tests · 0 fail (incluye el test de shell añadido en el fix CR-01: `spawnSync('bash', ['-c', comando], …)`) |
| `test/skill-sync.test.js` | Suite adaptada a multi-skill + guard anti-generalización | ✓ VERIFIED | 26 tests · 0 fail |
| `test/dashboard-inbox-count.test.js` | Anti-drift, never-throws, render | ✓ VERIFIED | 14 tests · 0 fail |
| `.planning/phases/84-.../deferred-items.md` | 6 ítems diferidos con trigger real | ✓ VERIFIED | Existe, 6 filas (D-08b, D-08, D-24, D-13, format-isolation transitivo, 83-05 drenaje stdout), todas con columna Trigger no vacía |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| `KODO_SKILLS[i]` | `join(homedir(), '.claude', 'skills', name)` | bucle del handler + `syncFn` | ✓ WIRED | E2E confirmado: destino sandbox recibe exactamente las dos skills del registro |
| Bloque cercado del `SKILL.md` | `test/kodo-capture-skill.test.js` (`BLOCK_RE`/`ARGV_CANONICO`) | extracción + `deepEqual` | ✓ WIRED | Editar a mano la línea (mordida documentada en 84-02-SUMMARY.md) pone rojo el test |
| Invocación del `SKILL.md` | shell real (`bash -c`) | test añadido en el fix CR-01 | ✓ WIRED | `test/kodo-capture-skill.test.js:386-436` ejecuta la línea literal por `bash -c` con texto `$(id -un)` y `` `hostname` `` y asserta que NO se expande |
| `OPEN_LINE_RE` | `LINE_RE` (`src/inbox/store.js:126`) | test anti-drift sobre fixture compartido | ✓ WIRED (con caveat) | Igualdad exacta hoy (0 mismatches en fuzz de 20 000 líneas, según REVIEW.md); es un anclaje de **fixture**, no de propiedad — ver WR-04 en Anti-Patterns |
| `readOpenCaptureCount` | `App.js` → `SessionTable.js` | prop `inboxCountFn` → `inboxOpen` | ✓ WIRED | Confirmado por lectura de código en los tres ficheros |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| `SessionTable.js` header | `inboxOpen` | `App.js:755` → `inboxCountFn({})` → `readOpenCaptureCount` → lectura real de `~/.kodo/inbox.md` (o `kodoDir` inyectado en tests) | Sí | ✓ FLOWING |
| `kodo skill sync` render | `perSkill` | bucle sobre `KODO_SKILLS` → `syncFn({source, dest, prune})` → filesystem real | Sí | ✓ FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| `kodo skill sync --json` distribuye ambas skills en HOME sandbox | `HOME=$(mktemp -d) node bin/kodo skill sync --json` | `{"status":"ok","files_changed":2,"skills":[{"name":"kodo-orchestrate","status":"ok","files_changed":1},{"name":"kodo-capture","status":"ok","files_changed":1}]}`; `ls $HOME/.claude/skills/` → `kodo-capture`, `kodo-orchestrate` (sin `worktree-cleanup`) | ✓ PASS |
| `test/kodo-capture-skill.test.js` (fichero completo) | `node --test test/kodo-capture-skill.test.js` | 11 tests · 0 fail, incluida la mordida CR-01 (`CR-01 mordida — la MISMA línea con comillas dobles sí expande`) | ✓ PASS |
| `test/skill-sync.test.js` (fichero completo) | `node --test test/skill-sync.test.js` | 26 tests · 0 fail | ✓ PASS |
| `test/dashboard-inbox-count.test.js` (fichero completo) | `node --test test/dashboard-inbox-count.test.js` | 14 tests · 0 fail (incluye WR-01 y el backstop de overflow) | ✓ PASS |
| `test/format-isolation.test.js` (fichero completo) | `node --test test/format-isolation.test.js` | 8 tests · 0 fail — `inbox-count.js` pasa el guard de aislamiento de color | ✓ PASS |
| Suite completa | `npm test` | **2586 tests · 2585 pass · 0 fail · 1 skipped** — coincide exactamente con lo reportado independientemente por el orquestador | ✓ PASS |
| `src/server.js` / `src/inbox/store.js` / `usePoll.js` sin tocar | `git diff d6297e8..HEAD --stat -- src/server.js src/inbox/store.js src/cli/dashboard/usePoll.js` | sin salida | ✓ PASS |

### Probe Execution

No hay probes convencionales (`scripts/*/tests/probe-*.sh`) ni declarados en los PLAN/SUMMARY de esta fase. **Step 7c: SKIPPED (sin probes aplicables — fase de superficies CLI/TUI verificada por suite `node --test` y checks e2e manuales)**.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| CAPT-02 | 84-02-PLAN.md | `/kodo-capture` captura mid-session con formato byte-idéntico al CLI, un solo writer | ✓ SATISFIED | Ver truth #1 y #4; REQUIREMENTS.md lo marca `[x]` Complete |
| CAPT-05 | 84-01-PLAN.md | `kodo skill sync` distribuye también `kodo-capture` | ✓ SATISFIED | Ver truth #2; REQUIREMENTS.md lo marca `[x]` Complete |
| CAPT-07 | 84-03-PLAN.md | Conteo de capturas sin enrutar como superficie ambient en el dashboard | ✓ SATISFIED | Ver truth #3 y #5; REQUIREMENTS.md lo marca `[x]` Complete |

No hay requisitos huérfanos: `grep -n "Phase 84" .planning/REQUIREMENTS.md` solo lista CAPT-02, CAPT-05, CAPT-07, y las tres aparecen en el campo `requirements:` de sus respectivos PLAN.md.

### Anti-Patterns Found

Ningún marcador de deuda (`TBD`/`FIXME`/`XXX`) ni placeholder en los ficheros modificados por la fase — la única aparición de "TODO" en el diff es la palabra española "todo/todos" en comentarios y en un fixture de test (`- [ ] TODO: revisar esto mañana`, deliberado como hand-edit adversarial), no el marcador de deuda en inglés.

El code review de la fase (`84-REVIEW.md`) es más severo que este verificador en un punto y coincide en el resto. Su **BLOCKER** (CR-01, inyección de comandos por comillas dobles en la invocación congelada) y su **WARNING** WR-01 (never-throws roto por resolución de path fuera del `try`) están **confirmados cerrados** en el commit `c91f4d2`: comillas simples + test de ejecución real por `bash -c` para CR-01; resolución de `homedir()` movida dentro del `try` para WR-01. Ambos verificados por este verificador leyendo el código actual y ejecutando los tests correspondientes (no solo por la narrativa del REVIEW).

Quedan **6 warnings + 4 info abiertos** en `84-REVIEW.md`, ninguno de los cuales invalida las tres observable truths del roadmap tal como están literalmente redactadas, pero que una verificación honesta no puede omitir:

| ID | Severidad | Resumen | ¿Rompe un must-have de esta fase? |
|---|---|---|---|
| WR-02 | ⚠️ Warning | En un repo/checkout que NO tenga `kodo-capture` en `.claude/skills/` (p. ej. un fork o un worktree anterior a esta fase), `kodo skill sync` pasa de exit 0 a exit 1, clasificando la ausencia como "filesystem error" | No, para el repo kodo actual (ya tiene ambas skills); sí es una regresión de DX/CI para OTROS checkouts — fuera del boundary literal de CAPT-05 tal como está escrita, pero real |
| WR-03 | ⚠️ Warning | El payload `--json` en la rama de error es un contrato nuevo sin tests que lo fijen (3 de 4 ramas condicionales sin cobertura) | No rompe la truth D5 del plan 84-01 (que cubre el happy path), pero es un hueco de regresión futura en el contrato `--json` |
| WR-04 | ⚠️ Warning | El test anti-drift de `OPEN_LINE_RE` vs `LINE_RE` es de fixture, no de propiedad: si `LINE_RE` gana un tercer estado o ensancha su charset, el leaf podría subcontar sin que la suite lo detecte (hoy 0 divergencias medidas por fuzz de 20 000 líneas) | No rompe la truth de hoy; es un riesgo de mantenimiento futuro documentado por el propio reviewer |
| WR-05 | ⚠️ Warning (relacionado con CR-01, ya parcialmente resuelto) | El carril "child-process" original no pasaba por ningún shell — **este hueco específico ya se cerró** en `c91f4d2` (test `bash -c` añadido); el REVIEW.md no se actualizó para retirar WR-05 de la lista de abiertos aunque su fix está en el mismo commit que cerró CR-01 | Ya no aplica en la práctica — verificado que el test existe y pasa |
| WR-06 | ⚠️ Warning | `inboxCountFn` se invoca en el cuerpo del render en TODOS los modos (incluidos overlays/config con early-return), no solo donde se pinta: I/O síncrona sin acotar en cada pulsación de tecla | No rompe la truth CAPT-07 tal como está redactada ("el operador ve el conteo… leído de `~/.kodo/inbox.md`"); es un riesgo de rendimiento/arquitectura, aceptado explícitamente en el threat model de 84-03 (T-84-16) para el caso normal, pero WR-06 señala que también corre en rutas donde no aporta nada |
| WR-07 | ⚠️ Warning | Los 7 ficheros de test de dashboard preexistentes no sandboxean `inboxCountFn` y leerán el `~/.kodo/inbox.md` real de quien ejecute la suite | No rompe ninguna truth de esta fase; es no-hermeticidad latente ya documentada por el propio plan/summary |
| IN-01 a IN-04 | ℹ️ Info | Comentario "lazy" desactualizado, campos opcionales ausentes en `skills[]`, `@param` faltante en JSDoc, pérdida de aviso de symlink en fallo | No rompen ninguna truth; deuda cosmética/DX menor |

**WR-05 es la única corrección de este verificador sobre el estado de `84-REVIEW.md`:** su fix ya está en el commit `c91f4d2` (el mismo que cierra CR-01) — el listado de "6 warnings abiertos" en el frontmatter de `84-REVIEW.md` no se actualizó tras la resolución, pero el conteo `resolved: 2` sigue siendo correcto para CR-01+WR-01.

### Human Verification Required

Ver `human_verification` en el frontmatter. Resumen:

1. **UAT de carga real de la skill** — `/kodo-capture` desde una sesión de Claude Code real, tras `kodo skill sync`.
2. **UAT del backstop de error** — `kodo` fuera del PATH o exit ≠ 0, comprobar que el modelo reporta stderr verbatim y no reintenta escribir el inbox a mano.
3. **UAT del ciclo ambient completo** — capturar 3, ver el conteo, triar las 3, ver que desaparece (no `0`).
4. **D-07 en filesystem case-sensitive** — el test de tolerancia de mayúsculas/minúsculas del entrypoint pasa trivialmente en macOS; solo muerde en Linux/CI, no disponible en este entorno.

### Gaps Summary

No hay gaps que bloqueen el objetivo de la fase. Las tres observable truths del roadmap (CAPT-02, CAPT-05, CAPT-07) están verificadas con evidencia de código, tests que este verificador ejecutó de forma independiente (no solo la narrativa de los SUMMARY), y un check e2e manual sobre `kodo skill sync --json` con HOME sandboxed.

El BLOCKER original del code review (CR-01, inyección de comandos vía comillas dobles) y su WARNING acompañante (WR-01, never-throws roto) están confirmados **cerrados** en el commit `c91f4d2`, con mordida verificada en ambos sentidos por este verificador (lectura del código + ejecución de los tests de mordida).

Lo que impide un veredicto `passed` limpio:

- Un ítem de comportamiento de prompt irreducible por diseño (CAPT-02 · UI · error backstop) que ningún unit test puede cerrar — marcado `verification: backstop` desde el propio plan.
- Tres ítems de UAT explícitamente pendientes en los SUMMARY de los tres planes (carga real de la skill, ciclo ambient completo, D-07 en Linux).
- Seis warnings + cuatro info abiertos en `84-REVIEW.md` que no invalidan las truths pero que una auditoría honesta no puede callar — ninguno alcanza severidad BLOCKER y ninguno contradice lo que el roadmap pide literalmente, pero WR-02 (regresión de exit code para checkouts sin `kodo-capture`) y WR-04 (anti-drift de fixture, no de propiedad) merecen atención humana antes de considerar la fase "cerrada del todo" en sentido amplio.

---

_Verified: 2026-07-26T09:43:10Z_
_Verifier: Claude (gsd-verifier)_
