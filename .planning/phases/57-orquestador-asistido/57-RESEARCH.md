# Phase 57: Orquestador asistido (kodo) - Research

**Researched:** 2026-06-18
**Domain:** Prompt/skill engineering for an LLM consumer of a deterministic CLI (shell-out safety, title derivation, prose authoring)
**Confidence:** HIGH (all claims grounded in the actual repo source, line-cited)

## Summary

Phase 57 is a **prose-only consumer phase**. The deterministic 0-token core (`adoptSession`/`kodo adopt`/`sanitizeAdoptionData`) and the two existing consumers (CLI Phase 54, dashboard Phase 56) are complete and **untouched**. The only deliverable is instruction prose: a new section in `.claude/skills/kodo-orchestrate/skill.md` (the canonical orchestrator behavior) plus a condensed mirror + cross-ref in `src/orchestrator/prompt.md` (the degraded fallback). `src/orchestrator/launch.js` and the core do **not** change — `resolvePromptTemplate` only does `{{placeholder}}` substitution and must stay that way (SC3: zero new business logic).

Two implementation-knowledge gaps drive the plan. **(1) D-01 — coordinate source.** I verified empirically that `listAgentSurfaces()` exists ONLY in-process in `src/host/cmux.js`, consumed ONLY by the dashboard (`src/cli/dashboard/`). There is NO `kodo` CLI command exposing it (the `adopt` command in `src/cli.js:248-277` takes explicit `--workspace/--cwd/--session-id` and never discovers). The pure-prose-with-explicit-input path is therefore **viable today** — the orchestrator can obtain coordinates from the operator and/or from `cat ~/.kodo/state.json` + Bash. A thin read-CLI is **NOT required** for Phase 57 to function; I recommend deferring it (see D-01 resolution below). **(2) Shell-injection threat.** `sanitizeAdoptionData` (`src/adopt.js:82-90`) redacts paths/home — it does NOT neutralize shell metacharacters. The orchestrator shells `kodo adopt` via its Bash tool with an LLM-derived `--title`; an unconstrained title containing `"`/`$()`/backticks/`;` is a shell-injection risk **at the orchestrator's invocation**, before the title ever reaches the sanitizer. This is the phase's centerpiece threat-model item and the skill prose must mandate a safe invocation pattern.

**Primary recommendation:** Add one skill section "Adopción asistida (sesión → tarea)" (placed after §"Sesiones GSD", before §"Diagnóstico") that instructs the orchestrator to: derive a smart title from `git log --oneline`/cwd/transcript, propose it + target project to the operator and WAIT for approval, then invoke `kodo adopt` with the title passed as a single literal argument under single quotes (or constrained charset). Mirror condensed in `prompt.md`. Default scope = pure prose + explicit input + title-only (no `--description`, no read-CLI).

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Derive smart title from context | Orchestrator (LLM consumer) | — | The ONLY LLM rail; uses Bash (`git log`) + Read (transcript). Lives in skill prose, never in the core. |
| Sanitize title (paths/home) | Deterministic core (`src/adopt.js`) | — | `sanitizeAdoptionData` is the single source of truth (BIDIR-08). Orchestrator MUST NOT duplicate it. |
| Shell-safe invocation of `kodo adopt` | Orchestrator (consumer, via prose) | — | The orchestrator's Bash tool is the injection surface; the core never sees a shell. Mitigation is a prose mandate, not core code. |
| Create task + seed state row | Deterministic core (`adoptSession`) | — | 0-token, untouched. Orchestrator shells the CLI; never calls the core directly. |
| Resolve target `--project` | Orchestrator (reuses §"Mapeo de proyectos") | Core (fail-fast on unmapped) | Orchestrator reads `~/.kodo/projects.json`; CLI `runAdoptCli` PASO 2 re-validates and fails before any POST. |
| Surface discovery | Dashboard (Phase 56, in-process `listAgentSurfaces`) | — | OUT OF SCOPE for 57. Orchestrator takes explicit input; never calls cmux (LOCKED: cmux only via `src/host/`). |

## Standard Stack

**No new packages.** This phase adds zero dependencies and zero source logic. The "stack" is the existing repo machinery the prose leans on:

| Asset | Location | Purpose | Consumed how |
|-------|----------|---------|--------------|
| `kodo adopt` CLI | `src/cli.js:248-277` → `src/cli/adopt.js` | The 0-token shell-out target | Orchestrator runs it via Bash with explicit flags + derived `--title` |
| `sanitizeAdoptionData` | `src/adopt.js:82-90` | Auto-redacts home/abs paths from title/description | Runs automatically inside `adoptSession`; orchestrator does NOT duplicate |
| §"Mapeo de proyectos" | `skill.md:51-64` | `projectId → path` via `~/.kodo/projects.json` | Reused to resolve `--project <id>` |
| `git log --oneline -N` | operator's Bash | Strongest signal for the smart title | Orchestrator's existing Bash tool |
| Transcript file | `~/.claude/projects/<encoded-cwd>/<sessionId>.jsonl` | Optional summary source | Orchestrator's existing Read tool (path computable, see §Title-derivation sources) |

**Installation:** None. (No package legitimacy audit required — this phase installs nothing.)

## Package Legitimacy Audit

Not applicable — Phase 57 installs no external packages. Deliverable is prose in two `.md` files.

## Architecture Patterns

### System Architecture Diagram (data flow)

```
operator: "adopta la sesión ad-hoc en ~/dev/foo"
        │  (provides coordinates explicitly: cwd, and ideally workspace_ref/session_id)
        ▼
ORCHESTRATOR (Claude session, the only LLM rail)
        │
        ├─(read) cat ~/.kodo/state.json ........ live sessions / workspace_ref
        ├─(read) cat ~/.kodo/projects.json ...... resolve --project (§Mapeo de proyectos)
        ├─(derive title) ───────────────────────────────────────────────┐
        │     basename(cwd)  +  git log --oneline -N (in cwd)            │ LLM composition
        │     [+ optional summary of transcript .jsonl via Read]         │ → "<smart title>"
        ▼                                                                ▼
   PROPOSE title + target project to operator ──► WAIT for approval/edit  (D-03: never silent)
        │  (approved/edited "<final title>")
        ▼
   INVOKE (Bash, shell-SAFE): kodo adopt --workspace <ref> --cwd <path>
                              --session-id <id> --project <id>
                              --title '<final title literal>'
        │   ⚠ title passed as ONE quoted literal arg — no shell interpolation
        ▼
   kodo adopt  ──►  runAdoptCli  ──►  adoptSession  (DETERMINISTIC 0-TOKEN, UNTOUCHED)
                                          │
                                          ├─ sanitizeAdoptionData(title) ... redact home/paths
                                          ├─ findSession({sessionId}) ...... idempotency guard
                                          ├─ provider.createTask() ......... the only POST
                                          └─ addSession() .................. seed state.json row
        ▼
   exit 0 (adopted | ALREADY_ADOPTED) / 1 (config|input|persist) / 2 (transient POST)
```

The LLM lives strictly in the top box (title derivation + propose/confirm + safe invocation). Everything below `kodo adopt` is the frozen 0-token core.

### Recommended "structure" (files touched)

```
.claude/skills/kodo-orchestrate/skill.md   # NEW section "Adopción asistida (sesión → tarea)"
src/orchestrator/prompt.md                 # condensed mirror + cross-ref (NOT canonical)
# NOT TOUCHED: src/orchestrator/launch.js, src/adopt.js, src/cli/adopt.js, src/cli.js
```

### Pattern 1: Skill section placement & voice

**What:** Add the new section to `skill.md` between §"Sesiones GSD" (ends ~line 109) and §"Diagnóstico" (starts ~line 111). It is an operational flow like "Sesiones GSD", not a diagnostic symptom→command flow, so it belongs adjacent to the lifecycle sections, not inside §"Diagnóstico".

**Voice to match (verified from the existing file):**
- Imperative, second-person ("Ejecuta", "Lee", "Pregunta al usuario antes de…").
- **Provider-agnostic** — the skill never names a concrete provider; it says `mcp__<provider>__*`, "tu provider", "la label genérica `kodo`". The adoption prose MUST stay provider-agnostic (the `--project` is a generic id; the task creation is the provider's `createTask`, invoked by the core, not the orchestrator).
- References CLI commands and `~/.kodo/*.json` files by exact name (e.g., `cat ~/.kodo/state.json`).
- Numbered ordered steps for a flow (mirror §"Proceso de inicio" `skill.md:14-35`).

**Example (the existing flow voice it should match):**
```markdown
# Source: .claude/skills/kodo-orchestrate/skill.md:14-21 (§Proceso de inicio)
1. **Detectar el provider configurado** — `cat ~/.kodo/config.json`. Lee la clave
   `provider` (string corto en minúsculas...). NO asumas un provider concreto...
```

### Pattern 2: Condensed mirror in prompt.md

**What:** `prompt.md` is the **degraded fallback** that cross-references the skill (line 3). It already mirrors §"Sesiones GSD" in condensed form (`prompt.md:30-38`) and uses `{{provider_name}}` placeholders resolved by `resolvePromptTemplate`. Add a short "Adopción asistida" subsection in the same condensed style: 4-6 lines stating the flow (derive title → confirm → shell `kodo adopt --title`), the shell-safety rule, and a pointer to the canonical skill section for detail.

**Constraints verified:**
- `resolvePromptTemplate` (`launch.js:28-36`) only does `.replaceAll('{{provider_name}}'…)` / `{{provider}}` / `{{mcp_tool}}`. The new prose may use these placeholders but introduces **no new tokens** and **no logic change** (SC3).
- The reporting block (`<!-- BEGIN reporting -->…<!-- END reporting -->`, `prompt.md:40-109`) is gated by `applyReportingGate`. Place the new adoption subsection in the always-on body (before line 40) so it is never stripped.

### Anti-Patterns to Avoid
- **Duplicating the sanitizer in prose:** Do NOT instruct the orchestrator to strip paths/home from the title itself — that is the core's single source of truth (`sanitizeAdoptionData`, BIDIR-08). The orchestrator passes the raw derived title; the core sanitizes. (Verified: `src/cli/adopt.js:111-113` PASO 3 passes title untouched; `adoptSession` step (b) sanitizes.)
- **Embedding a transcript body as `--description`:** Forbidden by BIDIR-08 and structurally impossible at the core (`sanitizeAdoptionData` has no transcript param, `src/adopt.js:75-77`). If `--description` is used at all, it must be a short LLM-written summary. Default recommendation: omit `--description` this phase (D-04).
- **Orchestrator calling cmux directly to discover surfaces:** LOCKED invariant — cmux only via `src/host/`. The orchestrator never runs `cmux surface resume show`. It takes explicit input.
- **Adding a 6th branch / new logic to the core or launch.js:** Out of scope (SC3). The exit-code switch is exactly 5 cases (`src/cli/adopt.js:144-160`).
- **Naming a concrete provider in the prose:** Breaks the skill's provider-agnostic invariant.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Title sanitization (paths/home) | Prose telling the LLM to redact | `sanitizeAdoptionData` (automatic in core) | Single source of truth; BIDIR-08; the LLM would do it inconsistently |
| Task creation / state seeding | Any orchestrator logic | `kodo adopt` shell-out | 0-token core invariant; the orchestrator only derives the title |
| `cwd → projectId` resolution | New mapping logic | `cat ~/.kodo/projects.json` (§Mapeo de proyectos) | The map already exists; dashboard `resolveProjectId` proves the ancestor-match algorithm but the orchestrator can just read the file and ask the operator |
| Idempotency / double-adopt | Prose checks | Core `findSession({sessionId})` guard | Returns `ALREADY_ADOPTED` (exit 0, no-op); orchestrator just re-runs safely |
| Surface discovery | Read-CLI or cmux call | Explicit operator input | D-01: discovery is the dashboard's job (Phase 56), explicitly OUT of 57 |

**Key insight:** Phase 57 adds **value, not machinery** — the only thing the orchestrator contributes that the dashboard cannot is a *good title derived by an LLM from real work context*. Everything else is reuse.

## Runtime State Inventory

Not a rename/refactor/migration phase. Omitted.

## Common Pitfalls

### Pitfall 1: Shell injection via the LLM-derived `--title` (THE centerpiece)
**What goes wrong:** The orchestrator runs `kodo adopt --title "<derived>"` through its Bash tool. `sanitizeAdoptionData` (`src/adopt.js:82-90`) redacts home/abs paths via `redactPaths` — it does **NOT** escape shell metacharacters (it operates on `/`-rooted path runs and `~` only). A title the LLM derives from commit subjects could legitimately contain `"`, `$(…)`, backticks, `;`, `&&`, `|`. If the orchestrator builds the command with the title interpolated inside a double-quoted string, those metacharacters execute in the orchestrator's shell **before** the core ever sees the string. The sanitizer is a *post-parse, pre-POST* path redactor — it is no defense against *shell parsing at invocation time*.
**Why it happens:** The injection surface is the orchestrator's Bash tool, not the CLI's argv (the dashboard avoids this entirely by using `execFile` with a literal argv array — `src/cli/dashboard/adopt.js:102-118` — no shell at all). The orchestrator is an LLM in a shell, so it cannot use `execFile`; it must compose a safe shell command via prose discipline.
**How to avoid (prose MUST mandate one of these):**
1. **Single-quote the title as ONE literal argument:** `kodo adopt … --title 'Smart title here'`. Inside single quotes nothing is interpreted; only an embedded `'` breaks it. Instruct the LLM to (a) constrain the derived title to a safe charset (letters, digits, spaces, basic punctuation `-_.:,()`) and (b) strip/forbid single-quotes, double-quotes, backticks, `$`, `;`, `|`, `&`, `<`, `>`, newlines from the title before invoking.
2. **Preferred framing:** Tell the orchestrator the title is a plain human-readable phrase (≤ ~80 chars, one line) — derived titles are descriptive prose, so the safe-charset constraint is natural and loses nothing. A commit subject like `feat(x): add $FOO via \`bar\`` becomes `Añadir FOO via bar` when the LLM *summarizes* rather than *copies*.
**Warning signs:** A proposed title containing any of `\` $ \` " ' ; | & ( ) < > {newline}` — the operator-confirmation step (D-03) is also a human backstop: the operator sees the title before it runs.
**Note:** This is a *prose-enforced* mitigation. There is no code change (SC3). The defense-in-depth layers are: (1) safe-charset derivation, (2) single-quote literal arg, (3) human confirmation, (4) core sanitizer (paths only). Document all four; the title-charset constraint + single-quote are the load-bearing ones for injection.

### Pitfall 2: Confusing the sanitizer's job
**What goes wrong:** A plan author assumes `sanitizeAdoptionData` makes the title shell-safe and skips the invocation-safety prose.
**Why it happens:** "Sanitize" is overloaded. Here it means *redact secrets/paths for export to the external task manager* (BIDIR-08), not *shell-escape*.
**How to avoid:** Treat the two concerns as orthogonal. Path-redaction = core (automatic). Shell-safety = orchestrator invocation discipline (prose). Both must be present; neither replaces the other.

### Pitfall 3: Putting the new prose in the gated reporting block of prompt.md
**What goes wrong:** If the condensed mirror lands inside `<!-- BEGIN reporting -->…<!-- END reporting -->` (`prompt.md:40-109`), it disappears when `workflow.report_to_provider` is false (`applyReportingGate`, `launch.js:54-60`).
**How to avoid:** Place it in the always-on body (before line 40), like §"Sesiones GSD" (`prompt.md:30-38`).

### Pitfall 4: Operator doesn't know the `session_id` / `workspace_ref`
**What goes wrong:** D-01 says "explicit input", but a human rarely knows the cmux `workspace_ref` or the Claude `session_id` from memory. If the prose demands all three coordinates from the operator verbatim, the flow stalls.
**Why it happens:** `session_id` (= `resume_binding.checkpoint_id`) and `workspace_ref` are machine identifiers held by cmux/state, not human-memorable.
**How to avoid:** The orchestrator can recover coordinates from data it already reads: `cat ~/.kodo/state.json` lists live sessions with `workspace_ref` and `session_id`. The operator supplies the *human* anchor ("the session in ~/dev/foo" / the cwd), and the orchestrator matches it against `state.json` to fill `workspace_ref`/`session_id`. **Caveat:** an ad-hoc session that has NEVER been seeded into `state.json` will not appear there (that is exactly what the dashboard's `listAgentSurfaces` solves — and why it's OUT of scope here). For Phase 57 the realistic, in-scope path is: operator names the session, orchestrator fills coordinates from `state.json` when present, else the operator provides the cwd and the orchestrator proceeds with what `kodo adopt` requires. See D-01 resolution for when a read-CLI would become necessary.

## Code Examples

### The exact `kodo adopt` flags (verified)
```text
# Source: src/cli.js:248-277
kodo adopt
  --workspace <ref>      (required)
  --cwd <path>           (required)
  --session-id <id>      (required)
  --project <id>         (required; must be mapped in ~/.kodo/projects.json)
  --title <t>            (optional; default basename(cwd) applied by the CORE)
  --description <d>      (optional)
  --json                 (optional; byte-deterministic discriminant to stdout)
```

### How `--title` flows (verified, no duplication of sanitization)
```js
// Source: src/cli/adopt.js:114-124 (PASO 3 — title passed untouched)
const result = await adoptSessionFn({ /* … */ title: opts.title, description: opts.description });
// Source: src/adopt.js:196-197 (core sanitizes BEFORE the POST)
const clean = sanitizeAdoptionData({ cwd, title, description });
// Source: src/adopt.js:82-90 (what sanitize does: redactPaths only — NO shell escaping)
export function sanitizeAdoptionData({ cwd, title, description }, homedirFn = homedir) {
  const home = homedirFn();
  const rawTitle = title ?? basename(cwd);           // D-04 default lives HERE
  return { title: redactPaths(rawTitle, home), description: /* …redactPaths or undefined… */ };
}
```

### Shell-safe invocation pattern the prose should mandate
```bash
# SAFE: title as a single single-quoted literal arg; LLM constrains charset first.
kodo adopt --workspace "$WS" --cwd "$CWD" --session-id "$SID" \
           --project "$PROJ" --title 'Investigar tags y comportamiento del orquestador'
# UNSAFE (do NOT generate): metacharacters interpreted by the orchestrator's shell
kodo adopt --title "$(git log -1 --format=%s)"     # command substitution executes
kodo adopt --title "feat: add `thing`; rm -rf x"   # backticks + ; execute
```

### Transcript path is computable (for the optional summary)
```js
// Source: src/logger-events.js:107-109
// transcript_path = ~/.claude/projects/<encodeURIComponent(cwd).replace(/%2F/g,'-')>/<sessionId>.jsonl
// e.g. /Users/alex/dev/klab/kodo  ->  -Users-alex-dev-klab-kodo
```
The orchestrator can Read this `.jsonl` to summarize work for a richer title. Limitation: non-ASCII/space paths may not match Claude Code's encoding (`logger-events.js:98-101`). Treat the transcript as *optional* — `git log` is the primary, always-available signal (D-02).

## D-01 Resolution (the key open question)

**Empirical finding:** There is **no** `kodo` CLI command and **no** server endpoint that exposes `listAgentSurfaces()`. Verified by grep:
- `listAgentSurfaces` is defined only in `src/host/cmux.js:230` and returned in its host object (`:315`).
- Its **only** consumers are the dashboard wiring (`src/cli/dashboard/index.js:172`, `App.js:837-844`, `select.js:341` `computeAdoptable`). [CITED: grep `src/`]
- `src/cli.js` exposes `adopt` (`:248-277`) with explicit `--workspace/--cwd/--session-id`; no `surfaces`/`adopt --list` command exists. [CITED: src/cli.js]
- LOCKED invariant: everything cmux-specific lives behind `HostProvider` (`src/host/interface.js`); `listAgentSurfaces` is OUTSIDE the FROZEN-4 `HOST_METHODS`, typeof-detected (`src/host/interface.js:29`).

**Three options:**

| Option | Description | Verdict |
|--------|-------------|---------|
| (a) Operator types coordinates | Operator provides cwd + (workspace_ref/session_id) | Viable but friction: machine IDs aren't human-memorable (Pitfall 4) |
| (b) Orchestrator fills from `state.json` | Operator names the session by cwd; orchestrator matches against `cat ~/.kodo/state.json` | **Viable & in-scope for already-seeded sessions.** Fails only for never-seeded ad-hoc sessions |
| (c) Thin read-CLI wrapping `listAgentSurfaces()` | New `kodo surfaces`/`kodo adopt --list` command (deterministic, mirror of `kodo adopt`, cmux confined to `src/host/`) | LOCKED-compliant but is NEW code → tension with "default scope = pure prose". Only needed for the never-seeded-session case |

**Recommendation: ship pure-prose with explicit input (a)+(b); do NOT build the read-CLI in Phase 57.** Rationale:
- A read-CLI is **not required for the orchestrator to function** — the canonical orchestrator flow (operator says "adopt the session in ~/dev/foo") is satisfiable today via `state.json` lookup + the explicit `kodo adopt` flags. Phase 57's *value* is the smart title, not discovery (ROADMAP/ORCH-01: "no depende del spike, toma input explícito").
- Discovery is the **dashboard's** responsibility (Phase 56), explicitly OUT of 57's scope (CONTEXT §FUERA de scope). Building a parallel discovery path here risks scope creep and a second mechanism.
- The read-CLI remains a clean, LOCKED-compliant **deferred refinement** (CONTEXT §Deferred Ideas) IF live UAT shows the never-seeded-session case is common. If the planner wants belt-and-suspenders, the cheapest in-scope hedge is one prose sentence: "if you cannot resolve the coordinates from `state.json`, ask the operator to adopt from the dashboard (`a` key) instead."

**Net:** Phase 57 = **pure prose + explicit input + title-only**. No read-CLI. Flag remaining: the planner should confirm with the operator whether the typical ad-hoc session is already in `state.json` (seeded by a kodo hook) or truly invisible; that single fact decides whether the deferred read-CLI ever materializes.

## State of the Art

| Old Approach (other consumers) | Phase 57 Approach | Why different |
|--------------------------------|-------------------|---------------|
| Dashboard: title = `basename(cwd)` deterministic, no LLM (Phase 56) | Orchestrator: title = LLM summary of `git log`/cwd/transcript | The orchestrator is the only LLM rail → can produce "Investigar tags del orquestador" vs "kodo" |
| Dashboard: `execFile(node, [kodoBin,'adopt',…])` literal argv, no shell (`dashboard/adopt.js:102-118`) | Orchestrator: shell command via Bash tool | The orchestrator is an LLM in a shell — cannot use `execFile`; must enforce shell-safety in prose |

**Deprecated/outdated:** none — all referenced code is current (v0.13 in-progress).

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Single-quoting + safe-charset is sufficient shell-injection mitigation for the orchestrator's Bash tool | Pitfall 1 | If the orchestrator constructs the command in a way that re-parses (e.g., `eval`, nested quotes), single-quoting alone could be bypassed. Mitigation: prose must also forbid command-substitution syntax in the title and rely on human confirmation. |
| A2 | The typical ad-hoc session is recoverable from `~/.kodo/state.json` by the orchestrator | Pitfall 4 / D-01 | If most ad-hoc sessions are NEVER seeded into state.json, option (b) fails and the deferred read-CLI (c) becomes necessary. Needs operator confirmation. |
| A3 | Placing the new skill section between §"Sesiones GSD" and §"Diagnóstico" matches the file's organization | Pattern 1 | Low risk — purely editorial; the planner/operator can relocate. |

## Open Questions

1. **Is the typical ad-hoc session already in `state.json`?**
   - What we know: the orchestrator can read `state.json`; the dashboard's `listAgentSurfaces` exists precisely because some surfaces are NOT tracked there.
   - What's unclear: whether operators' real ad-hoc `claude` sessions get seeded into `state.json` (and thus are orchestrator-resolvable) or are invisible until the dashboard discovers them.
   - Recommendation: ship pure-prose (resolves the common case); add a one-line escape-hatch pointing to the dashboard `a` key for the invisible case; defer the read-CLI per CONTEXT.

2. **Include `--description` this phase?**
   - What we know: D-04 recommends title-only; `--description` is optional and, if used, must be a short LLM summary (never a transcript body, BIDIR-08).
   - Recommendation: omit `--description` in 57; defer the auto-derived description to BIDIR-F2 (CONTEXT §Deferred).

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `git` (for `git log --oneline`) | Smart title derivation | ✓ (repo present) | system git | If absent, fall back to `basename(cwd)` (the core default) — title still produced |
| `kodo` CLI (`adopt` command) | The shell-out target | ✓ | v0.13 (in repo, `src/cli.js:248`) | none needed |
| Transcript `.jsonl` | Optional summary | conditional | — | `git log` is primary; transcript is optional enrichment |

**Missing dependencies with no fallback:** none.
**Missing dependencies with fallback:** transcript read (optional) → `git log` primary.

## Validation Architecture

> `workflow.nyquist_validation: true` (verified in `.planning/config.json`) → section included.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node:test (built-in) + the repo's existing test harness under `test/` |
| Config file | none (node --test convention; existing `test/*.test.js`) |
| Quick run command | `node --test test/orchestrator-launch-isolation.test.js` |
| Full suite command | `npm test` (repo suite, ~1333 pass / 1 skip per STATE.md) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| ORCH-01 | New adoption section present in skill.md | unit (content assertion) | `node --test test/skill-content.test.js` (assert section heading + safe-quote mandate present) | ❌ Wave 0 (or grep-assert) |
| ORCH-01 | `resolvePromptTemplate`/`launch.js` UNCHANGED (SC3 zero new logic) | unit (regression) | `node --test test/orchestrator-launch-isolation.test.js` | ✅ (exists per launch.js:189 ref) |
| ORCH-01 | prompt.md mirror in always-on body, not gated block | unit (content assertion) | grep-assert: section appears before `<!-- BEGIN reporting -->` | ❌ Wave 0 |
| ORCH-01 | Core (`adoptSession`/`sanitizeAdoptionData`) byte-unchanged | unit (regression) | existing `test/adopt*.test.js` remain green | ✅ |

**Note:** This is a prose phase. "Tests" are primarily (1) content-presence assertions on the two `.md` files and (2) **regression** assertions that the core + launch.js did NOT change. The strongest verification is a grep/golden assertion that `src/adopt.js`, `src/cli/adopt.js`, and `src/orchestrator/launch.js` are untouched by this phase's diff, plus a content check that the skill section mandates the single-quote/safe-charset rule.

### Sampling Rate
- **Per task commit:** `node --test test/orchestrator-launch-isolation.test.js` (+ skill content grep)
- **Per wave merge:** `npm test`
- **Phase gate:** Full suite green + manual read of the new prose for shell-safety mandate before `/gsd:verify-work`

### Wave 0 Gaps
- [ ] `test/skill-content.test.js` (or extend an existing skill test) — assert the adoption section heading exists AND contains the safe-quote/charset mandate (covers ORCH-01 SC1/SC3).
- [ ] Grep-assert in CI/test that the new prose lands in `prompt.md` before the reporting markers.
- [ ] (If none exists) a regression assertion that the phase diff touches ONLY `.claude/skills/kodo-orchestrate/skill.md` + `src/orchestrator/prompt.md`.

## Security Domain

> `security_enforcement` absent in config → enabled. Section included.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | No auth surface in this phase (provider auth already exists, untouched) |
| V3 Session Management | no | No new sessions/tokens introduced by prose |
| V4 Access Control | no | No new authorization decisions |
| V5 Input Validation | **yes** | The LLM-derived title is untrusted input flowing into a shell command. Control: safe-charset constraint + single-quote literal arg (prose-mandated) + human confirmation. Core path-redaction (`sanitizeAdoptionData`) is a secondary layer. |
| V6 Cryptography | no | No crypto introduced |

### Known Threat Patterns for {orchestrator shelling a CLI with LLM-derived input}

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Shell injection via `--title` (metacharacters in LLM-derived string interpreted by the orchestrator's Bash) | Tampering / Elevation of Privilege | Pass title as ONE single-quoted literal argument; constrain derived title to a safe charset (no `\` `$` `` ` `` `"` `'` `;` `|` `&` `<` `>` newline); summarize commit subjects rather than copy them verbatim; human confirmation (D-03) as a backstop |
| Secret/path leakage into the external task title | Information Disclosure | Core `sanitizeAdoptionData` redacts home/abs paths automatically (BIDIR-08) — orchestrator must NOT duplicate but benefits from it |
| Transcript body exfiltration into the task | Information Disclosure | Structurally impossible at core (no transcript param); prose forbids using raw transcript as `--description` (BIDIR-08); recommend title-only (D-04) |

**Centerpiece:** V5 input validation of the LLM-derived title at the shell boundary. The dashboard sidesteps this with `execFile` (no shell); the orchestrator cannot, so the mitigation is a strict prose mandate. This is the single most important thing the new skill section must get right.

## Sources

### Primary (HIGH confidence — read directly this session)
- `.claude/skills/kodo-orchestrate/skill.md` (180 lines) — section structure, imperative provider-agnostic voice, placement target
- `src/orchestrator/prompt.md` (109 lines) — fallback structure, reporting-gate markers, condensed-mirror style
- `src/orchestrator/launch.js` — `resolvePromptTemplate` (only placeholder substitution), `applyReportingGate`, no business logic to add
- `src/adopt.js` — `sanitizeAdoptionData` (`:82-90`, redactPaths only, NO shell escaping), `adoptSession` (5-state discriminant), title default single-source-of-truth
- `src/cli/adopt.js` — thin handler, title passed untouched (PASO 3), exit-code switch (5 cases)
- `src/cli.js:248-277` — exact `adopt` flags
- `src/host/cmux.js:230,315` + `src/host/interface.js:29` — `listAgentSurfaces` lives only here (D-01)
- `src/cli/dashboard/{adopt,index,select}.js` — the deterministic consumer using `execFile` literal argv (the shell-safety contrast); `computeAdoptable` keyed by sessionId
- `src/logger-events.js:107-142` — `resolveTranscriptPath` (transcript path computable), `sessionStart`
- `.planning/phases/57-orquestador-asistido/57-CONTEXT.md` (D-01..D-05 LOCKED), `.planning/REQUIREMENTS.md` (ORCH-01, BIDIR-08), `.planning/STATE.md`

### Secondary (MEDIUM)
- 54-CONTEXT / 56-CONTEXT references via STATE.md Accumulated Context (CLI ships explicit-input; dashboard is the deterministic discovery consumer)

### Tertiary (LOW)
- none — no web research needed (phase is fully internal to the codebase)

## Metadata

**Confidence breakdown:**
- Standard stack / no-new-deps: HIGH — verified there is nothing to install; deliverable is two `.md` edits
- Architecture / placement: HIGH — read the full skill + prompt.md; placement is editorial
- D-01 resolution: HIGH — empirically grepped; `listAgentSurfaces` is dashboard-only, no CLI/endpoint
- Shell-injection threat: HIGH — verified `sanitizeAdoptionData` does path redaction only; dashboard avoids shell via execFile, orchestrator cannot
- Title-derivation sources: HIGH — `git log` trivial; transcript path verified computable via `resolveTranscriptPath`

**Research date:** 2026-06-18
**Valid until:** 2026-07-18 (stable — internal codebase, no fast-moving external deps)
