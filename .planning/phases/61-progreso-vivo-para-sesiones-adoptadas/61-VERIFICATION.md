---
phase: 61-progreso-vivo-para-sesiones-adoptadas
status: passed
verified: 2026-06-24
suite: 1509 pass / 0 fail / 1 skip (full) · 8/8 isolation walkers
---

# Phase 61 Verification — Progreso vivo para sesiones adoptadas (PROG-04)

## must_haves (goal-backward)

### MH1 — Una sesión adoptada (sin worktree) con `<project_path>/.planning/STATE.md` muestra `N/M` ✅
**Evidencia:** `App.js` enrich — gate dinámico (D-1) + fallback de path (D-2). Test `test/dashboard/app-progress-adopted.test.js` caso 1: sesión SIN `gsd:true`, SIN worktree, con STATE.md en project_path → la columna muestra `3/7`. PASS.

### MH2 — Una sesión LANZADA (con worktree) sigue leyendo del worktree (no regresión) ✅
**Evidencia:** `App.js:base = existsSync(worktreeBase) ? worktreeBase : projectPath`. Test caso 2: worktree con `5/9` + project_path con `1/9` trampa → muestra `5/9`, NO `1/9`. PASS. Preserva Pitfall 1.

### MH3 — `readGsdProgress` y keep-last-good intactos ✅
**Evidencia:** solo se cambió el gate (L419) y la resolución de path (L433); el bloque 'ok'/'error'/'no-progress' + `lastGood.set/get` quedan idénticos. `test/dashboard/app-progress-keeplast.test.js` sigue PASS (47/47 en el batch dashboard).

### MH4 — Sin STATE.md GSD en el path → `—` ✅
**Evidencia:** Test caso 3: project sin `.planning` → `readGsdProgress` 'no-progress' → la columna no muestra `N/M`. PASS.

### MH5 — `adopt.js` setea `gsd:true` (+ `gsd_mode`) cuando el project_path es GSD ✅
**Evidencia:** `buildSessionFromAdoption` → `isGsdProject(projectPath)` (existsSync `.planning/PROJECT.md`|`STATE.md`, never-throws, DI). Tests en `test/adopt.test.js`: GSD project → `gsd:true`/`gsd_mode:'full'`; non-GSD → omitidos; `isGsdProject` cubre true/false/vacío/never-throws. `phase_id` NO se deriva (un adopt no mapea a fase del roadmap — documentado). PASS.

## Decisiones implementadas (61-CONTEXT.md)
- **D-1** gate dinámico: `App.js` lee el STATE.md del path resuelto sin depender del flag `gsd` (cubre adoptadas que se vuelven GSD después). Reemplaza el corte `if (row.gsd !== true)`.
- **D-2** fallback de path: worktree (lanzada) → project_path (adoptada). Never-throws (existsSync guard). Guard anti-traversal del session_id preservado.
- **D-3** `adopt.js` detección GSD → `gsd`/`gsd_mode` para columnas phase/mode.

## Invariantes preservados
- `cmux-isolation` ✅ (adopt.js solo fs read de `.planning/`, no cmux). `format-isolation` ✅ (App.js no leakea color). Walkers 8/8.
- `readGsdProgress`/keep-last-good/reconcile NO tocados. Carril determinista 0-token de adopt.js intacto (solo fs read añadido, sin LLM/provider).

## Tests
```
npm test → 1509 pass / 0 fail / 1 skip
node --test test/dashboard/app-progress-adopted.test.js → 3 pass
node --test test/adopt.test.js → incluye 3 casos GSD detection
walkers format/cmux-isolation → 8 pass
```

## Veredicto
**PASSED.** Los 5 must_haves verificados. PROG-04 entregado: sesiones adoptadas GSD muestran progreso vivo; lanzadas sin regresión; keep-last-good intacto.
</content>
