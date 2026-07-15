---
phase: 69-red-y-autenticaci-n
fixed_at: 2026-07-06T00:00:00Z
review_path: .planning/phases/69-red-y-autenticaci-n/69-REVIEW.md
iteration: 1
findings_in_scope: 5
fixed: 5
skipped: 0
status: all_fixed
---

# Phase 69: Code Review Fix Report

**Fixed at:** 2026-07-06
**Source review:** .planning/phases/69-red-y-autenticaci-n/69-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 5 (fix scope: Critical + Warning; IN-01/IN-02 excluded by scope)
- Fixed: 5
- Skipped: 0

**Verification:** full suite after all fixes — **1843 pass + 1 skip, 0 fail** (baseline
1838 pass + 1 skip; the +5 are the new regression tests). Webhook HMAC lane untouched
(readBody semantics unchanged; body-limit test green). Zero new dependencies.

## Fixed Issues

### CR-01: Unauthenticated daemon crash via malformed request target

**Files modified:** `src/server.js`, `test/server-malformed-request.test.js` (new)
**Commit:** 523e2e4
**Applied fix:** Extracted the request handler into `handleRequest` and wrapped it in a
`createServer` boundary: any escaped throw/rejection → log-only `err.message` + neutral
500 `{"error":"internal error"}` (or `res.end()` if headers already sent). The
`new URL(req.url, …)` parse is now guarded → neutral 400 `{"error":"bad request"}` on a
target Node's parser accepts but WHATWG-URL rejects. Regression test drives the exact
repro (`GET http://[ HTTP/1.1`) over a raw TCP socket (fetch refuses to emit it),
asserts 400 + neutral body, and asserts the daemon still serves `/health` afterwards.

### WR-01: `decodeURIComponent` throws → authenticated daemon crash

**Files modified:** `src/server.js`, `test/server-malformed-request.test.js`
**Commit:** f679d17
**Applied fix:** Guarded both decodes (`/comments/…` at the head of the branch, and the
`DELETE /sessions/…` branch) — malformed percent-encoding (`%zz`) now returns a neutral
400 `{"error":"bad request"}` instead of an escaped `URIError` (the CR-01 boundary is
the backstop; 400 is the correct semantics). Regression tests for both routes assert
400 + daemon survival.

### WR-02: Bearer token embedded in HTML/JS without output encoding

**Files modified:** `src/server.js`
**Commit:** ab32a40
**Applied fix:** `dashboardHtml` now serializes the token via
`JSON.stringify(String(token)).replace(/</g, '\\u003c')` and interpolates
`const TOKEN = ${tokenJs};` — quotes/backslashes are JSON-escaped and `</script>`
breakout is neutralized by the unicode `less-than` escape. Byte-identical output for the
auto-generated hex token (verified: `test/server-auth.test.js` 13/13 green, including
the `const TOKEN = "${TOKEN}"` shape assertions).

### WR-03: Bearer token transmitted in the URL query string (`?token=`)

**Files modified:** `README.md`
**Commit:** 7ebd542
**Applied fix:** Documentation-only, per the locked design (D-05 in CONTEXT.md locks the
query-param mechanism; T-69-07 accepted in the plan threat model — no mechanism
redesign). Added a security note to the «Topología multi-nodo» section: the `?token=`
lands in browser history / address bar / screenshots, the token is long-lived, and the
manual rotation story is to edit (or delete, to regenerate on boot) the
`KODO_API_TOKEN` line in `~/.kodo/.env` and restart (`kodo stop && kodo start`).

### WR-04: `config.server.bind = ''` silently binds all interfaces

**Files modified:** `src/server.js`, `test/server-bind.test.js`
**Commit:** 2e88342
**Applied fix:** Bind resolution now treats empty/whitespace strings (and non-string
values) as absent: `(typeof rawBind === 'string' && rawBind.trim()) ? rawBind.trim() :
'127.0.0.1'` — `listen(port, '')` can no longer silently bind 0.0.0.0. This is the
single resolution point for both listen sites (managed and legacy share `host`). Two
regression tests added: `bind: ''` and `bind: '   '` both resolve the real listening
address to `127.0.0.1`.

## Skipped Issues

None — all in-scope findings were fixed. (IN-01 and IN-02 were explicitly out of scope
and untouched, as directed.)

## Notes

- Fixes were applied in an isolated git worktree and fast-forwarded onto `main`
  (523e2e4..2e88342); the temp branch and worktree were cleaned up.
- During worktree verification, `test/hooks/install.test.js` showed 2 failures that are
  **environmental, pre-existing, and unrelated**: `install.js`/`uninstallHooks` match
  hook entries by the substring `'kodo'` in the command path, which a `/tmp/...`
  worktree path lacks. Confirmed by reproducing the same 2 failures at the pre-fix base
  commit (8ddd64c) in a throwaway `/tmp` worktree. In the real repo path the tests pass
  (full suite green post-merge).

---

_Fixed: 2026-07-06_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
