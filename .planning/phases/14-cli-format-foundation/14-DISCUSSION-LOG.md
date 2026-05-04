# Phase 14: CLI Format Foundation - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-04
**Phase:** 14-cli-format-foundation
**Areas discussed:** API shape del helper, Convivencia con formatLine de logger.js, Picocolors solo interno o re-exportado, Column formatter — shape API

---

## API shape del helper

### Q1: Forma fundamental de la API — ¿cómo se inyecta el descriptor (TTY detection)?

| Option | Description | Selected |
|--------|-------------|----------|
| Factory bound al stream | `createFormatter(stream, env?)` → objeto bound al descriptor. Cumple SC#1 literal. | ✓ |
| Funciones top-level con opts por llamada | `export function ok(text, { useColor })` — caller calcula useColor cada vez. | |
| Híbrido: factory + helpers puros | Ambos exports. Más API, más mantener. | |

**User's choice:** Factory bound al stream → **D-01**.
**Notes:** Match exact con SC#1 ("TTY detection a partir del descriptor pasado").

### Q2: Precedencia entre NO_COLOR y FORCE_COLOR cuando ambas están set

| Option | Description | Selected |
|--------|-------------|----------|
| NO_COLOR gana | Match picocolors internal + no-color.org. | ✓ |
| FORCE_COLOR gana | Chalk-style. Necesita lógica custom envolviendo picocolors. | |
| Error si ambas están set | Conflict-fail-loud. Riesgo de romper scripts CI. | |

**User's choice:** NO_COLOR gana → **D-02**.
**Notes:** Coherencia con la dep que vamos a añadir.

### Q3: ¿Qué set de helpers debe exponer el formatter?

| Option | Description | Selected |
|--------|-------------|----------|
| Mínimo SC#1 + colores genéricos | `{ debug, info, warn, error, ok, fail, columns, green, yellow, red, cyan, gray, dim }`. | ✓ |
| Solo el mínimo SC#1 | Sin colores genéricos. DX-04 verde/amarillo/rojo no se cubre limpio. | |
| Helpers semánticos por surface | `pass`/`softFail`/`hardFail` específicos. format.js conoce surfaces (acoplamiento upstream). | |
| Símbolos como exports separados | `SYMBOL_PASS`/`FAIL` + ok/fail. Más ruido. | |

**User's choice:** Mínimo SC#1 + colores genéricos → **D-03**.

### Q4: useColor evaluation — eager o lazy

| Option | Description | Selected |
|--------|-------------|----------|
| Eager: una vez en construcción | Computado al crear formatter, capturado en closure. | ✓ |
| Lazy: re-evaluado en cada llamada | Re-lee env por llamada. Overhead innecesario para CLI corto. | |

**User's choice:** Eager → **D-04**.

---

## Convivencia con formatLine de logger.js

### Q1: ¿Qué hacemos con la duplicación natural entre logger.js y format.js?

| Option | Description | Selected |
|--------|-------------|----------|
| Duplicar primitives en format.js | logger.js intocable; format.js implementa color via picocolors. kodo logs sigue con formatLine. format.js cubre los otros 3 surfaces. | ✓ |
| Extraer a módulo neutro src/cli/colors.js | Tercer módulo compartido. Más limpio pero toca logger.js. | |
| Mover formatLine a format.js | Migración total. Toca callsites del logger. Scope creep. | |

**User's choice:** Duplicar primitives en format.js → **D-05**.
**Notes:** Mínima superficie tocada en Phase 14, LOG-12 trivialmente preservado.

### Q2: SC#2 source-hygiene test — ¿dónde organizamos el guard?

| Option | Description | Selected |
|--------|-------------|----------|
| Reusar walker en check-isolation.test.js | Añade un it() ahí. Inicialmente seleccionado, luego redirigido por D-08. | ✓ (redirected by D-08) |
| Test independiente nuevo | Archivo separado, copia-paste del walker. Más LOC. | |
| Test genérico parametrizado | Walker recibe lista de entries. Premature. | |

**User's choice:** Reusar walker → **D-06**, pero **redirigido vía D-08 a `test/format-isolation.test.js`** (mismo archivo que el grep de picocolors). check-isolation.test.js queda con su guard original `check.js → logger.js`.

---

## Picocolors: solo interno o re-exportado

### Q1: ¿format.js es la ÚNICA superficie de color, o re-exporta picocolors?

| Option | Description | Selected |
|--------|-------------|----------|
| Solo interno — única surface | format.js NO re-exporta picocolors. Test grep falla si otro archivo lo importa. | ✓ |
| Solo interno + re-export con prefix | format.js exporta `pc` nominal. Compromiso intermedio. | |
| Re-exportado libre | Sin source-hygiene posible. Va contra el patrón del repo. | |

**User's choice:** Solo interno → **D-07**.
**Notes:** Coherente con D-09/D-10/D-11 source-hygiene pattern de Phase 13.

### Q2: ¿Dónde vive el test source-hygiene del grep contra picocolors?

| Option | Description | Selected |
|--------|-------------|----------|
| Archivo nuevo test/format-isolation.test.js | Cohesión por sujeto (format.js). Recoge también D-06 redirigido. | ✓ |
| Agregar a test/check-isolation.test.js | Mezcla LOG-12 (sujeto: vigilante) con single-source-of-color (sujeto: format.js). | |
| Re-asignar D-06 al mismo archivo nuevo | Equivalente al ✓ pero explícito sobre re-asignación. | |

**User's choice:** Archivo nuevo `test/format-isolation.test.js` → **D-08**.
**Notes:** D-06 se redirige aquí también — ambos guards de hygiene de format.js cohabitan en este archivo.

---

## Column formatter — shape API

### Q1: Shape del column formatter

| Option | Description | Selected |
|--------|-------------|----------|
| Dos APIs: formatRow + formatTable | formatRow streaming (kodo logs), formatTable batch (kodo check, gsd inspect). | ✓ |
| Solo formatRow | Caller orquesta tablas a mano. Más LOC en surfaces. | |
| Solo formatTable | Buffering siempre. Rompe DX-01 follow-mode tail. | |
| Ninguna API explícita — solo padCell/stripAnsi | Manual labor en cada surface. | |

**User's choice:** Dos APIs → **D-09**.

### Q2: ANSI-aware width — ¿cómo manejamos la cuenta de longitud cuando los cells tienen ANSI codes?

| Option | Description | Selected |
|--------|-------------|----------|
| Strip-aware width interno | format.js implementa `visibleWidth()` y la usa en `padCell` internamente. Caller no se entera. | ✓ |
| Caller responsibility | format.js no se ocupa. Fuga de abstracción a los 3 surfaces. | |
| Color-after-pad | formatRow recibe sin color, pad-aligna, segunda función colorea. Dos pasadas. | |

**User's choice:** Strip-aware width interno → **D-10**.

### Q3: Separator — ¿fijo o configurable?

| Option | Description | Selected |
|--------|-------------|----------|
| Default `' · '` configurable via opts | Match DX-02 literal pero `opts.separator` override per-surface. | ✓ |
| Hardcodeado `' · '` | Sin opción. Cambio en format.js si hace falta otro. | |
| Sin default — caller siempre pasa | Más explícito pero más ruidoso en cada callsite. | |

**User's choice:** Default `' · '` configurable → **D-11**.

---

## Claude's Discretion

- Estructura interna del módulo (un solo archivo o split si supera ~250 LoC).
- Implementación del resolver `useColor` (`createColors(bool)` de picocolors vs custom wrapper).
- Versión exacta de `picocolors` (sugerencia `^1.0.0`).
- Forma del walker en `test/format-isolation.test.js` (copy del existente o helper compartido en `test/helpers/`).
- Behavior con multi-byte / emoji / wide-chars CJK (default ASCII-puro).
- Default widths para `formatRow` cuando se cablea desde `kodo logs`.
- Naming exacto (`formatRow` vs `row`, `formatTable` vs `table`).

## Deferred Ideas

- Refactor de `logger.js` para consumir `format.js` (Phase 15.5+ o post-v0.5).
- `string-width` / `Intl.Segmenter` para wide-chars CJK.
- Themes / paletas configurables (Out of Scope en REQUIREMENTS.md).
- `fmt.bold` / `italic` / `underline` (si Phase 15 los pide).
- Wrapping de líneas largas (terminal lo hace).
- Snapshot tests por archivo.
