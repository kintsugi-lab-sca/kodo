---
phase: 14
slug: cli-format-foundation
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-06
---

# Phase 14 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

Phase 14 entrega el helper `src/cli/format.js` (factory de color/format con picocolors) + tests source-hygiene + smoke `kodo --version`. Es **presentation-layer puro con dependency bump**: introduce una dependencia de producción (`picocolors@^1.1.1`) pero ningún callsite la consume aún (Phase 14 boundary = no callsite). El threat surface es la combinación de:

1. **Supply-chain** (picocolors es nueva dep, primera desde commander en v0.2).
2. **Env-var resolution** (`_resolveUseColor` lee `NO_COLOR`/`FORCE_COLOR` de `process.env`).
3. **Source-hygiene guards** (walker estático + grep recursivo de imports).
4. **Spawn-based smoke test** (`spawnSync` sobre `bin/kodo --version`).

Los 3 plans declaran `<threat_model>` blocks con 13 threats (T-14-01..13). Esta SECURITY.md es **State B reconstruction** post-execution: cada threat ya tiene disposition documentada en el plan y mitigación (cuando aplica) verificable en código.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| `process.env` → `_resolveUseColor` | Lectura de `NO_COLOR` / `FORCE_COLOR` para resolver `useColor` eagerly en factory | Boolean coercion (`!= null` y `!== '0'`); valores no se reflejan en output |
| Stream descriptor → `createFormatter` | `stream.isTTY` leído UNA vez en factory (D-04) | Boolean (no escritura al stream desde format.js — Phase 14 boundary) |
| `picocolors` package → `format.js` | Nueva supply-chain dep (zero-dep, ~100 LOC) | Funciones puras `string → string` (con/sin ANSI escapes) |
| Filesystem → `test/format-isolation.test.js` | Test recursivo lee todos los `.js` bajo `src/` | Source code (developer-controlled, version-controlled) |
| `spawnSync` → `bin/kodo --version` | Test spawn de child process Node sobre el CLI entry | exit code + stdout + stderr (sin network, sin user input) |
| Documentation → `.planning/PROJECT.md` | Bullet append en §Constraints referenciando test path | Markdown estático |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-14-01 | Tampering | `process.env.NO_COLOR` / `FORCE_COLOR` injection en `_resolveUseColor` | accept | Valores booleanizados via `!= null` y `!== '0'` (D-02). Sin user-controlled content fluye a ANSI output en Phase 14 (no callsite). Phase 15 callers responsables de sanitizar `s` args antes de `fmt.info(s)`. | closed |
| T-14-02 | Information Disclosure | ANSI escape injection si user data fluye via `fmt.info(userInput)` | accept | Out of scope para Phase 14 (no callsite). Phase 15 review item — picocolors NO strip pre-existing escapes en input. | closed (deferred to Phase 15 — verified there as presentation-only) |
| T-14-03 | Tampering | Supply-chain compromise de `picocolors@^1.0.0` | mitigate | (a) `package-lock.json` pin a 1.1.1 exact, (b) zero transitive deps verificado en lockfile, (c) `test/format-isolation.test.js` enforces single-source via grep recursivo (cualquier nuevo importer falla CI), (d) `test/version-smoke.test.js` asserta stderr vacío post-install (deprecation/warn = test fail). | closed (3 controls verificados verdes) |
| T-14-04 | Denial of Service | Unbounded recursion / pathological input a `formatTable` | accept | `formatTable` es O(rows × cols) sin recursión; max table size bounded por callers (Phase 15 surfaces son CLI tables, no user-uploaded data). Sin DoS surface en CLI personal. | closed |
| T-14-05 | Repudiation | n/a | n/a | Helper produce strings, sin logging ni audit trail. Logger sigue responsable per LOG-01..04. | closed |
| T-14-06 | Tampering | Bypass del LOG-12 guard via dynamic `import()` | accept | El walker no sigue dynamic imports. Repo no usa dynamic imports (Phase 6 RESEARCH A3, re-confirmado en `check-isolation.test.js` comment). Future-work flag — no blocker. | closed |
| T-14-07 | Tampering | Bypass single-source via re-export chain | accept | Grep matchea specifier literal `'picocolors'`. Re-export `export { red } from './format.js'` NO cuenta (correcto). `import 'picocolors'` (bare side-effect) sí cazado por `IMPORT_BARE_RE`. Sin bypass realista en ESM static. | closed |
| T-14-08 | Information Disclosure | Test recursivo lee source files | accept | Todos los archivos bajo `src/` son version-controlled developer code. Sin secrets (LOG-08 redactor vive en logger). Sin riesgo. | closed |
| T-14-09 | Denial of Service | Pathological recursion en `listJsFiles` | accept | `src/` es small (~30 archivos, ~13K LOC). Sin symlink loop guard necesario. Si crece órdenes de magnitud → revisitar. | closed |
| T-14-10 | Tampering | Doc drift entre `PROJECT.md` y código | mitigate | El bullet referencia `test/format-isolation.test.js` por path. Si test deleted/renamed → doc rota pero sin security failure (maintenance concern). Future doc-link checker (out of scope) cerraría el gap. | closed (advisory) |
| T-14-11 | Denial of Service | Spawn-based test cuelga CI | accept | `bin/kodo --version` es commander built-in, exit en ms. `spawnSync` síncrono. Sin timeout explícito (no necesario). | closed |
| T-14-12 | Information Disclosure | `spawnSync` hereda parent env | accept | Test lee `process.execPath` y `cwd: REPO`. Sin propagación de secrets — es un CLI version flag, no network call. | closed |
| T-14-13 | Tampering | Picocolors transitive deprecation warns | mitigate | **Verified by `test/version-smoke.test.js`**: stderr-trim assertion falla si una versión futura emite deprecation. Empíricamente: 0 bytes stderr con picocolors@1.1.1. ASVS L1: dependency confusion / vulnerable component → flagged at install-time, escalated a test failure. | closed (control activo + verification verde) |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party) · n/a*

**Total threats:** 13
**Closed:** 13
**Open:** 0

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-14-01 | T-14-01 | Phase 14 boundary = no callsite. Phase 15 callers responsables de sanitizar input antes de pasarlo a `fmt.*`. Documentado en `T-14-02` para reactivación bajo Phase 15. | Plan 14-01 author (verified Phase 15 SECURITY.md presentation-only) | 2026-05-04 |
| AR-14-02 | T-14-02 | Phase 14 no añade callsites; Phase 15 SECURITY.md confirmó "presentation-only" — picocolors NO strip user-supplied ANSI, pero el data flowing es output del logger (ya redactado per LOG-08) o de Plane API (ya validado per Phase 10). Sin user-supplied raw strings en los 5 callsites. | Phase 15 verifier (2026-05-05) | 2026-05-05 |
| AR-14-04 | T-14-04 | CLI personal, sin tablas user-uploaded. `formatTable` complexity O(N) garantizado por código (no recursión). | Plan 14-01 author | 2026-05-04 |
| AR-14-06 | T-14-06 | Repo no usa dynamic imports (verified Phase 6). Future-work flag si Phase N introduce. | Plan 14-02 author | 2026-05-04 |
| AR-14-07 | T-14-07 | ESM static semantics: no realistic bypass para grep specifier literal. | Plan 14-02 author | 2026-05-04 |
| AR-14-08 | T-14-08 | Source code is version-controlled, no secrets per LOG-08 redactor (en logger, no en source). | Plan 14-02 author | 2026-05-04 |
| AR-14-09 | T-14-09 | `src/` ~30 files, sin symlinks, no pathological. Revisit si repo crece >>10x. | Plan 14-02 author | 2026-05-04 |
| AR-14-11 | T-14-11 | Commander built-in `--version` exit en ms, `spawnSync` síncrono. | Plan 14-03 author | 2026-05-04 |
| AR-14-12 | T-14-12 | spawnSync inherit env: solo `execPath` + `cwd`, sin propagación de secrets. | Plan 14-03 author | 2026-05-04 |

*Accepted risks no resurfacen en future audit runs.*

T-14-03, T-14-05, T-14-10, T-14-13 NO listados aquí (tienen mitigation activa, no accepted risk):
- T-14-03 → mitigated: 3 controls verificados verdes (lockfile pin + format-isolation grep + version-smoke stderr).
- T-14-05 → n/a (sin surface).
- T-14-10 → mitigated advisory: doc-link manual review.
- T-14-13 → mitigated: control activo en `version-smoke.test.js`.

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-06 | 13 | 13 | 0 | gsd-secure-phase orchestrator (State B reconstruction; no auditor spawn — threats_open: 0 skipped to Step 6 per workflow) |

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer / n/a)
- [x] Accepted risks documented in Accepted Risks Log (9 entries: AR-14-01/02/04/06/07/08/09/11/12)
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-05-06 (retroactive State B reconstruction post-execution)

---

## Cross-references

- **Plan 14-01 §threat_model** — T-14-01..05 (factory + helper supply chain).
- **Plan 14-02 §threat_model** — T-14-06..09 (source-hygiene walker + recursive grep).
- **Plan 14-03 §threat_model** — T-14-10..13 (doc + spawn smoke).
- **`test/format-isolation.test.js`** — Active control para T-14-03 (single-source) + T-14-06 (LOG-12 extension).
- **`test/version-smoke.test.js`** — Active control para T-14-13 (deprecation watcher) + T-14-03 (post-install cleanliness).
- **`package-lock.json`** — Active control para T-14-03 (version pin a 1.1.1 exact).
- **Phase 15 SECURITY.md** — confirma que el deferral T-14-02 quedó como presentation-only (Phase 14 boundary respected downstream).
