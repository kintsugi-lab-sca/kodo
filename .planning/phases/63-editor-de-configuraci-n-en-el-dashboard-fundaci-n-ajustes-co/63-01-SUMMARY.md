---
phase: 63-editor-de-configuraci-n-en-el-dashboard-fundaci-n-ajustes-co
plan: 01
subsystem: config
tags: [validation, atomic-write, config, pure-functions]
requires: []
provides:
  - "src/config-validate.js: validadores puros + getEditableFields + getByPath/setByPath"
  - "src/config.js: writeFileAtomic (temp+rename) reusado por saveConfig/saveProjects"
affects:
  - "src/cli/dashboard/App.js (Plan 02 consumirá validateField/getEditableFields/getByPath/setByPath)"
  - "Phase 64 editor de proyectos (reusará writeFileAtomic)"
tech-stack:
  added: []
  patterns:
    - "Validador puro never-throws {ok,value}|{ok,error}"
    - "Escritura atómica temp+rename intra-filesystem (DI puro: path por parámetro)"
key-files:
  created:
    - src/config-validate.js
    - test/config-validate.test.js
    - test/config-atomic.test.js
  modified:
    - src/config.js
decisions:
  - "v1 acepta solo los 16 colores cmux nombrados, sin hex (D-07/A2)"
  - "validateModel set estricto {opus,sonnet,haiku}: un id completo claude-* se rechaza conscientemente (Pitfall 6/A2)"
  - "states.* editables solo para el provider activo (A3)"
  - "fsync omitido en v1: rename basta para crash-safety de proceso (A1)"
  - "writeFileAtomic exportado como helper interno (lo requiere el test config-atomic)"
metrics:
  duration_min: 4
  completed: 2026-06-29
  tasks: 2
  files: 4
status: complete
---

# Phase 63 Plan 01: Fundación del editor de configuración (validadores puros + escritura atómica) Summary

Validadores puros never-throws (`{ok,value}|{ok,error}`) para los 11 campos editables del dashboard, más escritura atómica temp+rename no-corruptiva reusada por `saveConfig`/`saveProjects` — toda la fundación determinista (0 tokens, sin red, sin TUI) verificada en aislamiento para que el editor UI (Plan 02) la consuma ya probada.

## What Was Built

- **`src/config-validate.js` (nuevo, puro `// @ts-check`, sin imports):**
  - `validatePositiveInt` (anti-ReDoS `/^\d+$/` sobre input recortado), `validateModel` (set `{opus,sonnet,haiku}`), `validateNonEmpty` (trim), `validateCmuxColor` (16 nombrados, case-sensitive).
  - `validateField(field, raw)` dispatcher por `field.kind`.
  - `getByPath`/`setByPath` dot-walk puros; `setByPath` muta el clon que recibe sin tocar `DEFAULT_CONFIG`.
  - `getEditableFields(config)`: registro de **exactamente 11** descriptores `{path,label,kind}` con los `states.*` resueltos contra el provider activo y NINGÚN campo de secreto (PERSIST-04/D-11).
  - Sets exportados `MODELS` y `CMUX_COLORS`.
- **`src/config.js` (modificado, quirúrgico):**
  - Helper interno `writeFileAtomic(path, data)` (temp+rename, `path` por parámetro DI, `.tmp` en el mismo dir → atómico intra-fs).
  - `saveConfig`/`saveProjects` refactorizados sobre el helper; `migrateConfigIfNeeded` y `loadConfig` intactos; formato `JSON.stringify(...,2)+'\n'` preservado.
  - `renameSync` añadido al import de `node:fs`; `writeFileAtomic` exportado (lo requiere el test).
- **Tests nuevos:** `test/config-validate.test.js` (44 casos), `test/config-atomic.test.js` (8 casos).

## How to Verify

```bash
node --test test/config-validate.test.js   # 44 pass
node --test test/config-atomic.test.js      # 8 pass
npm test                                     # 1594 pass, 0 fail (sin regresión)
```

## Key Decisions

- **Set estricto de modelos** `{opus,sonnet,haiku}` (D-07): documentado en el JSDoc que un id completo `claude-*` manual se rechaza (Pitfall 6/A2) — decisión v1 aceptada, no un bug.
- **Solo 16 colores cmux nombrados** (sin hex) en v1; cycle-through y hex diferidos a v2.
- **`states.*` solo del provider activo** (A3), path resuelto contra `config.provider`.
- **`fsync` omitido** (A1): `rename` solo basta para crash-safety de proceso.
- **`writeFileAtomic` exportado** como helper interno (marcado en JSDoc) porque el test de aislamiento lo ejercita con un `path` de tmpdir (DI puro) — evita la fuga de `KODO_DIR` cacheado al import (obs. 21811/22683).

## Deviations from Plan

None - el plan se ejecutó exactamente como estaba escrito. Ambas tareas siguieron el ciclo TDD RED→GREEN con commits separados.

## Threat Surface

Mitigaciones del `<threat_model>` aplicadas y verificadas por test:
- **T-63-01** (Tampering): un valor inválido devuelve `{ok:false}` y nunca alcanza `saveConfig` (validadores never-throws, pre-escritura).
- **T-63-02 / T-63-05 / T-63-06** (Tampering/DoS): `writeFileAtomic` deja el fichero previo intacto ante fallo de write (test (c)); `.tmp` en el mismo dir (anti-EXDEV, test (d)); validadores con `Set.has` + regex acotada (anti-ReDoS).
- **PERSIST-04** (Info Disclosure): `getEditableFields` excluye por construcción `api_key_env`/`base_url`/`workspace_slug`/`provider` — asertado en test.

Sin superficie de seguridad nueva fuera del threat model. Sin paquetes nuevos (package.json intacto).

## Self-Check: PASSED

- FOUND: src/config-validate.js
- FOUND: src/config.js
- FOUND: test/config-validate.test.js
- FOUND: test/config-atomic.test.js
- Commits verificados: 75798ea, e72a45a, 377b4fe, 4d7c5d9
- Pureza confirmada: `src/config-validate.js` sin imports de `node:fs`/ink/picocolors.
