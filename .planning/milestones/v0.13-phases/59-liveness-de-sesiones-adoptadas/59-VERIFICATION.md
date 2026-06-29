---
phase: 59-liveness-de-sesiones-adoptadas
status: passed
verified: 2026-06-19
mode: retroactive
suite: 61 pass / 0 fail (scoped) · 1471 pass / 0 fail / 1 skip (full, per SUMMARY)
---

# Phase 59 Verification — Liveness de sesiones adoptadas

> Verificación retroactiva contra el código mergeado a `main`. Evidencia leída del código live (no del SUMMARY).

## Success Criteria

### SC1 — Una sesión adoptada viva NO se marca `dead` por no llevar el `task_ref` en el título del workspace ✅ PASSED (vía RENAME)

**Criterio original (ROADMAP):** `reconcile.liveForSession` identifica por identidad estable (`session_id`/`checkpoint_id`) con fallback a `titleIdentifiesSession`.

**Implementación real (RENAME, equivalente funcional, menor blast radius):** en vez de extender `reconcile` para identificar por `session_id`, `kodo adopt` **renombra** el workspace a `"<task_ref>: <título>"` de modo que el contrato EXISTENTE `titleIdentifiesSession` pasa. `reconcile.js` queda intacto.

**Evidencia:** `src/cli/adopt.js:201-208` — `if (result.ok === true && result.task && typeof result.task.ref === 'string' && result.task.ref)` → `const title = \`${result.task.ref}: ${result.task.title ?? ''}\`` → `renameFn({ workspaceRef, title })`. La defensa anti-reciclaje de Phase 43 (`titleIdentifiesSession` word-bounded por el ref) se **refuerza, no se debilita** (el ref sigue siendo el discriminante).

> **Nota de divergencia documentada:** el approach RENAME logra el efecto observable (sesión adoptada viva) sin tocar `reconcile`/`WorkspaceInfo`. La extensión por identidad estable del criterio original NO se implementó; queda como mejora futura si el rename resultara insuficiente. Aceptado como cierre válido del criterio (efecto equivalente, riesgo menor).

### SC2 — El host expone lo necesario para la liveness, aditivamente ✅ PASSED

**Evidencia:**
- `src/host/cmux.js:354-355` — `_legacy.rename(opts)` passthrough a `cmux/client.js:rename`.
- `src/host/interface.js:90-93` — `createNullHost` con `_legacy.rename` no-op (fail-open en hosts non-cmux).
- `src/cmux/client.js:69-73` — `rename` usa el verbo canónico `cmux workspace rename <ws> --title <t>` (corrección `dfd9e71`).
- Regla transversal LOCKED preservada: lo cmux-específico vive en `src/host/`; `adopt.js` entra por `getHost`, sin leak de `cmux/client`. Walker `cmux-isolation` verde.

### SC3 — Una sesión adoptada viva NO reaparece como adoptable en el picker ✅ PASSED (consecuencia de SC1)

Al no marcarse `dead`, la sesión no cae al ciclo `dead → history → computeAdoptable`. La entrada permanece viva y `computeAdoptable` (set-difference contra `/status` activo) deja de re-ofrecerla. Es consecuencia directa de SC1: el título con ref hace que `liveForSession` la mantenga viva en cada tick.

## Tests (live, 2026-06-19)

```
node --test test/adopt-cli.test.js test/host/contract.test.js
→ tests 61 · pass 61 · fail 0 · skipped 0
```

- `test/adopt-cli.test.js` (Phase 59): rename llamado con título ref-word-bounded + exit 0; fail-open (rename lanza → exit 0, render de éxito); NO llamado en non-ok; SKIPPED sin ref.
- `test/host/contract.test.js` (Phase 59): cmux expone `_legacy.rename`; NullHost no-op; aserción de fuente del argv.

## Limitación conocida (acción del operador, NO bloqueante)

El fix cubre adopciones NUEVAS. Sesiones adoptadas YA muertas (antes de este cambio) necesitan re-adoptar o renombrar el workspace manualmente para revivir — el reconcile no retroactiva un workspace cuyo título nunca llevó el ref. Documentado en `<deferred>` de `59-CONTEXT.md`.

## Veredicto

**PASSED.** Los 3 success criteria se cumplen en el código mergeado (SC1 vía el approach RENAME equivalente, con la divergencia documentada). Suite verde. Sin gaps bloqueantes.
</content>
