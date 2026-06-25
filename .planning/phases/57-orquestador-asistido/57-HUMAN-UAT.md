---
status: issue
phase: 57-orquestador-asistido
source: [57-VERIFICATION.md]
started: 2026-06-18
updated: 2026-06-24
resolved_by: ORCH-02 (Phase 62)
---

## Current Test

[Test 1 aún SIN ejercitar — el operador adoptó vía la tecla `a` del dashboard (Phase 56, determinista, correcto), no vía el orquestador (Phase 57). El test del orquestador sigue pendiente.]

## Module-placement gap (surfaced 2026-06-19, fixing now)

- truth: "La tarea adoptada aparece en su MÓDULO de Plane (no solo en el proyecto)"
  status: resolved  # 57-05 (6ea4f39/660d8c3): kodo adopt --module + auto-derive del cwd + Plane createTask asocia module-issues (fail-open). POST shape VERIFICADO en vivo contra Plane (module-issues POST {issues:[id]} → 200; FVF tiene 68 issues, re-add idempotente OK). Suite 1454 pass. Re-test visual pendiente (adoptar fvf → cae en módulo FVF).
  severity: major
  scope: "Cross-cutting — afecta a los 3 consumidores (CLI/dashboard/orquestador); ninguno pasa módulo. NO es específico de Phase 57."
  reason: |
    `kodo adopt` solo acepta `--project`, no `--module`. La tarea creada cae en el proyecto pero sin módulo → no aparece en su tablero ("no sale en su sitio"). El provider Plane sabe LEER módulos (listModules + moduleCache para getTaskState) pero createTask/createWorkItem NO asocia módulo al crear (en Plane el módulo es asociación aparte, module-issues). projects.json YA mapea cwd→módulo (add88b2b → FVF → /Users/alex/dev/roman/fvf), así que es derivable.
  fix: |
    Auto-derivar el módulo del --cwd en `kodo adopt` (los 3 consumidores shellean `kodo adopt --cwd …` → lo reciben gratis): CLI añade `--module` opcional + reverse-lookup cwd→moduleName contra projects.json modules; adoptSession enhebra el param; Plane createTask resuelve name→moduleId (listModules) y POST module-issues, FAIL-OPEN (si no resuelve, la tarea se crea igual). GitHub ignora module.
  artifacts:
    - src/cli/adopt.js + src/cli.js   # --module flag + auto-derive from cwd
    - src/adopt.js                    # thread module → createTask
    - src/providers/plane/provider.js # createTask asocia el work-item al módulo
    - src/providers/plane/client.js   # POST /projects/{id}/modules/{mid}/module-issues/

## Tests

### 1. Adopción asistida end-to-end por el orquestador (LLM)
expected: |
  En una sesión real del orquestador (skill `kodo-orchestrate` cargado), apuntándolo a una sesión `claude` ad-hoc:
  1. Deriva un título INTELIGENTE del contexto real (cwd + `git log` + transcript) — claramente mejor que `basename(cwd)` (que es lo que da el dashboard en Phase 56).
  2. PROPONE el título + proyecto al operador y ESPERA confirmación/edición antes de crear (D-03; nunca crea silenciosamente).
  3. Forma el comando con TODOS los valores entre comillas SIMPLES (`kodo adopt --title '<t>' --workspace '...' --cwd '...' --session-id '...' --project '...'`) y restringe el charset del título (sin `'`/`$`/backtick/`$()`/`;`); aborta si un valor no se puede hacer seguro.
  4. La tarea creada tiene el título derivado (saneado por el núcleo BIDIR-08), no `basename(cwd)`.
why_human: El comportamiento es LLM-driven (calidad del título + seguir la prosa) y requiere una sesión orquestador viva + una sesión ad-hoc; no es determinista. La capa automática verificó la estructura/prosa/invariantes; solo el comportamiento en vivo es manual.
adversarial_check: |
  Probar con un cwd/título que contenga metacaracteres adversariales (p.ej. trabajar en un dir con `$` o un commit subject con backticks/`;`) y confirmar que el orquestador (a) restringe/aborta y (b) NUNCA emite un comando donde el metacarácter se ejecute. Este es el corazón de T-57-01.
result: [issue]
executed: 2026-06-24
evidence: ROMAN-194 (proyecto add88b2b / scp-cmri)
findings: |
  Ejecutado 2026-06-24 contra una sesión ad-hoc real (scp-cmri, proyecto GSD Rails). Resultado: ISSUE, no pass.

  - **F1 (mayor — gap arquitectónico):** el orquestador NO pudo resolver las coordenadas
    (`workspace_ref`/`session_id`) de la sesión ad-hoc. El skill §1 manda resolverlas
    matcheando por `cwd` en `state.json`, pero una sesión sin adoptar no está en
    `state.json` (huevo y gallina) y el skill prohíbe descubrir surfaces directamente.
    → degradó a "adopta tú primero por el dashboard". El camino at-adopt de ORCH-01 (su
    razón de ser: derivar título ANTES de crear) quedó SIN ejercitar. La adopción la hizo
    el dashboard (Phase 56, determinista) → título = `basename(cwd)` = `scp-cmri`.
  - **Checks 1/2/3 (título inteligente / confirmación / shell-safety at-adopt):** N/A —
    nunca se shelleó `kodo adopt --title` por el orquestador.
  - **F2 (menor — calidad del resumen):** el único aporte fue un comentario de backfill
    (Phase 60) derivado de `git log --oneline -N` → se ancló en los últimos commits
    ("la Fase 2 acaba de cerrarse…") en vez del alcance global del proyecto. Para un
    proyecto GSD la mejor señal del alcance es `.planning/PROJECT.md`/`ROADMAP.md`, que
    el skill no manda leer. De ahí la vaguedad relativa a la amplitud real de la tarea.
resolution: |
  ORCH-01 queda como "code-complete (9/9) · UAT fallido". El intent se reubica en
  **ORCH-02 (Phase 62 — adopción inteligente desde el dashboard)**: el dashboard YA tiene
  las coordenadas vía `listAgentSurfaces()` (disuelve F1) y leerá la memoria del proyecto
  (disuelve F2). Ver REQUIREMENTS.md ORCH-02 + ROADMAP.md Phase 62.

## Summary

total: 1
passed: 0
issues: 1
pending: 0
skipped: 0
blocked: 0

## Gaps

- F1 (mayor): coordenadas irresolubles para sesión ad-hoc no adoptada → camino at-adopt inalcanzable. Reubicado a ORCH-02/Phase 62.
- F2 (menor): resumen anclado en git log reciente, no en el alcance del proyecto (PROJECT.md). Reubicado a ORCH-02/Phase 62.
