# Phase 67: Secrets Writer + Masked Input - Context

**Gathered:** 2026-07-02
**Status:** Ready for planning
**Mode:** `--auto` (decisiones auto-seleccionadas con la opción recomendada por research/PITFALLS; revisar antes de planificar)

<domain>
## Phase Boundary

Cerrar la mitad **secreta** del onboarding (Pilar 2a): el operador introduce la API key del provider en un **campo enmascarado** (`•` por carácter) que se persiste a `~/.kodo/.env` con permisos `0600` vía un **único writer** `writeEnvVar`, y ese valor **NUNCA** cruza a `config.json` / `/status` / logs / argv ni se renderiza de vuelta. Se aísla del setup mode (Phase 68) **a propósito**: el writer y el boundary de fuga se testean solos antes de que el valor toque cualquier path de render.

**En alcance (SETUP-03, SETUP-04):**
- `writeEnvVar(key, value)` — writer único de secretos: atómico + `chmod 0600` **pre-rename** + **parse-merge-write** que no clobbea otras keys del `.env`.
- Campo enmascarado en el dashboard extendiendo el text-input editable de Phase 63 (render-only: `•` por char).
- **Grep test de higiene de fuente** — verifica que el valor no alcanza los 5 vectores de fuga (argv/console/logger/config.json/snapshot TUI).
- Indicador `[configurado]` (prueba de presencia, sin revelar valor) + aviso de reiniciar el daemon tras cambiar la key.

**Fuera de alcance:**
- Setup mode / first-run / edición de provider-base_url-workspace / CFGF-03 → **Phase 68**.
- `saveConfig`/`saveProjects` (no-secretos, ya existen de Phase 63) — solo se **añade** `writeEnvVar` como 3er escritor.
- Hot-reload de la key (CFGF-01) → v2. Aquí solo se avisa de reiniciar.
- Gestión de secretos genérica (múltiples keys arbitrarias, vault, rotación) → futuro.
- Toggle "reveal" del valor tecleado → ver Deferred (tensiona con PERSIST-04).

</domain>

<decisions>
## Implementation Decisions

> Auto-seleccionadas en modo `--auto` con la opción recomendada por `SUMMARY.md`/`ARCHITECTURE.md`/`PITFALLS.md`. Marcadas `[auto]`.

### Writer de secretos `writeEnvVar` (SETUP-03)
- **D-01 `[auto]`:** `writeEnvVar(key, value)` vive en **`src/config.js`** como 3er escritor único junto a `saveConfig`/`saveProjects` (SETUP-05 nombra los tres como la única fontanería; research ARCHITECTURE lo ubica ahí). Se exporta desde `config.js`.
- **D-02 `[auto]` (Pitfall 13 — LOAD-BEARING):** **NO** reusa `writeFileAtomic` (config.js:99-103) — ese helper hace `writeFileSync(tmp)`+`renameSync` **sin `chmod`**, dejando el `.env` a umask (0644, world-readable) y un `.env.tmp` 0644 con el secreto en claro. `writeEnvVar` implementa su **propia** secuencia, espejo directo de `writePidFile` (polling-daemon.js:94-101): `writeFileSync(tmp)` → **`chmodSync(tmp, 0o600)` PRE-rename** → `renameSync(tmp, ENV_PATH)`. El fichero final es 0600 el instante en que aparece. `ensureDir()`/`mkdirSync` del `~/.kodo` a 0700 (discreción del planner el modo exacto del dir).

### Merge del `.env` (SETUP-03, Pitfall 14)
- **D-03 `[auto]`:** **parse-merge-write**, nunca full-rewrite de una sola key. Lee el `.env` existente con el mismo formato del parser `loadEnvFile` (config.js:12-28: `KEY=VALUE`, primer `=`, skip líneas vacías/`#`), hace **upsert** de la key objetivo (reemplaza in-place si existe, append si no) y **preserva verbatim** el resto de líneas (`GITHUB_TOKEN`, `PLANE_API_KEY`, webhook secrets — nunca se clobbean). Si no existe `.env`, lo crea con solo esa key.
- **D-04 `[auto]`:** Formato de salida **sin comillas** (coherente con el parser naive que hace `trim` del valor). El parser NO soporta round-trip de valores con `#` inicial, espacios extremos o `=` embebido — el planner decide entre (a) restringir/validar esos caracteres en el input o (b) un escaping mínimo; recomendado **validar y rechazar** (simplicidad, las API keys reales no los usan).

### Campo enmascarado (SETUP-03, extiende Phase 63)
- **D-05 `[auto]`:** Extiende el text-input **controlado** `buffer`/`cursor` de Phase 63 (inline en `App.js`, props pasadas a `SessionTable` en App.js:1607-1608). Añade un flag de render `mask` → pinta `•` por carácter. El `buffer` mantiene el **valor real en memoria**; el render **deriva** la máscara — el valor nunca se pinta raw. **NO** se usa `ink-password-input`/`ink-text-input` (research "Lo que NO se usa"). El save sale por una DI prop `onSaveApiKey` → `writeEnvVar` (nunca inline).
- **D-06 `[auto]` (Pitfall 11/16):** El valor **NO** entra en el `overlaySnapshot` congelado del overlay (el snapshot es la ruta de fuga a scrollback / cross-overlay). El buffer del secreto se limpia al salir del campo.
- **D-07 `[auto]` (Pitfall 16):** El campo raw-mode reusa el gate `useStdin().isRawModeSupported` ya presente en `App.js` (belt-and-suspenders). En non-TTY (attach de `kodo up` vía wrapper, pipe) degrada con aviso a `kodo config` — **never-throws**, no cuelga el first-run.

### Boundary de fuga — grep de higiene (SETUP-03, PERSIST-04)
- **D-08 `[auto]` (Pitfall 11, UAT crítico):** Test **source-level** (molde del source-hygiene test anti-inline ya existente en la suite, p.ej. el blindaje `report_to_provider` de config.js) que verifica estáticamente que el valor del key NUNCA alcanza los **5 sinks**: (1) argv de `execFile`/`spawn`, (2) `console.*`, (3) `logger.*`/NDJSON, (4) `saveConfig`/`config.json`, (5) el snapshot del overlay TUI. Escritura **en-proceso**, jamás vía shell-out (`execFile kodo config --api-key SECRET` — el vector de mayor riesgo dado el hábito shell-out de v0.13/v0.14). Complementado por el UAT runtime: `ps` / grep de `~/.kodo/logs` / `/status` tras la entrada.

### Indicador "configurado" + aviso reinicio (SETUP-04)
- **D-09 `[auto]`:** Prueba de **presencia**: la key del provider activo existe en `.env` con valor no-vacío → render literal `[configurado]`, **NUNCA** el valor. El planner decide si el check re-lee `.env` o consulta el `process.env[api_key_env]` ya cacheado por `loadEnvFile` (discreción). Tras cambiar la key, aviso honesto tipo "reinicia el daemon para aplicar" (sin hot-reload — coherente con el patrón de aviso de reinicio de v0.14).

### Claude's Discretion
- Escaping vs validación-restrictiva de valores con caracteres especiales (D-04) — recomendado validar+rechazar.
- Presence-check: re-leer `.env` vs consultar `process.env` cacheado (D-09).
- Ubicación del grep test (fichero nuevo en `test/` vs extender el source-hygiene existente).
- Modo exacto del `~/.kodo` dir (0700) y si `writeEnvVar` lo fuerza en cada write.
- Nombre exacto de la key a escribir: se deriva de `config.providers[activo].api_key_env` (p.ej. `PLANE_API_KEY`, `GITHUB_TOKEN`), no hardcodeado.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requisito y trazabilidad
- `.planning/ROADMAP.md` — Phase 67 (Goal, 3 Success Criteria, SETUP-03/04, Research/UAT note: omitir research-phase, UAT = grep de higiene, evita Pitfalls 11/13/14/16).
- `.planning/REQUIREMENTS.md` §SETUP-03/04/05 + Out of Scope (round-trip del valor viola PERSIST-04; `saveConfig`/`saveProjects`/`writeEnvVar` únicos escritores).

### Research del milestone (cubre esta fase — leer)
- `.planning/research/SUMMARY.md` — vector de riesgo #2 (el key nunca cruza a config.json/status/logs); `writeEnvVar` en `config.js` (tmp+rename+chmod 0600, parse-merge-write); masked input extiende Phase 63 con `onSaveApiKey` DI; "Lo que NO se usa": ink-text-input/ink-password-input, secretos en argv.
- `.planning/research/PITFALLS.md` — **P11** (5 vectores de fuga del key), **P13** (`writeFileAtomic` NO hace chmod → usar el patrón chmod-pre-rename de polling-daemon.js), **P14** (formato del parser + merge sin clobber), **P16** (raw-mode/TTY en el attach de `kodo up`). Incluye "Looks Done But Isn't" checklist para `.env` write y secret entry.
- `.planning/research/ARCHITECTURE.md` — `writeEnvVar` como único sink de secretos en `config.js`; el masked field en `src/cli/dashboard/`.

### Activos de código a reusar (verificados en scout 2026-07-02)
- `src/cli/polling-daemon.js:94-101` — `writePidFile`: el **molde exacto** del atomic+`chmodSync(tmp, 0o600)` pre-rename que `writeEnvVar` debe espejar.
- `src/config.js:12-28` — `loadEnvFile` (parser `KEY=VALUE` a espejar para el parse-merge); `:99-103` `writeFileAtomic` (**NO usar para el `.env`** — sin chmod); `:167/184` `saveConfig`/`saveProjects` (los otros dos escritores); `:195` `getProviderApiKey` (presence check); `:9` `ENV_PATH`; `:263` export barrel.
- `src/cli/dashboard/App.js` — text-input controlado Phase 63: `buffer` :489, `cursor` :490, modo `config-edit` :477, gate `useStdin().isRawModeSupported`/`useInput` :54/:675, props buffer/cursor a SessionTable :1607-1608.
- `src/cli/dashboard/SessionTable.js` — consumidor del render del text-input (punto de inserción del flag `mask`).

### Convenciones
- `.planning/codebase/CONVENTIONS.md`, `ARCHITECTURE.md` — never-throws TUI, DI puro, "una fontanería, varios consumidores", source-hygiene tests (blindaje anti-inline).

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `writePidFile` (`polling-daemon.js:94-101`): patrón atomic + chmod 0600 pre-rename — `writeEnvVar` es su espejo directo para el `.env`.
- `loadEnvFile` (`config.js:12-28`): formato/parser del `.env` a reusar en el parse-merge-write.
- Text-input `buffer`/`cursor` de Phase 63 (`App.js`): base del campo enmascarado; solo se añade el flag de render `mask`.
- `getProviderApiKey` (`config.js:195`): base del presence-check para `[configurado]`.
- Source-hygiene test existente (blindaje anti-inline de `config.js`): molde del grep de higiene de D-08.

### Established Patterns
- Atomic write intra-fs (tmp+rename, `.tmp` en el mismo dir — nunca `os.tmpdir()`, Pitfall EXDEV) + chmod pre-rename para ficheros sensibles.
- DI puro para el save (`onSaveApiKey` prop) — coherente con Phase 63/64.
- never-throws/fail-open en la TUI; gate raw-mode `isRawModeSupported` como belt-and-suspenders.
- `KODO_DIR` cacheado al import (fuga de aislamiento conocida, obs. 21811/22683) — los tests inyectan `HOME` o el path como parámetro.

### Integration Points
- `writeEnvVar` nuevo (aditivo) en `src/config.js`.
- Campo enmascarado nuevo en `src/cli/dashboard/App.js` + render en `SessionTable.js`.
- `onSaveApiKey` DI prop → `writeEnvVar` (nunca shell-out).
- Presence check consumido por el render del indicador `[configurado]`.

</code_context>

<specifics>
## Specific Ideas

- El pitfall load-bearing es **P13**: la reutilización "obvia" de `writeFileAtomic` es la trampa — filtra el secreto a 0644. El writer DEBE seguir el molde de `writePidFile`, no el de `saveConfig`.
- El vector de fuga de mayor riesgo (P11) es el **argv de subprocess**: dado el hábito shell-out de v0.13/v0.14, la tentación es `execFile('kodo', ['config','--api-key', SECRET])` — prohibido para secretos; escritura en-proceso siempre.
- Aislar writer+boundary de la UI de setup (Phase 68) es deliberado: permite testear el grep de higiene y el `writeEnvVar` antes de que el valor toque ningún render (Pilar 2a antes de 2b).
- El UAT crítico es post-implementación: `ls -l ~/.kodo/.env` = `-rw-------` sin `.env.tmp` residual, editar la key preserva `GITHUB_TOKEN`, y el valor no aparece en `ps`/logs/`/status`.

</specifics>

<deferred>
## Deferred Ideas

- **Setup mode / first-run / CFGF-03 (provider/base_url/workspace) + `kodo config` rewired** → Phase 68 (dependencia directa: consume `writeEnvVar` + masked input de esta fase).
- **Toggle "reveal"** del valor tecleado — research lo menciona, pero tensiona con PERSIST-04/P11 (abre vector scrollback). Recomendado **NO** implementarlo en v0.15; los SC solo exigen enmascarado. Si se quiere, su propia mini-decisión en Phase 68.
- **Soporte paste** en el campo enmascarado — research lo menciona como nice-to-have; discreción del planner si entra aquí o se difiere (el SC no lo exige).
- **Hot-reload de la key** (CFGF-01) → v2; aquí solo aviso de reinicio.
- **Gestión de secretos genérica** (vault, rotación, múltiples keys arbitrarias) → futuro.

None adicional — la discusión (auto-resuelta) se mantuvo dentro del scope de la fase.

</deferred>

---

*Phase: 67-secrets-writer-masked-input*
*Context gathered: 2026-07-02*
