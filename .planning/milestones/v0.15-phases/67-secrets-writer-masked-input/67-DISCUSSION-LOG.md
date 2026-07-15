# Phase 67: Secrets Writer + Masked Input - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-02
**Phase:** 67-secrets-writer-masked-input
**Mode:** `--auto` (todas las áreas auto-seleccionadas; opción recomendada por research/PITFALLS)
**Areas discussed:** Writer writeEnvVar, Merge del .env, Campo enmascarado, Grep de higiene, Indicador configurado

---

## Writer de secretos `writeEnvVar`

| Option | Description | Selected |
|--------|-------------|----------|
| Espejo de `writePidFile` (chmod 0600 pre-rename) en config.js | Atomic tmp → chmodSync(tmp,0600) → rename; fichero 0600 al aparecer | ✓ |
| Reusar `writeFileAtomic` de config.js | Un helper menos; pero NO hace chmod → secreto a 0644 + .env.tmp world-readable (Pitfall 13) | |
| Módulo nuevo dedicado a secretos | Separa concerns; pero rompe "saveConfig/saveProjects/writeEnvVar únicos escritores" (SETUP-05) | |

**Auto-selección:** Espejo de `writePidFile` en `src/config.js` (D-01/D-02).
**Notes:** P13 es load-bearing — `writeFileAtomic` es la trampa de reutilización obvia. `~/.kodo` a 0700.

---

## Merge del `.env`

| Option | Description | Selected |
|--------|-------------|----------|
| parse-merge-write (upsert de la key, resto verbatim) | Preserva GITHUB_TOKEN/PLANE_API_KEY/webhook secrets (Pitfall 14) | ✓ |
| Full-rewrite solo con la key editada | Trivial; pero clobbea el resto de secretos del operador | |

**Auto-selección:** parse-merge-write, formato sin comillas coherente con `loadEnvFile` (D-03/D-04).
**Notes:** El parser naive no round-trip-ea `#`/espacios/`=`; recomendado validar+rechazar esos caracteres.

---

## Campo enmascarado (extensión Phase 63)

| Option | Description | Selected |
|--------|-------------|----------|
| Extender text-input buffer/cursor de Phase 63 con flag `mask` | Render `•` derivado; buffer mantiene valor real; onSaveApiKey DI | ✓ |
| Adoptar `ink-password-input` / `ink-text-input` | Dependencia nueva; research lo descarta explícitamente | |

**Auto-selección:** Extender Phase 63 con flag de render `mask` (D-05/D-06/D-07).
**Notes:** Valor fuera del snapshot congelado (P11/16); TTY guard `isRawModeSupported` con degradación never-throws en el attach de `kodo up` (P16).

---

## Grep de higiene de fuente (5 vectores)

| Option | Description | Selected |
|--------|-------------|----------|
| Test source-level (molde source-hygiene existente), 5 sinks | argv/console/logger/config.json/snapshot TUI; escritura en-proceso | ✓ |
| Solo UAT manual runtime (ps/grep logs) | Menos código; pero sin blindaje estático contra regresiones | |

**Auto-selección:** Grep test source-level + UAT runtime complementario (D-08).
**Notes:** Vector de mayor riesgo = argv de shell-out (hábito v0.13/v0.14). Prohibido `execFile ... SECRET`.

---

## Indicador "configurado" + aviso reinicio

| Option | Description | Selected |
|--------|-------------|----------|
| Presence-check → `[configurado]`, nunca el valor + aviso reinicio | Prueba de presencia sobre `.env`/process.env (PERSIST-04) | ✓ |
| Mostrar valor parcial/enmascarado del persistido | Round-trip del valor → viola PERSIST-04 | |

**Auto-selección:** Presence-only + aviso de reinicio honesto sin hot-reload (D-09).

---

## Claude's Discretion
- Escaping vs validación-restrictiva de caracteres especiales en el valor.
- Presence-check: re-leer `.env` vs `process.env` cacheado.
- Ubicación del grep test (fichero nuevo vs extender el source-hygiene existente).
- Modo del `~/.kodo` dir (0700) y forzado en cada write.

## Deferred Ideas
- Setup mode / first-run / CFGF-03 / `kodo config` rewired → Phase 68.
- Toggle "reveal" del valor tecleado → NO en v0.15 (tensiona PERSIST-04/P11).
- Soporte paste en el campo → discreción/diferible.
- Hot-reload de la key (CFGF-01) → v2.
- Gestión de secretos genérica (vault, rotación) → futuro.
