---
phase: 57-orquestador-asistido
verified: 2026-06-18T17:35:00+02:00
status: human_needed
score: 9/9 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Lanzar el orquestador apuntado a una sesión ad-hoc real en un repo con historial de commits, pedirle que la adopte, y verificar que (a) deriva un título mejor que basename(cwd), (b) muestra el título al operador y espera confirmación antes de shellear, y (c) el título llega a kodo adopt sin metacaracteres peligrosos"
    expected: "El orquestador propone un título concreto tipo 'Investigar X e integrar Y' (no solo el nombre del directorio), espera aprobación explícita, y el kodo adopt resultante sale con exit 0 y el título saneado correcto en el provider"
    why_human: "Comportamiento LLM end-to-end: la calidad del título derivado, que el LLM efectivamente lea git log y no sólo use basename, y que respete el paso de confirmación antes de actuar — no verificable con grep ni tests de invariantes"
---

# Phase 57: Orquestador asistido (ORCH-01) — Informe de Verificación

**Phase Goal:** El orquestador (único carril LLM) propone adoptar una sesión ad-hoc y deriva un título inteligente del contexto real (cwd/commits/transcript), que pasa por el sanitizador del núcleo (BIDIR-08) y se confirma (humano/CLI) antes de crear; shellea el mismo `kodo adopt --title "<derived>"`; prosa del skill `kodo-orchestrate` actualizada, CERO lógica de negocio nueva en el orquestador.
**Verified:** 2026-06-18T17:35:00+02:00
**Status:** human_needed
**Re-verification:** No — verificación inicial

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | D-05: skill.md contiene `## Adopción asistida (sesión → tarea)` con flujo numerado de 6 pasos, fuente canónica | ✓ VERIFIED | Línea 111 de skill.md; sección entre §"Sesiones GSD" (l.66) y §"Diagnóstico" (l.223) |
| 2 | D-01: coordenadas por input explícito — match por cwd en state.json, escape hatch al dashboard (tecla `a`), NUNCA cmux directo | ✓ VERIFIED | skill.md:119-126 literal; "NUNCA llames a `cmux` directamente (invariante LOCKED: todo cmux entra por `src/host/`)" |
| 3 | D-02: título derivado por LLM de basename(cwd) + git log --oneline -N + transcript opcional | ✓ VERIFIED | skill.md:128-139; prompt.md:42; transcript como "enriquecimiento opcional"; cap ≤80 chars; "git log es la señal primaria" |
| 4 | Mandato de invocación shell-segura presente en AMBOS archivos (charset seguro + TODOS los args en comillas simples + summarizar commits + fail-closed) | ✓ VERIFIED | skill.md §3 (l.141-164) y §6 (l.175-221); prompt.md:44 — "CINCO args" nombrados explícitamente, LOAD-BEARING en ambos |
| 5 | D-03: proponer título + proyecto y ESPERAR aprobación humana; nunca crear silenciosamente | ✓ VERIFIED | skill.md:166-169 "propón… y ESPERA su aprobación/edición. Nunca crees silenciosamente"; prompt.md:42 "espera confirmación/edición del operador" |
| 6 | D-04: sanitizeAdoptionData (núcleo/BIDIR-08) hace el saneo; el orquestador NO lo duplica; solo --title esta fase | ✓ VERIFIED | skill.md:159-164 menciona explícitamente que la redacción de rutas "vive solo en el núcleo; no la dupliques en prosa"; línea 215 "Solo `--title` esta fase — OMITE `--description`" |
| 7 | D-05: prompt.md contiene espejo condensado de adopción ANTES de `<!-- BEGIN reporting -->`, con cross-ref al skill | ✓ VERIFIED | prompt.md §"Adopción asistida" en línea 40; `<!-- BEGIN reporting -->` en línea 47; cross-ref "Detalle completo en §Adopción asistida de la skill" en línea 45 |
| 8 | SC3: CERO lógica nueva — src/orchestrator/launch.js, src/adopt.js, src/cli/adopt.js, src/cli.js byte-idénticos | ✓ VERIFIED | `git diff f4163dc^..HEAD -- src/orchestrator/launch.js src/adopt.js src/cli/adopt.js src/cli.js` → 0 bytes |
| 9 | Suite de invariantes verde: `node --test test/prompt.test.js test/skill-sync.test.js test/orchestrator-launch-isolation.test.js` → exit 0 | ✓ VERIFIED | 38 pass / 0 fail / 0 skip ejecutado en vivo |

**Score:** 9/9 truths verified

---

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `.claude/skills/kodo-orchestrate/skill.md` | Sección canónica §"Adopción asistida (sesión → tarea)" con 6 pasos numerados + mandato shell-seguro + exit codes | ✓ VERIFIED | 293 líneas; sección en l.111-222; 6 pasos presentes con toda la estructura requerida |
| `src/orchestrator/prompt.md` | Espejo condensado en cuerpo always-on + cross-ref al skill | ✓ VERIFIED | 117 líneas; §"Adopción asistida" en l.40-45; mandato LOAD-BEARING en l.44; cross-ref en l.45 |

---

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `skill.md §Adopción asistida` | `kodo adopt --title '<derived>'` | Instrucción de shell-out con `--title` entre comillas SIMPLES (§6) | ✓ WIRED | skill.md:202-213 ejemplo SAFE con valores literales; todos los 5 args en simples |
| `prompt.md §Adopción asistida` | `skill.md §Adopción asistida` | Cross-ref "Detalle completo en §Adopción asistida de la skill" | ✓ WIRED | prompt.md:45 referencia explícita al skill |
| `prompt.md §Adopción asistida` | Cuerpo always-on (antes del reporting gate) | Colocación antes de `<!-- BEGIN reporting -->` | ✓ WIRED | l.40 < l.47; sobrevive `applyReportingGate(raw, false)` |

---

### Security Invariants (T-57-01 — LOAD-BEARING)

| Invariant | skill.md | prompt.md | Status |
|-----------|----------|-----------|--------|
| Charset prohibido (`` \ $ ` " ' ; \| & < > `` + newline) | l.147 | l.44 | ✓ AMBOS |
| Fail-closed: re-derivar, no strip ciego | l.148-154 | l.44 ("re-deríbalo, no lo strippees a ciegas") | ✓ AMBOS |
| `'` nunca sobrevive; ABORTAR si no se puede hacer seguro | l.151-154 | l.44 ("ABORTA") | ✓ AMBOS |
| TODOS los args (5) en comillas SIMPLES, no dobles | l.182-186 | l.44 ("los CINCO args") | ✓ AMBOS |
| LLM emite one-shot: NO `"$WS"` literales (vacíos) | l.179-180 | l.44 | ✓ AMBOS |
| `sanitizeAdoptionData` corre DESPUÉS que el shell parseó (WR-02) | l.160-162 | l.44 ("corre después de que tu shell ya parseó el comando") | ✓ AMBOS |
| Ejemplo SAFE con valores literales concretos | l.202-206 | l.42 (inline en prosa) | ✓ AMBOS |
| Ejemplos UNSAFE con anti-patrones (`"$VAR"`, doble-comilla+`$()`, command sub) | l.207-212 | l.44 (`"--cwd /path/$(whoami)"` ejecuta) | ✓ AMBOS |

**CR-01 fix (57-04):** Los 4 argumentos no-título (`--workspace`, `--cwd`, `--session-id`, `--project`) también van en comillas SIMPLES — verificado en skill.md:182-186 y prompt.md:44. El ejemplo SAFE inicial (57-01) usaba `"$WS"`/`"$CWD"` (dobles, con variables no exportadas); 57-04 lo corrigió a valores literales en simples.

**WR-01 fix:** §3 es fail-closed y ordenado — PRIMERO charset (re-derivar, no strip), DESPUÉS wrap; ambos obligatorios; `'` nunca sobrevive; ABORTAR si no se puede hacer seguro. Verificado en skill.md:143-154.

**WR-02 fix:** prompt.md l.44 incluye "corre después de que tu shell ya parseó el comando" — la razón temporal del porqué el núcleo no protege en esta frontera.

**WR-03 fix:** §2 de skill.md (l.136-139) referencia explícitamente "el título que compongas pasa OBLIGATORIAMENTE por el filtro de charset del §3 ANTES de shellear (§6)".

---

### Behavioral Spot-Checks

Step 7b: SKIPPED — fase pure-prose (2 archivos `.md`). No hay puntos de entrada ejecutables nuevos que testear.

---

### Probe Execution

Step 7c: no hay probes en esta fase (no es una fase de migración/CLI).

---

### Requirements Coverage

| Requirement | Plan | Description | Status | Evidence |
|-------------|------|-------------|--------|----------|
| ORCH-01 | 57-01-PLAN.md | El orquestador propone + deriva título inteligente + confirma + shellea `kodo adopt --title`; prosa del skill; cero lógica nueva | ✓ SATISFIED | skill.md §"Adopción asistida" completo; prompt.md espejo; suite verde 38/38; SC3 diff vacío |

---

### Anti-Patterns Found

Análisis de los dos archivos modificados:

| File | Pattern Checked | Result |
|------|----------------|--------|
| `.claude/skills/kodo-orchestrate/skill.md` | TBD/FIXME/XXX markers | Ninguno |
| `.claude/skills/kodo-orchestrate/skill.md` | `return null` / stubs | N/A (archivo .md) |
| `src/orchestrator/prompt.md` | Literal "Plane" fuera de `{{ }}` | Ninguno — PASS |
| `src/orchestrator/prompt.md` | Frases inglesas (`you must`/`please`/`execute your`) | Ninguna — PASS |
| `src/orchestrator/prompt.md` | Marcadores reporting exactamente 1× cada uno | 1× BEGIN + 1× END — PASS |
| `src/orchestrator/prompt.md` | Espejo antes del reporting gate | l.40 < l.47 — PASS |

Sin anti-patrones bloqueantes.

---

### Human Verification Required

#### 1. Comportamiento LLM end-to-end: derivación de título + confirmación + adopción

**Test:** Lanzar el orquestador apuntado a un repo real con historial de commits (p. ej. el propio `kodo`), pedirle verbalmente que adopte la sesión ad-hoc actual, y observar su comportamiento completo.

**Expected:**
- El orquestador lee `git log` del cwd (o equivalente) y propone un título concreto y descriptivo — no simplemente `kodo` o el basename del directorio.
- Muestra el título propuesto + el proyecto destino al operador y espera respuesta explícita antes de ejecutar nada.
- Tras aprobación, emite `kodo adopt --title 'Título seguro' --workspace '...' --cwd '...' --session-id '...' --project '...'` con todos los valores entre comillas simples y el título libre de metacaracteres peligrosos.
- `kodo adopt` sale con exit 0 y la tarea aparece creada en el provider.

**Why human:** Comportamiento LLM en runtime — la calidad del título derivado, la correcta lectura de git log vs. uso de basename, la pausa real de confirmación antes de actuar, y la adecuada formación del comando shell son propiedades emergentes del LLM siguiendo la prosa, no verificables con grep ni tests de invariantes. La suite (38/38 pass) solo verifica la estructura y los invariantes del texto de la prosa, no que el LLM los ejecute correctamente.

---

### Gaps Summary

Ningún gap. Los 9 must-haves están verificados en codebase. El estado `human_needed` refleja únicamente que el comportamiento LLM end-to-end (calidad del título derivado, paso de confirmación, formación correcta del comando) requiere UAT manual.

El ítem de UAT estaba previsto y documentado explícitamente en el PLAN (sección `<verification>` §"HUMAN-UAT") y en `57-VALIDATION.md §"Manual-Only Verifications"`.

---

_Verified: 2026-06-18T17:35:00+02:00_
_Verifier: Claude (gsd-verifier)_
