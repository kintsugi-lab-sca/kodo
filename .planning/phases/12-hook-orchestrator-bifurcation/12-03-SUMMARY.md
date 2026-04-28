---
phase: 12-hook-orchestrator-bifurcation
plan: 03
subsystem: orchestrator
tags:
  - orchestrator
  - launch
  - prompt
  - quick-mode
  - visibility
requirements:
  - QUICK-07
dependency_graph:
  requires:
    - "src/labels.js getSessionMode (Phase 11 D-09)"
    - "Phase 10 D-19 — buildContextSummary tag pattern"
  provides:
    - "Tres etiquetas mutuamente excluyentes en pizarra: [GSD quick], [GSD phase N], [GSD bootstrap]"
    - "Documentación orquestador que aclara que sesiones quick no se verifican"
  affects:
    - "src/orchestrator/launch.js"
    - "src/orchestrator/prompt.md"
tech_stack:
  added: []
  patterns:
    - "S1 — Helper en labels.js + consumer downstream (primer consumer en orchestrator/)"
    - "S5 — Inline computation hasta que YAGNI exija extracción (D-12)"
key_files:
  created: []
  modified:
    - "src/orchestrator/launch.js"
    - "src/orchestrator/prompt.md"
decisions:
  - "D-11: prioridad mode-first en gsdTag (quick gana sobre phase_id residual)"
  - "D-12: cómputo inline en buildContextSummary, no se extrae helper"
  - "D-13: sesiones no-GSD siguen sin tag (status quo Phase 10 D-19)"
  - "D-14: patch incremental en prompt.md (líneas 1-88 verbatim intactas)"
  - "D-15: párrafo único al final de la sección, sin sub-h3"
  - "D-16: contenido del párrafo en ES per Phase 10 D-16"
  - "D-17: reusa placeholder existente {{provider_name}}, no introduce nuevos"
metrics:
  tasks: 3
  files_modified: 2
  duration_minutes: ~12
  completed_date: "2026-04-28"
---

# Phase 12 Plan 03: Orchestrator Visibility Summary

Bifurcación del control-plane del orquestador (`launch.js` + `prompt.md`) para que sesiones `kodo:gsd-quick` se distingan visualmente como `[GSD quick]` en la pizarra y la sección `## Sesiones GSD` del prompt explicite que no se ejecuta `kodo gsd verify` sobre ellas.

## What Was Built

Tres cambios atómicos cubriendo QUICK-07:

1. **Import de `getSessionMode`** en `src/orchestrator/launch.js:9` — primer consumer del helper desde el orchestrator-side. Pattern S1 (Phase 11 D-09 helper centralizado).
2. **Bifurcación de `gsdTag`** en `src/orchestrator/launch.js:122-130` — reemplazo del ternary `phase_id ? phase N : bootstrap` por un `if` con `let gsdTag = ''` + lectura de modo via `getSessionMode(s)` que gana sobre `phase_id` (defensa en profundidad).
3. **Párrafo `**Sesiones quick.**`** en `src/orchestrator/prompt.md:90` — un solo párrafo nuevo al final de la sección `## Sesiones GSD` aclarando que las sesiones quick se revisan manualmente.

### Línea exacta donde se añadió el import

`src/orchestrator/launch.js:9`

```javascript
import { getSessionMode } from '../labels.js';
```

Pegado al grupo de imports relativos `../`. La directiva `// @ts-check` (línea 1) y los 7 imports previos quedaron intactos. `grep -E "^import" src/orchestrator/launch.js | wc -l` retorna `8`.

### Líneas donde vive el nuevo cómputo del gsdTag

`src/orchestrator/launch.js:122-130`

```javascript
      // Phase 12 D-11: prioridad mode-first. Una sesión quick con phase_id
      // residual (no debería existir — dispatcher lo descarta — pero defensa
      // en profundidad) renderiza [GSD quick], no [GSD phase N].
      // D-12: cómputo inline (YAGNI — un solo callsite, no se extrae helper).
      // D-13: sesiones no-GSD siguen sin tag (status quo Phase 10 D-19).
      let gsdTag = '';
      if (s.gsd) {
        const mode = getSessionMode(s);
        const inner = mode === 'quick' ? 'quick' : (s.phase_id ? `phase ${s.phase_id}` : 'bootstrap');
        gsdTag = ` \`[GSD ${inner}]\``;
      }
```

El bloque produce las tres etiquetas posibles:

| Sesión                                                | gsdTag emitido       |
|-------------------------------------------------------|----------------------|
| `gsd:true, gsd_mode:'quick'`                          | `` `[GSD quick]` ``  |
| `gsd:true, gsd_mode:'quick', phase_id:'99'` (residual)| `` `[GSD quick]` ``  |
| `gsd:true, gsd_mode:'full', phase_id:'7'`             | `` `[GSD phase 7]` ``|
| `gsd:true, gsd_mode:'full'` (sin phase_id)            | `` `[GSD bootstrap]` ``|
| `gsd:true` legacy sin gsd_mode con phase_id           | `` `[GSD phase N]` ``|
| `gsd:false` o sin campo gsd                           | `''` (sin tag)       |

### Confirmación verbatim del párrafo añadido a prompt.md

Las dos líneas insertadas tras la línea 88 — verbatim:

```markdown

**Sesiones quick.** Las sesiones lanzadas por `kodo:gsd-quick` aparecen en la pizarra como `[GSD quick]`. Son one-shot (sin `VERIFICATION.md`), por eso **NO ejecutes `kodo gsd verify`** sobre ellas — el CLI no las soporta. Revísalas manualmente como cualquier sesión no-GSD: lee el comentario final del agente, valida en {{provider_name}} y decide si pasa a Done o necesita más trabajo.
```

Línea 89 = blanco. Línea 90 = párrafo. Trailing newline preservado (el archivo terminaba con `\n` y sigue terminando con `\n`).

### Confirmación de que las líneas 1-88 de prompt.md NO se tocaron

Diff `git diff HEAD~1 src/orchestrator/prompt.md` (commit `9d9e839`):

```
@@ -86,3 +86,5 @@ Las sesiones con `gsd: true` en `state.json` siguen un flujo estructurado de fas
 4. **Debugging previo al verify:** si dudas de la resolución de fase, puedes correr `kodo gsd inspect <task-id>` (dry-run del resolver).
 
 **No dupliques el gate en comentarios manuales.** Todo el lifecycle GSD se orquesta desde el CLI; tu rol es leer los artefactos, ejecutar el verify y continuar con la siguiente ronda de supervisión.
+
+**Sesiones quick.** Las sesiones lanzadas por `kodo:gsd-quich` ...
```

- Sólo 2 líneas añadidas (89 blanca + 90 párrafo).
- 0 líneas eliminadas.
- Los 4 pasos numerados (líneas 79-86) y el cierre `**No dupliques el gate**` (línea 88) quedaron verbatim.
- `grep -c "## Sesiones GSD" src/orchestrator/prompt.md` retorna `1` (no se introdujo sub-sección h3).

### Tests verificados (bloque `<verify>` Task 2)

Los 7 tests sobre `buildContextSummary` pasaron:

1. `quick session` → emite `[GSD quick]`, no `[GSD bootstrap]` ni `[GSD phase`.
2. `full+phase` → emite `[GSD phase 7]`, no `[GSD quick]`.
3. `full+bootstrap` (sin phase_id) → emite `[GSD bootstrap]`.
4. `legacy gsd:true` sin `gsd_mode` con phase_id → se taggea como `[GSD phase 3]` (Phase 11 D-08: legacy lee como full).
5. **Defensa en profundidad** — `gsd_mode:'quick'` con `phase_id:'99'` → `[GSD quick]`, NO `[GSD phase 99]`.
6. `gsd:false` → sin tag, pero `task_ref` sigue renderizándose.
7. Mixed sessions (quick + full+phase + non-GSD) → exactamente 2 ocurrencias del prefijo `[GSD`.

## Tasks Completed

| # | Task                                                              | Commit    | Files                       |
|---|-------------------------------------------------------------------|-----------|-----------------------------|
| 1 | Importar `getSessionMode` en launch.js                            | `6c7df6d` | `src/orchestrator/launch.js`|
| 2 | Reemplazar gsdTag ternary por switch mode-first (D-11/D-12/D-13)  | `f954ab3` | `src/orchestrator/launch.js`|
| 3 | Insertar párrafo `**Sesiones quick.**` en prompt.md (D-14..D-17)  | `9d9e839` | `src/orchestrator/prompt.md`|

## Decisions Made

Todas las decisiones del plan se aplicaron literalmente. No hubo desviaciones, descubrimientos ni rule-fixes.

- **D-11 mode-first:** el `if (s.gsd)` chequea `getSessionMode(s)` antes de mirar `phase_id`. Resultado: una sesión malformada con `gsd_mode:'quick'` pero `phase_id` residual renderiza `[GSD quick]`, evitando que el orchestrator humano intente `kodo gsd verify` sobre ella (T-12-07 mitigado).
- **D-12 inline computation:** el cómputo queda en `buildContextSummary`. NO se creó `function buildGsdTag(session)` ni se exportó nada. Si Phase 13 necesita testearlo aislado, se importa `buildContextSummary` y se asserta sobre el output (es lo que hicimos en `<verify>`).
- **D-13 status quo non-GSD:** `let gsdTag = ''` inicial garantiza que sesiones no-GSD (`s.gsd` falsy) salgan idénticas a Phase 10. NO se introdujo `[no-GSD]` ni similar.
- **D-14 patch incremental en prompt.md:** las líneas 1-88 quedaron literalmente intactas. El diff es `+2 / -0`.
- **D-15 párrafo único:** un solo párrafo al final, sin h3. La sección `## Sesiones GSD` sigue siendo única en el archivo.
- **D-16 contenido en ES:** el párrafo está en español per D-16 Phase 10 (texto que lee el orquestador humano).
- **D-17 placeholder existente:** se usa `{{provider_name}}` que `resolvePromptTemplate` ya resuelve. No se tocó `launch.js` para añadir resolución de placeholders.

## Deviations from Plan

None — plan executed exactly as written.

## Threat Flags

Ninguno. El cambio se mantiene dentro del threat model documentado en el plan (T-12-07 a T-12-10). No se introdujo nueva superficie de red, autenticación, ni schema cambia. La única superficie tocada (`gsdTag` en stdout del orchestrator) es lectura humana, no parsing programático.

## Hand-off Note for Phase 13

`test/launch.test.js` (a crear en Phase 13 Test Coverage Matrix) puede importar directamente `buildContextSummary` y assertar los 5 estados de label más el caso defensa-en-profundidad:

| Test name suggestion                            | Input shape                                                | Expected substring        |
|-------------------------------------------------|------------------------------------------------------------|---------------------------|
| `gsdTag/quick`                                  | `{gsd:true, gsd_mode:'quick'}`                             | `` `[GSD quick]` ``       |
| `gsdTag/full+phase`                             | `{gsd:true, gsd_mode:'full', phase_id:'7'}`                | `` `[GSD phase 7]` ``     |
| `gsdTag/full+bootstrap`                         | `{gsd:true, gsd_mode:'full'}`                              | `` `[GSD bootstrap]` ``   |
| `gsdTag/legacy-without-gsd_mode-with-phase_id`  | `{gsd:true, phase_id:'3'}`                                 | `` `[GSD phase 3]` ``     |
| `gsdTag/non-GSD`                                | `{gsd:false}`                                              | (no `[GSD` substring)     |
| `gsdTag/quick-with-residual-phase_id` (defense) | `{gsd:true, gsd_mode:'quick', phase_id:'99'}`              | `` `[GSD quick]` `` ; assert NOT `phase 99` |

Patrón ya validado en el bloque `<verify>` automated del Task 2. La extracción a un test file sólo formaliza esos asserts.

Para `prompt.md` no hay test programático — es validación manual: el orquestador humano lee `## Sesiones GSD`, ve el párrafo nuevo, entiende que sesiones `[GSD quick]` no van a `kodo gsd verify`. Pattern S6 (manual review) preservado.

## Self-Check: PASSED

Verificado:

- `src/orchestrator/launch.js` modificado, `node --check` pasa, importa `getSessionMode`, contiene `let gsdTag = ''` y `mode === 'quick' ? 'quick'`, comentario actualizado a `Phase 12 D-11`.
- `src/orchestrator/prompt.md` modificado, contiene `Sesiones quick`, `kodo:gsd-quick`, `[GSD quick]`, `NO ejecutes \`kodo gsd verify\``, `{{provider_name}}`, y preserva `No dupliques el gate en comentarios manuales`.
- 3 commits creados con `--no-verify` (worktree mode):
  - `6c7df6d` — Task 1
  - `f954ab3` — Task 2
  - `9d9e839` — Task 3
- Todas las verificaciones automatizadas (`<verify>` blocks de los 3 tasks + `<verification>` block del plan) pasan.
- `must_haves.truths` (los 9 enunciados) verificados via runtime asserts.
