---
phase: 57-orquestador-asistido
plan: 57-04
gap_closure: true
source_review: 57-REVIEW.md
resolved_findings:
  - CR-01
  - WR-01
  - WR-02
  - WR-03
files_touched:
  - .claude/skills/kodo-orchestrate/skill.md
  - src/orchestrator/prompt.md
commits:
  - fb85a1c  # fix(57-04): single-quote ALL kodo adopt args + executable example (CR-01)
  - 45b4f12  # fix(57-04): fail-closed charset + quote ALL args + post-parse rationale in prompt.md (WR)
---

# Phase 57 — Gap-fix 57-04: shell-safety del `kodo adopt` asistido

Cierre del BLOCKER **CR-01** del code review (`57-REVIEW.md`) y de los tres WARNINGs que endurecen el mismo mandato shell-safe. Cambio **pure-prose**: solo `skill.md` + `prompt.md`, cero lógica `src`. No se toca `sanitizeAdoptionData`, `kodo adopt` ni `launch.js` (D-04/D-05 honrados).

## Problema (CR-01)

El mandato shell-safe endurecía SOLO `--title`. El mismo `kodo adopt` interpola cuatro valores más (`--workspace`, `--cwd`, `--session-id`, `--project`) en el mismo comando, sin guía de citado. Dos fallos:

1. El ejemplo "SAFE" usaba sintaxis `"$WS"`/`"$CWD"`/`"$SID"`/`"$PROJ"` que un LLM emitiendo un comando one-shot NO puede ejecutar (no hay variables exportadas) → o lo copia literal (4 args vacíos) o inlinea valores crudos sin guía.
2. Esos valores —en especial `cwd`, leído de `~/.kodo/state.json`— pueden contener metacaracteres legítimos (espacios, `&`, `$`, `;`). `sanitizeAdoptionData` no ayuda: redacta rutas DENTRO de `kodo adopt`, DESPUÉS de que el shell ya parseó.

## Qué se cambió

**`skill.md`:**
- **§6 (CR-01):** cada valor interpolado va citado y es untrusted al nivel del shell — `--title` en comillas SIMPLES, los otros cuatro en comillas DOBLES. Ejemplo SAFE reescrito con valores literales concretos ejecutables por un LLM one-shot; ejemplos UNSAFE incluyen el anti-patrón `"$VAR"` y el `cwd` sin citar.
- **§3 (WR-01):** charset fail-closed y ordenado — PRIMERO restringir charset (re-derivar el título, NO strip ciego), DESPUÉS envolver en simples; ambos controles obligatorios; el `'` nunca sobrevive; ABORTAR si no se puede hacer seguro.
- **§2↔§3 (WR-03):** acoplados explícitamente — el título derivado pasa obligatoriamente por el filtro de charset del §3 antes del shell-out; cap ≤80 chars traído a §2; "summariza, no concatenes en crudo".

**`prompt.md` (espejo condensado):**
- Refleja "cita CADA valor" (simples para título, dobles para el resto) con valores reales inline, no `"$VAR"`.
- Charset fail-closed condensado.
- **WR-02:** añade la razón temporal — el saneo del núcleo "corre después de que tu shell ya parseó el comando", no solo "no neutraliza metacaracteres".

## Verificación

- `node --test test/prompt.test.js test/skill-sync.test.js test/orchestrator-launch-isolation.test.js` → 38 pass, 0 fail.
- Suite completa: 1436 pass, 0 fail, 1 skip (pre-existente).
- `git diff` vs base toca SOLO `.claude/skills/kodo-orchestrate/skill.md` y `src/orchestrator/prompt.md`.
- Hygiene `prompt.md`: 8 placeholders intactos, sin literal "Plane", sin imperativos en inglés, mirror antes de `<!-- BEGIN reporting -->`.

## Findings restantes (no en scope de este gap-fix)

- **IN-01 / IN-02:** Info, opcionales. IN-01 (split del comentario UNSAFE) quedó parcialmente atendido al anotar "backticks ejecutan `thing`; además `;` encadena `rm -rf x`". IN-02 (encoding del path del transcript) sin cambios — degrada con gracia.
