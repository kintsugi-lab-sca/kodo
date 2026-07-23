---
status: testing
phase: 79-sidebar-doctor
source: [79-VERIFICATION.md]
started: 2026-07-23T08:40:00Z
updated: 2026-07-23T11:35:00Z
---

## Current Test

number: 4
name: Round-trip completo de `kodo sidebar doctor --fix` sobre sesión suelta con grupo YA existente (SDR-05, re-scopeado post gap-closure)
expected: |
  El workspace de la sesión suelta aparece en member_workspace_refs del grupo esperado; una 2ª pasada del dry-run sale exit 0 (converged); ningún workspace no-kodo del operador fue movido o re-anclado (D-04); ninguna sesión viva pierde su fila/título (execute() ya no emite create/set-anchor bajo ninguna rama).
awaiting: user response

## Tests

### 1. Convergencia real del sidebar con `--fix` (SDR-05)
expected: Tras un pase de `--fix` con una sesión kodo suelta real, el workspace aparece agrupado bajo su grupo esperado en `cmux workspace-group list --json`; sin duplicados; una 2ª pasada del dry-run sale limpia (exit 0).
result: issue
reported: "Al ejecutar kodo sidebar doctor --fix se ha cargado una sesión en vivo y ha cerrado todo lo que había para meterlo en el grupo. Fatal!"
refined: "No se eliminó la sesión — el workspace vivo se convirtió en la base del grupo, perdiendo el título y demás info (al menos en la sidebar). Captura: sidebar muestra el grupo con entrada base sin título original."
severity: blocker

### 2. Supuestos A1/A2/A5 del binario cmux real
expected: `create` crea el grupo (el código no depende de su stdout — A1 informativo); `add` mueve/añade el workspace al grupo indicado (A2); los verbos mutan correctamente aunque kodo corra bajo daemon headless (A5 — relevante para Phase 80, no bloquea esta).
result: pass
notes: "A2 verificado manualmente: `cmux workspace-group add --group workspace_group:1 --workspace workspace:4` → OK. El verbo `add` requiere id de grupo (workspace_group:N) e id de workspace (workspace:N)."

### 3. D-04 — workspaces del operador intactos tras `--fix`
expected: Ningún workspace no-kodo (sin sesión en state.json) fue movido, re-anclado ni des-agrupado por el pase de `--fix`.
result: pass

### 4. Round-trip completo de `kodo sidebar doctor --fix` sobre sesión suelta con grupo YA existente (SDR-05, re-scopeado post gap-closure)
expected: Con ≥1 sesión kodo real cuyo workspace esté suelto de un grupo que YA EXISTE — `node src/cli.js sidebar doctor` lista `add`; `--fix` lo ejecuta; `cmux workspace-group list --json` muestra el workspace en member_workspace_refs del grupo esperado; 2ª pasada del dry-run sale exit 0; ningún workspace no-kodo movido (D-04); ninguna sesión viva pierde fila/título (G-79-1 irreproducible: execute() no emite create/set-anchor).
result: [pending]
notes: "El 2026-07-23 el sidebar del operador estaba limpio (protected: 1, 0 loose/missing/empty) — sin deriva real para ejercitar la rama mutante desde la cadena autónoma. El verbo crudo `add` ya pasó en el test 2 (A2); falta el round-trip vía el binario kodo."

## Summary

total: 4
passed: 2
issues: 1
pending: 1
skipped: 0
blocked: 0

## Gaps

- gap_id: G-79-1
  truth: "Tras un pase de `--fix` con una sesión kodo suelta real, el workspace aparece agrupado bajo su grupo esperado en `cmux workspace-group list --json`; sin duplicados; una 2ª pasada del dry-run sale limpia (exit 0)."
  status: resolved
  resolved_by: "79-04 (gap_closure) — missing_group pasa a report-only/advisory ratificado por checkpoint:decision (Opción A); execute() eliminó por completo el bucle create/set-anchor (regresión imposible por construcción, test de regresión con spy de argv); hasActions excluye missing_group, hasAdvisories añadido. Re-verificado en 79-VERIFICATION.md (2026-07-23, re_verification.gaps_closed)."
  reason: "User reported: Al ejecutar kodo sidebar doctor --fix se ha cargado una sesión en vivo y ha cerrado todo lo que había para meterlo en el grupo. Fatal! — Refinado tras inspección: la sesión NO se eliminó; el workspace vivo se convirtió en la BASE del grupo creado, perdiendo el título y demás info en la sidebar. Probable causa a investigar: el verbo `create` de cmux convierte/absorbe el workspace como base del grupo en vez de crear un grupo vacío, o el doctor pasa el workspace vivo como base al crear el grupo."
  severity: blocker
  test: 1
  root_cause: "cmux (0.64.20) modela el header del grupo como la representación sidebar del workspace anchor — su propio --help lo documenta: 'the group header IS the anchor's sidebar representation'. El doctor ancla el grupo recién creado en el workspace de la sesión kodo viva más antigua (scan(): anchor = ordered[0].workspace_ref; execute(): create --from <anchor> + set-anchor al mismo), por lo que la fila sidebar de esa sesión SE CONVIERTE en el header del grupo y pierde su título visible. No hay pérdida real de datos (custom_title y custom_color de workspace:40 intactos en workspace list --json); es pérdida de representación. Causa de fondo: gap de research — el modelo header-is-anchor no se capturó en 79-RESEARCH.md y la política D-08 (anchor = miembro más longevo) se decidió sin conocerlo. La 2ª pasada del dry-run sí sale limpia (exit 0): la convergencia mecánica se cumple; el blocker es exclusivamente la absorción de identidad."
  artifacts:
    - path: "src/cmux/sidebar-doctor.js"
      issue: "scan() elige anchor = ordered[0].workspace_ref (~L267); execute() emite createWorkspaceGroup({name, from: [anchor]}) (L365) y setGroupAnchor({group, workspace: anchor}) (L388) — ancla el grupo en una sesión viva, cuya fila sidebar pasa a ser el header del grupo"
    - path: ".planning/phases/79-sidebar-doctor/79-RESEARCH.md"
      issue: "Supuestos A1–A5 y Pitfalls omiten el modelo header-is-anchor de cmux (los verbos mutantes nunca se ejecutaron en vivo antes del UAT)"
  missing:
    - "Política de anchor que no sacrifique la identidad de una sesión viva: (a) verificar EN VIVO (grupo throwaway) si `workspace-group create --name X --cwd <path>` sin --from crea un workspace FRESCO como anchor — si es así, anclar el grupo en un workspace base desechable y dejar las sesiones como miembros planos (ojo: el help dice que --from omitido defaultea al caller workspace — semántica SIN verificar); o (b) degradar missing_group a report-only (el doctor solo hace `add` a grupos existentes; crear grupos queda en manos del operador)"
    - "Resolver a la vez el trade-off compuesto con D-07: anclar en workspace de sesión implica disolución del grupo al terminar esa sesión"
  debug_session: ".planning/debug/doctor-fix-workspace-absorbido-como-base.md"
