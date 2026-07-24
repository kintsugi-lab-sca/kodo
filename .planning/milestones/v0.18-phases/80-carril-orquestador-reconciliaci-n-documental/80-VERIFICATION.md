---
phase: 80-carril-orquestador-reconciliaci-n-documental
verified: 2026-07-23T20:22:31Z
status: passed
score: 11/12 must-haves verified
behavior_unverified: 1
overrides_applied: 0
behavior_unverified_items:

  - truth: "SC1 (ROADMAP)/T5 (80-01): con needsOrchestrator===true, un sidebar con workspaces sueltos o grupos vacíos converge al estado agrupado en ≤1 pase (loose→add, empty→ungroup) — y un 2º pase sobre el sidebar ya convergido ejecuta 0 acciones"
    test: "Lanzar una sesión kodo suelta (sin su grupo cmux creado) o dejar un grupo cmux vacío tras cerrar sus miembros; disparar un pase de `kodo check` ya motivado (stuck/review/pending); observar la línea `[kodo:check] Sidebar: N acción(es) aplicadas` y verificar en la sidebar real de cmux que el workspace pasó a estar agrupado / el grupo vacío desapareció"
    expected: "Tras el pase motivado, el sidebar de cmux muestra el workspace ya agrupado (o el grupo vacío disuelto) sin intervención humana; un 2º pase motivado inmediato no vuelve a mover nada (`Sidebar: 0 acción(es) aplicadas`)"
    why_human: "El motor `scan`/`execute` se prueba con fixtures mockeados (deps stub, sin cmux real) y el piggyback se prueba con `scanFn`/`executeFn` inyectados — ningún test del repo ejercita el ciclo completo contra una sidebar cmux viva, así que la convergencia observable en ≤1 pase no tiene evidencia de comportamiento real, solo de cableado correcto"
---

# Phase 80: Carril orquestador + reconciliación documental — Verification Report

**Phase Goal:** El orquestador mantiene el sidebar limpio automáticamente, sin que el humano intervenga: invoca `kodo sidebar doctor --fix` de piggyback en pases ya motivados por `kodo check` (el sidebar NO es trigger — consistencia eventual asumida). Y su skill `kodo-orchestrate` + `src/orchestrator/prompt.md` dejan de estar desfasados: reflejan toda la realidad post-v0.17 que hoy no mencionan.

**Verified:** 2026-07-23T20:22:31Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | (SC-ORCH-07/T5) Con `needsOrchestrator===true`, un sidebar con workspaces sueltos o grupos vacíos converge al estado agrupado en ≤1 pase, sin intervención humana | ⚠️ PRESENT_BEHAVIOR_UNVERIFIED | `src/check.js:148-166` invoca `scanFn`/`executeFn({fix:true})` antes de `launchFn`; tests A/D usan stubs inyectados, no un cmux real — cableado correcto, convergencia real no ejercitada por ningún test |
| 2 | (D-05/T1) `executeFn(deps,{fix:true})` corre ANTES de `launchOrchestrator()` cuando `needsOrchestrator===true` | ✓ VERIFIED | Test A (`test/check.test.js:338-355`) pasa, orden `execute` < `launch` en array compartido; `node --test` → verde |
| 3 | (D-03/T2, edge a) Con `needsOrchestrator===false`, cero llamadas al doctor | ✓ VERIFIED | Test B (`test/check.test.js:357-369`), `calls === []`; verde |
| 4 | (D-04/T3, edge c) El resultado del doctor JAMÁS entra en `reasons` ni altera `needsOrchestrator` | ✓ VERIFIED | Test C (`test/check.test.js:371-395`): sidebar sucio + check limpio ⇒ 0 llamadas; inspección de `src/check.js` confirma que `report`/`r` solo se pasan a `logFn`, nunca a `reasons` |
| 5 | (D-05/T4, edge b) Un error de `scan`/`execute` no bloquea el check ni `launchOrchestrator` — fail-open | ✓ VERIFIED | Test D + D2 (`test/check.test.js:397-426`) verdes: throw en `executeFn`/`scanFn` no propaga, `launchFn` corre igual |
| 6 | (edge d) 0 acciones no genera bucle sobre advisories (`missing_group` nunca se ejecuta, cero dependencia del nº de pases) | ✓ VERIFIED | `test/cmux/sidebar-doctor.test.js:218` (G-79-1): `missing_group` NUNCA emite `create`/`set-anchor` bajo `execute()`; estructuralmente excluido de `hasActions` — invariante independiente del nº de pases |
| 7 | (Pitfall 4) `runCheck()` queda byte-idéntico — sin líneas `Sidebar` en su `summary` | ✓ VERIFIED | Test E (`test/check.test.js:428-439`) verde; inspección directa del cuerpo de `runCheck()` en `src/check.js:67-119` sin menciones a `Sidebar` |
| 8 | (LOG-12) `src/check.js` alcanza `src/cmux/sidebar-doctor.js` en su grafo de imports Y sigue sin alcanzar `logger.js`/`github/provider.js`/`github/normalize.js`/`triggers/polling.js` | ✓ VERIFIED | `test/check-isolation.test.js:156` (convergencia) + 4 guards negativos preexistentes, los 5 en verde; `node --test test/check-isolation.test.js` → 33/33 (combinado con check.test.js) |
| 9 | (ORCH-07, no trigger) No se añade ningún trigger nuevo al orquestador; el sidebar solo converge en pases YA motivados | ✓ VERIFIED | `src/check.js` — el bloque piggyback vive dentro de `if (result.needsOrchestrator)`, consumido no alimentado; sin nuevas fuentes de `reasons` |
| 10 | (ORCH-08) `skill.md` y `prompt.md` mencionan `kodo sidebar doctor` y las 4 features v0.17 (`NEXT:`, dashboard/nudge, `pending_stale`, `--group`) | ✓ VERIFIED | grep en ambos ficheros: los 4 tokens presentes en `skill.md` y `prompt.md` (ejecutado directamente, no solo citado del PLAN) |
| 11 | (D-12) Bloque `<!-- BEGIN/END reporting -->` y placeholders `{{provider}}`/`{{provider_name}}`/`{{mcp_tool}}` de `prompt.md` intactos | ✓ VERIFIED | grep de los 5 marcadores → todos presentes; `git show 8100e8d` confirma el diff añade 2 párrafos ANTES de `## Reglas mínimas`, fuera del bloque (líneas 51-120) |
| 12 | (D-11/HYG-08) Ni skill ni prompt prometen features borradas (`missing_group` como acción ejecutable, nudge de refresh eliminado en Phase 73) | ✓ VERIFIED | `grep -n "nudge de refresh"` → 0 resultados en ambos ficheros; toda mención de `missing_group` en ambos ficheros lo describe como "advisory"/"acción del operador", nunca como acción ejecutada por el doctor |

**Score:** 11/12 truths verified (1 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `src/check.js` | `runCheckAndAct` con DI y bloque piggyback fail-open, gated por `needsOrchestrator` | ✓ VERIFIED | Firma `runCheckAndAct({runCheckFn,scanFn,executeFn,launchFn,logFn,errorFn}={})`; import directo `{scan,execute}` de `./cmux/sidebar-doctor.js`; bloque try/catch propio antes de `launchFn()` |
| `test/check.test.js` | Batería del piggyback (gate on/off, orden, D-04, fail-open) | ✓ VERIFIED | `describe('check.js — runCheckAndAct sidebar doctor piggyback (ORCH-07)')` con Tests A/B/C/D/D2/E, todos verdes |
| `test/check-isolation.test.js` | Aserción positiva de convergencia + 4 guards LOG-12 verdes | ✓ VERIFIED | `it('kodo check reaches src/cmux/sidebar-doctor.js...')` (L156) + 4 guards negativos preexistentes, todos verdes |
| `src/logger-events.js` | Comentario de invariante LOG-12 corregido a la realidad post-Phase-80 | ✓ VERIFIED | L19-25: comentario reemplazado, confirma que `check.js → sidebar-doctor.js → logger-events.js` SÍ alcanza el módulo pero es pure transform, no viola LOG-12 |
| `.claude/skills/kodo-orchestrate/skill.md` | Nuevo § higiene del sidebar + flujo 5 + reflejo detallado de 4 features v0.17 | ✓ VERIFIED | `## Higiene del sidebar` (L346), `### 5. Sidebar desalineado...` (L328), `## Estado vivo de la tarea (novedades v0.17)` (L379); numeración de flujos 1-5 intacta; `git show 4b25013 --stat` → +79/-1 líneas, edición acotada |
| `src/orchestrator/prompt.md` | Mención concisa del carril + referencia a la skill + reflejo conciso de 4 features v0.17, reporting intacto | ✓ VERIFIED | 2 párrafos añadidos en `## Loop de supervisión` (L22-24), fuera del bloque `BEGIN/END reporting` (L51-120); referencia explícita a `skill.md` |

### Key Link Verification

| From | To | Via | Status | Details |
|------|-----|-----|--------|---------|
| `src/check.js` | `src/cmux/sidebar-doctor.js` | `import { scan, execute } from './cmux/sidebar-doctor.js'` | ✓ WIRED | Import presente; `deps={}` en la llamada → `noopLogger` (verificado en `resolveDeps`); sin `child_process`/`spawn`/`execFile` en `check.js` |
| `runCheckAndAct` gate | invocación del doctor | `if (result.needsOrchestrator) { ... scanFn/executeFn ... }` | ✓ WIRED (consume, no alimenta) | Test C confirma que el resultado del doctor no re-entra al gate; el gate se consume una sola vez |
| `prompt.md` (fallback) | `skill.md` (canónica) | referencia textual explícita en el párrafo añadido | ✓ WIRED | `"Detalle en la skill \`.claude/skills/kodo-orchestrate/skill.md\`."` — asimetría D-09 preservada; el prompt enumera y remite, no duplica el detalle |
| `src/cli.js:141` | `runCheckAndAct()` | llamada sin args | ✓ WIRED | `node -e "import('./src/check.js')..."` confirma que `runCheckAndAct()` sin args no lanza; firma DI con defaults preserva el caller de producción |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Suite del carril (check + isolation) | `node --test test/check.test.js test/check-isolation.test.js` | 33/33 pass | ✓ PASS |
| Suite completa del repo (no solo lo tocado) | `npm test` | 2355 pass / 0 fail / 1 skip | ✓ PASS |
| Import directo presente, sin shell-out | `grep -q "from './cmux/sidebar-doctor.js'" src/check.js && ! grep -qE "child_process\|spawn\|execFile" src/check.js` | OK | ✓ PASS |
| Sin ANSI inline en check.js | `! grep -qE 'x1b\[\|ANSI_(YELLOW\|RED\|RESET)' src/check.js` | OK | ✓ PASS |
| `runCheckAndAct()` sin args no lanza al importar | `node -e "import('./src/check.js')..."` | OK | ✓ PASS |
| `src/orchestrator/launch.js` sin diffs (Pitfall 3) | commits de fase (`d6f1e97,630cc68,4021995,4b25013,8100e8d`) — ninguno toca `launch.js` | Confirmado | ✓ PASS |
| skill.md/prompt.md mencionan doctor + 4 features | grep de 4 tokens × 2 ficheros | 8/8 OK | ✓ PASS |
| D-12 (bloque reporting + placeholders) intacto | grep de 5 marcadores en `prompt.md` + inspección del diff | 5/5 OK, diff fuera del bloque | ✓ PASS |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| ORCH-07 | 80-01-PLAN.md | Sidebar converge en ≤1 pase vía piggyback in-process, sidebar NO trigger | ✓ SATISFIED (con 1 ítem de comportamiento real pendiente de confirmación humana) | Código + tests de cableado en verde; convergencia real requiere sidebar cmux viva (ver Human Verification) |
| ORCH-08 | 80-02-PLAN.md | skill.md + prompt.md mencionan sidebar doctor y features v0.17, sin prometer features borradas | ✓ SATISFIED | grep + inspección manual de contenido en ambos ficheros; REQUIREMENTS.md ya marca ambos `[x]` / `Complete` |

Ambos IDs (ORCH-07, ORCH-08) declarados en frontmatter de los planes coinciden 1:1 con `REQUIREMENTS.md` (líneas 21-22, 64-65). Sin huérfanos para esta fase.

### Anti-Patterns Found

Ninguno. Escaneados `src/check.js`, `src/logger-events.js`, `test/check.test.js`, `test/check-isolation.test.js`, `.claude/skills/kodo-orchestrate/skill.md`, `src/orchestrator/prompt.md` — sin `TBD`/`FIXME`/`XXX`/`TODO`/`HACK`/`PLACEHOLDER` reales (el único match de "TODO" es la palabra española "TODOS" en skill.md, falso positivo).

Nota — 3 warnings ya documentados en `80-REVIEW.md` (WR-01 fallos por-item silenciosos en `r.errors`, WR-02 rama de advisories sin test de contenido, WR-03 guard LOG-12 solo estático con comentario desactualizado sobre `import()` dinámico): son degradaciones no-bloqueantes de observabilidad/cobertura, no re-litigadas aquí per instrucción explícita de esta verificación.

### Human Verification Required

### 1. Convergencia real del sidebar en ≤1 pase (SC1 ROADMAP, T5 80-01)

**Test:** Lanzar (o dejar) una sesión kodo con su workspace suelto de su grupo cmux esperado, o un grupo cmux vacío tras cerrar sus miembros. Disparar un pase de `kodo check` que ya esté motivado por otra razón (sesión stuck, en review, o con tareas pendientes). Observar la salida `[kodo:check] Sidebar: N acción(es) aplicadas` y confirmar en la sidebar real de cmux que el workspace quedó agrupado / el grupo vacío se disolvió.

**Expected:** El sidebar converge al estado agrupado sin que el humano mueva nada; un 2º pase motivado inmediato después no vuelve a aplicar acciones (`Sidebar: 0 acción(es) aplicadas`).

**Why human:** El motor `scan`/`execute` (Phase 79) y el piggyback (Phase 80) solo tienen cobertura de test contra fixtures/stubs inyectados (`deps` mockeados o `scanFn`/`executeFn` fake) — ningún test del repo ejecuta el ciclo completo contra un `cmux` real. El cableado (orden, gate, fail-open, no-trigger) está verificado; el resultado observable en una sidebar viva no.

### Gaps Summary

No hay gaps de código: los 5 tests del piggyback (A-E, D2), el guard de convergencia LOG-12, los 4 guards negativos preexistentes, y la reconciliación documental (skill.md + prompt.md con grep de 8 tokens + D-12 intacto) están todos verificados directamente contra el código — no solo citados de SUMMARY.md. La suite completa (`npm test`) pasa 2355/2356 (1 skip, 0 fail).

El único ítem sin cerrar es de naturaleza estructural, no de implementación: la promesa central de ORCH-07 ("converge en ≤1 pase") describe una interacción con `cmux` real que ningún test del repo ejercita end-to-end — todos los tests de `scan`/`execute` (Phase 79) y del piggyback (Phase 80) usan fixtures o dependencias inyectadas. Esto no es una regresión de esta fase: es un límite estructural de la suite (cmux real no es mockeable de forma barata) explícitamente anticipado en las instrucciones de esta verificación. Se enruta a verificación humana, no se marca como fallo.

Los 3 warnings de `80-REVIEW.md` (silenciosidad de `r.errors`, falta de test de contenido en la rama de advisories, comentario desactualizado del guard LOG-12 estático) siguen documentados y no bloquean el goal de la fase — no se re-litigan aquí.

---

_Verified: 2026-07-23T20:22:31Z_
_Verifier: Claude (gsd-verifier)_
