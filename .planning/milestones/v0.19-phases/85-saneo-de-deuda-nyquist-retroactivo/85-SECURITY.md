---
phase: 85
slug: saneo-de-deuda-nyquist-retroactivo
status: verified
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-28
---

# Phase 85 — Security

> Contrato de seguridad de la fase: registro de amenazas, riesgos aceptados y traza de auditoría.
> Registro autorado en plan-time (`register_authored_at_plan_time: true` — los 5 `PLAN.md` traen `<threat_model>`).
> Auditado por `gsd-security-auditor` contra el **código commiteado**, no contra lo que los SUMMARY afirman: cada mitigación tiene un grep o un diff que la ancla.

---

## Trust Boundaries

| Boundary | Descripción | Datos que cruzan |
|----------|-------------|------------------|
| Disco → TUI | `state.json` (campo `next`, hand-editable) leído por el dashboard | Texto libre del operador, truncado a 200 chars en escritura (`src/session/handoff.js:38`) |
| cmux → carril automático de `kodo check` | Resultado del sidebar doctor (`scan`/`execute`) consumido por el piggyback | Refs de workspace del operador; **solo el conteo entero cruza a stderr** |
| Repo → suite de tests | Ficheros fuente leídos **como texto** por los guards de aislamiento | Ninguno sensible: los guards no ejecutan lo que leen |
| Fase → artefactos archivados | `.planning/milestones/**` de v0.16 y v0.18 | Solo escritura sobre 6 `VALIDATION.md`; los snapshots históricos son read-only por D-15 |

**Superficie nueva de red, autenticación o parsing de input externo: ninguna.** La fase es doc/debt sweep: cero deps npm, cero endpoints, cero I/O de red.

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation (evidencia verificada por el auditor) | Status |
|-----------|----------|-----------|----------|-------------|--------------------------------------------------|--------|
| T-85-01-01 | DoS | `nextCell` — regex `/\s+/g` sobre un `next` de disco | low | accept | Regex literal constante (`src/cli/dashboard/format.js:266`); truncado real a 200 en `src/session/handoff.js:38`. Cero regex nuevas en la fase | closed |
| T-85-01-02 | Tampering | `src/cli/dashboard/select.js` — primer import de runtime | low | mitigate | `select.js:35` único import; `format.js:25` importa solo `node:path`; guard §TUI-04 (`test/format-isolation.test.js:209-220`) itera fichero a fichero; 0 sentencias `import` de picocolors | closed |
| T-85-01-03 | Repudiation | Los 8 asserts LIVE-05 de `test/dashboard-select.test.js` | medium | mitigate | `git diff b9624e1^..c6fa846 -- test/dashboard-select.test.js` = **8 inserciones / 0 borrados** | closed |
| T-85-01-04 | Information Disclosure | Comentario JSDoc de `state.js` | low | accept | `src/session/state.js:53` describe un contrato de merge + refs a tests del repo. Sin paths de operador ni valores de `state.json` | closed |
| T-85-01-SC | Tampering | Supply chain (npm) | low | accept | `git diff 2ca5080..HEAD -- package.json package-lock.json` **vacío** | closed |
| T-85-02-01 | DoS | `DYNAMIC_LOGGER_IMPORT_RE` / `LOGGER_ALLOWLIST_RE` | low | mitigate | `test/check-isolation.test.js:33-34`: ambas `const` literales a nivel de módulo, nunca compiladas desde input; clases separadas por literal obligatorio (`logger`) → sin backtracking exponencial | closed |
| T-85-02-02 | Information Disclosure | Línea nueva de `src/check.js` → stderr | medium | mitigate | `src/check.js:169-172` interpola **solo** `${failed}` (entero). Diff completo confirma cero `reason`/`target`/`category` | closed |
| T-85-02-03 | Repudiation | El guard LOG-12 reforzado | **high** | mitigate | `test/check-isolation.test.js:206-228`: `stripComments` **antes** del match, allowlist anclada con `$` a `logger-events.js`/`logger-noop.js`, regex sin relajar. **No vacuidad corroborada**: el auditor reprodujo la clausura estática (23 ficheros, incluye `src/labels.js` → la mordida fue real) y existe un hit vivo suprimido por allowlist en `src/session/state.js:247` | closed |
| T-85-02-04 | Tampering | `walkImports` / `extractImports` | **high** | mitigate | Diff de fase sobre `check-isolation.test.js`: **2 borrados, ambos líneas de comentario**. `IMPORT_FROM_RE`, `IMPORT_BARE_RE`, `extractImports` y el cuerpo de `walkImports` byte-idénticos | closed |
| T-85-02-05 | Elevation of Privilege | Piggyback → gate `needsOrchestrator` | low | mitigate | El diff añade `const failed` + `if/errorFn` dentro del `try` fail-open existente (`src/check.js:154-179`). `reasons`, `needsOrchestrator`, el gate y el exit code sin tocar | closed |
| T-85-02-06 | Tampering | Verificación de mordida (mutación temporal de `src/labels.js`) | medium | mitigate | `git diff 2ca5080..HEAD -- src/labels.js` vacío y `git status --porcelain src/labels.js` vacío | closed |
| T-85-02-SC | Tampering | Supply chain (npm) | low | accept | Ídem T-85-01-SC | closed |
| T-85-03-01 | Repudiation | `nyquist_compliant: true` sin evidencia (79/80/81) | **high** | mitigate | Citas `{N}-VERIFICATION.md`: 79→**14**, 80→**14**, 81→**13** (≥3); `status: validated` + `nyquist_compliant: true` ×1; placeholders → **0**; `## Reconstruction Audit` presente en las 3 | closed |
| T-85-03-02 | Tampering | Artefactos archivados de v0.18 | medium | mitigate | `v0.18-MILESTONE-AUDIT.md` sin tocar; el `git diff --name-only` de la fase confirma que solo cambian los 3 `VALIDATION.md` de v0.18 | closed |
| T-85-03-03 | Tampering | Suite de tests del repo | **high** | mitigate | `git status --porcelain test/ \| grep -c '^??'` = **0**; `test(phase-` en el rango de la fase = **0**; el rango `cb9d86b^..3c9c487` no toca un solo fichero de `test/` | closed |
| T-85-03-04 | Information Disclosure | Citas de evidencia en los `VALIDATION.md` | low | accept | Barrido de `/Users/`, `api_key`, `token`, `Bearer`, `ghp_` sobre los 6 ficheros: solo prosa y un `<ip-del-host>` placeholder. Cero credenciales | closed |
| T-85-03-SC | Tampering | Supply chain (npm) | low | accept | Ídem | closed |
| T-85-04-01 | Repudiation | `nyquist_compliant: true` sin evidencia (69/71/72; agravado en `72`) | **high** | mitigate | Citas: 69→**17**, 71→**14**, 72→**15**; marcadores de plantilla (`pytest`/`jest`/`REQ-{`/`tests/test_file`) → **0**; en `72-VALIDATION.md` las 8 filas verdes citan fichero + sección + conteo una a una | closed |
| T-85-04-02 | Tampering | Suite de tests del repo | **high** | mitigate | Misma evidencia que T-85-03-03 | closed |
| T-85-04-03 | Tampering | Artefactos archivados de v0.16 | medium | mitigate | `v0.16-MILESTONE-AUDIT.md`, `71-UAT.md`, `72-UAT.md` y `72-SECURITY.md` sin modificar en todo el rango | closed |
| T-85-04-04 | Repudiation | El `skipped: 1` del UAT de 71 | medium | mitigate | `71-VALIDATION.md:35,65,75,90` declaran el skip literalmente (fecha 2026-07-09, cobertura compensatoria); en ningún punto se cuenta como pass | closed |
| T-85-04-05 | Information Disclosure | Citas de evidencia en los `VALIDATION.md` | low | accept | Ídem T-85-03-04 | closed |
| T-85-04-SC | Tampering | Supply chain (npm) | low | accept | Ídem | closed |
| T-85-05-01 | Repudiation | Fila de `STATE.md` cerrada sin artefacto que la respalde | **high** | mitigate | Las 4 filas cerradas de §Deferred Items citan requisito + plan + los 3 commits de tarea; contrastados uno a uno contra `git log` | closed |
| T-85-05-02 | Tampering | Fila del format-isolation transitivo | medium | mitigate | `grep -c 'format-isolation transitivo'` = 1; su celda dice **ABIERTOS** / «evaluado y DIFERIDO por la Phase 85 (D-18)». No cerrada, no borrada | closed |
| T-85-05-03 | Tampering | `STATE.md` / `REQUIREMENTS.md` fuera del writer gestionado | medium | mitigate | **Desviación documentada y mecánicamente verificada** — ver §Desviaciones | closed |
| T-85-05-04 | Repudiation | `deferred-items.md` con ítems sin trigger | low | mitigate | 6 filas de datos, **6 celdas `Trigger` no vacías** (196–446 chars) | closed |
| T-85-05-SC | Tampering | Supply chain (npm) | low | accept | Ídem | closed |

*Status: open · closed · open — below `high` threshold (non-blocking)*
*Severity: critical > high > medium > low — solo las amenazas abiertas en o por encima de `workflow.security_block_on` cuentan para `threats_open`*
*Disposition: mitigate (implementación requerida) · accept (riesgo documentado) · transfer (tercero)*

**Total: 26 amenazas · 26 closed · 0 open · 7 de severidad `high`, todas cerradas con evidencia.**

---

## Desviaciones verificadas

### T-85-05-03 — mutación de §Deferred Items fuera del writer gestionado

El plan exigía que toda mutación de `STATE.md` fuera por `state.update`/`state.patch`. **Ese camino no existe para esta sección**, y el auditor lo verificó de forma independiente en vez de aceptar la explicación del ejecutor:

- `state-document.cjs:57` — `tableRowPattern` es `^(\|[ \t]*)(name)([ \t]*\|[ \t]*)([^|\n]*?)([ \t]*\|[ \t]*)$`: anclado y con **una sola celda de valor**. Las filas de §Deferred Items tienen 4 columnas → ningún handler puede direccionarlas. La imposibilidad es real, no una excusa.
- `state-transition.cjs:1284` declara `## Deferred Items` **sección curada, preservada verbatim** por `rebuild`. El SDK no posee esa sección por diseño.
- El diff de `5d09884` toca **exclusivamente** esa sección curada: ningún campo gestionado o derivado se escribió a mano.
- `state.validate` re-ejecutado de forma independiente → `{"valid": true, "warnings": [], "drift": {}}`.

La **intención** de la amenaza (que el artefacto gestionado no se desincronice) se cumple. CLOSED con desviación documentada.

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-85-01 | UF-01 | La cobertura declarada del guard LOG-12 excede la real. Los comentarios de `test/check-isolation.test.js:14-17,56-59` afirman que el source-grep cubre el punto ciego de los imports dinámicos; **no lo cubre**: la clausura estática de `check.js` son 23 ficheros que **no** incluyen `src/providers/{plane,github}/provider.js`, que `registry.js:28,58` carga dinámicamente desde `check.js:103`. Además `DYNAMIC_LOGGER_IMPORT_RE` solo casa `import(` con comillas: un `require('../logger.js')` vía el `createRequire` de `src/host/interface.js:12` (que **sí** está en la clausura) evadiría walker y grep a la vez. **Riesgo residual latente, no activo**: los dos providers reciben el logger por inyección (`opts.logger`), sin import dinámico de `logger.js`. Registrado en `deferred-items.md` con su trigger. | Mantenedor (UAT 2026-07-28) | 2026-07-28 |
| AR-85-02 | UF-02 | La premisa que sostiene T-85-01-02 («`format.js` es puro») es cierta hoy (`src/cli/dashboard/format.js:25`) pero **ningún test la congela**, y §TUI-04 solo mira imports **directos**. Si `format.js` ganara mañana una arista hacia la capa de color, `select.js` alcanzaría picocolors transitivamente con los dos guards en verde. Cubierto en lo general por la fila «format-isolation transitivo» de `deferred-items.md`; el guard concreto (congelar la lista de imports de `format.js`) queda registrado allí. | Mantenedor (UAT 2026-07-28) | 2026-07-28 |
| AR-85-03 | WR-01 (85-REVIEW) | La línea de fallos del piggyback solo se dispara ante fallos de **escritura por-item**; con cmux caído `parseRaw` traga el error y `errors` queda `[]`, así que el silencio persiste. **Sin relevancia de seguridad**: no filtra nada, no altera el gate, no cambia el exit code — es una carencia de observabilidad, no una superficie explotable. Aceptado explícitamente en `85-UAT.md` test 1 (opción a) y registrado en `deferred-items.md` fila 3 con su trigger. | Mantenedor (UAT 2026-07-28) | 2026-07-28 |

*Los riesgos aceptados no vuelven a aparecer en futuras corridas de auditoría.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-07-28 | 26 | 26 | 0 | `gsd-security-auditor` (opus, ASVS L1, block_on `high`) |

**Nota de proceso:** los cinco SUMMARY declaran `## Threat Flags: Ninguno`, lo cual resultó **incompleto** — `85-REVIEW.md` se completó *después* del cierre de bookkeeping y trajo hallazgos de cobertura de control que nadie mapeó a un threat ID. La auditoría los recogió como UF-01/UF-02 y quedan en el log de riesgos aceptados. Ninguno es bloqueante; todos son latentes, sin violación activa a HEAD.

---

## Sign-Off

- [x] Todas las amenazas tienen disposición (mitigate / accept / transfer) — 26/26
- [x] Riesgos aceptados documentados en el Accepted Risks Log — AR-85-01..03
- [x] `threats_open: 0` confirmado
- [x] `status: verified` en frontmatter

**Approval:** verified 2026-07-28
