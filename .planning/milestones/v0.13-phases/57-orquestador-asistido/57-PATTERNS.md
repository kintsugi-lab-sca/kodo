# Phase 57: Orquestador asistido - Pattern Map

**Mapped:** 2026-06-18
**Files analyzed:** 2 (both MODIFIED, pure-prose)
**Analogs found:** 2 / 2 (both intra-file — analogs live in the same files being edited)

## File Classification

| Modified File | Role | Data Flow | Closest Analog | Match Quality |
|---------------|------|-----------|----------------|---------------|
| `.claude/skills/kodo-orchestrate/skill.md` | config / instruction-prose (canonical orchestrator behavior) | request-response (operator → derive → confirm → shell-out) | §"Sesiones GSD" (`skill.md:66-109`) + §"Proceso de inicio" (`skill.md:14-35`) — same file | exact (intra-file lifecycle flow) |
| `src/orchestrator/prompt.md` | config / instruction-prose (degraded fallback mirror) | request-response | §"Sesiones GSD" condensed mirror (`prompt.md:30-38`) + header cross-ref (`prompt.md:3`) — same file | exact (intra-file condensed mirror) |

**Note:** This is a 2-file prose phase. There is no "new file" to scaffold; both deliverables are new prose *sections* appended to existing files. The best analogs are therefore the sibling sections inside those same files, not other files in the codebase. The planner pattern-matches voice + structure, not code.

## Pattern Assignments

### `.claude/skills/kodo-orchestrate/skill.md` — NEW §"Adopción asistida (sesión → tarea)"

**Placement (per RESEARCH Pattern 1, Assumption A3):** insert a new `##` section BETWEEN §"Sesiones GSD" (ends `skill.md:109`) and §"Diagnóstico" (starts `skill.md:111`). It is a lifecycle/operational flow like §"Sesiones GSD", NOT a symptom→command diagnostic, so it belongs adjacent to the lifecycle sections, above §"Diagnóstico".

**Voice + structure analog — §"Proceso de inicio" (`skill.md:14-35`):** numbered ordered steps, imperative second-person, each step opens with a **bolded action label**, cites CLI commands and `~/.kodo/*.json` by exact name, embeds the provider-agnostic caveat ("NO asumas un provider concreto"):

```markdown
## Proceso de inicio

Ejecuta estos pasos en orden al arrancar la sesión:

1. **Detectar el provider configurado** — `cat ~/.kodo/config.json`. Lee la clave
   `provider` (...). NO asumas un provider concreto: si la
   skill se carga en un repo sin config válida (...) pregunta al usuario antes de continuar.

2. **Leer estado de sesiones** — `cat ~/.kodo/state.json` para ver sesiones
   activas, su `gsd` / `gsd_mode`, `task_ref`, `workspace_ref` y `status`.
```

Mirror this exact shape for the adoption flow: numbered steps `(1) reconocer/recibir coordenadas → (2) derivar título → (3) proponer + esperar aprobación → (4) shellear kodo adopt`. The coordinate-recovery prose should reuse the `cat ~/.kodo/state.json` lookup pattern already established at `skill.md:23-24` (Pitfall 4 escape hatch).

**Project-resolution analog — §"Mapeo de proyectos" (`skill.md:51-64`):** reuse verbatim-by-reference, do NOT re-document. Resolve `--project <id>` by pointing at this section's `cat ~/.kodo/projects.json` + "pregunta al usuario antes de" pattern:

```markdown
## Mapeo de proyectos
- Ejecuta `cat ~/.kodo/projects.json` y verifica que el proyecto (...) tiene path mapeado.
- Si el mapping no existe, **pregunta al usuario antes de lanzar**. No hardcodes IDs ni paths (...).
```

**CLI-with-exit-codes analog — §"Cuándo correr `kodo gsd verify`" (`skill.md:83-97`):** the established pattern for documenting a shelled `kodo <cmd>` is: name the command, list flags/behavior, then enumerate deterministic exit codes as a bulleted sub-list. Mirror this for `kodo adopt`'s contract (per RESEARCH Code Examples, `src/cli.js:248-277` flags + 5-case exit switch `src/cli/adopt.js:144-160`: `0` adopted|ALREADY_ADOPTED, `1` config|input|persist, `2` transient POST):

```markdown
  Exit codes deterministas del CLI:
  - `0` — el gate corrió: el verdict viene en stdout/JSON (...)
  - `1` — error interno (...)
  - `2` — fetch transient al provider (...); retryable.
```

**⚠ LOAD-BEARING — shell-safe `--title` invocation (RESEARCH Pitfall 1 / Security V5 centerpiece):** this is the single most important thing the section must get right. The prose MUST mandate passing the derived title as ONE single-quoted literal argument and constraining the derived charset. There is NO existing analog in `skill.md` for this (the skill never previously shelled an LLM-derived string into Bash) — so this is net-new prose, not a copy. Mandate, in prose:

```bash
# SAFE — title as a single single-quoted literal arg (LLM constrains charset first):
kodo adopt --workspace "$WS" --cwd "$CWD" --session-id "$SID" \
           --project "$PROJ" --title 'Investigar tags y comportamiento del orquestador'
# UNSAFE — do NOT generate (metacharacters interpreted by the orchestrator's shell):
kodo adopt --title "$(git log -1 --format=%s)"        # command substitution executes
kodo adopt --title "feat: add `thing`; rm -rf x"      # backticks + ; execute
```

Prose rules the section must state (defense-in-depth, all four; the first two are load-bearing):
1. **Safe-charset derivation** — the title is a plain one-line human phrase (≤ ~80 chars); forbid/strip `\ $ \` " ' ; | & < > {newline}`. Summarize commit subjects, never copy verbatim.
2. **Single-quote literal arg** — `--title '<final>'`; nothing interpolated inside single quotes.
3. **Human confirmation (D-03)** — propose title + target project and WAIT for approval/edit; never create silently. The operator sees the title before it runs (backstop).
4. **Core sanitizer is paths-only (D-04)** — `sanitizeAdoptionData` (`src/adopt.js:82-90`) redacts home/abs paths, NOT shell metachars. Do NOT duplicate it in prose (anti-pattern); do NOT rely on it for shell-safety (Pitfall 2 — orthogonal concerns).

**Title-derivation sources (D-02):** `basename(cwd)` anchor + `git log --oneline -N` (in cwd, primary always-available signal) + optional transcript summary via Read of `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` (path computable, `src/logger-events.js:107-109`; treat as optional enrichment — `git log` is primary).

---

### `src/orchestrator/prompt.md` — NEW condensed "Adopción asistida" subsection

**Placement (RESEARCH Pattern 2 / Pitfall 3 — load-bearing structural constraint):** insert in the ALWAYS-ON body, BEFORE the `<!-- BEGIN reporting -->` marker (`prompt.md:40`). Anything between `<!-- BEGIN reporting -->` and `<!-- END reporting -->` is stripped by `applyReportingGate` (`launch.js:54-60`) when `workflow.report_to_provider` is false. Natural slot: right after §"Sesiones GSD" (`prompt.md:38`), before line 40.

**Condensed-mirror analog — §"Sesiones GSD" (`prompt.md:30-38`):** the established pattern for mirroring a canonical skill section into prompt.md is 4–8 condensed lines + bullets that state the flow + a deference to the canonical skill. Match this density (do NOT re-explain the full flow — that lives in the skill):

```markdown
## Sesiones GSD

Las sesiones con `gsd: true` siguen un flujo estructurado de fase. Cuando entran a Review:

- Ejecuta `kodo gsd verify <session-id>`. El CLI lee `VERIFICATION.md` (...). Exit codes (...): `0` (...), `1` (...), `2` (...).
- **No dupliques el gate** en comentarios manuales al provider — el CLI es la única fuente (...).
```

**Cross-ref analog — header (`prompt.md:3`):** prompt.md explicitly names the skill as "Fuente canonical extendida" and defers to it. The new subsection should close with the same deference ("ver §'Adopción asistida' en la skill para el detalle"):

```markdown
**Fuente canonical extendida**: la skill `.claude/skills/kodo-orchestrate/skill.md` (...) contiene el comportamiento completo (...).
```

**Placeholder convention (SC3 — no new logic):** the mirror may use `{{provider_name}}` / `{{provider}}` / `{{mcp_tool}}` (the only tokens `resolvePromptTemplate` substitutes, `launch.js:28-36`) but MUST introduce no new placeholder and no logic change. `launch.js` is NOT touched.

**Condensed content (4–6 lines):** flow (derive title → confirm with operator → shell `kodo adopt --title '<literal>'`) + the shell-safety one-liner (single-quote + safe charset) + pointer to the canonical skill section. The shell-safety rule is the one thing that must survive the condensation.

---

## Shared Patterns

### Provider-agnostic voice (apply to BOTH files)
**Source:** `skill.md:16-30` ("NO asumas un provider concreto", `mcp__<provider>__*`, "la label genérica `kodo`") and `prompt.md` `{{provider_name}}` placeholders.
**Apply to:** both new sections. Never name a concrete provider. The `--project` is a generic id; task creation is the core's `createTask` invoked by `kodo adopt`, not by the orchestrator — so no provider tool appears in the adoption prose at all.

### Single-source-of-truth deference (apply to BOTH files)
**Source:** §"Mapeo de proyectos" (`skill.md:53` "vive **únicamente** en `~/.kodo/projects.json`") and the anti-duplication rule (`skill.md:48-49`, `prompt.md:38`).
**Apply to:** the sanitizer (do NOT re-document path redaction — `sanitizeAdoptionData` owns it, BIDIR-08) and the project map (point at §"Mapeo de proyectos", do NOT re-state).

### Canonical-skill ⇄ degraded-fallback relationship
**Source:** `skill.md:5-10` (skill = canonical) and `prompt.md:3` (prompt = degraded mirror that cross-refs the skill).
**Apply to:** keep the skill section full + authoritative; keep the prompt.md subsection condensed + deferential. The shell-safety mandate must appear in BOTH (it is load-bearing and must not depend on the skill being auto-loaded).

## No Analog Found

| Item | Role | Data Flow | Reason |
|------|------|-----------|--------|
| Shell-safe single-quote `--title` mandate | input-validation prose (V5) | request-response | No prior section in `skill.md`/`prompt.md` shells an LLM-derived string into Bash. The dashboard sidesteps this with `execFile` literal argv (`src/cli/dashboard/adopt.js:102-118`) — but the orchestrator is an LLM in a shell and cannot use `execFile`. This prose is net-new with no copy-from analog; author it per RESEARCH Pitfall 1 / Code Examples. |

## Metadata

**Analog search scope:** the two target files (`.claude/skills/kodo-orchestrate/skill.md`, `src/orchestrator/prompt.md`); referenced-but-untouched: `src/adopt.js`, `src/cli/adopt.js`, `src/cli.js`, `src/orchestrator/launch.js`, `src/cli/dashboard/adopt.js`, `src/logger-events.js` (all read-only, cited from RESEARCH).
**Files scanned:** 2 read in full + 2 upstream docs (CONTEXT, RESEARCH).
**Pattern extraction date:** 2026-06-18
