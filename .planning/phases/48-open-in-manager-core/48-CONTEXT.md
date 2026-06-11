# Phase 48: Open-in-manager core - Context

**Gathered:** 2026-06-11
**Status:** Ready for planning

<domain>
## Phase Boundary

El operador pulsa la tecla `o` sobre una fila del dashboard y abre la tarea
(Plane/GitHub) en el navegador del sistema, vía `open` con `child_process.execFile`
fire-and-forget, sin salir de la TUI ni desmontar el panel ink. Lee la `task_url` ya
persistida en la fila (cero endpoints nuevos). Incluye el fix del bug latente de URL de
Plane en deploys partidos (web/API separados). Ships incondicionalmente — independiente
del spike de live-progress (Phases 49-50).

**Fuera de scope** (de REQUIREMENTS / Out of Scope del milestone): picker multi-URL,
apertura cross-platform (`xdg-open`/`start`), web view embebida, `pbcopy` fallback,
endpoint nuevo en `server.js`, lectura del schema on-disk de `~/.claude/tasks/`.

</domain>

<decisions>
## Implementation Decisions

### Feedback de éxito
- **D-01:** Al lanzar `open` con éxito (`{ok:true}`), el footer muestra una
  **confirmación transitoria** — la TUI no cambia visualmente, así que la confirmación
  señala que la tecla hizo algo. No silencio (diverge de `focus.js`, que es silencioso
  al hacer focus, porque ahí el cambio de workspace en cmux ES visible).
- **D-02:** Wording y color: **`opening PROJ-123…`** usando el `task_ref` de la fila
  (mismo identificador que ya muestra el resto del dashboard), color **verde/neutro**
  vía `setFooterColor` (espejo de `DISMISS_OK`, que usa verde con el ref). **Sin** el
  prefijo `[!]` — ese prefijo se reserva para errores (`FOCUS_ERR_*`).
- **D-03:** La confirmación se limpia con el mecanismo **clear-on-any-input** ya
  existente (no timer dedicado).

### Disponibilidad por estado de fila
- **D-04:** `o` funciona sobre **toda fila que tenga `task_url`**, sin importar el estado
  de sesión (`alive`/zombie/dismissed). La `task_url` es independiente del estado de la
  sesión: la tarea sigue existiendo en el gestor aunque el workspace esté muerto, y
  abrirla para revisar/cerrar es legítimo. **Diverge deliberadamente de Enter**, que sí
  se guarda con `alive===false` (no tiene sentido enfocar un workspace muerto en cmux).
- **D-05:** El **único guard** es "sin URL": fila sin `task_url` (SessionRecords legacy
  previos al campo, o `task_url` falsy) → no-op con footer `no task URL for this session`
  (wording locked por Success Criteria #2). Nunca se invoca `open` con argumento
  falsy/garbage.

### Link muerto / split-deploy (OPEN-04)
- **D-06:** **`plane.web_url` es el ÚNICO mecanismo** para resolver web-URLs vivas en
  deploys partidos. Config opcional `providers.plane.web_url` con **default a `base_url`**.
  En deploy partido (web/API en hosts distintos) es **responsabilidad del operador**
  configurar `web_url`. Sin heurísticas de "detección de host API" (frágiles, falsos
  positivos, contradicen "CLI ligera sin magia"). El deploy unificado actual
  (`base_url = https://tasks.kintsugi-lab.com`) funciona sin config nueva.
- **D-07:** El bug concreto: `normalize.js:76` construye la browse-URL desde
  `context.baseUrl` (el host de API, que `client.js:24` luego concatena con `/api/v1`).
  En split-deploy ese host produce un link web muerto. El fix enruta la construcción de
  la browse-URL por `web_url` (default `base_url`), **no** por el host de API.
- **D-08:** Caso `UNKNOWN-<seq>` (identificador sin resolver) → tratado como **"sin URL"**
  (footer, no abre), **no** como link muerto (Success Criteria #5, locked). *Dónde* se
  detecta (normalize-time: no emitir `url`; vs launch-time: `open.js` reconoce el prefijo
  `UNKNOWN-`) lo decide el planner.

### Decididos por Claude (no re-preguntados — siguen patrón locked)
- **Taxonomía de mensajes de error:** espejo de `focus.js` (`{ok:false, code, detail}` →
  mensajes literal-estables formato `[!] … — press any key`). El no-url
  (`no task URL for this session`) está locked; los demás (protocolo rechazado /
  open falló / binario ausente) los define el planner siguiendo el patrón `FOCUS_ERR_*`.
- **Hint de footer:** añadir `o` a la línea de hints de teclas existente.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements del milestone
- `.planning/REQUIREMENTS.md` §"Open in Manager (OPEN)" — OPEN-01..04, driver, decisión
  URL-como-campo-estático vs método `getTaskUrl`, contrato `TaskProvider` FROZEN en 9.
- `.planning/ROADMAP.md` §"Phase 48" — Goal + 5 Success Criteria (panel montado, no-op
  legacy, never-throws, allowlist protocolo, split-deploy/UNKNOWN).

### Research (verificó el round-trip ya construido)
- `.planning/research/SUMMARY.md` — síntesis del research del milestone.
- `.planning/research/ARCHITECTURE.md` — round-trip de la URL ya construido.
- `.planning/research/PITFALLS.md` — landmines de la apertura del navegador / execFile.

### Patrón a clonar (load-bearing)
- `src/cli/dashboard/focus.js` — TEMPLATE de `open.js`: never-throws `{ok, code, detail}`,
  DI del binario (sin default → leak guard estructural; aquí default `'open'`), args
  literales fijos, timeout corto, color-isolation (importa solo de `node:*`/internos puros).
- `src/cli/dashboard/App.js:407-577` — handlers de teclas (`q`/`/`/`c`/`l`/`p`/`d`/Enter),
  formato de footer `[!] … — press any key`, `setFooterColor`, clear-on-any-input,
  `DISMISS_OK` (verde+ref) como referencia del mensaje de éxito.

### Bug de URL de Plane (OPEN-04)
- `src/providers/plane/normalize.js:76` — construcción de la browse-URL desde
  `context.baseUrl` (el bug).
- `src/providers/plane/client.js:8,24` — `base_url` + `/api/v1` (host de API).
- `src/config.js:33-36,84-93` — schema de config Plane (`providers.plane.*`) y migración
  v1→v2; dónde añadir `web_url`.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- `src/cli/dashboard/focus.js`: clon directo → `src/cli/dashboard/open.js`. Mismo
  discriminante never-throws, misma DI del binario inyectable (default `'open'`), misma
  cobertura automática de color-isolation por `test/format-isolation.test.js` (escanea
  `src/cli/dashboard/**`).
- `App.js` footer + `setFooterColor` + clear-on-any-input: reusar para la confirmación
  `opening PROJ-123…` (verde) y los mensajes de error.
- `task_url` ya persistida en el `SessionRecord` (`manager.js:48`) y expuesta por fila en
  `GET /status` — el handler de `o` la lee directo, sin fetch nuevo.

### Established Patterns
- never-throws `{ok}` end-to-end (Phase 35 D-07 / Phase 37 D-01): ningún throw llega a
  React; todo modo de fallo colapsa al discriminante.
- Args literales pasados a `execFile` (nunca string de shell) — base de la mitigación
  de inyección de flags vía URL (OPEN-03).
- Invariante v0.10: la TUI lee datos ya persistidos (fila/filesystem), nunca un endpoint
  nuevo.
- Color-isolation cross-milestone (Phase 34 D-12): módulos bajo `src/cli/dashboard/**`
  importan solo `node:*` o internos puros; cero `picocolors`/`format.js`.

### Integration Points
- Nuevo `src/cli/dashboard/open.js` (lógica pura del launcher) ← invocado desde el nuevo
  handler `if (input === 'o')` en `App.js` (modo lista), inyectando `execFile` + binario
  resuelto de `loadConfig()`.
- `normalize.js` ← lee `web_url` (default `base_url`) del context para la browse-URL.
- `config.js` ← schema + migración v1→v2 para `providers.plane.web_url`.

</code_context>

<specifics>
## Specific Ideas

- Mensaje de éxito modelado sobre `DISMISS_OK(ref)` (verde + ref), sin el prefijo `[!]`.
- Allowlist de protocolo restringe a `http(s)` — rechaza `file://`, `javascript:`, y
  URLs con `-` inicial (inyección de flags hacia `open`). La URL siempre se pasa como
  argumento literal posicional.

</specifics>

<deferred>
## Deferred Ideas

None — la discusión se mantuvo dentro del scope de la fase. Las capacidades adyacentes
(picker multi-URL, `xdg-open`/`start` cross-platform, web view embebida, `pbcopy`
fallback) ya están listadas como Out of Scope en `REQUIREMENTS.md` y no se reabrieron.

</deferred>

---

*Phase: 48-open-in-manager-core*
*Context gathered: 2026-06-11*
