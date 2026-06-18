---
phase: 57-orquestador-asistido
reviewed: 2026-06-18T15:23:26Z
depth: standard
files_reviewed: 2
files_reviewed_list:
  - .claude/skills/kodo-orchestrate/skill.md
  - src/orchestrator/prompt.md
findings:
  critical: 1
  warning: 3
  info: 2
  total: 6
status: issues_found
---

# Phase 57: Code Review Report

**Reviewed:** 2026-06-18T15:23:26Z
**Depth:** standard
**Files Reviewed:** 2
**Status:** issues_found

## Summary

Phase 57 is a pure-prose phase adding an "Adopción asistida" section to the
`kodo-orchestrate` skill plus a condensed mirror in `prompt.md`. The prose
drives an LLM to derive a smart task title and shell `kodo adopt --title <derived>`
via its Bash tool. With no `execFile`/argv protection on this path and the core
`sanitizeAdoptionData` running *after* the shell already parsed (confirmed in
`src/adopt.js:82-100,197` — it only calls `redactPaths`, never neutralizes shell
metacharacters), **the prose IS the security control.**

Verdict on the centerpiece (T-57-01 shell injection): the title path is
**well-defended with genuine defense-in-depth**. The single-quote-literal residual
the executor flagged is adequately mitigated: `'` is explicitly in the prohibited
charset in BOTH files, so the single-quote wrapping cannot be broken by a surviving
literal quote. The mandate is present, unambiguous, and duplicated correctly across
both files (matters because the skill isn't always auto-loaded). Locked decisions
hold: explicit-input coordinates, confirm-before-create backstop, title-only
(no `--description`, BIDIR-08 preserved), core sanitizer not duplicated in prose.
prompt.md hygiene passes: no literal "Plane" outside placeholders, 11 placeholders
intact, reporting markers present, mirror placed before the reporting gate (line 40
< line 47), no English imperatives in prose.

**However**, the security framing has a blind spot: the prose hardens `--title`
(LLM-derived, correctly treated as untrusted) but provides **zero quoting guidance
for the four sibling arguments** (`--workspace`, `--cwd`, `--session-id`, `--project`),
and the canonical SAFE example uses unexplained shell-variable syntax (`"$WS"`,
`"$CWD"`, …) that an LLM cannot follow literally. That gap is the BLOCKER below.

## Critical Issues

### CR-01: SAFE example mandates `--title` quoting but leaves the other four interpolated args unguided and ambiguous

**File:** `.claude/skills/kodo-orchestrate/skill.md:159-170` (mirror: `src/orchestrator/prompt.md:42,44`)

**Issue:** The entire shell-injection mandate (charset restriction + single-quote
wrapping) targets ONLY `--title`. The canonical SAFE example is:

```bash
kodo adopt --workspace "$WS" --cwd "$CWD" --session-id "$SID" \
           --project "$PROJ" --title 'Investigar tags y comportamiento del orquestador'
```

This conflates two incompatible mental models and is unsafe for an LLM consumer:

1. **The `"$WS"` / `"$CWD"` / `"$SID"` / `"$PROJ"` syntax is not literally runnable.**
   The orchestrator is an LLM emitting a one-shot Bash command, not a script with
   pre-exported env vars. If it copies the template literally, the shell expands
   four unset variables to empty strings and `kodo adopt` runs with blank
   `--workspace`/`--cwd`/`--session-id`/`--project`. If instead the LLM does the
   natural thing and **inlines the real values**, it falls off the example entirely
   and there is no guidance for how to quote them.

2. **Those four inlined values are themselves attacker/garbage-influenced and
   interpolated into the same shell command, yet the prose never restricts or
   quotes them.** `cwd` and `workspace_ref` come from `~/.kodo/state.json`;
   `cwd` in particular is a filesystem path the operator chose for an ad-hoc
   session and can legitimately contain shell metacharacters (`$`, spaces,
   `&`, `;`, `(`, `)` are all legal in directory names). A session seeded from
   `cwd=/tmp/foo;rm -rf ~` (or, more realistically, a dir named `foo & bar`)
   becomes a live injection vector the moment the LLM inlines it without
   double-quoting — and the prose's only quoting instruction is scoped to
   `--title`. The core `sanitizeAdoptionData` does NOT help here: it redacts
   paths *inside* `kodo adopt`, after the shell already parsed (confirmed
   `src/adopt.js:197`).

The all-caps "SAFE" label on this example makes the gap worse: it signals the
example is the secure pattern to imitate, while actually demonstrating only the
title and silently modeling the other args with a syntax the LLM can't reproduce.

**Fix:** Make the quoting rule apply to *every* interpolated argument and replace
the env-var template with concrete-literal guidance the LLM can actually follow.
Add to the §6 mandate (and mirror the one-liner in prompt.md):

```text
6. Shellear `kodo adopt` de forma shell-segura — cada valor que insertes es un
   argumento literal entre comillas. El título (charset-restringido) va entre
   comillas SIMPLES; los demás valores (workspace_ref, cwd, session_id,
   project_id, resueltos de state.json/projects.json) van entre comillas DOBLES
   porque pueden contener espacios o metacaracteres legítimos en paths. Inserta
   los valores reales — NO emitas `"$WS"` literal (no hay variables exportadas;
   eres un LLM emitiendo un comando one-shot):

   # SAFE (valores reales, cada uno citado):
   kodo adopt --workspace "kodo-foo-3" --cwd "/Users/alex/dev/foo bar" \
              --session-id "abc123" --project "PROJ-12" \
              --title 'Investigar tags del orquestador'
```

Either that, or note explicitly that the four non-title args are validated tokens
from kodo-managed JSON and therefore safe to double-quote verbatim — but the
`cwd` field undermines that claim, so quoting is the correct minimal control.

## Warnings

### WR-01: "Prohíbe/elimina" is ambiguous about fail-closed vs. silent-strip ordering

**File:** `.claude/skills/kodo-orchestrate/skill.md:139-141`

**Issue:** The mandate reads `Prohíbe/elimina del título derivado estos
metacaracteres`. "Prohibit OR remove" leaves the LLM free to *silently strip* a
`'` (or `$`, `` ` ``) and proceed, rather than reject/rewrite. Stripping is
generally safe for the single-quote-wrapping invariant, but it can produce a
mangled title (e.g. `feat: add 'X'` → `feat: add X`) that then gets confirmed by
a fast-clicking operator. More importantly, the instruction never pins the
*ordering* relationship between the two controls (charset-restrict, THEN
single-quote-wrap), so a model could reason "I'm wrapping in single quotes
anyway, so the charset rule is belt-and-suspenders I can skip." Since the
single-quote wrap is the only thing standing between a stray `'` and a broken
quote context, that reasoning is dangerous.

**Fix:** State the two controls as an explicit AND with ordering and a fail-closed
default: "PRIMERO restringe el charset (si el título derivado contiene `'`,
re-derívalo sin ese carácter — no lo strippees a ciegas), DESPUÉS envuélvelo en
comillas simples. Ambos controles son obligatorios: el wrap NO sustituye la
restricción de charset." Make explicit that `'` specifically must never survive,
because it is the one character that breaks the single-quote container.

### WR-02: prompt.md mirror omits the "core sanitizer runs AFTER shell parse" rationale

**File:** `src/orchestrator/prompt.md:44`

**Issue:** The skill (lines 142-148) explains *why* the LLM cannot lean on the
core sanitizer: it "corre DENTRO de `kodo adopt` — DESPUÉS de que tu shell ya
parseó el comando." The prompt.md mirror compresses this to "El saneo del núcleo
redacta rutas pero NO neutraliza metacaracteres shell," dropping the temporal
reason. prompt.md is the *degraded fallback used precisely when the skill is NOT
auto-loaded* (per its own line 3). An LLM reading only prompt.md learns the
sanitizer doesn't neutralize metacharacters, but not that it's also too late in
the pipeline to matter — leaving it free to assume "the core will catch what I
miss." The one place this rationale is most needed (skill absent) is the one
place it was cut.

**Fix:** Add five words to the prompt.md bullet: "…NO neutraliza metacaracteres
shell **y corre después de que tu shell ya parseó el comando.**"

### WR-03: No upper bound enforced on inputs feeding the title; `-N` / "~5 commits" is non-binding

**File:** `.claude/skills/kodo-orchestrate/skill.md:130-136`

**Issue:** The title-derivation step pulls from `git log --oneline -N` ("~5
commits basta") and an optional transcript summary, then says "Compón UNA línea
concisa estilo título de tarea (≤ ~80 chars)" only later at line 139. The `≤ ~80
chars` is the sole length control and it's soft ("~"). For a *security* boundary
the length cap is secondary, but combined with "Summariza los subjects... nunca
los copies verbatim," there is no hard instruction preventing the LLM from
concatenating raw multi-commit subjects (which is exactly where metacharacters
live). The summarize mandate and the charset mandate are in different steps
(§2 vs §3) with no cross-reference, so a model could summarize for brevity while
forgetting the security strip, or vice-versa.

**Fix:** Co-locate the summarize and charset rules, or cross-reference them:
in §2 add "(el resultado pasa obligatoriamente por el filtro de charset del §3
antes de invocar)." Keep the ≤80 char cap but it's the weaker of the two controls.

## Info

### IN-01: "command substitution ejecuta" comment is slightly imprecise

**File:** `.claude/skills/kodo-orchestrate/skill.md:168`

**Issue:** The UNSAFE example comment `kodo adopt --title "$(git log -1
--format=%s)"  # command substitution ejecuta` is correct, but the adjacent
backtick example on line 169 (`"feat: add \`thing\`; rm -rf x"`) mixes two
distinct failures (backtick command-substitution AND the `;` separator) under one
comment. Fine as a scare-example, but a reader might think the `;` is what makes
backticks dangerous. Minor.

**Fix:** Optional — split into two lines or annotate "backticks ejecutan
`thing`; además `;` encadena `rm -rf x`."

### IN-02: Transcript path template uses `<cwd-encoded>` without specifying the encoding

**File:** `.claude/skills/kodo-orchestrate/skill.md:131-133`

**Issue:** `~/.claude/projects/<cwd-encoded>/<sessionId>.jsonl` calls the path
"computable" but never states the encoding (Claude Code slugifies the cwd by
replacing `/` with `-`). An LLM may guess wrong and read a nonexistent file. Since
the transcript is explicitly "enriquecimiento opcional" with `git log` as the
always-available primary signal, a miss degrades gracefully — hence Info, not
Warning.

**Fix:** Optional — note "(`/` → `-`, p. ej. `~/dev/foo` → `-Users-alex-dev-foo`)"
or just reaffirm it's optional and skippable on any read failure.

---

_Reviewed: 2026-06-18T15:23:26Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
