---
phase: 45
slug: spike-captura-de-plan-no-gsd-v-a-hook
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-09
---

# Phase 45 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
>
> **Naturaleza de la fase:** SPIKE puro de investigación. El entregable es un documento
> (`45-SPIKE.md`) que alcanza un veredicto binario a partir de un experimento reproducible,
> NO código de producción. Por eso la verificación es **mayoritariamente manual** (ejecutar
> el experimento, inspeccionar payloads crudos, alcanzar el veredicto). La única verificación
> automatizable es **estructural**: que el documento exista con las 4 secciones requeridas
> (D-05) y un veredicto binario explícito. El roadmap bloquea código de producción aquí
> (Notes: "Spike puro — no se compromete implementación de producción"), así que NO hay
> lógica de negocio que cubrir con tests unitarios.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (builtin) + `node:assert/strict` |
| **Config file** | none — `package.json` script `test` |
| **Quick run command** | `node --test $(find test -name '*.spike*.test.js' -type f)` |
| **Full suite command** | `node --test $(find test -name '*.test.js' -type f)` |
| **Estimated runtime** | ~1 segundo (solo el check estructural del documento) |

---

## Sampling Rate

- **After every task commit:** Run the quick command (structural doc check, si el plan crea uno)
- **After every plan wave:** Run the full suite (asegura que el experimento no rompió tests existentes)
- **Before `/gsd:verify-work`:** Full suite green + `45-SPIKE.md` con veredicto binario presente
- **Max feedback latency:** ~5 segundos

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 45-01-XX | 01 | 1 | PLAN-03 | T-45-01 / — | Teardown restaura `~/.claude/settings.json` byte-idéntico (no clobber de hooks producción) | manual | inspección de backup/restore | ✅ existing | ⬜ pending |
| 45-01-XX | 01 | 1 | PLAN-03 | — | `45-SPIKE.md` existe con veredicto binario + 4 secciones (D-05) | structural | `node --test` (asserción de fichero/secciones, si el plan la crea) | ❌ W0 | ⬜ pending |
| 45-01-XX | 01 | 1 | PLAN-03 | — | Experimento reproducible: matriz de comandos + script de volcado + payloads capturados | manual | ejecución del experimento (ver Manual-Only) | ✅ existing | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

*El planner ajusta los Task IDs exactos al desglosar el plan; la fila estructural es la única candidata a automatización.*

---

## Wave 0 Requirements

- [ ] `test/spike-doc.spike.test.js` (OPCIONAL) — asserción estructural de `45-SPIKE.md`: existe, contiene un veredicto binario (`VIABLE`|`INVIABLE`) y las 4 secciones de D-05. Solo si el planner decide que el coste vale la pena para un documento; en caso contrario, la completitud del documento se verifica manualmente.

*Si el planner omite el test estructural: "Existing infrastructure covers all phase requirements — la verificación del spike es manual por naturaleza (experimento + documento)."*

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| El experimento dispara (o no) `PostToolUse:ExitPlanMode` bajo `--dangerously-skip-permissions` | PLAN-03 | Requiere una sesión real de Claude Code interactiva con plan mode — no automatizable en CI | Instalar el hook de volcado temporal, lanzar `claude --dangerously-skip-permissions` (matriz D-02), forzar un plan, inspeccionar `/tmp/kodo-spike-*.log` |
| El payload contiene el plan Y es correlacionable (`session_id`/`cwd`) — criterio "capturable" (D-03) | PLAN-03 | Depende del payload crudo capturado en la ejecución real | Inspeccionar el log crudo: ¿existe el campo con el texto del plan? ¿están `session_id`/`cwd`? |
| Veredicto binario VIABLE/INVIABLE justificado con evidencia reproducible | PLAN-03 (SC#1, SC#2) | Juicio sobre la evidencia capturada | Leer `45-SPIKE.md`: el veredicto está en la 1ª línea y la evidencia (comandos + payloads) lo respalda |
| Teardown: `~/.claude/settings.json` restaurado byte-idéntico, hooks producción intactos | PLAN-03 (D-06) | Verificación de estado del filesystem del usuario | `diff` del settings.json contra el backup; confirmar `SessionStart`/`Stop` de kodo presentes |

---

## Validation Sign-Off

- [ ] El experimento del spike es reproducible (matriz de comandos + script de volcado documentados)
- [ ] `45-SPIKE.md` contiene veredicto binario + evidencia + (contrato de captura | decisión de diferir)
- [ ] Teardown restaura `~/.claude/settings.json` sin clobber de hooks producción
- [ ] Full suite verde (el experimento no rompió tests existentes)
- [ ] No watch-mode flags
- [ ] `nyquist_compliant: true` set cuando se cumpla lo anterior

**Approval:** pending

---

*Nota Nyquist: esta fase es un spike de investigación; el modelo de muestreo de feedback orientado a tests se aplica de forma degradada por diseño. La cobertura real del éxito es la reproducibilidad del experimento y la completitud del documento, capturadas arriba como verificaciones manuales + una asserción estructural opcional.*
</content>
