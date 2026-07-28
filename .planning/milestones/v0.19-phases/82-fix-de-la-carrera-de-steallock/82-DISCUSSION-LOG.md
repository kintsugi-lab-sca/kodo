# Phase 82: Fix de la carrera de `stealLock` - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-24
**Phase:** 82-fix-de-la-carrera-de-steallock
**Mode:** `--auto` — todas las áreas auto-seleccionadas; en cada pregunta se eligió la opción recomendada sin AskUserQuestion.
**Areas discussed:** Estrategia del fix, Robustez ante crash mid-steal, Validación del test (LOCK-02), Cierre documental y contrato (LOCK-03)

---

## Estrategia del fix (mecanismo que cierra la ventana)

| Option | Description | Selected |
|--------|-------------|----------|
| Reemplazo in-place atómico + steal-guard | Tmp único + `rename` overwrite (lockPath jamás ausente); exclusión entre stealers vía guard `O_EXCL`; re-check ABA dentro del guard. Dirección 1+3 del diagnóstico combinadas | ✓ |
| Verificación post-adquisición | Re-read + confirmar ownership tras «ganar». El diagnóstico la marca como TOCTOU residual — no elimina la ventana | |
| Lock por directorio (`mkdir`) | Atómico sin ventana, pero cambia el formato del artefacto → blast radius en readLock/release/doctor/tests | |

**Auto-selección:** Reemplazo in-place atómico + steal-guard (recommended default)
**Notes:** Constraint estructural LOCKED (D-01): la ventana se elimina por construcción, no por reducción probabilística. El planner puede variar el mecanismo solo si preserva D-01 y el contrato D-08.

---

## Robustez ante crash mid-steal (guard huérfano)

| Option | Description | Selected |
|--------|-------------|----------|
| Guard breakable por PID muerto o edad corta | Contenido mínimo (pid+timestamp); rotura si `isPidAlive` falso o edad > umbral de segundos; cleanup best-effort | ✓ |
| Guard solo-PID | No cubre PID reciclado/EPERM edge; sin backstop temporal | |
| Guard solo-TTL largo | Un crash bloquearía steals durante todo el TTL | |

**Auto-selección:** Guard breakable por PID muerto o edad corta (recommended default)

---

## Validación del test (LOCK-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Harness byte-idéntico + unit tests nuevos + loop de estrés como evidencia | CR-01 intacto (prueba del invariante); unit tests dirigidos del guard; ≥30 iteraciones bajo carga citadas en VERIFICATION | ✓ |
| Solo harness existente | Sin cobertura dirigida de los estados nuevos del guard | |
| Reforzar el harness (más N/iters) | Tocar el harness levanta sospecha de enmascarado; prohibido por el constraint DEBT-04 | |

**Auto-selección:** Harness byte-idéntico + unit tests nuevos + loop de estrés (recommended default)

---

## Cierre documental y contrato (LOCK-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Debug file → resolved/ + Deferred Items cerrado + docblock reescrito; API/formato intactos | Traza completa de la resolución; cero doc-drift; blast radius contenido en `stealLock` | ✓ |
| Solo actualizar STATE.md | Dejaría el debug file abierto y el docblock describiendo un CAS que ya no existe | |

**Auto-selección:** Cierre completo con API/formato intactos (recommended default)

---

## Claude's Discretion

Nombre del fichero guard, umbral de edad concreto (segundos), presupuesto de re-contención, estructura de helpers privados, N del loop de estrés.

## Deferred Ideas

- Flaky residual del harness `raceGsdChildren` (hold-expiry benigno) — issue de harness aparte si reaparece, jamás debilitar el assert.
- Rediseño mayor del modelo de locking (directorio-lock global) — fuera de alcance.
