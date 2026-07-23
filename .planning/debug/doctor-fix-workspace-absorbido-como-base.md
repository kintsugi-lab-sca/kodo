---
status: diagnosed
trigger: "G-79-1 (doctor-fix-workspace-absorbido-como-base-grupo): Al ejecutar kodo sidebar doctor --fix con una sesión kodo suelta real, el pase de fix creó el grupo pero el workspace vivo acabó convertido en la BASE del grupo recién creado, perdiendo su título y demás metadatos en la sidebar de cmux."
created: 2026-07-23T00:00:00Z
updated: 2026-07-23T12:00:00Z
---

## Current Focus
<!-- OVERWRITE on each update - reflects NOW -->

hypothesis: CONFIRMADA — el doctor ancla el grupo nuevo en el workspace de la sesión kodo viva más antigua (`create --from <oldest>` + `set-anchor <oldest>`), y en el modelo de cmux "the group header IS the anchor's sidebar representation": la fila del ancla en la sidebar ES el header del grupo, por lo que el workspace vivo pierde su fila propia (título y metadatos visibles) y aparece "absorbido como base".
test: help oficial del binario (cmux 0.64.20) + estado real del sidebar post-incidente + state.json + 2ª pasada dry-run
expecting: n/a — root cause confirmado con evidencia directa
next_action: Devolver ROOT CAUSE FOUND al orquestador (goal: find_root_cause_only; el fix lo planifica plan-phase --gaps)

reasoning_checkpoint:
  hypothesis: "El doctor elige como anchor del grupo el workspace de la sesión viva más antigua; cmux, por diseño, convierte la fila sidebar del anchor en el header del grupo → identidad visual del workspace sustituida por el nombre del grupo"
  confirming_evidence:
    - "cmux workspace-group --help (0.64.20): 'Each group is owned by an anchor workspace; the group header IS the anchor's sidebar representation.'"
    - "workspace-group list --json: grupo LIKEN (workspace_group:9) con anchor_workspace_ref workspace:40; workspace:40 = sesión kodo viva LIKEN-121 (state.json, started 09:59, la más antigua)"
    - "workspace list --json: workspace:40 conserva custom_title 'LIKEN-121 [DEV]: INCIDENCIA: comments en los grupos' — el dato NO se perdió; solo la representación sidebar"
    - "src/cmux/sidebar-doctor.js: scan() fija anchor=ordered[0].workspace_ref (más antigua); execute() hace createWorkspaceGroup({from:[g.anchor]}) + setGroupAnchor({workspace:g.anchor})"
  falsification_test: "Si el título de workspace:40 estuviera mutado/perdido en workspace list --json, o si el anchor no fuera la sesión kodo más antigua, la hipótesis sería falsa — ambas comprobaciones dieron lo contrario"
  fix_rationale: "n/a en este modo (find_root_cause_only)"
  blind_spots: "Semántica de `create --cwd <path>` sin --from (¿crea workspace fresco como anchor?) NO verificada — misma clase de supuesto que causó el gap; debe verificarse contra el binario real antes de usarla en el fix"

## Symptoms
<!-- Written during gathering, then IMMUTABLE -->

expected: Tras `kodo sidebar doctor --fix`, el workspace vivo aparece agrupado bajo su grupo esperado en `cmux workspace-group list --json` (dentro de `member_workspace_refs`), conservando título y metadatos; sin grupos duplicados; una 2ª pasada del dry-run sale limpia (exit 0).
actual: El workspace vivo se convirtió en la BASE del grupo creado, perdiendo el título y demás info (al menos en la sidebar). Percepción inicial del usuario, "se ha cargado la sesión en vivo y ha cerrado todo"; tras inspección, la sesión no se eliminó, quedó absorbida como base del grupo sin su identidad original.
errors: None reported (sin errores en consola; el fix reportó éxito aparente)
reproduction: Test 1 del UAT fase 79 — con ≥1 sesión kodo suelta (workspace vivo en state.json sin grupo), ejecutar `kodo sidebar doctor` (dry-run, exit 1 con acciones create+add+set-anchor o add) y luego `kodo sidebar doctor --fix`.
started: Discovered during UAT (2026-07-23), fase 79 sidebar-doctor, milestone v0.18

## Eliminated
<!-- APPEND only - prevents re-investigating -->

- hypothesis: "El doctor invocó un verbo destructivo (delete) y cerró/eliminó la sesión viva"
  evidence: "state.json muestra ambas sesiones LIKEN alive:true; workspace:40 existe en workspace list --json con título intacto; el allowlist no cablea delete (guard source-hygiene); el propio usuario refinó el report: 'No se eliminó la sesión'"
  timestamp: 2026-07-23

- hypothesis: "El verbo add es el que rompe la identidad del workspace"
  evidence: "Verificado a mano por el usuario (UAT test 2: add → OK); workspace:43 (LIKEN-123), que entró al grupo vía add, conserva su fila y título en la sidebar; solo el ANCHOR (workspace:40) perdió su fila"
  timestamp: 2026-07-23

- hypothesis: "create --from muta/renombra el título del workspace (pérdida real de metadatos)"
  evidence: "workspace list --json: workspace:40 conserva custom_title y custom_color intactos; la pérdida es EXCLUSIVAMENTE de representación en sidebar (la fila del anchor se sustituye por el header del grupo)"
  timestamp: 2026-07-23

- hypothesis: "El fix no convergió / creó grupos duplicados"
  evidence: "2ª pasada dry-run en vivo: exit 0, 'clean — sidebar converged', protected: 2 sesiones; un solo grupo LIKEN en workspace-group list --json (anchor incluido en member_workspace_refs)"
  timestamp: 2026-07-23

## Evidence
<!-- APPEND only - facts discovered -->

- timestamp: 2026-07-23
  checked: Contexto adicional del usuario (verificación manual)
  found: "cmux workspace-group add --group workspace_group:N --workspace workspace:N funciona correctamente (verificado a mano). La sospecha recae en create (o la secuencia create+add+set-anchor)."
  implication: El verbo add del binario cmux NO es el culpable; examinar create y set-anchor y los args que les pasa el doctor.

- timestamp: 2026-07-23
  checked: src/cmux/sidebar-doctor.js (motor scan/execute)
  found: "scan() ordena las sesiones vivas por started_at y fija anchor = ordered[0].workspace_ref (la MÁS ANTIGUA, D-08); execute() para cada missing_group hace: createWorkspaceGroup({ name, from: [g.anchor] }) → add del resto → setGroupAnchor({ group, workspace: g.anchor }). Pitfall 1 exige --from SIEMPRE explícito (sin él, cmux agarraría el workspace del caller)."
  implication: El workspace vivo de la sesión más antigua se pasa deliberadamente como --from y luego como anchor del grupo.

- timestamp: 2026-07-23
  checked: src/cmux/client.js:148-172 (passthroughs)
  found: "createWorkspaceGroup → `cmux workspace-group create --name <n> --from <ref>`; setGroupAnchor → `cmux workspace-group set-anchor --group <g> --workspace <ws>`. Passthroughs fieles al contrato; sin lógica propia."
  implication: El cliente no distorsiona nada; el comportamiento viene del contrato del binario + la elección de anchor del motor.

- timestamp: 2026-07-23
  checked: cmux workspace-group --help (binario real, cmux 0.64.20 (100) [14e3400b9])
  found: "'Each group is owned by an anchor workspace; the group header IS the anchor's sidebar representation. Closing the anchor dissolves the group while preserving its other members as ungrouped workspaces.'"
  implication: MECANISMO CONFIRMADO — en cmux, el anchor NO conserva fila propia en la sidebar: su fila ES el header del grupo (que muestra el NOMBRE del grupo, no el título del workspace). Anclar el grupo en un workspace de sesión viva absorbe visualmente esa sesión.

- timestamp: 2026-07-23
  checked: cmux workspace-group list --json + cmux workspace list --json (estado post-incidente, read-only)
  found: "Grupo LIKEN (workspace_group:9): anchor_workspace_ref workspace:40, members [40, 43, 42]. workspace:40 conserva custom_title 'LIKEN-121 [DEV]: INCIDENCIA: comments en los grupos' y custom_color '#7D6608' en workspace list --json."
  implication: El workspace NO fue eliminado ni retitulado — los metadatos persisten; la 'pérdida' es la sustitución de su fila sidebar por el header 'LIKEN'. workspace:43 (miembro vía add) conserva su fila. Coincide con la captura del usuario.

- timestamp: 2026-07-23
  checked: ~/.kodo/state.json (sesiones)
  found: "LIKEN-121 → workspace:40, alive, started 2026-07-23T09:59 (la más antigua); LIKEN-123 → workspace:43, alive, started 10:20."
  implication: Confirma el mapeo: scan() eligió workspace:40 (LIKEN-121, oldest) como anchor → exactamente el workspace que el usuario vio 'absorbido'.

- timestamp: 2026-07-23
  checked: 79-RESEARCH.md (supuestos A1-A5, Pitfalls, §Standard Stack) + grep de 'header|representation' en todos los docs de la fase
  found: "El research capturó del MISMO help la sintaxis de create y el caveat '--from defaults to caller' (Pitfall 1), pero el párrafo 'the group header IS the anchor's sidebar representation' NO aparece en NINGÚN documento de la fase (grep vacío). A1-A5 cubren shape del stdout, headless, orden add/set-anchor — ninguno cubre la semántica de representación del anchor. El research declara explícitamente: 'semántica de movimiento/anchor y output de create --json NO ejecutados (mutarían el sidebar del operador)'."
  implication: Gap de supuesto de diseño: D-08 (anchor = miembro más longevo) se decidió con un modelo mental incompleto ('anchor = atributo de ownership') sin conocer que el anchor pierde su fila sidebar. La consecuencia 'closing anchor dissolves group' SÍ se conocía (política de re-anclaje eventual), la de representación NO.

- timestamp: 2026-07-23
  checked: 2ª pasada dry-run en vivo (node bin/kodo sidebar doctor — solo scan(), inocuo)
  found: "exit 0, 'clean — sidebar converged', protected: 2 sesiones ya agrupadas, 0 acciones."
  implication: La convergencia MECÁNICA del criterio UAT sí se cumple (anchor incluido en member_workspace_refs → sesión protected). El blocker es exclusivamente la absorción de identidad del anchor, no la convergencia.

## Resolution
<!-- OVERWRITE as understanding evolves -->

root_cause: |
  El doctor ancla los grupos recién creados en el workspace de la SESIÓN KODO VIVA MÁS ANTIGUA
  (src/cmux/sidebar-doctor.js: scan() fija anchor=ordered[0].workspace_ref; execute() emite
  `workspace-group create --name <grupo> --from <ese workspace>` y después `set-anchor` al mismo),
  y en el modelo de grupos de cmux (0.64.20, documentado en `cmux workspace-group --help`)
  "the group header IS the anchor's sidebar representation": el workspace anchor NO conserva fila
  propia en la sidebar — su fila se convierte en el header del grupo, que muestra el NOMBRE del
  grupo en vez del título del workspace. Resultado: la sesión viva queda visualmente "absorbida
  como base" del grupo (título/metadatos ocultos en sidebar), aunque el workspace y sus metadatos
  (custom_title, custom_color) permanecen intactos en `workspace list --json`.
  Causa de fondo: gap de research en la fase 79 — se capturó del help la sintaxis de create y el
  caveat de --from, pero NO el párrafo del modelo header-is-anchor; los supuestos A1-A5 no cubrían
  la semántica de representación del anchor y los verbos mutantes nunca se ejecutaron en vivo antes
  del UAT (decisión deliberada de no mutar el sidebar del operador durante research).
fix: (fuera de scope — goal: find_root_cause_only; direcciones esbozadas en el return ROOT CAUSE FOUND)
verification: n/a
files_changed: []
