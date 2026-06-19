# Phase 59: Liveness de sesiones adoptadas - Context

**Gathered:** 2026-06-19 (RETROACTIVO)
**Status:** Implementado y mergeado a `main` — formalizado a posteriori
**Mode:** Auto-generado retroactivamente. El código ya estaba mergeado vía gap-fix cuando se escribió este CONTEXT; documenta el boundary y la decisión real tomada, no una intención previa.

<domain>
## Phase Boundary

Una sesión ad-hoc **adoptada** (viva en cmux) debe reflejarse **viva** (`running`/`idle`/`needs-input`) en el dashboard, no `dead`/`zombie`, y dejar de re-ofrecerse en el picker de adopción.

**Origen:** UAT de Phase 56 (`56-HUMAN-UAT.md` §"Cross-cutting gap — LIVENESS"). Raíz: `reconcile.liveForSession` identifica la entrada viva del host por `titleIdentifiesSession(workspace.title, task_ref)` — defensa anti-reciclaje de `workspace_ref` (Phase 43). Las sesiones lanzadas por kodo tienen el workspace auto-nombrado con el `task_ref`; una sesión **adoptada** vive en un workspace titulado por cmux/usuario que nunca contiene el `task_ref` recién creado → marcada `dead` → archivada a history → `computeAdoptable` la re-ofrece.

</domain>

<decisions>
## Implementation Decisions

### LOCKED — enfoque RENAME (no cambio de identidad en reconcile)
Tras `kodo adopt` crear la tarea, **renombrar el workspace cmux** a `"<task_ref>: <título>"`. El `:` tras el ref satisface el límite de palabra de `titleIdentifiesSession`, de modo que el check EXISTENTE pasa en el próximo tick — **sin tocar `reconcile.js`**. Es el mismo mecanismo por el que las sesiones lanzadas por kodo están vivas (cmux nombra su workspace con el ref).

- **Por qué RENAME y no identidad estable (`session_id`/`checkpoint_id`):** UNA llamada cmux en adopt-time, cero coste por-tick, `reconcile.js` intacto. El criterio original del ROADMAP (#1) proponía identificar por identidad estable con fallback a título; el approach mergeado lo logra por el lado más barato (hacer que el título cumpla el contrato existente) en vez de extender `reconcile`/`WorkspaceInfo`. Resultado funcionalmente equivalente para el caso de uso, menor blast radius.
- **Dónde vive el rename:** en `runAdoptCli` (consumidor CLI), NO en `adoptSession` (`src/adopt.js`, que sigue host-agnóstico) ni en `reconcile`/hooks. **Regla transversal LOCKED:** lo cmux-específico solo via `src/host/` (`getHost`).
- **Fail-open absoluto:** cmux caído / sin host / host non-cmux / método ausente / rename error NUNCA falla el adopt ni cambia `exitCodeFor(result)`. Una tarea adoptada-pero-mostrada-dead es estrictamente mejor que un adopt fallido.
- **Rename SKIPPED** cuando `task.ref` falta/vacío y en resultados non-ok (ALREADY_ADOPTED / INVALID_INPUT / CREATE_FAILED).

### Corrección posterior (commit dfd9e71)
El verbo canónico de cmux 0.64.16 es `cmux workspace rename <ws> --title <t>`, **no** `workspace-action --action set-title` (esa acción no existe → "Unknown workspace action"). `src/cmux/client.js:rename` usa la forma canónica.

</decisions>

<code_context>
## Existing Code Insights

- `reconcile.liveForSession` / `titleIdentifiesSession` (`src/session/reconcile.js`) — contrato existente que el rename satisface sin modificarlo.
- `cmux/client.js:rename` (ya existía, línea ~69) — solo faltaba exponerlo en el contrato del host.
- Contrato `WorkspaceHost` (Phase 38): `getHost`, `_legacy`.

</code_context>

<specifics>
## Specific Ideas

- Side-effect post-discriminante con fail-open absoluto (espejo de los wrappers `setColor`/`send` del host).
- `renameWorkspaceFn` DI inyectable en `runAdoptCli`; default lazy-importa `getHost('cmux')._legacy.rename` con guard `typeof`.

</specifics>

<deferred>
## Deferred Ideas

- **Backfill retroactivo** de sesiones adoptadas YA muertas (adoptadas antes de este fix): el reconcile no retroactiva un workspace cuyo título nunca llevó el ref. Acción del operador: re-adoptar o renombrar el workspace manualmente. No se automatiza en esta fase (limitación conocida documentada en el SUMMARY).

</deferred>
</content>
