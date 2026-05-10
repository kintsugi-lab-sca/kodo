# Pending Integrations

Trabajo terminado en ramas paralelas, listo para integrar cuando convenga, sin perder lo hecho.

---

## GSD Provider Reporting (rama: `gsd-provider-reporting`)

**Status:** ✅ Código completo, 481 tests pasando (480 pass + 1 skip pre-existente, 0 fail), listo para integrar.
**Branch:** `gsd-provider-reporting` (35 commits sobre `origin/main` `ad2cd88`)
**HEAD:** `cb28994` (al momento de documentar, 2026-05-10)

**Qué hace:**

Cierra la cadena de visibilidad GSD → proveedor. Cuando el operador habilita `workflow.report_to_provider` en `~/.kodo/config.json`, el agente Claude (vía sus propios MCP) crea un sub-issue informativo por cada fase con label `kodo:gsd-child` y refleja el progreso plan-by-plan como comentarios. Diseño **instruction-driven**: kodo nunca crea, lee, ni borra issues — sólo blinda anti-recursión y opt-in gating.

**Componentes entregados:**

- `KODO_LABEL_GSD_CHILD = 'kodo:gsd-child'` exportado desde `src/labels.js` + helper `isGsdChild()`
- Filtro anti-recursión en `src/triggers/dispatcher.js` (cortes antes de `parseKodoLabels` / lock / resolver / launch, incluso bajo `--force`)
- `isReportToProviderEnabled()` en `src/config.js` con strict equality `=== true`, optional chaining, DI opcional para tests; `DEFAULT_CONFIG` no contiene la key `workflow` (anti-mutation invariant)
- `applyReportingGate(prompt, enabled)` en `src/orchestrator/launch.js` — pure function idempotente entre marcadores `<!-- BEGIN reporting -->` / `<!-- END reporting -->`
- Sección "Sub-issue reporting" en `src/orchestrator/prompt.md` con prosa ES provider-agnostic (vía `{{provider_name}}`) cubriendo just-in-time creation, comentarios plan-by-plan, lifecycle abstracto, append-only `NUNCA delete-issue`, HARD STEP pre-transición, logs literales `[kodo:reporting] MCP failure on phase N: <error>`

**Tests:** 38 nuevos sobre baseline 443 → 481 total. Cero regresiones.

**Requirements internos cubiertos** (numeración interna de la rama, NO confundir con requirements de `main`):

- REPORT-01: Anti-recursion filter
- REPORT-02: opt-in flag helper
- REPORT-03: conditional prompt section gating
- REPORT-04..08: prosa de sub-issue reporting (creation, comments, lifecycle, append-only, HARD STEP)

**Por qué está separado:**

Esta rama se desarrolló en paralelo a la línea principal de `main`. La línea principal usó las numeraciones Phase 14, 15, 16, 17 para su propio v0.5 ("CLI Polish & v0.3 Debt Cleanup"). La rama `gsd-provider-reporting` también las usó internamente para su propio v0.5 ("GSD Provider Reporting"), causando colisión. Para integrar:

- Renumerar las Phases internas de la rama (14, 15) a las que correspondan después de cerrar el v0.5 actual de `main` (probablemente Phase 18 + 19, o las que toquen).
- Asignar número de milestone definitivo. Sugerencia: **v0.6 = GSD Provider Reporting**, desplazando el sketch actual de "Concurrency Isolation" a v0.7. Provider Reporting (visibility en proveedor) y Concurrency Isolation (worktree always-on) son ortogonales — el orden no es crítico.

**Cómo integrar (cuando toque):**

```bash
# Inspeccionar
git log --oneline main..gsd-provider-reporting

# Cherry-pick selectivo de los commits de CÓDIGO (saltando docs/.planning/ que asumen Phase 14-15):
git cherry-pick 5a41d8f  # feat(14-01): export KODO_LABEL_GSD_CHILD + isGsdChild helper
git cherry-pick cbd8f9c  # feat(14-01): anti-recursion filter for kodo:gsd-child in dispatcher
git cherry-pick e1f82c9  # feat(14-02): isReportToProviderEnabled helper with source-hygiene tests
git cherry-pick 7c28c06  # feat(15-01): reporting block markers + placeholder in prompt.md
git cherry-pick 5feb578  # feat(15-01): applyReportingGate helper + wire into launchOrchestrator
git cherry-pick 38c7a2e  # test(15-01): launch.test.js — applyReportingGate + source hygiene
git cherry-pick d030547  # feat(15-02): replace placeholder with full ES prose for sub-issue reporting
git cherry-pick 4d67312  # test(15-02): SR1..SR6 — sub-issue reporting section gating asserts
git cherry-pick 81c848c  # test(15-02): RC1..RC15 + RA1..RA6 — sub-issue reporting content asserts

# Después: regenerar artefactos planning con la numeración correcta del milestone destino
# (PLAN.md, SUMMARY.md, VERIFICATION.md, VALIDATION.md) — el contenido base está en
# .planning/milestones/v0.5-phases/{14,15}-* dentro de la rama, copiar y renumerar.
```

**Importante: NO mergear directamente la rama a `main`** — los archivos `.planning/` de la rama (con numeración Phase 14-15 y milestone v0.5) chocarían con los de `main`. Cherry-pick selectivo de código + regeneración manual de planning es la vía limpia.
