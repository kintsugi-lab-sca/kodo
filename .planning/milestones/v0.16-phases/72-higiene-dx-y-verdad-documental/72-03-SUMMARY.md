---
phase: 72-higiene-dx-y-verdad-documental
plan: 03
subsystem: infra
tags: [labels, gsd-verification, roadmap-parser, plane-client, hooks-install, provider-registry, hardening]

# Dependency graph
requires:
  - phase: 70-concurrencia-y-ciclo-de-vida-de-procesos
    provides: config v2 (providers.plane.*) migración atómica
provides:
  - "Label kodo:opus resuelve como modelo (no cae a flags)"
  - "Gate must_haves de verificación con comparación !== (99/3 se rechaza)"
  - "Parser YAML de VERIFICATION.md tolera comentarios # inline"
  - "Descubrimiento de VERIFICATION.md desacoplado del zero-pad de 2 dígitos"
  - "Parser de header de ROADMAP acepta guion ASCII, en-dash y em-dash"
  - "Cliente Plane lee config.providers.plane.* (schema v2)"
  - "Regex de identificador Plane acepta dígito interno en el prefijo (K2-42)"
  - "isNameConflict409 estrechado a 'already exists'"
  - "Match de install/uninstall de hooks por ruta canónica /src/hooks/<name>.js"
  - "Factory GitHub con guard + mensaje canónico ante config ausente"
affects: [73-debounce-nudge-orchestrator, milestone-audit-v0.16]

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Micro-diff quirúrgico (1-5 líneas) + test por hallazgo (Pattern 1)"
    - "HOME temporal en test para ejercer loadConfig del schema v2 sin tocar el config real"

key-files:
  created: []
  modified:
    - src/labels.js
    - src/gsd/verification.js
    - src/gsd/verify.js
    - src/gsd/roadmap.js
    - src/providers/plane/client.js
    - src/hooks/install.js
    - src/providers/registry.js
    - test/labels.test.js
    - test/gsd-verification.test.js
    - test/gsd-roadmap.test.js
    - test/plane-provider.test.js
    - test/hooks/install.test.js
    - test/registry.test.js

key-decisions:
  - "B12b (throttle epoch-vs-delta) DIFERIDO: el formato de x-ratelimit-reset en Plane self-hosted no es confirmable barato (Open Question #2 / D-02) — adivinar introduciría una regresión de comportamiento"
  - "El nombre del fichero VERIFICATION.md se deriva del pad real del directorio encontrado (dirPrefix), no de un pad asumido — robusto para 9- y 09-"
  - "Match de hooks por segmento de ruta /src/hooks/<name>.js (soporta separador POSIX y Windows), no ruta absoluta completa — robusto ante install global vs local"

patterns-established:
  - "Guard + mensaje canónico grep-friendly en factories que consumen sub-objetos de config opcionales"

requirements-completed: [HYG-06]

coverage:
  - id: D1
    description: "Label kodo:opus resuelve model='opus' (no flags)"
    requirement: HYG-06
    verification:
      - kind: unit
        ref: "test/labels.test.js#parseKodoLabels — B1 opus model"
        status: pass
    human_judgment: false
  - id: D2
    description: "Gate must_haves usa !== (verified=99, total=3 → must-haves-incomplete)"
    requirement: HYG-06
    verification:
      - kind: unit
        ref: "test/gsd-verification.test.js#computeVerdict — B3 must_haves gate usa !=="
        status: pass
    human_judgment: false
  - id: D3
    description: "Parser YAML de VERIFICATION.md tolera comentario # inline"
    requirement: HYG-06
    verification:
      - kind: unit
        ref: "test/gsd-verification.test.js#parseVerificationFrontmatter — B12a comentario # inline"
        status: pass
    human_judgment: false
  - id: D4
    description: "Descubrimiento de VERIFICATION.md casa fases sin pad-2 (9- y 09-)"
    requirement: HYG-06
    verification:
      - kind: unit
        ref: "test/gsd-verification.test.js#runGsdVerify — B4 descubrimiento sin pad-2 fijo"
        status: pass
    human_judgment: false
  - id: D5
    description: "Parser de ROADMAP acepta en-dash/em-dash como separador"
    requirement: HYG-06
    verification:
      - kind: unit
        ref: "test/gsd-roadmap.test.js#parseRoadmap — M12 separador en-dash/em-dash"
        status: pass
    human_judgment: false
  - id: D6
    description: "Cliente Plane lee config.providers.plane.* (schema v2)"
    requirement: HYG-06
    verification:
      - kind: unit
        ref: "test/plane-provider.test.js#PlaneClient — B2 config.providers.plane.*"
        status: pass
    human_judgment: false
  - id: D7
    description: "resolveIdentifier('K2-42') resuelve (dígito interno en el prefijo)"
    requirement: HYG-06
    verification:
      - kind: unit
        ref: "test/plane-provider.test.js#PlaneClient.resolveIdentifier — B8 dígito interno"
        status: pass
    human_judgment: false
  - id: D8
    description: "isNameConflict409 estrechado: un 409 con labels/ sin 'already exists' se re-lanza"
    requirement: HYG-06
    verification:
      - kind: unit
        ref: "test/plane-provider.test.js#PlaneClient.createLabel — B12c predicado 409 estrecho"
        status: pass
    human_judgment: false
  - id: D9
    description: "install/uninstall de hooks matchea por ruta canónica, no substring 'kodo'"
    requirement: HYG-06
    verification:
      - kind: unit
        ref: "test/hooks/install.test.js#Test 6 (B9) / Test 6b (B9)"
        status: pass
    human_judgment: false
  - id: D10
    description: "Factory GitHub sin providers.github lanza mensaje canónico (no TypeError)"
    requirement: HYG-06
    verification:
      - kind: unit
        ref: "test/registry.test.js#getProvider('github') sin providers.github lanza el mensaje canónico"
        status: pass
    human_judgment: false

# Metrics
duration: 35min
completed: 2026-07-13
status: complete
---

# Phase 72 Plan 03: Batch de BAJAS mecánicas HYG-06 Summary

**10 micro-diffs quirúrgicos (1-5 líneas) cerrando deuda mecánica dispersa por labels, GSD, cliente Plane, hooks y registry — con un test por hallazgo; B12b diferido con nota por formato de header no confirmable.**

## Performance

- **Duration:** ~35 min
- **Completed:** 2026-07-13
- **Tasks:** 3
- **Files modified:** 13 (7 fuente + 6 test)

## Accomplishments

- **B1** `src/labels.js`: `opus` añadido a la whitelist de modelos — `kodo:opus` resuelve `model='opus'` en vez de caer a `flags` (latente-activo: `default_model` ya es `'opus'`).
- **B3** `src/gsd/verification.js`: el gate de must_haves usa `!==` — un `verified > total` inconsistente (99/3) ahora se rechaza (reason `must-haves-incomplete`) en vez de colarse como pass.
- **B12a** `src/gsd/verification.js`: el parser YAML del frontmatter tolera comentarios `#` inline (whitespace-precedido o comment-only), preservando `#` literales pegados al valor.
- **B4** `src/gsd/verify.js`: el descubrimiento de `VERIFICATION.md` casa fases con o sin zero-pad (`9-` y `09-`); el nombre del fichero se deriva del pad real del directorio.
- **M12** `src/gsd/roadmap.js`: la regex de header acepta guion ASCII, en-dash `–` y em-dash `—` como separador.
- **B2** `src/providers/plane/client.js`: el cliente lee `config.providers.plane.*` (schema v2) — tras la migración v1→v2 el bloque legacy top-level es `undefined`.
- **B8** `src/providers/plane/client.js`: la regex de identificador acepta dígito interno en el prefijo (`K2-42`).
- **B12c** `src/providers/plane/client.js`: `isNameConflict409` estrechado a `already exists` — no traga cualquier 409 con `labels/` en el path.
- **B9** `src/hooks/install.js`: install/uninstall matchean por el segmento de ruta `/src/hooks/<name>.js`, no por el substring genérico `'kodo'`.
- **B12d** `src/providers/registry.js`: guard + mensaje canónico en el factory GitHub ante `providers.github` ausente (evita `TypeError` críptico).

## Task Commits

Cada task se commiteó atómicamente:

1. **Task 1: B1 + B3/B12a + B4 + M12 (labels/verification/verify/roadmap)** - `afa171a` (fix)
2. **Task 2: B2 + B8 + B12c (cliente Plane)** - `cfdea89` (fix)
3. **Task 3: B9 (install) + B12d (registry)** - `1e1fa3f` (fix)

## Files Created/Modified

- `src/labels.js` - whitelist de modelo con `opus`
- `src/gsd/verification.js` - gate `!==` + strip de `#` inline
- `src/gsd/verify.js` - descubrimiento desacoplado del pad-2
- `src/gsd/roadmap.js` - regex de header con `[-–—]`
- `src/providers/plane/client.js` - `config.providers.plane.*`, regex de identificador, 409 estrecho
- `src/hooks/install.js` - `isKodoHookCommand` (match por ruta canónica)
- `src/providers/registry.js` - guard + mensaje canónico del factory GitHub
- `test/labels.test.js`, `test/gsd-verification.test.js`, `test/gsd-roadmap.test.js`, `test/plane-provider.test.js`, `test/hooks/install.test.js`, `test/registry.test.js` - tests por hallazgo

## Decisions Made

- **B12b (throttle epoch-vs-delta) DIFERIDO (D-02 / Open Question #2):** el throttle (`client.js:37`) asume que `x-ratelimit-reset` es epoch-segundos. Plane self-hosted podría devolver un delta, pero el formato **no es confirmable barato** (Open Question #4 del audit, sin responder; el RESEARCH lo marca como candidato a diferir). Un heurístico epoch-vs-delta introduciría un cambio de comportamiento basado en una suposición no verificada. Se difiere con nota en vez de adivinar.
- **B4 — pad real del directorio:** el nombre del `VERIFICATION.md` se deriva de `match.slice(0, match.indexOf('-'))` (el pad tal cual está en disco), no de un pad asumido — un solo cambio cubre `9-`, `09-` y `02.1-`.
- **B9 — segmento de ruta, no ruta absoluta:** el match usa `/src/hooks/<name>.js` (POSIX y Windows), robusto ante install global vs local; no exige la ruta absoluta completa.

## Deviations from Plan

None - plan executed exactly as written. B12b se difirió conforme al mecanismo D-02 previsto en el propio plan (no es una desviación, es una rama contemplada).

## Deferred Items

| Item | Motivo | Referencia |
|------|--------|------------|
| **B12b** — throttle epoch-vs-delta (`src/providers/plane/client.js:37`, `:57-59`) | El formato de `x-ratelimit-reset` en Plane self-hosted (epoch vs delta) no es confirmable barato; adivinar introduciría una espera basura ante un header ambiguo. | 72-RESEARCH.md Open Question #2, PLAN D-02, threat T-72-09 |

## Issues Encountered

- El primer intento de B12a no cubría el caso comment-only (`status: # x`), donde el `#` inicia el valor sin whitespace previo en el grupo capturado (el regex ya consumió el espacio post-`:`). Corregido añadiendo una rama `value.startsWith('#') → ''` antes del strip por `\s#`. Test verde.

## Threat Surface

Los 3 threats mitigables del threat_model quedan cubiertos por código + test:
- **T-72-08** (Tampering, `isNameConflict409` amplio) → B12c estrechado (D8).
- **T-72-10** (Tampering, match por substring en install) → B9 por ruta canónica (D9).
- **T-72-11** (DoS, factory github sin config) → B12d guard + mensaje canónico (D10).
- **T-72-09** (DoS, throttle epoch-vs-delta) → mitigación DIFERIDA con nota (B12b), disposición `mitigate` no satisfecha en este plan por decisión D-02.

## Next Phase Readiness

- Suite completa verde: **2007 pass + 1 skip, 0 fail** (cero deps nuevas).
- Phase 73 (debounce del nudge del orchestrator) depende de Phase 72; este plan no toca el trigger del orchestrator.
- B12b queda como deuda acotada para una futura sesión cuando se confirme empíricamente el formato del header de rate-limit de Plane.

## Self-Check: PASSED

- 7/7 ficheros fuente y el SUMMARY.md presentes en disco.
- 3/3 commits de task (`afa171a`, `cfdea89`, `1e1fa3f`) presentes en el historial.

---
*Phase: 72-higiene-dx-y-verdad-documental*
*Completed: 2026-07-13*
