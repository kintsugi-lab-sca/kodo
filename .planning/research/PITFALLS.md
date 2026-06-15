# Pitfalls Research

**Domain:** kodo bidireccional — reverse flow `sesión ad-hoc → tarea persistente` (`createTask` + `adoptSession` + `kodo adopt` + cmux-detection spike + orchestrator-assisted adoption)
**Researched:** 2026-06-15
**Confidence:** HIGH (grounded in this repo's source: `src/triggers/polling.js`, `src/triggers/dispatcher.js`, `src/providers/{plane,github}/provider.js`, `src/interface.js`, and the documented v0.8 anti-recursion / D-18 leak-guard / v0.12 WR-01 lessons)

> Scope note: these are pitfalls **specific to adding the reverse flow to THIS system**, not generic CRUD advice. Every pitfall references a concrete kodo invariant, file, or prior lesson. Phase numbering continues from 51 → the first new phase is **Phase 52**.

---

## Critical Pitfalls

### Pitfall 1: The adopted task re-dispatches itself (self-recursion via polling/webhook)

**What goes wrong:**
`kodo adopt` creates a task in Plane/GitHub and registers it in `state.json`. But the existing polling loop (`src/triggers/polling.js`) is *also* watching that provider. The brand-new task lands in `listPendingTasks()` with a fresh `updated_at`, `shouldDispatch(task, prev)` returns `true` (`task.updated_at > prev.last_updated_at`), `classifyPattern` tags it `'a-new'`, and the daemon **launches a second Claude Code session for the work you just adopted** — colliding with the live ad-hoc session, racing for the per-repo lock, and potentially worktree-colliding. This is the exact failure shape the `kodo:gsd-child` anti-recursion guard was built to prevent (v0.8 Phase 29 / D-06): a thing kodo creates must never be able to launch a session.

**Why it happens:**
The `first-tick skip` (T-25-04, `polling.js:173`) only protects the *very first* tick per repo — `if (!prev.last_updated_at) return false`. A daemon that has been running has a **populated cursor**, so a task created mid-session is precisely the case the skip does NOT cover. The reverse flow inverts kodo's normal direction but reuses a provider surface the forward trigger is actively scanning. Developers think "adopt just writes state.json" and forget the provider write is visible to the poller within one tick.

**How to avoid:**
Mirror the `gsd:gsd-child` precedent exactly — make adopted tasks **un-dispatchable by construction**, cut as early as possible:
- `createTask` MUST stamp an adoption marker on the created task (e.g. a `kodo:adopted` label, mirroring `KODO_LABEL_GSD_CHILD`). Add an `isAdopted(labels)` guard in `dispatcher.js` that cuts **before** `parseKodoLabels`/lock/resolver/launch (same position as `isGsdChild` at `dispatcher.js:68`), and that `--force` does NOT bypass (D-07 precedent).
- Belt-and-suspenders: because GitHub adoption may not carry a kodo label and Plane state may be `trigger`, ALSO short-circuit in `shouldDispatch`/`processRepo`: a task whose `task_id` is already present in `state.json` with a live session must never dispatch. The dispatcher already has the session record; reuse identity by `task_id` (the same identity axis the TUI uses).
- Prefer to create the task in a **non-trigger state** so `listPendingTasks()` (Plane filters on `config.states.trigger`) never returns it in the first place — defense at the provider query layer, not just the dispatcher.

**Warning signs:**
- Two sessions for one piece of work; the lock log shows a contention/coalesce right after an adopt.
- `gsd.bootstrap` / dispatch NDJSON event fires with a `task_id` that already has an `alive` session.
- A worktree-collision canonical error (`worktree_collision`) immediately following `kodo adopt`.

**Phase to address:**
The `createTask` + `adoptSession` plumbing phase (**Phase 52**, the deterministic 0-token core). The anti-recursion guard is not a follow-up — it is a launch-blocking invariant of the adopt core itself, exactly as `isGsdChild` shipped *with* the reporting feature, not after it.

---

### Pitfall 2: Non-atomic create+adopt leaves orphans (task without state, or state without task)

**What goes wrong:**
Adoption is inherently a **two-step transaction across two systems**: (a) `createTask` POSTs to the provider, (b) `adoptSession` writes the new `task_id` into `state.json`. Either half can fail independently:
- Provider POST succeeds, `state.json` write fails → **orphan task** in Plane/GitHub with no session tracking it (and now re-dispatchable per Pitfall 1, since nothing in state suppresses it).
- `state.json` write succeeds but you reorder and the POST fails → **orphan session record** pointing at a `task_id` that doesn't exist in the provider (every later `getTask`/`updateTaskState`/`addComment` against it 404s).

**Why it happens:**
No transaction spans an HTTP POST and a local file write. Developers write the happy path (`const task = await createTask(...); await adoptSession(task.id)`) and assume both land. kodo's existing state writes are atomic *per file* (tmp+rename, e.g. polling-state.json) but there is no cross-system rollback primitive.

**How to avoid:**
- **Order: provider POST first, then state write.** A provider task with no local record is the *recoverable* failure (idempotent re-run can find-or-adopt it; `kodo gsd doctor` / dashboard can surface it). A state record pointing at a nonexistent task is the *corrosive* one. Choose the recoverable orphan.
- Make `adoptSession`'s state write **atomic** (tmp+rename, the existing kodo pattern) so you never get a half-written `state.json`.
- On state-write failure after a successful POST, **fail loud with the created `task_id` in the error message** so the operator (or a re-run) can recover, and emit an NDJSON event (`adopt.partial` / reuse the taxonomy). Do NOT swallow it never-throws-style — never-throws is correct for the *read* rails (TUI, fetchStatus), but a partial write here is real data loss that must surface.
- Provide **idempotent recovery**: re-running `kodo adopt` against a session that already has a created-but-unregistered task should adopt the existing task, not create a duplicate (see Pitfall 3).

**Warning signs:**
- A task exists in Plane/GitHub but `kodo dashboard` never shows a row for it.
- `getTask`/`addComment` 404s for a `task_id` that is present in `state.json`.
- The adopt command exits 0 but the operator can't find the task, or finds two.

**Phase to address:**
**Phase 52** (the create+adopt core). Atomicity and ordering are the defining correctness property of the plumbing; the CLI and dashboard consumers inherit it.

---

### Pitfall 3: Double-adoption creates duplicate tasks (no idempotency on the session)

**What goes wrong:**
The operator runs `kodo adopt` twice on the same ad-hoc session (or the dashboard keybinding fires twice, or an orchestrator suggestion and a manual run both land). Each invocation calls `createTask`, producing **two provider tasks for one session**, two `task_id`s, and a `state.json` that can only point at one — leaving a duplicate task orphaned in the manager. This is the destructive double-action class the dashboard already learned to guard (double-`d` dismiss confirm in Phase 42).

**Why it happens:**
`createTask` is a pure write with no natural idempotency key. An ad-hoc cmux session has no `task_id` *by definition* (that's why it needs adopting), so there's no obvious dedup key before the first adopt. Nothing stops a second create.

**How to avoid:**
- **Pre-create idempotency check:** before calling `createTask`, look up whether this workspace/session is already adopted. Key on a **stable session identity** — the cmux `workspace_ref` / cwd, which `adoptSession` should persist alongside the new `task_id`. If a record already maps this workspace to a `task_id`, the second `adopt` is a **no-op that returns the existing task** (idempotent), never a second create.
- The dashboard keybinding consumer must reuse the **double-confirm + per-`task_id` identity** pattern from Phase 42's dismiss (no fire-and-forget create on a single keypress).
- Guard against the create+adopt re-run case from Pitfall 2: if a created-but-unregistered task is detected, adopt *it* rather than creating anew.

**Warning signs:**
- Two tasks in Plane/GitHub with near-identical derived titles created seconds apart.
- The dashboard shows the adopted row but the manager has an extra ghost task.

**Phase to address:**
**Phase 52** (idempotency belongs in the `adoptSession` core), with the dashboard-consumer guard layered in the **gated dashboard keybinding phase** (post-spike).

---

### Pitfall 4: cmux detection is version-fragile and mis-identifies non-claude processes (why the spike is a HARD GATE)

**What goes wrong:**
The dashboard keybinding needs to **discover ad-hoc `claude` sessions that are NOT in `state.json`** by introspecting cmux's per-workspace process/cwd. If detection is built on assumptions about how cmux exposes process info (or how a `claude` process presents itself), it breaks silently across cmux/Claude Code versions, or worse — produces **false positives**: it offers to "adopt" a shell, a `node` REPL, a different agent, or a kodo-launched session that simply hasn't reconciled yet. Adopting a non-claude process or a session kodo already owns creates a junk task and corrupts `state.json`.

**Why it happens:**
"Does cmux expose process/cwd per workspace to identify a `claude` ad-hoc absent from `state.json`?" is explicitly flagged in the backlog as the **"único supuesto sin validar."** Process-identity heuristics ("the command contains `claude`") are inherently version- and environment-specific and cannot be validated from docs — exactly the situation the Phase 49 live-progress spike faced (task-state surface was version-specific to Claude Code 2.1.175 and only empirically knowable). The forward-flow already got burned here twice: Phase 50 built on `~/.claude/tasks/` which turned out **empty for real GSD sessions using `Agent`** (fixed in 50.1), and Phase 43 found cmux **recycling `workspace_ref`** producing phantom `alive` sessions.

**How to avoid:**
- Run the **detection spike as a HARD GATE before building the keybinding** (mirror Phase 49). The spike's verdict (VIABLE / NOT) governs whether the dashboard discovery path exists at all. If NOT VIABLE, the CLI `kodo adopt` (which receives the workspace/cwd **explicitly**, no auto-detection) still ships — the milestone does not depend on detection.
- The spike must produce **raw evidence from the installed cmux/Claude Code versions** (like `49-SPIKE.md`'s raw 2.1.175 evidence), not reasoning from docs.
- Detection must **exclude sessions already in `state.json`** (by `workspace_ref` AND `task_id`, defending against the Phase 43 `workspace_ref`-recycling phantom) and must distinguish a real `claude` process from look-alikes — fail closed (don't offer adoption) on ambiguity.

**Warning signs:**
- The keybinding offers to adopt a workspace that is actually a kodo-owned or already-adopted session.
- Detection works on the dev's machine but returns nothing (or garbage) after a cmux/Claude Code upgrade.
- A "ghost" ad-hoc session appears that maps to a recycled `workspace_ref`.

**Phase to address:**
A dedicated **detection spike phase (HARD GATE)** *before* the dashboard-keybinding phase. The keybinding phase is **conditional on the spike verdict**, exactly as Phase 50 was gated by Phase 49.

---

### Pitfall 5: Derived title/description is garbage or leaks sensitive data

**What goes wrong:**
Two opposite failures from the same code:
- **Garbage:** `basename(workspace)` yields `agent-xyz`, `tmp.Xa9F`, a UUID, or `worktree-3` as the task title — an unreadable manager task nobody can triage. (The forward flow already had a sibling bug: `UNKNOWN-<seq>` dead links suppressed in Phase 48.)
- **Leak:** deriving the title/description from the **real cwd or transcript** can expose an absolute home path (`/Users/alex/dev/secret-client/...`), a private repo name, branch names, or transcript fragments containing credentials/PII — pushed into a possibly-shared manager (Plane/GitHub). This is the leak-guard concern the NDJSON redactor (Key Decisions) and the WR-01 XSS lesson exist to enforce: don't ship raw untrusted-origin strings to an external surface.

**Why it happens:**
`basename(workspace)` is the lazy default and ad-hoc workspaces have non-semantic names. Conversely, the orchestrator (the **only LLM rail**) is asked to derive a "smart" title from cwd/commits/transcript — rich context that is exactly where sensitive paths and secrets live.

**How to avoid:**
- **Title is an editable default, never a silent commit.** `kodo adopt` proposes the derived title and lets the operator edit it (PROJECT.md target feature: "título … como default editable"). Never POST a derived title without a confirmation/edit opportunity in the interactive paths.
- **Sanitize before deriving:** strip absolute paths to a repo-relative or basename form, redact home dir, never embed transcript bodies in the description. Reuse the existing redactor philosophy (redact at emit, before the sink).
- Reject obviously-non-semantic derivations (`agent-*`, pure-UUID, tmp names) and fall back to prompting rather than shipping junk.
- The orchestrator-derived smart title is a **proposal to the deterministic core**, not a direct write — the core still applies the sanitizer and the human still confirms.

**Warning signs:**
- Manager tasks titled `agent-7f3a`, `worktree-2`, or containing absolute `/Users/...` paths.
- A task description containing a token-shaped string, a private client name, or transcript verbatim.

**Phase to address:**
Title/description derivation + sanitization in **Phase 52** (the core owns the sanitizer); the **orchestrator-assisted adoption phase** for the smart-title proposal (it must route through the core's sanitizer + human confirm, never bypass).

---

### Pitfall 6: Breaking the FROZEN-at-9 contract or putting LLM logic in the 0-token rail

**What goes wrong:**
Two identity-breaking architecture violations:
- **Contract:** adding `createTask` as a **10th required method** of `TASK_PROVIDER_METHODS` (`src/interface.js:52`). This breaks the registry's 9-method validation (`registry.js:107` iterates the frozen list) and forces every adapter — including future ClickUp/local — to implement create, defeating the "adopt is optional" design and the "FROZEN at 9" invariant repeated across v0.10/v0.11/v0.12.
- **Rail:** putting the LLM/orchestrator logic (smart title derivation) **inside `createTask`, `adoptSession`, the CLI, the server, or the polling rail** — violating the hard constraint "Vigilante/server consumen 0 tokens; solo el orquestador usa LLM." The adopt plumbing must be deterministic; only the orchestrator *consumer* may use the LLM.

**Why it happens:**
`createTask` *feels* like a peer of `getTask`/`updateTaskState`, so the instinct is to add it to the canonical list. And "smart title from context" is tempting to inline wherever the title is assembled — which is in the deterministic core, the wrong place.

**How to avoid:**
- `createTask` is **OPTIONAL, typeof-detected** at the call site (`typeof provider.createTask === 'function'`), exactly mirroring how `getTaskState` was added in Phase 40 — both providers already carry the precedent comment *"OPTIONAL method (NOT in TASK_PROVIDER_METHODS — FROZEN at 9, D-13)"*. The frozen list stays at 9. Add a contract-matrix test that asserts the list length is still 9 and that `createTask` is capability-gated.
- Architecture is **"one plumbing, three consumers"**: the deterministic 0-token core (`createTask` + `adoptSession`) does string assembly with **no LLM call**. The orchestrator is a *consumer* that produces a title **proposal** and hands it to the core — the LLM lives only in the orchestrator process, never in CLI/server/vigilante.
- Reuse the `report_to_provider` strictness lesson (Phase 29): any new opt-in must default off and not change baseline behavior.

**Warning signs:**
- `TASK_PROVIDER_METHODS.length !== 9` or the registry rejecting an adapter that lacks `createTask`.
- Any `import`/spawn of an LLM/orchestrator path reachable from `server.js`, `polling.js`, or the `kodo adopt` CLI (token spend in the vigilante rail).
- `format-isolation`-style guard analog: a test that should assert the adopt core graph never reaches the orchestrator/LLM module.

**Phase to address:**
**Phase 52** (typeof-detected `createTask` + 0-token core, with a contract-length guard test); the **orchestrator-assisted adoption phase** keeps the LLM strictly on the consumer side.

---

### Pitfall 7: Cero-endpoints-nuevos invariant broken by the dashboard adopt path

**What goes wrong:**
The dashboard keybinding tempts a new `POST /adopt` (or `POST /sessions`) endpoint on `src/server.js` — breaking the **"Cero endpoints nuevos desde v0.10"** candidate invariant. (The dismiss in Phase 42 added `DELETE /sessions/{id}` as a *conscious, signed* break of TUI-read-only; an unplanned new write endpoint here would be drift, not a decision.)

**Why it happens:**
The TUI talks to the server over HTTP, so "the dashboard needs to create a task" reads as "add a create endpoint." But `kodo adopt` is a deterministic CLI core — the dashboard can shell to it via `execFile` (the existing `runOpen`/`runFocus` pattern) instead of adding an HTTP write.

**How to avoid:**
- Route the dashboard adopt action through the **CLI core via `execFile`** (no shell — see Pitfall 8), reusing the `runOpen`/`runFocus`/`cmux select-workspace` fire-and-forget precedent, OR consciously decide-and-document an endpoint as Phase 42 did. Do not add an endpoint by reflex.
- PROJECT.md explicitly lists "cero endpoints nuevos" as a *candidate* invariant "a confirmar en planificación" — make that an explicit planning decision, not an accident.

**Warning signs:**
- A new route handler in `src/server.js`; the endpoint count diverges from the v0.10 baseline.
- The dashboard importing provider/create logic directly instead of shelling to the CLI.

**Phase to address:**
The **gated dashboard-keybinding phase** — decide the dashboard→core wiring (execFile vs. endpoint) explicitly at planning.

---

### Pitfall 8: Shell-injection / flag-injection surface on the new write path + unsynced XSS debt

**What goes wrong:**
The reverse flow adds new inputs that flow into subprocess calls (dashboard → `kodo adopt` via execFile; possibly cmux introspection) and into the provider POST body. Two concrete risks:
- A workspace name, cwd, or derived title containing shell metacharacters or leading `-` (flag injection) reaching a subprocess if invoked via a shell or as a bare argv element.
- Shipping v0.13 while the **WR-01 XSS** (raw `task_url` as `<a href>` in `src/server.js`'s HTML rail, missing the `http(s)` allowlist the TUI's `runOpen` has) stays latent — and now the dashboard also renders adopted/derived data, widening the untrusted-string surface in that same HTML rail.

**Why it happens:**
The forward flow's write surfaces (`runOpen`, `runFocus`) already established `execFile` without a shell + allowlist + literal argv — but a *new* feature is where someone forgets and reaches for `exec`/string concatenation. And WR-01 is pre-existing debt explicitly carried into v0.13 scope.

**How to avoid:**
- All subprocess calls use **`execFile` without a shell**, with literal argv arrays (mirror `runOpen`'s `[url]` anti-flag-injection pattern); never interpolate workspace/title into a command string.
- Apply the **allowlist pattern** to any URL/protocol and treat derived strings as untrusted (Pitfall 5 sanitizer).
- **Harden WR-01 in this milestone** (it's in scope): apply the same `http(s)` allowlist + `new URL()` validation to the HTML rail's `<a href>` in `src/server.js` that the TUI's `runOpen` already enforces — close it before adding more rendered data to that rail.

**Warning signs:**
- Any `exec(` (shell) instead of `execFile`; any `\`...${userInput}...\`` building a command.
- `javascript:`/`data:` URLs rendering live in the dashboard HTML.

**Phase to address:**
Subprocess hardening in the **dashboard-keybinding phase**; WR-01 XSS hardening as an explicit **debt-paydown task** in the milestone (alongside the deferred 50.1 HUMAN-UAT).

---

## Technical Debt Patterns

| Shortcut | Immediate Benefit | Long-term Cost | When Acceptable |
|----------|-------------------|----------------|-----------------|
| `basename(workspace)` as title with no edit/confirm | Ships adopt fast, zero derivation logic | Garbage tasks (`agent-xyz`), leaked cwd paths in manager | Never for the committed title — OK only as a *pre-filled editable default* |
| Skip idempotency check in `adoptSession` | Less code in the core | Duplicate tasks on double-adopt; orphans on re-run | Never — duplicates are user-visible data corruption in an external system |
| `createTask` then `adoptSession` with no atomic state write / no loud failure | Happy-path works in demo | Orphan task or orphan session record; silent data loss | Never — must be atomic write + loud partial-failure |
| Build dashboard detection on current cmux behavior without a spike | Feels faster than a spike | Version-fragile false positives; adopts non-claude processes | Never — this is the milestone's only unvalidated assumption; HARD GATE it |
| Inline smart-title LLM call in the core "just for the title" | One code path | Breaks 0-token rail; vigilante/server spend tokens | Never — LLM only in the orchestrator consumer |
| New `POST /adopt` endpoint for the dashboard | Obvious TUI→server path | Breaks cero-endpoints-nuevos; drift vs. the signed Phase 42 decision | Only if consciously decided + documented like Phase 42's `DELETE` |
| Defer WR-01 XSS again | Smaller milestone | Latent XSS in a rail now rendering more adopted data | Never — it's explicitly in v0.13 scope |

## Integration Gotchas

| Integration | Common Mistake | Correct Approach |
|-------------|----------------|------------------|
| Plane/GitHub `createTask` POST | Assuming the same token used for read/`addComment` can create tasks | Verify create scope: GitHub PAT needs `issues:write`/`repo`; Plane API key needs project member/write on the target project. Fail with a clear scope error, not a raw 403/401. |
| Provider rate limits | A burst of adopts hits the GitHub rate limit; partial failures mid-batch | Reuse the existing `X-RateLimit-Remaining < 100` warn + `etag/304` discipline; surface rate-limit failure as a recoverable adopt-partial, not a crash |
| `listProjects` for destination | Hardcoding the project or assuming one project | `listProjects` is already in the FROZEN 9 — use it to let the operator choose destination; default to the session's repo-mapped project |
| Polling daemon running during adopt | The new task trips `shouldDispatch` and launches a duplicate session | Anti-recursion marker + create-in-non-trigger-state + dispatcher cut by `task_id` already in state (Pitfall 1) |
| cmux `workspace_ref` | Treating it as a stable unique key | It gets **recycled** (Phase 43 phantom-session bug) — reconcile by identity + `task_id`, exclude already-tracked refs |
| GitHub vs Plane `createTask` shape | One `createTask` signature assuming Plane's `{projectId, name, description_html}` | Each adapter normalizes its own create payload behind the optional method; the core passes provider-agnostic `{title, description, projectId}` |

## Performance Traps

| Trap | Symptoms | Prevention | When It Breaks |
|------|----------|------------|----------------|
| Dashboard detection scans all cmux workspaces every poll | Dashboard stutters; cmux introspection cost per tick | Detect on-demand (keypress), not on the live poll loop; snapshot like the overlay panels | When the operator has many concurrent workspaces |
| Adopt-time provider round-trips block the CLI/TUI | `kodo adopt` hangs on a slow Plane API | Timeout + the existing retry/backoff; never block the ink render thread (fire-and-forget + footer like `runFocus`) | Slow/unreachable provider |
| Re-deriving title from full transcript | Large transcript read on every adopt | Cap/sample the context the orchestrator reads; the core never reads transcripts | Long-running ad-hoc sessions |

## Security Mistakes

| Mistake | Risk | Prevention |
|---------|------|------------|
| Pushing raw cwd/transcript into the provider | Leaks absolute home paths, private repo/client names, secrets to a shared manager | Sanitize/redact before POST (reuse redactor philosophy); editable title; never embed transcript bodies |
| `exec` with interpolated workspace/title | Shell injection on the new write path | `execFile` without shell, literal argv (mirror `runOpen` `[url]`) |
| Leaving WR-01 XSS in `src/server.js` HTML rail | `javascript:`/`data:` URL XSS, widened by new adopted data | Apply `http(s)` allowlist + `new URL()` validation to `<a href>` (parity with TUI `runOpen`) — explicit v0.13 task |
| Assuming read token can create | Confusing 403 on first adopt; or worse, a token with broader scope than intended | Validate create scope up front; document required scopes; least-privilege token |

## UX Pitfalls

| Pitfall | User Impact | Better Approach |
|---------|-------------|-----------------|
| Single-keypress adopt in the dashboard | Accidental duplicate tasks (Pitfall 3) | Double-confirm + per-`task_id` identity (reuse Phase 42 dismiss pattern) |
| Silent title commit with no edit | Garbage `agent-xyz` tasks in the manager | Editable default with confirmation (PROJECT.md target) |
| Orchestrator proactively creates tasks without asking | Surprise tasks; operator loses control of their manager | Orchestrator *proposes* adoption; it is a consumer, not the owner of the flow (PROJECT.md: "NO es dueño del flujo") |
| Adopt succeeds but no visible confirmation of where the task went | Operator can't find the task | Print/footer the task URL + project; reuse the `task_url` round-trip from Phase 48 |

## "Looks Done But Isn't" Checklist

- [ ] **`createTask`:** Often missing capability-gating — verify `TASK_PROVIDER_METHODS.length === 9` and the registry still validates only the 9; `createTask` detected via `typeof`.
- [ ] **`adoptSession`:** Often missing atomicity — verify tmp+rename state write AND provider-POST-before-state ordering AND loud failure on partial.
- [ ] **Anti-recursion:** Often missing — verify an adopted task does NOT re-dispatch (a polling-tick test with the new task in `listPendingTasks`, mirroring the `gsd:gsd-child` 3-scenario dispatcher test; `--force` must not bypass).
- [ ] **Idempotency:** Often missing — verify a second `kodo adopt` on the same workspace is a no-op returning the existing task, no duplicate POST.
- [ ] **Title derivation:** Often missing sanitization — verify no absolute home path / non-semantic name reaches the POST without operator edit.
- [ ] **0-token rail:** Often missing a guard — verify the adopt core graph never reaches the orchestrator/LLM module (format-isolation-style walker test).
- [ ] **Detection spike:** Often skipped — verify a HARD-GATE spike with raw evidence from installed cmux/Claude Code versions gates the keybinding phase.
- [ ] **WR-01 XSS:** Often deferred again — verify `<a href>` in `src/server.js` HTML rail has the `http(s)` allowlist.
- [ ] **50.1 HUMAN-UAT debt:** Carried from v0.12 — verify the deferred live-progress TTY UAT is closed in this milestone.

## Recovery Strategies

| Pitfall | Recovery Cost | Recovery Steps |
|---------|---------------|----------------|
| Self-recursion (duplicate session launched) | MEDIUM | `kodo gsd doctor --fix` / dashboard dismiss the dupe; release the contended lock; add the missing anti-recursion marker before re-enabling |
| Orphan task (POST ok, state write failed) | LOW | Re-run `kodo adopt` idempotently (adopts the existing task) OR manually delete the provider task; the loud error already carries the `task_id` |
| Orphan session record (state ok, POST failed) | MEDIUM | Remove the bogus `state.json` entry (doctor/dismiss); the 404s stop; re-adopt with provider-first ordering |
| Duplicate tasks (double-adopt) | MEDIUM | Close/delete the duplicate in the manager; add the workspace-identity idempotency key |
| Detection false-positive adopted a non-claude process | MEDIUM | Dismiss the junk session record + delete the junk task; tighten the detection filter; the spike should have caught this |
| Leaked cwd/secret in a task | HIGH | Edit/delete the task in the manager (may already be in webhooks/notifications/history); add the sanitizer; rotate any leaked secret |

## Pitfall-to-Phase Mapping

| Pitfall | Prevention Phase | Verification |
|---------|------------------|--------------|
| 1. Self-recursion via polling | Phase 52 (create+adopt core) | Polling-tick test: adopted task in `listPendingTasks` does NOT dispatch; `--force` doesn't bypass (mirror gsd-child 3-scenario test) |
| 2. Non-atomic create+adopt | Phase 52 | Inject state-write failure after POST → loud error with `task_id`, no silent swallow; atomic tmp+rename test |
| 3. Double-adoption duplicates | Phase 52 (core) + gated dashboard phase | Second adopt on same workspace = no-op returning existing task; dashboard double-confirm |
| 4. cmux detection fragility | Detection spike (HARD GATE) before keybinding phase | Spike verdict with raw installed-version evidence; keybinding phase conditional on VIABLE; excludes already-tracked `workspace_ref`+`task_id` |
| 5. Garbage/leaky title | Phase 52 (sanitizer) + orchestrator phase | No absolute path / non-semantic name reaches POST without edit; orchestrator routes through core sanitizer |
| 6. FROZEN-9 / 0-token break | Phase 52 | `TASK_PROVIDER_METHODS.length === 9`; isolation-walker test: core graph never imports orchestrator/LLM |
| 7. New endpoint break | Gated dashboard phase | Server endpoint count == v0.10 baseline, OR a documented Phase-42-style decision |
| 8. Injection + WR-01 XSS | Dashboard phase + explicit debt task | No `exec`/string-built commands; `execFile` literal argv; `<a href>` allowlist test in `src/server.js` |

## Sources

- `src/triggers/polling.js` — `shouldDispatch` (line 172-175), `first-tick skip` (T-25-04), `classifyPattern`, per-repo `firstTickPerRepo` (HIGH, direct read)
- `src/triggers/dispatcher.js` — `isGsdChild` anti-recursion cut before `parseKodoLabels`/lock/launch (line 68), `--force` does not bypass (HIGH, direct read)
- `src/interface.js` — `TASK_PROVIDER_METHODS` Object.freeze list of 9 (line 52); `src/providers/registry.js:107` 9-method validation (HIGH)
- `src/providers/plane/provider.js` + `src/providers/github/provider.js` — `getTaskState` OPTIONAL typeof-detected precedent comment *"NOT in TASK_PROVIDER_METHODS — FROZEN at 9, D-13"* (HIGH, direct read) — the exact pattern `createTask` must follow
- `.planning/PROJECT.md` — Constraints (0-token rail, color isolation), Key Decisions (D-06 anti-recursion v0.8 Phase 29, D-18 leak guard, WR-01 XSS Phase 48, `report_to_provider` strict opt-in, dismiss as conscious read-write break, Phase 49 spike-gate precedent), Out of Scope ("kodo no crea ni elimina tareas") (HIGH)
- `.planning/ROADMAP.md` — Backlog Phase 999.1: the 4 pieces, design decision (createTask optional), and the "único supuesto sin validar" (cmux detection) (HIGH)
- Prior bug lessons: Phase 43 `workspace_ref` recycling → phantom sessions; Phase 50→50.1 `~/.claude/tasks/` empty for `Agent` GSD sessions; Phase 48 `UNKNOWN-<seq>` dead-link suppression (HIGH, from PROJECT.md)

---
*Pitfalls research for: kodo bidireccional reverse flow (`sesión → tarea`)*
*Researched: 2026-06-15*
