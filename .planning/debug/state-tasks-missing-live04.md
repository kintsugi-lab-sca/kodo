# Debug: state.tasks ausente/vacío en ~/.kodo/state.json (G-74-4, LIVE-04 e2e)

**Fecha:** 2026-07-21
**Gap:** G-74-4 (Phase 74 UAT Test 4)
**Metodología:** diagnóstico inline por el orquestador (los dos agentes gsd-debugger abortaron por worktree base mismatch y sus relanzamientos murieron sin notificar). Solo lectura sobre `~/.kodo` y `~/.claude/settings.json`.

## Síntoma

Tras cierres reales de sesiones kodo, `state.tasks[<task_id>]` no se puebla nunca. Hoy la clave existe pero está vacía (`tasks: {}`); el backup `state.json.bak-2026-07-20T10-17-08-266Z` ya la tenía vacía.

## Evidencia (verificada, no inferida)

1. **`~/.claude/settings.json` — el hook SessionEnd de kodo NO está registrado.**
   - `hooks.SessionStart` SÍ incluye `node "/Users/alex/dev/klab/kodo/src/hooks/session-start.js"` ✓
   - `hooks.Stop` SÍ incluye `node "/Users/alex/dev/klab/kodo/src/hooks/stop.js"` ✓
   - `hooks.SessionEnd` solo contiene `codeisland-state.py` y `compound-session-end.sh` — **ninguna entrada de kodo** ✗
2. **`src/hooks/install.js` declara los TRES hooks** (`KODO_HOOK_FILES = ['session-start.js', 'stop.js', 'session-end.js']`, líneas 40-66 registran SessionStart, Stop y SessionEnd "Phase 58 LIFE-03"). El diseño es correcto; el registro real quedó incompleto (instalación anterior a Phase 58 nunca re-ejecutada, o settings reescritos por otra herramienta perdiendo la entrada).
3. **Telemetría:** un único `state.task.handoff_saved` en todos los logs de `~/.kodo/logs/`, del 2026-07-17, `session_id: uat75mock` (mock de la UAT de la fase 75). **Cero eventos de cierres reales** — ni `handoff_saved` ni `handoff_failed`.
4. **Cero bloques `author=auto`** en los ~26 planes de `~/.kodo/plans/`: todos los `## Handoff` son `author=llm`. El backstop mecánico (LIVE-03, mitad del hook SessionEnd) jamás corrió en producción.
5. **Resolución de la paradoja** (los bloques aterrizan pero state no): los bloques los escribe el **LLM** siguiendo la instrucción de `session-start.js` (hook SÍ registrado y apuntando al repo actual). `writeHandoff` — el único escritor de `state.tasks` vía `upsertTaskHandoff` — vive en `session-end.js`, que nunca se ejecuta.
6. Instalaciones: npm-global `kodo@0.16.1 → symlink /Users/alex/dev/klab/kodo` (repo actual); Homebrew `kodo 0.16.1` (copia separada, también con writeHandoff). Irrelevantes para el fallo: los hooks se invocan por ruta absoluta desde settings, y la ruta del repo es la correcta donde está registrada.

## Root Cause

**El hook `SessionEnd` de kodo no está registrado en `~/.claude/settings.json`.** El código de la Phase 74 (writeHandoff → upsertTaskHandoff) es correcto y funciona cuando se ejecuta (probado por el mock uat75mock y las suites), pero en producción nunca se dispara. Es un gap de registro/instalación, no de código.

## Files Involved

- `~/.claude/settings.json` — falta la entrada `SessionEnd: node "<repo>/src/hooks/session-end.js"`
- `src/hooks/install.js` — el instalador correcto existe y es idempotente (addHook sin clobbering); no se re-ejecutó tras añadir SessionEnd

## Suggested Fix Direction

1. Re-ejecutar el registro de hooks de kodo (install.js) o añadir la entrada SessionEnd a settings.json.
2. Hacer que `kodo doctor` (KODO-10) verifique la presencia de los 3 hooks registrados vs `KODO_HOOK_FILES` — esta clase de drift instalación↔settings es exactamente su dominio.
3. Verificar tras el fix: cerrar una sesión real y comprobar `state.tasks` poblado + telemetría `state.task.handoff_saved`.
