# Requirements: kodo — v0.9 TUI sesiones en vivo

**Defined:** 2026-05-26
**Core Value:** Observabilidad ambient de las N sesiones kodo en vivo, desde la terminal donde el operador ya vive, consumiendo el contrato JSON existente del server sin añadir endpoints.

> **Stack decidido (Opción A):** subcomando `kodo dashboard` con `ink@^6.8.0` (mantiene `engines.node >=20`; `ink@7` exigiría Node 22) + `react@^19.2.0` + `ink-text-input@^6.0.0`, en `.js` plano con `React.createElement` (sin build step). Tabla hand-rolled (`ink-table` descartado: stale/CJS). HTTP vía `fetch` built-in (sin dep nueva). Detalle y fuentes en `.planning/research/SUMMARY.md`.

## v1 Requirements

Cada requirement mapea a una fase del roadmap. Grupos funcionales = orden de build sugerido por la investigación (Phase A→E, numeración real desde Phase 34 la asigna el roadmapper).

### Fundación — subcomando + ciclo de vida (Phase A)

- [x] **TUI-01**: El usuario lanza el panel en vivo con `kodo dashboard`
- [x] **TUI-02**: Si stdout no es un TTY (pipe/CI), el dashboard se niega a arrancar con mensaje claro y exit code ≠ 0 (no crash, no raw-mode error)
- [x] **TUI-03**: El usuario sale limpiamente con `q` (y Ctrl-C / SIGTERM): cursor, echo y scrollback de la terminal quedan intactos
- [x] **TUI-04**: El color del TUI proviene exclusivamente de ink (`<Text color>`); ningún archivo bajo `src/cli/dashboard/` importa `picocolors` — invariante de color-isolation preservada y verificada por test

### Datos — cliente HTTP + polling (Phase B)

- [x] **TUI-05**: El dashboard refresca las sesiones desde `GET /status` cada ~2s con un loop self-scheduling que nunca apila requests solapadas (poll lento no encola)
- [x] **TUI-06**: Si el server kodo no responde (al arrancar o a mitad de sesión), el dashboard muestra estado "server caído", conserva el último dato bueno (keep-last-good), reintenta con backoff y nunca crashea — incluyendo respuesta JSON corrupta

### Tabla viva — render + selección + filtros (Phase C)

- [x] **TUI-07**: El dashboard muestra una tabla de sesiones activas con columnas `task_ref · repo · phase/mode · status · age`
- [x] **TUI-08**: El usuario mueve el cursor con ↑/↓; la selección se rastrea por identidad `task_id` y sobrevive al refresh/reordenamiento de la lista (nunca apunta a la sesión equivocada cuando una fila desaparece)
- [x] **TUI-09**: Las filas se ordenan de forma estable por `started_at` (no saltan en cada poll)
- [x] **TUI-10**: Las filas se colorean por `status` + `alive`, incluyendo el caso zombie `running` + `!alive`
- [x] **TUI-11**: El header muestra indicador "live" + resumen de contadores por estado (p. ej. "3 running · 1 review"); la lista vacía muestra un estado claro "no active sessions"
- [x] **TUI-12**: El usuario filtra filas con `/` (substring) + prefijos `r:<repo>` y `s:<state>`, preservando la posición del cursor al filtrar

### Focus workspace en cmux (Phase D)

> **REVISED 2026-05-28** tras hallazgo C-01 de Phase 37 research: el verbo `cmux attach` no existe; el binario cmux es una app GUI controlada por socket. El verbo real es `cmux select-workspace --workspace <ref>` (fire-and-forget, sin handoff TTY). El alcance original (handoff TTY + UAT 4 escenarios) se reduce a una RPC simple.

- [x] **TUI-13**: El usuario pulsa `Enter` sobre la fila seleccionada con `alive===true`; kodo ejecuta `cmux select-workspace --workspace <row.workspace_ref>` (fire-and-forget, ~50ms vía `execFile`) y la app cmux cambia foco a ese workspace en su GUI. El dashboard sigue montado y polling continúa sin interrupción (cero unmount, cero re-render desde cero, cero alt-screen toggle).
- [x] **TUI-14**: La invocación está guardada: si `alive===false` el dashboard rechaza con footer-error y NO invoca `cmux`; si `cmux` no está en PATH (ENOENT) o `select-workspace` retorna exit code ≠ 0, el dashboard muestra el error en el footer y permanece montado — nunca rompe el panel.

### Paneles auxiliares — comentarios + logs (Phase E)

- [x] **TUI-15**: El usuario pulsa `c` sobre la fila seleccionada para ver los comentarios de la tarea (`GET /comments/<task_id>`, con mapping `task_ref`→`task_id`); `Esc` vuelve al mismo cursor
- [x] **TUI-16**: El usuario pulsa `l` sobre la fila seleccionada para ver las líneas de log coincidentes (grep best-effort por `task_ref`/`workspace_ref` sobre el buffer compartido de `GET /logs`, etiquetado honestamente como no-per-session); `Esc` vuelve al mismo cursor

## v2 Requirements

Reconocidas pero diferidas — no entran en el roadmap de v0.9.

### Navegación / vistas adicionales

- **TUI-F1**: Tab de pending tasks (el `/status` ya devuelve `pending[]`)
- **TUI-F2**: Toggle de ordenamiento interactivo (por edad / estado / repo)
- **TUI-F3**: Footer contextual por panel (hints distintos en table vs comments vs logs)

### Acciones de mutación

- **TUI-F4**: Dismissal de sesiones con `d` — requiere orphan-safety (matar proceso + worktree) y depende del candidato diferido `kodo gsd doctor`; no es un simple `DELETE /sessions/<id>`

## Out of Scope

Excluidos explícitamente para frenar scope creep.

| Feature | Razón |
|---------|-------|
| `DELETE /sessions/<id>` como acción del TUI | Es bookkeeping-only (`removeSession` no mata proceso ni toca cmux/worktree); llamarlo "olvidaría" una sesión viva → reintroduce la desincronización clase ROMAN-132. Pertenece a `kodo gsd doctor` |
| Endpoints nuevos en `src/server.js` | Constraint dura del milestone: la TUI es cliente read-only del contrato existente |
| Stream de logs real por sesión | El buffer `/logs` es un ring compartido de 200 líneas sin `session_id`; un stream per-session exigiría endpoints nuevos |
| Llamar a `cmux rpc workspace.list` desde la TUI | El server ya mergea estado cmux en `/status` (`alive`, `elapsed_min`) — la TUI no duplica esa llamada |
| ink@7 / bump de `engines.node` a 22 | Se fija `ink@6.8.0` para mantener el floor Node ≥20 del proyecto |
| JSX / paso de build (Babel/esbuild/tsx) | Rompe la invariante "no build step"; se usa `React.createElement` en `.js` plano |
| Soporte de ratón, temas, ficheros de config, LLM/AI assist | Con 3-10 filas no aporta; "lo más simple" en v1 |
| Columna `last-hook` (del seed original) | No existe ese campo en `SessionRecord`; derivarlo del log buffer es complejidad innecesaria → se usa `status` |

## Traceability

Mapeo requirement → fase. Los grupos A–E reflejan el orden de build de la investigación; el roadmapper asigna los números reales (continúan desde Phase 34) y rellena esta tabla.

| Requirement | Grupo (build order) | Phase | Status |
|-------------|---------------------|-------|--------|
| TUI-01 | A — Fundación | Phase 34 | Done |
| TUI-02 | A — Fundación | Phase 34 | Done |
| TUI-03 | A — Fundación | Phase 34 | Done |
| TUI-04 | A — Fundación | Phase 34 | Done |
| TUI-05 | B — Datos/polling | Phase 35 | Done |
| TUI-06 | B — Datos/polling | Phase 35 | Done |
| TUI-07 | C — Tabla/selección | Phase 36 | Done |
| TUI-08 | C — Tabla/selección | Phase 36 | Done |
| TUI-09 | C — Tabla/selección | Phase 36 | Done |
| TUI-10 | C — Tabla/selección | Phase 36 | Done |
| TUI-11 | C — Tabla/selección | Phase 36 | Done |
| TUI-12 | C — Tabla/selección | Phase 36 | Done |
| TUI-13 | D — Attach | Phase 37 | Done |
| TUI-14 | D — Attach | Phase 37 | Done |
| TUI-15 | E — Paneles aux | Phase 39 | Done |
| TUI-16 | E — Paneles aux | Phase 39 | Done |

**Coverage:**
- v1 requirements: 16 total
- Mapped to phases: 16 (Phases 34-39, build order A→E)
- Unmapped: 0 ✓ (100% coverage — cada TUI-* mapea a exactamente una fase)

---
*Requirements defined: 2026-05-26*
*Last updated: 2026-06-02 — reconciliado por Phase 39.1 (D-10): TUI-15/16 marcados [x] (39-VERIFICATION passed), columna Status de la traceability table coherente con las VERIFICATION/UAT passed (16/16 Done), TUI-15/16 reubicados a Phase 39 (coherente con el audit y el roadmap — los overlays son Phase 39, no 38).*
