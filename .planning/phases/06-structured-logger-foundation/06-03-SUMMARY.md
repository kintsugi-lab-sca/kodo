---
phase: 06
plan: 03
subsystem: logging
tags: [logging, security, redaction, asvs-v7]
dependency_graph:
  requires:
    - "src/logger.js factory (Plan 06-02) — emit() pipeline already wired"
    - "test/logger-redaction.test.js + test/helpers/logger-fixtures.js (Plan 06-01)"
  provides:
    - "src/logger.js redact(): deep-walk redactor aplicado antes de disk + stderr"
    - "SENSITIVE_KEYS closed set + JWT_RE + BEARERY_RE patterns (privados al módulo)"
  affects:
    - "Cualquier consumidor futuro del logger queda protegido de leaks de PLANE_API_KEY, Authorization, x-plane-signature, JWT-like values, y `plane_*`/`Bearer *` tokens con key unknown"
tech_stack:
  added: []
  patterns: [deep-walk-redactor, closed-key-set, regex-fallback, prototype-pollution-defense]
key_files:
  created: []
  modified:
    - src/logger.js (175 → 259 LoC; +84)
decisions:
  - "Redactor top-level del módulo (no dentro del factory closure) — es pure, idempotente, facilita testing manual y no requiere capturar estado de la sesión"
  - "Una sola pasada de redact() en emit() — ambos sinks (disco + stderr mirror) reciben el record ya redactado, eliminando superficie de drift entre canales"
  - "Placeholder literal `[REDACTED]` (no hash, no longitud) — prohibido explícitamente en CONTEXT.md por facilitar side-channel attacks"
  - "Object.entries como iterador — omite `__proto__` enumerable por diseño, defensa natural contra prototype pollution (T-6-03-05)"
  - "Regex conservador: JWT_RE requiere 3 segmentos base64url ≥10 chars; BEARERY_RE requiere ≥20 chars tras `Bearer ` o `plane_`. Evita falsos positivos en UUIDs, git SHAs, refs cortos"
metrics:
  duration: 4min
  completed: 2026-04-16
---

# Phase 06 Plan 03: Secret Redaction (LOG-08) Summary

Redactor deep-walk con estrategia dual (key-set cerrado + regex JWT/Bearer) integrado en `emit()` antes de cualquier sink. Cierra ASVS V7.1.1 / V7.3.3 / V8.3.4 para el logger de kodo.

## What Was Built

### Redactor en `src/logger.js` (+84 LoC)

**Constantes privadas** (bloque `--- Redaction (LOG-08) ---`):
- `SENSITIVE_KEYS: Set<string>` — 9 keys en lowercase: `plane_api_key`, `authorization`, `x-api-key`, `x-plane-signature`, `password`, `token`, `secret`, `cookie`, `set-cookie`.
- `JWT_RE = /^eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}$/` — JWT con 3 segmentos base64url de ≥10 chars.
- `BEARERY_RE = /^(Bearer\s+|plane_)[A-Za-z0-9_\-]{20,}$/i` — captura tokens tipo Plane aunque la key sea desconocida.
- `REDACTED = '[REDACTED]'`, `REDACTED_DEPTH = '[REDACTED:depth-exceeded]'`, `MAX_DEPTH = 4`, `MAX_ARRAY_LEN = 100`.

**Función `redact(value, depth=0, keyHint='')`:**
- Top-level del módulo (no closure): pure, idempotente, no exportada.
- Depth > 4 → `[REDACTED:depth-exceeded]`.
- `null`/`undefined`/primitivos no-string pasan sin cambio.
- Strings: primero check `keyHint` contra `SENSITIVE_KEYS` (case-insensitive), luego regex JWT/Bearer.
- Arrays >100 items → slice(0,100) + sentinel `[REDACTED:truncated-<N>]`.
- Objetos: reconstruidos en `{}` plain vía `Object.entries` (omite `__proto__`), recursión con `depth+1`.

**Cableado en `emit()`:**
```javascript
const rawRecord = { timestamp, level, ...boundFields, msg, ...ctx };
const record = redact(rawRecord);
writeNdjson(record);
maybeMirrorToStderr(level, record);
```
Una sola pasada protege ambos sinks — mitiga T-6-03-08 (drift redactor/mirror).

## Verification

### Automated

| Suite | Command | Result |
|-------|---------|--------|
| LOG-08 redaction (3 tests) | `node --test test/logger-redaction.test.js` | PASS 3/3 |
| LOG-01..LOG-04 no-regression | `node --test test/logger.test.js` | PASS 8/8 |
| LOG-12 isolation | `node --test test/check-isolation.test.js` | PASS 3/3 |
| Full suite | `npm test` | PASS 138/138 |

**Grep de acceptance criteria** (todos match, en líneas 61/77/80/99/201 de `src/logger.js`):
- `SENSITIVE_KEYS = new Set(` → 1 match
- `JWT_RE = /^eyJ` → 1 match
- `BEARERY_RE =` → 1 match
- `function redact(` → 1 match (no exportado)
- `^export.*redact` → 0 matches (privado)
- `redact(rawRecord)` → 1 match (dentro de emit)

### Threat mitigations verificadas

| Threat ID | Mitigation | Evidence |
|-----------|------------|----------|
| T-6-03-01 | Key-set cerrado + test grep end-to-end | Test 1 asserta `raw.includes(secret) === false` sobre disco real |
| T-6-03-05 | Prototype pollution blocked por `Object.entries` + reconstrucción plain | Cubierto por design — `__proto__` no enumera |
| T-6-03-06 | DoS por profundidad → MAX_DEPTH=4 | Test 2 asserta sentinel `[REDACTED:depth-exceeded]` en depth 6 |
| T-6-03-07 | DoS por arrays gigantes → MAX_ARRAY_LEN=100 + sentinel | Cubierto por code path (no test explícito en 06-01) |
| T-6-03-08 | Drift disk/stderr → redact antes de ambos sinks | Test 3 captura `process.stderr.write` y verifica no-leak + `[REDACTED]` presente |

### Accepted trade-offs (de 06-03-PLAN threat_model)

- **T-6-03-02:** Falso positivo en JWTs legítimos — cost cosmético; explícitamente aceptado en CONTEXT.md.
- **T-6-03-03:** Secret embebido en string más largo (`"x=Bearer plane_xxx and y=z"`) — regex con anchors `^...$` no captura. Mitigación: convención de callsites + lint en Phase 7.
- **T-6-03-04:** Secret en `msg` (primer argumento) — regex sí se aplica (el campo `msg` del record pasa por el walk), pero si el secreto está embebido en frase natural, no se redacta. Convención documentada.

## Deviations from Plan

Ninguna. El código producido sigue literalmente el esqueleto del plan (action block de Task 3.1):

- Bloque 1 (constantes) insertado después de `BASE_RECORD_KEYS` (antes de `createLogger`), como indica el plan.
- Bloque 2 (función `redact`) colocada top-level (no dentro del factory) — recomendación explícita del plan por cohesión (pure function).
- Bloque 3 (wiring en `emit()`) — exactamente la sustitución `record` → `rawRecord` + `redact(rawRecord)` descrita.

No hubo necesidad de auto-fixes ni deviations. Los 3 tests RED pasaron a GREEN en el primer intento sin iterar el redactor.

## Known Stubs

Ninguno.

## Known FP del regex (exploración manual)

No se detectaron falsos positivos durante la ejecución de la full test suite (138/138 verdes). Campos de session state típicos:
- `session_id` (ej. `sess-abc`): no matchea `JWT_RE` (no empieza con `eyJ`) ni `BEARERY_RE` (no empieza con `Bearer `/`plane_`).
- `plane_task_id` (ej. `KL-42`): no matchea ningún regex, key no está en SENSITIVE_KEYS.
- `phase_id`, `component`, `workspace_ref`, `task_ref`: ninguno matchea.

Si Phase 7+ introduce payloads de Plane con campos opacos que comiencen en `eyJ` (unlikely — Plane usa UUIDs v4), añadir allow-list al redactor.

## Commits

| Hash | Type | Description |
|------|------|-------------|
| `4dde829` | feat | add deep-walk secret redactor with key-set + regex (LOG-08) |

## Self-Check: PASSED

Verificado:
- `src/logger.js` existe y compila (`node -c src/logger.js` implícito por npm test pass).
- Commit `4dde829` presente en `git log --oneline`.
- `node --test test/logger-redaction.test.js` → 3/3 PASS.
- `node --test test/logger.test.js test/check-isolation.test.js` → 11/11 PASS (no regresión LOG-01..LOG-04, LOG-12 isolation).
- `npm test` → 138/138 PASS (no regresión del resto del repo).
- `redact` no exportado (grep `^export.*redact` = 0 matches).
- Todos los grep de acceptance criteria en el plan → match esperado.
