---
phase: 48-open-in-manager-core
plan: 02
subsystem: cli-dashboard
tags: [tui, open-in-manager, execFile, security, never-throws]
requires:
  - "src/cli/dashboard/focus.js (template clonado)"
  - "row.task_url persistido en SessionRecord (Plan 48-01)"
provides:
  - "src/cli/dashboard/open.js#runOpen — lanzador never-throws con allowlist http(s)"
  - "src/cli/dashboard/App.js — handler `o` (list mode) + OPEN_* constants + hint"
  - "src/cli/dashboard/index.js — DI onOpen reusando execImpl"
affects:
  - "El dashboard TUI gana la tecla `o` (open-in-manager)"
tech-stack:
  added: []
  patterns:
    - "never-throws {ok} discriminant (clon de focus.js + nuevo code BAD_PROTOCOL)"
    - "allowlist http(s) via new URL() dentro de try ANTES de execFile (Pitfall 4)"
    - "argv literal [url] (anti flag-injection OPEN-03)"
    - "literal-stable message constants exportadas (mata code/render drift)"
    - "lazy-import DI wiring (execImpl reusado entre onFocus y onOpen)"
key-files:
  created:
    - "src/cli/dashboard/open.js"
    - "test/dashboard/open.test.js"
    - "test/dashboard/app-open.test.js"
  modified:
    - "src/cli/dashboard/App.js"
    - "src/cli/dashboard/index.js"
    - "test/dashboard/app-focus.test.js"
decisions:
  - "D-01/D-02: en {ok:true} se muestra un footer verde transitorio `opening <ref>…` (diverge del silencio de focus.js — la TUI no muestra otro cambio visible)"
  - "D-04: `o` no tiene guard alive — funciona sobre alive/zombie/dismissed por igual; el único guard es no-URL"
  - "D-05: fila sin task_url → footer BARE `no task URL for this session` (LOCKED: sin `[!]`, sin `— press any key`); onOpen jamás se invoca con arg falsy"
  - "D-06: el binario `open` se defaultea dentro de open.js, no se lee de config (divergencia con cmuxBin)"
  - "OPEN_ERR_BAD_PROTOCOL: `[!] refused non-http(s) URL — press any key` (formato espejo de FOCUS_ERR_*)"
metrics:
  duration: ~12min
  completed: 2026-06-11
  tasks: 3
  files: 6
  tests-added: 12
---

# Phase 48 Plan 02: open-in-manager TUI launcher Summary

Lanzador open-in-manager para la TUI: la tecla `o` sobre una fila abre su `task_url` en el navegador del sistema vía `execFile('open', [url])` fire-and-forget, con tolerancia a fallos never-throws end-to-end y hardening anti URL-injection (allowlist http(s) + argv literal), sin desmontar el panel ink ni añadir endpoints.

## What Was Built

1. **`src/cli/dashboard/open.js#runOpen`** — clon estructural de `focus.js`: discriminante never-throws `{ok}`, leak guard estructural de `exec` (TypeError síncrono, sin default). Divergencias load-bearing: (a) sin verbo/flag — `open` toma solo la URL; (b) `binary` defaultea a `'open'`; (c) args literales `[url]` (un único positional argv — OPEN-03 anti flag-injection); (d) nuevo code de union `BAD_PROTOCOL`; (e) NET-NEW: allowlist http(s) que corre ANTES de `exec` (`new URL(url)` dentro de try + `protocol === 'http:'|'https:'`), colapsando `file://`/`javascript:`/dash-inicial/vacío/no-parseable a `BAD_PROTOCOL` sin invocar `exec` jamás.

2. **`src/cli/dashboard/App.js`** — handler `if (input === 'o')` en list mode + 5 constantes `OPEN_*` exportadas + hint `· o open`. Lee `row.task_url` directo (sin fetch). Guard único no-URL (D-05, footer bare). Sin guard alive (D-04). Éxito → footer verde `OPEN_OK(task_ref)`; error → mapeo `ENOENT`/`BAD_PROTOCOL`/`failed` a footer rojo. El footer transitorio se limpia con el clear-on-any-input existente (D-03, sin timer dedicado).

3. **`src/cli/dashboard/index.js`** — lazy import de `runOpen` + prop `onOpen: async (url) => runOpen({ exec: execImpl, url })` reusando el `execImpl` ya resuelto (sin segundo import de `node:child_process`, sin lectura de binario de config — D-06). Alt-screen toggle / SIGTERM / lifecycle intactos.

## Tests

- **`test/dashboard/open.test.js`** (8 escenarios): ok + args `[url]` ordering, default `binary='open'`, http:// allowed, ENOENT, NON_ZERO_EXIT, SPAWN_ERROR sync-throw, leak guard, matriz adversarial (5 URLs → BAD_PROTOCOL con exec call-count 0).
- **`test/dashboard/app-open.test.js`** (4 escenarios): (a) `o` con task_url → onOpen una vez + footer verde; (b) sin task_url → onOpen 0 + footer bare; (c) ENOENT → `[!] open not found in PATH`; (d) clear-on-any-input restaura hints.
- **`test/dashboard/app-focus.test.js`** ajustado: la assertion de la línea de hints (literal compartido) incluye ahora `· o open`.

## Verification Results

- `node --test test/dashboard/open.test.js test/dashboard/app-open.test.js test/dashboard/app-focus.test.js` → 17/17 pass (launcher + handler + sin regresión focus).
- `node --test test/format-isolation.test.js` → 8/8 pass (open.js color-isolated, walker auto-cubre `src/cli/dashboard/**`).
- `grep -c "picocolors\|format.js" src/cli/dashboard/open.js` → 0.
- Matriz adversarial (`javascript:`/`file://`/`-a Calculator`/vacío/basura) rechazada ANTES de execFile, exec call-count 0.
- `grep "input === 'o'"` App.js + `grep "onOpen"` index.js confirman el cableado.
- **Suite global: 1272 pass + 1 skip (preexistente) + 0 fail** (+10 casos netos vs baseline; cero regresiones).
- NOTA: el lanzamiento real del navegador NO es auto-verificable — cubierto por el checkpoint HUMAN-UAT del Plan 48-03.

## Threat Mitigations Aplicadas

| Threat ID | Mitigación | Verificado por |
|-----------|------------|----------------|
| T-48-04 (EoP/Tampering) | URL como único elemento argv literal `[url]` a execFile, nunca shell string | open.test.js happy-path asserta `args === ['https://…']` |
| T-48-05 (flag injection) | allowlist http(s) ANTES de execFile rechaza dash-inicial/`file://`/`javascript:` | open.test.js matriz adversarial: exec call-count 0 |
| T-48-06 (DoS / never-throws) | todo fallo (incl. parse-throw de `new URL`) colapsa a `{ok:false}`; leak-guard es el único sync-throw deliberado | app-open.test.js (c) + open.test.js sync-throw |
| T-48-07 (Info Disclosure) | guard no-URL D-05 cortocircuita a footer bare; `open` nunca recibe arg falsy | app-open.test.js (b): onOpen call-count 0 |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Test fix] Línea de hints compartida en app-focus.test.js**
- **Found during:** Task 2
- **Issue:** `test/dashboard/app-focus.test.js:196` asserta la línea de hints literal completa (`… · d dismiss · q quit`). El plan inserta `· o open` entre `d dismiss` y `q quit`, rompiendo esa assertion exacta.
- **Fix:** Actualizada la regex de la assertion para incluir `· o open` (el literal es propiedad compartida del footer; el cambio del plan lo modifica deliberadamente). No es un bug del handler — el test verificaba un literal que el plan cambia.
- **Files modified:** test/dashboard/app-focus.test.js
- **Commit:** 6aaff40

**2. [Rule 3 - Color-isolation grep] Reformulación de comentario en open.js**
- **Found during:** Task 1
- **Issue:** La acceptance criteria `grep -c "picocolors\|format.js" src/cli/dashboard/open.js` debe devolver 0, pero un comentario de documentación de la invariante de color-isolation mencionaba literalmente `picocolors` y `src/cli/format.js`, dando un falso positivo (1).
- **Fix:** Reformulado el comentario para documentar la misma invariante sin los tokens literales que el grep busca. El módulo nunca importó nada de color — solo era ruido en el grep. `grep -c` ahora es 0; el walker de format-isolation sigue verde.
- **Files modified:** src/cli/dashboard/open.js
- **Commit:** c21c1de

## TDD Gate Compliance

Secuencia RED→GREEN verificada en git log:
- Task 1: `test(48-02): add failing test for runOpen` (1fad5b7) → `feat(48-02): implement runOpen` (c21c1de)
- Task 2: `test(48-02): add failing integration test for o handler` (e56e057) → `feat(48-02): add o keypress handler` (6aaff40)
- Task 3 (DI wiring, sin behavior nuevo testeable más allá de grep/`node --check`): `feat(48-02): wire onOpen DI` (5bb4b5b) — cubierto por las criterias grep + check; el comportamiento end-to-end ya está cubierto por app-open.test.js con onOpen inyectado.

## Known Stubs

Ninguno. El plan entrega la mitad consumidora completa (`o` → `open <url>`); la persistencia de `task_url` y el fix del normalizer Plane viven en el Plan 48-01 (wave 1 hermana) — fuera del scope de este plan.

## Self-Check: PASSED

- Archivos creados: src/cli/dashboard/open.js, test/dashboard/open.test.js, test/dashboard/app-open.test.js, .planning/phases/48-open-in-manager-core/48-02-SUMMARY.md — todos FOUND.
- Commits: 1fad5b7, c21c1de, e56e057, 6aaff40, 5bb4b5b, c524d7e — todos FOUND.
- Working tree limpio tras el commit del SUMMARY.
