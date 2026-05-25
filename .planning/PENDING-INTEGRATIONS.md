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

---

## kodo TUI — Sesiones en vivo (candidato v0.9)

**Status:** 🟡 Seed para milestone v0.9. Sin código aún, decisión de stack pendiente.
**Captado:** 2026-05-21 desde conversación de diseño (sesión Phase 32 en marcha).
**Driver:** la UI web actual (`http://localhost:9090`) muestra sesiones activas, candidatas, historial y logs, pero no convence en uso diario. El operador quiere superficie en terminal — donde ya vive — sin abandonar el dashboard JSON ya existente.

**Qué problema resuelve:**

Cuando hay N sesiones kodo en cmux trabajando en paralelo, hoy hay que: (a) abrir browser, (b) leer `kodo status`, o (c) hacer `cmux rpc workspace.list`. Ninguno es ambient. Un TUI persistente da panel-de-control de un vistazo: qué sesiones están activas, qué tarea/repo/phase llevan, último hook recibido, edad. Filtros por repo / estado. Attach a workspace cmux con Enter.

**Frontera explícita (alcance v1, deliberadamente reducido):**

- ✅ Leer `/status` y `/logs` del server kodo (ya existen como JSON en `src/server.js:355-451`).
- ✅ Combinar con `cmux rpc workspace.list` para colorear filas con estado cmux real.
- ✅ Attach a workspace cmux desde la TUI (Enter → `cmux attach <workspace>`).
- ✅ Filtros básicos: por repo, por estado, por label.
- ❌ **NO LLM en v1** — con 3-10 filas no aporta; con 100 lo que se necesita son filtros, no embeddings. La metadata ya está estructurada (provider, label, phase). Si después aparece un caso real de "clasificar/ordenar" no resoluble con filtros, reevaluar en v0.10+.
- ❌ NO duplicar lo que cmux ya pinta (color/nombre de workspace). El valor está en lo que cmux NO sabe: label kodo, task ref, fase GSD, último hook, polling channel, age desde último evento.
- ❌ NO crear endpoints nuevos en kodo server — el contrato JSON actual basta.

**Decisión clave pendiente (resolver al planear v0.9):**

| Opción | Stack | Pro | Con |
|---|---|---|---|
| **A** | Node + ink (subcomando `kodo dashboard`) | Un solo proyecto/release; `npm i -g kodo` distribuye TUI; comparte deps con kodo | Muere si daemon kodo cae; no reusa code-tui |
| **B** | Go + bubbletea (reusa chasis `code-tui` en `/Users/alex/dev/klab/code-tui`) | Chasis ya hecho (`internal/{app,store,ui,claude,integration}` + bubbletea v2 + lipgloss v2); binario standalone; consume HTTP, sobrevive a fallos del daemon kodo; empuja a iterar code-tui | Dos repos a versionar coordinadamente; mezcla scope code-tui ("Finder de tools Claude" vs "TUI de kodo") |
| **C** | Híbrido: code-tui añade "modo kodo" apuntando a `localhost:9090` | Lo mejor de B sin acoplar kodo a Go; code-tui crece como TUI multipropósito | code-tui debe definir antes su propia identidad |

Sesgo del autor del seed (sin imponer): **B o C**. Si code-tui tiene tracción que recuperar, esta phase es excusa perfecta para forzar su iteración. Si no, A es lo más simple.

**Componentes a entregar (v1):**

- Tabla viva refrescada cada 2-3s con columnas: `session-id`, `repo`, `task-ref`, `phase`, `state`, `last-hook`, `age`.
- Filtros: `/` para search, `r:<repo>`, `s:<state>`, `l:<label>`.
- Atajos: `Enter` para attach al workspace cmux correspondiente, `c` para abrir comentarios de la tarea, `l` para tail de logs de esa sesión, `q` para salir.
- Lectura: HTTP GET a `localhost:9090/status` y `/logs` + `cmux rpc workspace.list` mergeados por `session-id`.

**Por qué se documenta ahora y no se planea:**

v0.8 está en ejecución (82%, Phase 32 en marcha). Capturar el seed evita perder el contexto de diseño cuando se cierre v0.8 y se planee v0.9. No bloquea nada hoy.

**Cómo retomar (cuando toque):**

1. `gsd-new-milestone v0.9` → incluir esta TUI como requirement primario.
2. Resolver opción A/B/C antes de discuss-phase.
3. Verificar que el contrato JSON de `/status` y `/logs` no haya cambiado entre v0.8 y v0.9.
4. Si opción B o C: validar que `code-tui` sigue compilando con bubbletea v2 actual.
