---
phase: 57-orquestador-asistido
plan: 01
subsystem: orchestrator
tags: [adoption, orchestrator, skill, prompt, shell-safety, prose]
requires:
  - "kodo adopt CLI (Phase 54) — shell-out target, untouched"
  - "sanitizeAdoptionData / adoptSession (Phase 53, BIDIR-08) — core sanitizer, untouched"
  - "§Mapeo de proyectos (skill.md) — --project resolution, reused by reference"
provides:
  - "Canonical §Adopción asistida (sesión → tarea) section in kodo-orchestrate skill"
  - "Condensed always-on mirror of adoption flow in src/orchestrator/prompt.md"
  - "LOAD-BEARING shell-injection mitigation prose (single-quoted literal --title + safe charset) in BOTH files"
affects:
  - ".claude/skills/kodo-orchestrate/skill.md"
  - "src/orchestrator/prompt.md"
tech-stack:
  added: []
  patterns:
    - "One plumbing, three consumers — orchestrator is the LLM consumer of kodo adopt"
    - "Canonical skill ⇄ degraded prompt.md fallback mirror"
    - "Defense-in-depth shell-safety mandate present in both files (skill not always auto-loaded)"
key-files:
  created:
    - ".planning/phases/57-orquestador-asistido/57-01-SUMMARY.md"
  modified:
    - ".claude/skills/kodo-orchestrate/skill.md"
    - "src/orchestrator/prompt.md"
decisions:
  - "D-01: coordenadas por input explícito (match cwd contra ~/.kodo/state.json) + escape hatch al dashboard; nunca cmux directo"
  - "D-02: título derivado por LLM de basename(cwd) + git log --oneline -N + transcript opcional"
  - "D-03: proponer título + proyecto y ESPERAR aprobación humana antes de shellear"
  - "D-04: saneo automático en el núcleo (sanitizeAdoptionData); orquestador NO duplica; solo --title esta fase"
  - "D-05: fuente canónica en skill.md + espejo condensado en prompt.md antes del reporting gate; launch.js intacto"
metrics:
  duration: ~10m
  completed: 2026-06-18
  tasks: 2
  files-changed: 2
  commits: 2
---

# Phase 57 Plan 01: Orquestador asistido (adopción sesión → tarea) Summary

Añadido el tercer consumidor (LLM) de la fontanería de adopción: prosa de instrucción que enseña al orquestador a derivar un título inteligente del contexto real, confirmarlo con el operador y shellear `kodo adopt --title '<literal>'` de forma shell-segura — sin tocar una sola línea de lógica de negocio.

## What Was Built

- **Sección canónica `## Adopción asistida (sesión → tarea)` en `skill.md`** — ubicada entre §"Sesiones GSD" y §"Diagnóstico" (es un flujo de lifecycle, no un síntoma→comando). Seis pasos numerados imperativos espejando §"Proceso de inicio":
  1. Obtener coordenadas por input explícito (match `cwd` contra `~/.kodo/state.json`) con escape hatch al dashboard (tecla `a`) y la regla "nunca cmux directo".
  2. Derivar el título inteligente (`basename(cwd)` + `git log --oneline -N` + transcript opcional).
  3. **⚠ Mandato LOAD-BEARING:** restringir el título a charset seguro (prohibir `` \ $ ` " ' ; | & < > `` + newline), summarizar subjects de commit, y nota explícita de que el saneo del núcleo es paths-only y corre post-parse del shell.
  4. Proponer + esperar aprobación humana (D-03).
  5. Resolver `--project` por referencia a §"Mapeo de proyectos" (sin re-documentar).
  6. Shell-out shell-seguro con ejemplo SAFE (comilla simple) + ejemplos UNSAFE (`$()`, backticks + `;`) + exit codes deterministas de `kodo adopt` (0/1/2).

- **Espejo condensado `## Adopción asistida` en `src/orchestrator/prompt.md`** — en el cuerpo always-on, ANTES de `<!-- BEGIN reporting -->` (sobrevive el reporting gate). Densidad estilo §"Sesiones GSD" condensado: flujo en una línea + el mandato shell-seguro LOAD-BEARING repetido aquí (el skill no siempre se auto-carga) + cross-ref deferente al detalle del skill.

## How It Works

El orquestador es el único carril con LLM. Recibe coordenadas explícitas, deriva un título mejor que el `basename(cwd)` determinista del dashboard, lo confirma con el operador, y shellea el **mismo** `kodo adopt` que el dashboard. El núcleo 0-token (`adoptSession` / `sanitizeAdoptionData`) hace el saneo de rutas y crea la tarea — el orquestador solo aporta el título. La mitigación de shell-injection es prosa pura (charset seguro + argumento literal entre comillas simples + confirmación humana), presente en ambos archivos para no depender de que la skill se auto-cargue.

## Verification Results

- `node --test test/prompt.test.js test/skill-sync.test.js test/orchestrator-launch-isolation.test.js` → **38 pass / 0 fail** (exit 0).
- Full suite `node --test $(find test -name '*.test.js')` → **1436 pass / 1 skip / 0 fail**.
- `git diff src/orchestrator/launch.js src/adopt.js src/cli/adopt.js src/cli.js` → **VACÍO** (SC3 — cero lógica nueva).
- `git diff --name-only` desde base → solo `.claude/skills/kodo-orchestrate/skill.md` + `src/orchestrator/prompt.md`.
- Grep-asserts: heading presente en ambos; `--title '` (comilla simple) en ambos ejemplos SAFE; sección del skill entre §"Sesiones GSD" y §"Diagnóstico"; mirror antes de `<!-- BEGIN reporting -->`; sin literal "Plane" fuera de placeholders; sin frases inglés (`you must`/`please`/`execute your`).

## Deviations from Plan

None - plan executed exactly as written.

## Commits

- `f4163dc` — docs(57-01): add canonical §Adopción asistida section to kodo-orchestrate skill
- `815a44c` — docs(57-01): mirror condensed §Adopción asistida in orchestrator prompt.md

## Self-Check: PASSED

- FOUND: `.claude/skills/kodo-orchestrate/skill.md`
- FOUND: `src/orchestrator/prompt.md`
- FOUND: `.planning/phases/57-orquestador-asistido/57-01-SUMMARY.md`
- FOUND commit `f4163dc`
- FOUND commit `815a44c`
