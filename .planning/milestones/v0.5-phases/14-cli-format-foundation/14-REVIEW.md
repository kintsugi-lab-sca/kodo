---
phase: 14-cli-format-foundation
reviewed: 2026-05-04T16:22:00Z
depth: standard
files_reviewed: 5
files_reviewed_list:
  - src/cli/format.js
  - test/format.test.js
  - test/format-isolation.test.js
  - test/version-smoke.test.js
  - package.json
findings:
  critical: 0
  warning: 1
  info: 2
  total: 3
status: issues_found
---

# Phase 14: Code Review Report

**Reviewed:** 2026-05-04T16:22:00Z
**Depth:** standard
**Files Reviewed:** 5
**Status:** issues_found

## Summary

Phase 14 introduce `src/cli/format.js` como factory de formatters de color para superficies CLI, usando `picocolors` como nueva dependencia de producción. La revisión cubre los invariantes críticos declarados en el task:

- **LOG-12 extension (aislamiento):** `src/cli/format.js` NO importa `src/logger.js` ni ningún archivo que lo arrastre. Verificado con walker transitivo real en `test/format-isolation.test.js` y con `grep` directo.
- **D-07 single-source:** `picocolors` se importa EXACTAMENTE en un único archivo (`src/cli/format.js`). Verificado con scan de todos los `.js` bajo `src/`.
- **DX-06 golden bytes:** Con `useColor=false` todos los helpers devuelven la string de entrada sin bytes ANSI. Verificado ejecutando los tests y auditando `picocolors` para confirmar que solo emite secuencias de un parámetro (`\x1b[\d+m`), que son las que cubre la regex de `visibleWidth`.
- **Phase 14 boundary:** Sin callsites tocados. Solo se crean archivos nuevos + `package.json`.
- **44/44 tests pasan.**

Se detecta una advertencia de calidad en el test de smoke y dos items informativos sobre cobertura de tests y trailing spaces en tablas.

## Warnings

### WR-01: version-smoke — `spawnSync` sin timeout puede colgar el suite indefinidamente

**File:** `test/version-smoke.test.js:18`
**Issue:** `spawnSync` se invoca sin opción `timeout`. Si `bin/kodo` cuelga (por ejemplo, un import que espera I/O al cargar `src/cli.js`), el proceso hijo no tiene tope de tiempo y bloquea el runner de tests indefinidamente. El comentario `// No env override — we want to test the install in its real shape.` refuerza que se ejecuta en condiciones de entorno real, lo que hace más probable que un entorno CI lento provoque un cuelgue silencioso.
**Fix:**
```js
const result = spawnSync(process.execPath, [KODO_BIN, '--version'], {
  cwd: REPO,
  encoding: 'utf-8',
  timeout: 10_000, // 10 s — falla rápido en CI si el bin cuelga
});
```

## Info

### IN-01: `visibleWidth` — regex solo cubre secuencias ANSI de un único parámetro

**File:** `src/cli/format.js:57`
**Issue:** La regex `/\x1b\[\d+m/g` cubre correctamente todos los códigos que `picocolors` emite actualmente (`\x1b[Nm` y `\x1b[NNm` — siempre un solo parámetro numérico). Sin embargo, si en el futuro se pasan strings pre-coloreadas producidas por otra biblioteca que use secuencias multi-parámetro (`\x1b[1;31m`, `\x1b[38;5;200m`), `visibleWidth` devolvería un ancho incorrecto causando padding roto en `formatRow`/`formatTable`. El riesgo actual es bajo dado el invariante D-07 (single-source de color), pero es técnicamente frágil frente a entradas externas.
**Fix:** Ampliar la regex para cubrir el caso general CSI:
```js
// Antes
return String(s).replace(/\x1b\[\d+m/g, '').length;
// Después (cubre secuencias multi-param y cualquier letra final de CSI)
return String(s).replace(/\x1b\[[\d;]*[A-Za-z]/g, '').length;
```
Este cambio no afecta los tests existentes (todos los casos picocolors siguen funcionando) y hace el contrato defensivo frente a inputs externos.

### IN-02: Test de `_resolveUseColor` — caso `FORCE_COLOR=''` (empty string) no está cubierto explícitamente

**File:** `test/format.test.js:29`
**Issue:** El comentario en `_resolveUseColor` (línea 44) documenta explícitamente que `FORCE_COLOR=''` (cadena vacía pero variable definida) fuerza color ON. Hay 7 casos cubiertos en los tests pero este caso específico — que puede ocurrir en shells que exportan `FORCE_COLOR` vacío — no tiene un test propio. El comportamiento es correcto por la lógica `!== '0'`, pero la ausencia del test deja sin documentar el contrato de forma ejecutable.
**Fix:** Añadir un octavo caso al suite `_resolveUseColor precedence`:
```js
it("case 8: TTY=false + FORCE_COLOR='' (empty string is set) => true (any non-'0' value forces)", () => {
  assert.equal(_resolveUseColor({ isTTY: false }, { FORCE_COLOR: '' }), true);
});
```

---

_Reviewed: 2026-05-04T16:22:00Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
