---
phase: 34-fundacion-subcomando-ciclo-de-vida
plan: 01
subsystem: cli-dashboard-tui
tags: [tui, ink, react, testing, wave-0, nyquist-gate, color-isolation]
requires:
  - "package.json/package-lock.json existentes (commander + picocolors)"
  - "test/format-isolation.test.js con helpers listJsFiles/extractImports/REPO/SRC"
provides:
  - "Stack ink@^6.8.0 + react@^19.2.0 (prod) instalado y pinneado (sin subir Node floor)"
  - "ink-testing-library@^4.0.0 + @types/react@^19 (devDeps) para render-testing del TUI"
  - "test/dashboard-non-tty.test.js (TUI-02): contrato exit 1 + mensaje canónico D-04 (rojo Wave 0)"
  - "test/dashboard-render.test.js (TUI-01 + TUI-03 parcial): chrome D-01 + q→exit observable (rojo Wave 0)"
  - "Walker color-isolation extendido a src/cli/dashboard/ (TUI-04/D-13)"
affects:
  - "Plan 02 (34-02): debe poner verdes dashboard-non-tty + dashboard-render creando src/cli/dashboard/index.js + App.js y registrando el subcomando en src/cli.js"
tech-stack:
  added:
    - "ink@^6.8.0 (resuelto 6.8.0) — render TUI React-for-CLI, ESM-only con top-level await"
    - "react@^19.2.0 (resuelto 19.2.6) — peer obligatorio de ink@6"
    - "ink-testing-library@^4.0.0 (resuelto 4.0.0, devDep) — render sin TTY real"
    - "@types/react@^19 (resuelto 19.2.15, devDep) — mantiene @ts-check sobre la superficie ink"
  patterns:
    - "Tests de fase creados en estado rojo ANTES de implementar (Nyquist gate / Wave 0)"
    - "spawnSync(bin/kodo, ['dashboard'], {stdio:['pipe','pipe','pipe']}) reproduce non-TTY (análogo version-smoke)"
    - "render(createElement(App,{...})) de ink-testing-library + lastFrame() para asertar chrome sin TTY"
    - "q→exit verificado con Promise.race([waitUntilExit(), timeout(1000)]) — comportamiento observable, no stdin.write hueco"
    - "Walker estático de color-isolation reutilizando helpers existentes (cero redefinición)"
key-files:
  created:
    - "test/dashboard-non-tty.test.js"
    - "test/dashboard-render.test.js"
  modified:
    - "package.json"
    - "package-lock.json"
    - "test/format-isolation.test.js"
decisions:
  - "Incluir @types/react@^19 (Open Question 1 RESEARCH = recomendación incluir): coste trivial, mantiene @ts-check verde sobre ink"
  - "q→exit asertado vía Promise.race(waitUntilExit vs timeout 1s): el await NO debe lanzar (waitUntilExit gana) — cobertura real de TUI-03, no placeholder"
  - "Verificación de resolución de módulos vía ESM import() (no require()): ink@6 es ESM-only con top-level await; require() falla bajo Node 25 por diseño del paquete, no por install defectuoso"
metrics:
  duration: "~6 min"
  completed: "2026-05-26"
  tasks: 3
  files_changed: 5
  commits: 3
---

# Phase 34 Plan 01: Fundación de verificación TUI (stack ink + tests Wave 0) Summary

Instala y pinnea el stack ink@^6.8.0 + react@^19.2.0 (con ink-testing-library@^4.0.0 + @types/react@^19 como devDeps) sin tocar `engines.node` ni añadir build step, y crea los contratos de verificación de Phase 34 en estado rojo (Nyquist gate): el guard non-TTY (D-04), el chrome del dashboard (D-01) con q→exit observable, y la extensión del walker de color-isolation a `src/cli/dashboard/` (D-13).

## Qué se construyó

Plan de fundación (Wave 0) que NO crea `src/cli/dashboard/` ni toca `src/cli.js` — su salida son las invariantes ejecutables que Plan 02 deberá poner en verde.

### Task 1 — Stack ink/react instalado y pinneado (`f58d2e3`)
- `package.json`: `dependencies` añade `"ink": "^6.8.0"` y `"react": "^19.2.0"`; sección `devDependencies` nueva con `"ink-testing-library": "^4.0.0"` y `"@types/react": "^19"`.
- `npm install` sin warnings de engine/peer. Versiones resueltas: **ink 6.8.0, react 19.2.6, ink-testing-library 4.0.0, @types/react 19.2.15**.
- `engines.node` intacto (`>=20.0.0`); ink pinneado a `^6` para no subir el floor a Node 22 (Pitfall 4). Sin `scripts.build`.
- `package-lock.json` regenerado en el mismo commit. `node_modules/` queda fuera del commit (gitignored).

### Task 2 — Tests Wave 0 rojos (`9e38d57`)
- `test/dashboard-non-tty.test.js` (TUI-02): `spawnSync(bin/kodo, ['dashboard'], {stdio:['pipe','pipe','pipe']})` y aserta `status === 1`, `stderr` matchea `/requires an interactive terminal \(TTY\)/` y `stderr.trim()` igual al string canónico D-04 completo.
- `test/dashboard-render.test.js` (TUI-01 + TUI-03 parcial): primer `it` aserta los tres substrings del chrome (`kodo dashboard`, `starting…` con U+2026, `q quit`) sobre `lastFrame()`; segundo `it` (async) escribe `'q'` por stdin y aserta vía `Promise.race([instance.waitUntilExit(), timeout(1000)])` que `waitUntilExit()` resuelve antes del timeout (el `await` NO lanza).
- Ambos ROJOS por diseño: `dashboard` es comando desconocido y `src/cli/dashboard/App.js` no existe aún.

### Task 3 — Walker color-isolation extendido (`9d8bada`)
- Nuevo `describe('TUI-04 (D-13): cero picocolors bajo src/cli/dashboard/')` al final de `test/format-isolation.test.js`, reutilizando `listJsFiles`/`extractImports`/`REPO`/`SRC` (sin redefinir helpers).
- Verde en Wave 1: `src/cli/dashboard/` no existe → lista filtrada vacía → pasa trivialmente; muerde cuando Plan 02 cree archivos.
- La aserción original `assert.deepEqual(importers, ['src/cli/format.js'])` queda intacta y verde (ink no es picocolors).

## Decisiones tomadas

1. **`@types/react@^19` incluido** (Open Question 1 del RESEARCH, recomendación = incluir): coste de +1 devDep trivial, mantiene `@ts-check` verde sobre la superficie ink. Si se quisiera minimalismo, omitirlo no rompería nada.
2. **q→exit asertado con `Promise.race([waitUntilExit(), timeout(1000)])`**: el ejemplo del RESEARCH (L391-396) dejaba la aserción vacía a propósito; este plan la prescribe concreta. Patrón: capturar `instance`, `instance.stdin.write('q')`, correr la carrera; si el timeout gana, el `await` lanza y el test falla con mensaje accionable. Da cobertura automatizada real a TUI-03 (no un `stdin.write` hueco). La restauración de terminal tras Ctrl-C/SIGTERM en TTY real sigue siendo UAT manual (no automatizable sin PTY).
3. **Verificación de resolución de módulos vía ESM `import()`, no `require()`** — ver Deviations.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] El `<verify>` de Task 1 usaba `require('ink')`, incompatible con el stack ESM-only pinneado**
- **Found during:** Task 1, al ejecutar el comando de verificación tal cual.
- **Issue:** El comando `node -e "require('ink'); require('react'); require('ink-testing-library')"` del `<verify>` aborta con `ERR_REQUIRE_ASYNC_MODULE` bajo Node 25: ink@6 es un paquete ESM-only con top-level await, y `require()` no puede cargar un grafo ESM con TLA. Esto NO refleja un install defectuoso — refleja que ink@6 solo se consume vía `import`. El proyecto es `"type": "module"` y tanto `bin/kodo` como los tests cargan estas deps por ESM.
- **Fix:** Verifiqué la resolución por el mecanismo real (`node --input-type=module -e "await import('ink'); await import('react'); await import('ink-testing-library')"`), que pasa limpio. El acceptance criterion ("los tres módulos resuelven sin error desde el repo") queda satisfecho — solo cambió el verbo de carga (`import` en vez de `require`), que es el único correcto para este stack.
- **Files modified:** ninguno (cambio en el comando de verificación, no en código).
- **Commit:** N/A (verificación).

## Estado esperado de los tests de Plan 02

Tras este plan, la suite global queda en **896 pass + 2 fail + 1 skip** (sobre 899 tests). Los 2 fails son EXACTAMENTE los dos tests de Wave 0 creados aquí, rojos por diseño (Nyquist gate):

| Test | Razón del rojo (Wave 0) | Verde cuando Plan 02… |
|------|-------------------------|------------------------|
| `test/dashboard-non-tty.test.js` (TUI-02) | `dashboard` es comando desconocido (`error: unknown command 'dashboard'`) | registre el subcomando en `src/cli.js` + implemente el guard pre-render (`!stdout.isTTY \|\| !stdin.isTTY` → stderr canónico D-04 + `process.exit(1)`) en `src/cli/dashboard/index.js` (T-34-01) |
| `test/dashboard-render.test.js` (TUI-01 + TUI-03) | import de `../src/cli/dashboard/App.js` falla (archivo inexistente → el file entero errorea) | cree `src/cli/dashboard/App.js` (default export) con el chrome D-01 (banner/`starting…`/`q quit`) y el handler `q`→`useApp().exit()` |

El `+1 pass` neto vs baseline v0.8 (895→896) es el nuevo test TUI-04 del walker, que pasa trivialmente (directorio TUI aún vacío). El único `skip` sigue siendo `startup-budget` (Decisión B, pre-existente). Cero regresiones en los 895 tests previos.

## Verificación ejecutada

- `node --test test/format-isolation.test.js` → 8 pass / 0 fail (walker extendido, aserción previa intacta).
- `node --check` de ambos tests de dashboard → válidos.
- `grep -q waitUntilExit test/dashboard-render.test.js` → presente (it q→exit aserta comportamiento).
- `await import('ink' | 'react' | 'ink-testing-library')` → resuelven.
- `package.json`: `engines.node === ">=20.0.0"`, `dependencies.ink === "^6.8.0"`.
- Estado Wave 0: `dashboard-non-tty` y `dashboard-render` ROJOS (verificado vía `node --test` exit != 0).
- `npm test` (suite completa): 899 tests / 896 pass / 2 fail (los dos Wave 0) / 1 skip.

## Threat surface scan

Sin superficie de seguridad nueva fuera del `<threat_model>` del plan. Este plan no crea endpoints de red, paths de auth ni acceso a ficheros nuevos — solo instala deps y crea tests. T-34-01 (DoS en non-TTY) queda cubierto por el contrato de `test/dashboard-non-tty.test.js` (el guard lo implementa Plan 02). Sin threat flags.

## Self-Check: PASSED

- FOUND: test/dashboard-non-tty.test.js
- FOUND: test/dashboard-render.test.js
- FOUND: package.json (modificado)
- FOUND: package-lock.json (modificado)
- FOUND: test/format-isolation.test.js (modificado)
- FOUND commit: f58d2e3 (Task 1 — stack ink/react)
- FOUND commit: 9e38d57 (Task 2 — tests Wave 0)
- FOUND commit: 9d8bada (Task 3 — walker D-13)
