---
phase: 35-datos-cliente-http-polling
plan: 04
subsystem: cli-dashboard
tags: [tui, dashboard, config, hardening, wr-01, d-10]
requires:
  - "DEFAULT_CONFIG export (src/config.js:228)"
  - "runDashboard + deps inyectables (src/cli/dashboard/index.js, Phase 34)"
provides:
  - "resolveBaseUrl({ url, loadConfig, defaultConfig }) — helper puro exportado"
  - "Resolución de baseUrl con guard WR-01 (cfg.server?.port ?? DEFAULT_CONFIG.server.port)"
affects:
  - "src/cli/dashboard/index.js (runDashboard)"
tech-stack:
  added: []
  patterns:
    - "Helper puro exportado + DI de loadConfig (vía a, hermético sin TTY/ink)"
    - "Optional chaining + fallback a default conocido para config v1 migrado"
key-files:
  created:
    - "test/dashboard-baseurl.test.js"
  modified:
    - "src/cli/dashboard/index.js"
decisions:
  - "Vía (a) testabilidad: extraer resolveBaseUrl puro en vez de inyectar loadConfig en runDashboard (vía b) — más simple, no arranca ink"
  - "DEFAULT_CONFIG importado eager (no destructurado en el lazy import como sugería el plan) — el helper puro lo necesita en module scope; config.js no carga ink/picocolors, color-isolation intacta"
metrics:
  duration: ~6min
  completed: 2026-05-27
  tasks: 2
  files: 2
requirements: [TUI-06]
---

# Phase 35 Plan 04: Guard WR-01 del baseUrl del dashboard — Summary

Cierra el advisory WR-01 / D-10 de `34-REVIEW.md`: `runDashboard` ahora resuelve el baseUrl con optional chaining + fallback al default conocido 9090 vía el helper puro exportado `resolveBaseUrl`, eliminando el TypeError que disparaba un config v1 migrado (sin la clave `server`).

## Qué se construyó

- **`resolveBaseUrl({ url, loadConfig, defaultConfig = DEFAULT_CONFIG })`** (`src/cli/dashboard/index.js`): helper puro y exportado que resuelve el baseUrl del dashboard. Lógica: `const port = cfg.server?.port ?? defaultConfig.server.port; return url ?? \`http://localhost:${port}\``. El optional chaining `cfg.server?.port` evita el TypeError cuando `migrateConfig` (src/config.js:82-102) reconstruyó un config v1 SIN la clave `server`; el fallback usa `DEFAULT_CONFIG.server.port` (9090).
- **`runDashboard`** ahora invoca `resolveBaseUrl({ url, loadConfig })` en lugar del acceso sin guardia `loadConfig().server.port`. Se preserva el lazy import de `loadConfig` (no carga config en el arranque del CLI), el guard non-TTY, el render de ink y todo el lifecycle (SIGTERM/exit).
- **`test/dashboard-baseurl.test.js`** (NUEVO, `node:test` + `node:assert/strict`): 3 escenarios herméticos con `loadConfig` fake — v1-migrado (sin `server`) → 9090 sin TypeError, config normal (`server.port: 7777`) → 7777, override `--url` → prioridad. Sin server real, sin TTY, sin arrancar ink.

## TDD (RED → GREEN)

- **RED** (`0275f90`): test importa `resolveBaseUrl` aún no exportado → suite falla al cargar. ROJO confirmado.
- **GREEN** (`3ec1c6e`): extraído el helper + cableado en `runDashboard` → 4/4 verde (baseurl + non-tty), 8/8 verde (format-isolation).
- **REFACTOR:** no necesario (código limpio).

## Verificación

| Comando | Resultado |
|---------|-----------|
| `node --test test/dashboard-baseurl.test.js` | 3/3 pass (v1-migrado→9090, normal→7777, override) |
| `node --test test/dashboard-non-tty.test.js` | 1/1 pass (guard non-TTY de Phase 34 intacto) |
| `node --test test/format-isolation.test.js` | 8/8 pass (color-isolation intacta, cero picocolors en dashboard) |

Grep-asserts del plan (Task 2): `server?.port` presente, `DEFAULT_CONFIG.server.port` presente, `import { DEFAULT_CONFIG }` presente, `loadConfig().server.port` sin guardia == 0, `url ??` preservado, picocolors == 0.

## Desviaciones del Plan

### Ajustes (Rule 3 — compatibilidad de la vía elegida)

**1. [Rule 3 - Ajuste] DEFAULT_CONFIG importado eager en module scope en vez de destructurado en el lazy import**
- **Encontrado durante:** Task 2
- **Contexto:** El plan (acceptance criterion + fix pattern §192-204 de PATTERNS) sugería `const { loadConfig, DEFAULT_CONFIG } = await import('../../config.js')` dentro de `runDashboard`. Pero la vía (a) que fijó Task 1 (helper puro exportado `resolveBaseUrl` con `defaultConfig = DEFAULT_CONFIG` como default param) requiere `DEFAULT_CONFIG` accesible en module scope sin `await import` — el test importa el helper directamente y no inyecta `defaultConfig`.
- **Decisión:** Importar `DEFAULT_CONFIG` eager (`import { DEFAULT_CONFIG } from '../../config.js'` en module scope). `loadConfig` (que sí hace I/O de disco) se mantiene lazy dentro de `runDashboard`.
- **Por qué es seguro:** `DEFAULT_CONFIG` es una constante estática; `src/config.js` solo depende de `node:fs/path/os` (verificado: 0 picocolors, 0 ink) → no rompe color-isolation ni encarece el arranque del CLI. La intención del plan (fallback a 9090, sin tocar config.js, color-isolation intacta) se preserva íntegra.
- **Archivos:** `src/cli/dashboard/index.js`
- **Commit:** `3ec1c6e`

## Threat Model

T-35-08 (DoS / crash de arranque por config v1 migrado) — **mitigado**: cubierto por el test "v1-migrado→9090". Sin superficie de threat nueva introducida.

## Self-Check: PASSED
- `src/cli/dashboard/index.js` — FOUND (modificado, exporta resolveBaseUrl + runDashboard)
- `test/dashboard-baseurl.test.js` — FOUND (NUEVO)
- Commit `0275f90` (RED test) — FOUND
- Commit `3ec1c6e` (GREEN fix) — FOUND
