# Phase 15: CLI Polish Wiring - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-05
**Phase:** 15-cli-polish-wiring
**Areas discussed:** Render path de `kodo logs`, Widths y truncation (DX-02), Shape de `kodo check` (DX-05), Render de verdicts (DX-03 + DX-04)

---

## Render path de `kodo logs`

### Q1: ¿Dónde vive el render alineado para `kodo logs` y el stderr-mirror runtime?

| Option | Description | Selected |
|--------|-------------|----------|
| Modificar formatLine en logger.js | logger.js#formatLine importa format.js y delega columnas + color al formatter. Stderr runtime y `kodo logs` dump comparten exactamente el mismo render. Toca logger.js (Phase 14 lo declaró 'intocable' solo para Phase 14). LOG-12 sigue OK porque check.js no importa logger.js. | ✓ |
| Reescribir solo en reader.js | logger.js queda intocable. reader.js construye su propia línea via `fmt.formatRow([ts, lvl, comp, msg], widths)`. Stderr-mirror runtime (logger.js) sigue con su shape actual (color por nivel sin columnas). Divergencia visual entre runtime y dump pero churn mínimo en logger.js. | |
| Híbrido: helper compartido en format.js | format.js exporta `formatLogRecord(rec, fmt, opts)` que devuelve la línea humana completa. Tanto logger.js#formatLine como reader.js lo importan. Single source de layout, pero formato.js gana conocimiento del shape NDJSON del logger (acoplamiento contrario al actual). | |

**User's choice:** Modificar formatLine en logger.js
**Notes:** Single source de visual layout entre stderr runtime y dump. Phase 14 D-05 ("logger.js intocable") aplicaba sólo a Phase 14. LOG-12 sigue verde porque check.js no importa logger.js.

---

### Q2: ¿Cómo se garantiza que `kodo logs --json` mantiene bytes idénticos (DX-06 invariante)?

| Option | Description | Selected |
|--------|-------------|----------|
| Bypass total antes de formatter | reader.js mantiene el early-return actual: `if (opts.json) { stdout.write(raw + '\n'); return; }`. El formatter NUNCA se invoca para --json. Trivial de auditar; el golden bytes test compara bytes pre/post Phase 15 sin tocar nada. | ✓ |
| Formatter con useColor=false forzado | Se crea formatter para todos los caminos pero --json pasa por la rama de `raw passthrough` sin tocar el record. Refactor más uniforme pero añade superficie a auditar. | |

**User's choice:** Bypass total antes de formatter
**Notes:** Coherente con CONTEXT 14 §specifics que ya mencionaba "el flag bypasea el helper completamente". Mínima superficie a auditar.

---

## Widths y truncation (DX-02)

### Q1: ¿Widths fijas y política de truncation para el shape TTY-only `timestamp · level · component · message`?

| Option | Description | Selected |
|--------|-------------|----------|
| Fijas + pad-only (no truncate) | level=5 (max 'ERROR'), component=12, timestamp=8 (HH:MM:SS). Si component excede 12 chars se desborda y rompe alineación local de esa línea pero el resto sigue cuadrado. Coincide con el contrato `padCell` actual de Phase 14 (D-10 dice no truncar). Recommended. | ✓ |
| Fijas + truncate component (…9) | level=5, component=12 con truncado a 11 chars + '…'. Alineación perfecta pero pierde info; obliga a añadir lógica de truncate al formatter (no presente en Phase 14). | |
| level=5, component dynamic | level fijo, component sin width (espacio simple). Solo timestamp + level alineados; component+msg fluyen. Mejor cuando los components varían mucho de longitud (ej. `dispatcher` vs `gsd-bootstrap`). | |

**User's choice:** Fijas + pad-only (no truncate)
**Notes:** Aliñado con Phase 14 D-10 (no truncate en padCell). Componentes >12 chars como `gsd-bootstrap` (13) desbordan localmente — aceptable, documentado en §code_context.

---

### Q2: Cuando un record NO tiene `component` (campo opcional), ¿qué shape produce el dump TTY?

| Option | Description | Selected |
|--------|-------------|----------|
| Pad de 12 espacios (col vacía) | `HH:MM:SS · INFO  ·              · mensaje`. Mantiene alineación estricta entre filas; el observador siempre ve 4 columnas en la misma posición. | ✓ |
| Skip column (3 columnas) | `HH:MM:SS · INFO  · mensaje`. La línea se compacta, más densa visualmente. Rompe alineación vertical cuando el log mezcla records con/sin component. | |

**User's choice:** Pad de 12 espacios (col vacía)
**Notes:** Solo aplica a TTY mode. En non-TTY/NO_COLOR el component se omite igual que ahora (preservación bytes pre-Phase 15).

---

## Shape de `kodo check` (DX-05)

### Q1: ¿Migramos `kodo check` a una tabla semántica o conservamos las líneas actuales?

| Option | Description | Selected |
|--------|-------------|----------|
| Conservar líneas + colorizar inline | Mantenemos `[kodo:check] Sessions: X running, Y in review` etc. Sustituimos los `ANSI_YELLOW`/`ANSI_RED` inline por `fmt.yellow(...)` / `fmt.red(...)` y añadimos `fmt.ok('All clear')` al status final. NO_COLOR mode = bytes idénticos al actual (tests existentes intactos). El SC#5 'tabla' se cumple como 'tabla lógica' (varias filas — la palabra es aspiracional). | ✓ |
| Migrar a formatTable | Refactor a tabla real: rows como `Sessions · 2 running, 1 review · ✓` / `Pending · N tasks · ⚠` / `Health · stuck=X gone=Y · ✗`. Renderizamos via `fmt.formatTable(rows)`. Bytes cambian incluso en NO_COLOR (golden bytes pre/post Phase 15 difieren). Hay que actualizar `test/check.test.js` y los snapshots de runCheck. | |
| Híbrido: líneas + sufijo `· OK/FAIL` | Mantenemos prefijo `[kodo:check] msg` pero añadimos sufijo `· ✓` o `· ✗` por línea coloreado. NO_COLOR introduce los símbolos ASCII ('✓'/'✗' son chars, no ANSI) — bytes cambian solo si los añadimos. | |

**User's choice:** Conservar líneas + colorizar inline
**Notes:** Bytes en NO_COLOR/non-TTY = idénticos. Tests `runCheck`/`runCheckAndAct` siguen verdes sin refactor de snapshots. La palabra "tabla" del SC se interpreta como "tabla lógica".

---

## Render de verdicts (DX-03 + DX-04)

### Q1: Para `kodo gsd inspect` SC#3 — 4 secciones con ✓/✗ + exit code visible. ¿Qué mapping a las etapas reales del handler?

| Option | Description | Selected |
|--------|-------------|----------|
| Mapping literal SC#3 | config → resolveProjectPath OK \| fetch → provider.getTask OK \| roadmap → .planning/PROJECT.md present \| match → verdict.action != 'error'. Cada sección termina con `fmt.ok('OK')` o `fmt.fail('FAIL')`. Quita `Section 4: buildGsdContext preview` (lo deja como bloque opcional si verdict=='bootstrap'). Recommended — mapping 1:1 con el SC. | ✓ |
| Refactor más libre | Renombramos las 3 secciones actuales: 'Task' (fetch), 'Project' (config + roadmap fusionado), 'Verdict' (match). Coloreamos verdict con ✓ si action==phase\|bootstrap, ✗ si error. Append `Exit: N` al final. Más ergonómico para el operador pero diverge del SC literal (3 secciones vs 4). | |
| Modo mínimo: no añadir secciones nuevas | Mantener las 3 secciones actuales del renderHuman; solo cambiar 'Verdict:' header para que tenga ✓/✗ prefix según action y añadir línea final `Exit: N`. Menor superficie, pero el SC#3 'config, fetch, roadmap, match' se queda parcialmente cubierto. | |

**User's choice:** Mapping literal SC#3
**Notes:** Reorganización del renderHuman a 4 secciones literales del SC (config, fetch, roadmap, match). buildGsdContext preview se mantiene como bloque opcional cuando verdict=='bootstrap' (auditoría operador).

---

### Q2: ¿Mapping verdict→3 colores en `kodo gsd verify`?

| Option | Description | Selected |
|--------|-------------|----------|
| pass=verde, fail=amarillo, missing/malformed=rojo | pass = `fmt.green` (gate clean). fail = `fmt.yellow` (soft-fail — gate corrió, must-haves no cumplidas). missing/malformed = `fmt.red` (hard-fail — estructura incorrecta o ausente). Distinción soft/hard alineada con la semántica de Phase 10. Recommended. | ✓ |
| pass=verde, fail/missing/malformed=rojo | Solo 2 colores (verde/rojo). 'amarillo' del SC se reserva para warnings posibles futuros. Más simple pero el SC dice explícitamente 3 colores. | |
| pass=verde, fail=rojo, missing=amarillo, malformed=amarillo | Inversión: missing/malformed son condiciones recoverable (operador añade VERIFICATION.md), fail es contenido roto. Más coherente con 'recoverable=warn / final=error', pero contradice la lectura natural de soft-fail=fail. | |

**User's choice:** pass=verde, fail=amarillo, missing/malformed=rojo
**Notes:** Soft-fail (must-haves no cumplidas, gate corrió) = warn. Hard-fail (estructura ausente o rota) = error.

---

### Q3: ¿Qué incluye el 'resumen del comentario Plane' que muestra `gsd verify` en TTY?

| Option | Description | Selected |
|--------|-------------|----------|
| Header + verdict line (2-3 líneas) | Solo el header determinista del comentario (`## Verificación GSD — phase NN`) + la línea verdict (`**Verdict**: pass`). Compacto, suficiente para confirmar qué se postó sin saturar stdout. Recommended. | ✓ |
| Body completo del comentario | Render del body completo (header + verdict + must_haves list + reason/detail). Único cliente del comentario que ve el operador local; útil para auditar. Pero ~10-20 líneas en stdout. | |
| Solo conteo (`commented=X transitioned=Y`) | Mantener el shape actual sin añadir resumen. El SC#4 'resumen del comentario' se cumple como 'metadata del posteo' (número/estado, no contenido). Mínimo refactor pero diverge del SC literal. | |

**User's choice:** Header + verdict line (2-3 líneas)
**Notes:** El resumen es solo eco del primer slice de `renderComment(verdict)`. NO se rerendea — determinismo del comentario byte-a-byte (Pitfall #2 Phase 10) intacto.

---

## Claude's Discretion

- Estructura del refactor de `formatLine`: extraer helper `_renderColumnar(rec, fmt, widths)` o inlinearlo según LoC.
- Naming de las secciones gsd inspect: orden literal del SC#3 (`config, fetch, roadmap, match`) aunque el handler ejecute `fetch` antes de `config`.
- Helpers nuevos en format.js si son necesarios (truncate variant): se añaden a format.js, NO se abren a callsites.
- Tests source-hygiene: extender `test/format-isolation.test.js` con positive assertions (qué archivos deben importar format.js).

## Deferred Ideas

- Truncation con ellipsis (no requerido por SCs Phase 15).
- Migración de `kodo check` a `formatTable` semántico (rejected Q1 §kodo check).
- Body completo del comentario Plane en `gsd verify` (rejected Q3 §verdicts).
- `fmt.bold/italic/underline` (no requeridos).
- Themes / paletas configurables (Out of Scope REQUIREMENTS.md).
- Wide-char / emoji widths (componentes ASCII puro).
