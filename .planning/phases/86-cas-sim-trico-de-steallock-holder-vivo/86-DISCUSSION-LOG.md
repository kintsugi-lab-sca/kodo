# Phase 86: CAS simétrico de `stealLock` — holder VIVO - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-08-05
**Phase:** 86-cas-sim-trico-de-steallock-holder-vivo
**Mode:** `--auto` — sin prompts interactivos; en cada área se seleccionó la opción recomendada. El operador puede revocar cualquiera editando `86-CONTEXT.md` antes de planificar.
**Areas discussed:** Forma del baseline de identidad · Semántica del abort · Superficie del `reason` · Determinismo del harness · Topología del harness · Registro de la mordida · Declaración de la ventana residual

---

## Forma del baseline de identidad

| Option | Description | Selected |
|--------|-------------|----------|
| Lectura única `{raw, content, ino}` desde la lectura de la sección crítica; comparación por **contenido crudo + ino** | Espejo del precedente `markCapture`, con la divergencia justificada: el lock se reemplaza entero (no solo crece), así que `size` admite falso negativo. ~200 bytes → releer es barato | ✓ |
| `size` + `ino`, calcado literal del inbox | Más barato en ficheros grandes, pero aquí abre un falso negativo real: dos locks JSON distintos del mismo tamaño | |
| Solo `ino` | Falla si el inodo se recicla; deja fuera el caso de reescritura sobre el mismo inodo | |

**Selección:** contenido crudo + `ino`, baseline tomado de la lectura ya existente (`lock.js:448`).
**Notas:** el orden se hereda del JSDoc del inbox (`store.js:662-665`): los bytes salen de **la lectura**, jamás de un `statSync` separado — si no, el guard queda ciego ante lo que debe detectar. `mtimeMs` fuera a propósito (redundante + `touch` → abortos espurios). → D-01..D-04.

---

## Semántica del abort al detectar cambio

| Option | Description | Selected |
|--------|-------------|----------|
| `continue` — re-contender en el bucle existente, con corte inmediato si el nuevo holder está vivo | El bucle ya distingue PRESENT/ABSENT y resuelve los 3 estados posibles. Espejo exacto de lo que la rama ABSENT hace con `EEXIST` | ✓ |
| `return { acquired:false, holder, reason }` inmediato | Más simple, pero trata «lock ausente» como fallo cuando la rama ABSENT lo resolvería adquiriendo legítimamente | |
| `throw` | Rompe el contrato never-throws del camino caliente | |

**Selección:** `continue`, con corte inmediato a `{acquired:false, holder, reason:'lock-replaced-mid-steal'}` si la re-lectura ve un holder vivo y fresco.
**Notas:** `MAX_STEAL_ATTEMPTS` **no se sube** — ampliarlo es exactamente el enmascaramiento que DEBT-04 prohíbe (LOCKED). El epílogo actual ya rechaza sin clobbear si se agota. → D-05..D-07.

---

## Superficie del `reason` discriminado

| Option | Description | Selected |
|--------|-------------|----------|
| Campo `reason?: string` opcional en la variante `{acquired:false}` | Aditivo; el único consumidor (`dispatcher.js:202`) solo lee `.holder` → cero cambios en dispatcher/orchestrator/polling/doctor | ✓ |
| Unión discriminada nueva con campo `outcome` | Contrato más expresivo, pero obliga a tocar consumidores → choca con el criterio 5 (camino caliente intacto) | |
| Solo `console.error`, sin campo en el resultado | No cumple «aborta con un `reason` discriminado» de forma programable | |

**Selección:** campo opcional + `console.error` con el prefijo `[kodo:lock]` ya establecido.
**Notas:** un **único** valor nuevo (`lock-replaced-mid-steal`); no se abre una taxonomía de reasons especulativa. → D-08, D-09.

---

## Determinismo del harness (cómo se reproduce el interleaving)

| Option | Description | Selected |
|--------|-------------|----------|
| Seam de inyección en producción, default no-op, solo en el primer intento | Precedente literal: `_afterReadFn` de `markCapture` (`store.js:698-703`). Determinista, sin sleeps, sin presupuestos de tiempo | ✓ |
| Sleeps + N iteraciones esperando que caiga la carrera | Probabilístico; y afinar el timing hasta que pase es el enmascaramiento que DEBT-04 prohíbe | |
| Mock de `node:fs` | Deja de probar el sistema real; la carrera es de syscalls | |

**Selección:** seam invocado dentro de la sección crítica, tras la lectura del baseline y antes de escribir el `tmp`.
**Notas:** entra por un **tercer parámetro opcional de deps** en `acquireGsdLock`, el patrón de DI del repo (`dispatcher.js:78`, `store.js:710`) — no env vars. Documentado en JSDoc **como seam de test**, no como característica. → D-10, D-11.

---

## Topología del harness

| Option | Description | Selected |
|--------|-------------|----------|
| Procesos reales, `kind` nuevo en `lock-race-child.mjs` con los 3 roles, extendiendo `gsd-lock-race.test.js` | LOCK-05 exige cardinalidad exacta con N≥2 procesos; con el stealer detenido en el seam el interleaving es determinista aun con procesos reales | ✓ |
| In-proc con el seam inyectado | Más simple y rápido, pero no demuestra cardinalidad cross-proceso, que es el texto literal del requirement | |
| Híbrido: cardinalidad cross-proceso + mordida in-proc | Duplica harness sin cubrir nada que la opción 1 no cubra | |

**Selección:** procesos reales; holder stale-pero-vivo sembrado por **TTL expirado con PID vivo** (Case-3, `lock.js:145-155`), nunca por `DEAD_PID`.
**Notas:** `DEAD_PID`/`writeStaleDeadLock` es **el sesgo que esta fase corrige**, no el patrón a copiar. El contrato de stdout del helper se respeta; cualquier señal extra va por canal lateral en fichero, como los kinds `polling`/`dispatch`/`capture`. Aserción sobre el agregado (`acquired === 1`), nunca sobre quién gana. → D-12..D-14.

---

## Registro de la mordida (LOCK-06)

| Option | Description | Selected |
|--------|-------------|----------|
| Reversión manual + evidencia citada (diff + salida roja) en el SUMMARY/VERIFICATION | Precedente de las Phases 82 y 83; coste cero de infraestructura | ✓ |
| Mutation testing automatizado | Infraestructura nueva → contradice «saneo puro, sin feature nueva» de v0.20 | |
| Script `npm run` que revierte y corre | Código que solo existe para el test, con riesgo de quedar desfasado del CAS real | |

**Selección:** manual con evidencia citada.
**Notas:** DEBT-04 (LOCKED) se aplica al pie de la letra: ningún assert se debilita, ningún timeout sube, ningún presupuesto se amplía. → D-15, D-16.

---

## Declaración de la ventana residual (LOCK-07)

| Option | Description | Selected |
|--------|-------------|----------|
| JSDoc de `stealLock` (sección propia) **+** entrada en `STATE.md`, con la clase de riesgo nombrada | Es el texto literal del requirement; redacción calcada del registro honesto de `store.js:678-683` | ✓ |
| Solo JSDoc | `STATE.md` es donde el operador mira el estado real de la deuda | |
| ADR nuevo | Documento nuevo para 2 párrafos; el repo no usa ADRs aquí | |

**Selección:** ambos sitios, con los cuatro elementos: qué es (2 syscalls contiguos), clase de riesgo (TOCTOU residual, misma clase que el guard del inbox de Phase 83), qué cambia de verdad (la magnitud, no la existencia), y la prohibición explícita de presentarla como cierre por construcción.
**Notas:** se decidió además **retirar el comentario falso** de `lock.js:455-457` («No fresh Case-1 creator can race here…»), que la carrera desmiente. Mismo criterio que la Phase 85 aplicó a `check-isolation.test.js` y que la Phase 87 aplicará a `format-isolation.test.js:14,33`. → D-17, D-18.

---

## Claude's Discretion

- Nombres concretos de identificadores (lector interno, campo del seam, `kind` del helper).
- Reparto en planes (uno o dos), con la restricción de que la mordida sea demostrable al final.

## Deferred Ideas

- **`LOCK-F1`** — rediseño del primitivo (serializar Case-1/`release` con el guard, cierre por construcción). Descartado por el mantenedor el 2026-08-02; va a v2 con trigger propio: que la ventana residual se manifieste en uso real.
- **Mutation testing automatizado** de guards. Trigger: que el registro manual de mordidas se vuelva la fricción dominante.
- **Helper compartido del patrón CAS** entre `store.js` y `lock.js`. Trigger: una **tercera** aparición del patrón — con dos, extraer acoplaría por parecido de forma, no por requisito.
