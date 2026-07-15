---
phase: 69-red-y-autenticaci-n
reviewed: 2026-07-06T00:00:00Z
depth: standard
files_reviewed: 20
files_reviewed_list:
  - src/cli/dashboard/App.js
  - src/cli/dashboard/client.js
  - src/cli/dashboard/index.js
  - src/cli/dashboard/SessionTable.js
  - src/config.js
  - src/logger.js
  - src/logs/reader.js
  - src/server.js
  - src/server/auth.js
  - test/config.test.js
  - test/dashboard-client.test.js
  - test/dashboard-status-line.test.js
  - test/logs-reader.test.js
  - test/server-auth.test.js
  - test/server-bind.test.js
  - test/server-body-limit.test.js
  - test/server-error-hygiene.test.js
  - test/server-managed.test.js
  - test/server/auth.test.js
findings:
  critical: 1
  warning: 4
  info: 2
  total: 7
status: issues_found
---

# Phase 69: Code Review Report

**Reviewed:** 2026-07-06
**Depth:** standard
**Files Reviewed:** 20
**Status:** issues_found

## Summary

Phase 69 network hardening implements the intended controls competently: default-deny bearer
routing keyed off `pathname` (not raw `req.url`), constant-time token compare with a length guard,
loopback bind default, a 1 MB pre-HMAC body cap with drain-and-discard, neutral 500 bodies, a
`sessionId` allowlist before filesystem access, and a discriminated 401 state surfaced in the Ink
dashboard. The webhook HMAC lane is preserved byte-for-byte (verified by the body-limit test).

However, the hardening effort left one **critical, unauthenticated, pre-auth crash vector**: the
per-request `new URL(req.url, …)` parse (server.js:540) runs inside an `async` handler with **no
top-level error boundary**. A single malformed HTTP request target crashes the entire long-lived
daemon before the auth guard ever runs — a trivial DoS that undoes the phase's own threat model.
Two sibling `decodeURIComponent` calls share the same root cause behind the auth wall. There are
also two token-hygiene weaknesses worth addressing.

Verified empirically on the project runtime (Node v22.22.3): a raw `GET http://[ HTTP/1.1` request
terminates the process with `ERR_INVALID_URL` and exit code 1.

## Critical Issues

### CR-01: Unauthenticated daemon crash via malformed request target (no handler error boundary)

**File:** `src/server.js:536-540`
**Issue:** The request handler is `createServer(async (req, res) => { … })` and its very first
statement parses the URL unguarded:

```js
const { pathname, searchParams } = new URL(req.url, 'http://localhost');
```

`new URL()` throws `TypeError [ERR_INVALID_URL]` for request targets that Node's HTTP parser
accepts but WHATWG-URL rejects (e.g. an absolute-form target with a bad authority:
`GET http://[ HTTP/1.1`). Because the throw happens synchronously inside an `async` function with
no surrounding `try/catch`, it becomes an **unhandled promise rejection**. Under Node's default
`--unhandled-rejections=throw` (default since Node 15; confirmed on the project's Node v22.22.3),
this **terminates the whole process** — the client receives no response and the daemon dies.

This fires **before** `isOpenRoute` / the bearer guard / the body cap, so it is fully
**unauthenticated**. An attacker on loopback (or any exposed interface if `bind` is opened) can kill
the service with one packet, defeating the phase's entire hardening goal. Reproduced:

```
TypeError: Invalid URL … code: 'ERR_INVALID_URL', input: 'http://[' → process exit 1
```

**Fix:** Wrap the whole handler body in a try/catch that always emits a neutral response, and parse
the URL defensively:

```js
const server = createServer(async (req, res) => {
  try {
    let parsed;
    try {
      parsed = new URL(req.url, 'http://localhost');
    } catch {
      res.writeHead(400, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'bad request' }));
      return;
    }
    const { pathname, searchParams } = parsed;
    // … existing routing …
  } catch (err) {
    console.error(`[kodo] unhandled handler error: ${err?.message}`);
    if (!res.headersSent) {
      res.writeHead(500, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'internal error' }));
    }
  }
});
```

The outer catch also closes CR/WR gaps below (any future synchronous throw in a branch is contained
instead of crashing the daemon).

## Warnings

### WR-01: `decodeURIComponent` throws outside the try/catch → authenticated daemon crash

**File:** `src/server.js:651` (`/comments/`) and `src/server.js:689` (`DELETE /sessions/`)
**Issue:** Both routes decode the path segment before/without an enclosing try:

```js
// line 651 — the try{ begins on line 652, so this is OUTSIDE it:
const taskId = decodeURIComponent(pathname.slice('/comments/'.length));
try { … } catch (err) { … }

// line 689 — no try/catch in this branch at all:
const taskId = decodeURIComponent(pathname.slice('/sessions/'.length));
```

`decodeURIComponent` throws `URIError` on malformed percent-encoding (e.g. `/comments/%zz`,
`DELETE /sessions/%zz`). Same failure mode as CR-01: an unhandled rejection that crashes the
process. These routes sit behind the bearer guard, so exploitation requires a valid token — but a
process-wide crash of the shared daemon is still a serious robustness/DoS defect (any token holder,
a buggy client, or a proxy that forwards raw bytes can trigger it).

**Fix:** The CR-01 outer try/catch fixes both, but prefer a guarded decode with a 400:

```js
let taskId;
try { taskId = decodeURIComponent(pathname.slice('/comments/'.length)); }
catch { res.writeHead(400, {'Content-Type':'application/json'}); res.end(JSON.stringify({error:'bad request'})); return; }
```

### WR-02: Bearer token embedded in HTML/JS without output encoding

**File:** `src/server.js:171` (`const TOKEN = "${token}";`) and `:705` (`dashboardHtml(TOKEN)`)
**Issue:** The token is interpolated raw into a `<script>` string literal. The auto-generated token
is 64-char lowercase hex (safe), but `KODO_API_TOKEN` can also be supplied by the operator via
`~/.kodo/.env`. `loadEnvFile` does **not** run it through `validateEnvValue`, so a manually-set
token containing `"` or `</script>` breaks out of the string/script context — a stored
injection/self-XSS in the served dashboard. Defense-in-depth is cheap here.

**Fix:** JSON-encode the value into the script (`const TOKEN = ${JSON.stringify(token)};`) which
escapes quotes/backslashes, and additionally guard against `</` (e.g. replace `<` with `\x3c`), or
validate the token shape (`/^[0-9a-f]{64}$/`) at startup and refuse to serve otherwise.

### WR-03: Bearer token transmitted in the URL query string (`?token=`)

**File:** `src/server.js:549-552`
**Issue:** The HTML routes read the candidate token from `?token=` because a browser navigation
can't set an `Authorization` header (documented tradeoff, D-05). But tokens in URLs leak into
browser history, the address bar (shoulder-surfing/screenshots), and any intermediary/access log.
The Referer-to-external-site vector is correctly mitigated (task links use
`rel="noopener noreferrer"`), and this server writes no access log — but the exposure surface is
real and the token here is long-lived (generate-once, never rotated).

**Fix:** Where feasible, prefer a short-lived signed cookie set on first authenticated navigation
(then drop the `?token=` from the URL via `history.replaceState`), or at minimum document the
rotation story (how an operator invalidates a leaked `KODO_API_TOKEN`). Accept-as-is is defensible
for a loopback-only tool, but the risk should be recorded, not silent.

### WR-04: `config.server.bind = ''` silently binds all interfaces

**File:** `src/server.js:472`
**Issue:** `const host = config.server.bind ?? '127.0.0.1';` uses nullish coalescing, so only
`null`/`undefined` fall back to loopback. An empty-string `bind` (`""`), which is an easy config
typo, passes through and `server.listen(port, '')` binds `0.0.0.0` — the exact LAN exposure NET-01
is meant to prevent, with no warning.

**Fix:** Treat empty/whitespace as absent: `const host = (config.server.bind || '').trim() || '127.0.0.1';`
(and optionally log the resolved bind host so an operator can see when they've opened the interface).

## Info

### IN-01: `parseBearer` accepts any whitespace run after the scheme

**File:** `src/server/auth.js:47`
**Issue:** `/^bearer\s+(.+)$/i` matches tabs and multiple spaces between `Bearer` and the token,
whereas RFC 6750 specifies a single SP. Harmless in practice (header values are compared to a fixed
secret), noted only for spec-fidelity.
**Fix:** If strictness is desired, use `/^bearer (.+)$/i`; otherwise leave as-is.

### IN-02: `timingSafeTokenEqual` early-returns on length mismatch (length oracle)

**File:** `src/server/auth.js:71`
**Issue:** `a.length === b.length && timingSafeEqual(a, b)` short-circuits (non-constant-time) when
lengths differ, leaking the token's byte length via timing. This is the standard and accepted
pattern (the real token has a fixed 64-char length, so length is not secret), and it correctly
avoids `timingSafeEqual`'s throw on unequal buffers. Documented here only for completeness — no
change required.

---

_Reviewed: 2026-07-06_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
