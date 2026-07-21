# Debug: ROMAN-174 "no ha hecho nada parecido" (G-74-5, LIVE-02 productor)

**Fecha:** 2026-07-21
**Gap:** G-74-5 (Phase 74 UAT Test 5)
**Metodología:** diagnóstico inline por el orquestador (agentes gsd-debugger abortados/perdidos). Solo lectura sobre `~/.kodo`.

## Síntoma

Reporte de UAT (2026-07-20 ~11:40 local): la sesión de la tarea ROMAN-174 (gsd-quick) no exhibió el comportamiento preservar-y-appendear ni el formato de handoff.

## Evidencia (verificada, no inferida)

1. **La sesión ROMAN-174 registrada en state.json** es `e1cc7e31-b8c0-4981-8a7e-af313dac59ad`, `gsd: true`, work item `a09d786f-3c5f-4a3f-a18f-a98015b4878b`, arrancada **2026-07-20T12:39Z (14:39 local)** — POSTERIOR al reporte del test.
2. **El plan `~/.kodo/plans/a09d786f-….md` demuestra el comportamiento esperado funcionando:**
   - Plan estructurado escrito por el LLM (Diagnóstico/Enfoque/Pasos/Criterio de éxito), preservado íntegro.
   - Bloque `## Handoff 2026-07-20 14:48 <!-- kodo:handoff v=1 session=e1cc7e31-b8c0-4981-8a7e-af313dac59ad author=llm at=2026-07-20T12:48:31Z -->` **appendeado al final sin sobrescribir**, con `**Hecho:**`/`**Pendiente:**`/`**NEXT:**` en el formato exacto de D-01 y el session_id real interpolado (no placeholder).
3. El hook `session-start.js` registrado en `~/.claude/settings.json` apunta al repo actual (incluye los commits del Plan 03, 295ebeb) — la instrucción SÍ llega a las sesiones.
4. Los planes se nombran por **work item UUID**, no por task_ref (`ROMAN-174`): buscar "ROMAN-174.md" no encuentra nada, pero `grep -l ROMAN-174 ~/.kodo/plans/*.md` localiza el plan correcto.

## Root Cause

**No es un bug de código.** El reporte fue una observación prematura: en el momento del test, la sesión ROMAN-174 aún no había cerrado (o la búsqueda se hizo por nombre `ROMAN-174` en vez de por el UUID del work item). Al cierre real de esa misma tarde, la instrucción de LIVE-02 se cumplió de punta a punta: preservar-y-appendear + formato con session_id resuelto.

**Residuo real (cubierto por G-74-4):** si el LLM de una sesión NO escribe su bloque, hoy no hay backstop mecánico que lo cubra, porque el hook `SessionEnd` no está registrado (ver `.planning/debug/state-tasks-missing-live04.md`). Cualquier "cierre sin rastro" observado pertenece a esa causa raíz, no a la instrucción de arranque.

## Files Involved

- Ninguno con defecto. Evidencia en `~/.kodo/plans/a09d786f-3c5f-4a3f-a18f-a98015b4878b.md` y `~/.kodo/state.json`.

## Suggested Fix Direction

Ninguna acción de código para este gap. Se resuelve con evidencia (no-reproducible / funciona según lo diseñado). La mitad backstop la cierra el fix de G-74-4. Mejora de UX opcional para el futuro: que el dashboard/doctor muestre el mapeo task_ref → plan UUID para facilitar la verificación humana.
