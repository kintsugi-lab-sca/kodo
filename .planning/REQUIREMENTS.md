# Requirements: kodo — Milestone v0.16 Hardening

**Defined:** 2026-07-05
**Core Value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación.
**Input:** `.compound/AUDITORIA-ADVERSARIAL-2026-07-03.md` (9 ALTA re-verificados 2026-07-05) + `.compound/PROPUESTA-MEJORAS-AUDITORIA-2026-07-05.md`

## v0.16 Requirements

Requirements de este milestone. Cada uno mapea a fases del roadmap. Entre paréntesis, el hallazgo de la auditoría que cierra.

### Red y autenticación (Ola 1 — causa raíz T3)

- [x] **NET-01**: El server bindea a `127.0.0.1` por defecto; `config.server.bind` permite exponerlo explícitamente (A1)
- [x] **NET-02**: El carril no-webhook (`GET /status`, `/logs`, `/comments/:id`, `DELETE /sessions/:id`) exige `Authorization: Bearer <token>` — 401 sin token; el dashboard lee el token de config y lo envía; `/webhook` conserva HMAC y `/health` queda abierto (M2)
- [x] **NET-03**: `readBody` corta a 1 MB pre-auth → 413 (M1)
- [x] **NET-04**: Los errores 500 devuelven mensaje neutro al cliente; `err.message` solo al log (B10)
- [x] **NET-05**: `sessionId` validado con `/^[A-Za-z0-9_-]+$/` antes de tocar filesystem (B6)
- [x] **NET-06**: La topología multi-nodo está documentada — bind a IP tailscale + ACL para recibir el webhook de Plane desde otro nodo (decisión 2026-07-05)

### Concurrencia y ciclo de vida de procesos (Ola 2 — causas raíz T1, T2)

- [x] **CONC-01**: Los ~6 escritores de `state.json` pasan por `withStateLock(fn)` (lockfile `O_EXCL` + retry, re-lee→muta→guarda); el comentario falso "ÚNICO escritor" de `server.js:682` se corrige en el mismo commit (A2)
- [x] **CONC-02**: `acquireGsdLock` es atómico (`flag:'wx'`, `EEXIST` → tomado); `stealLock` vía tmp+rename (A3)
- [x] **CONC-03**: Una sesión zombi libera su slot de `max_parallel` — reconcile `state:'dead'` deriva `status:'idle'` o el gate filtra por `alive` (A4)
- [x] **CONC-04**: `teardown` solo borra `kodo.pid` si `payload.pid === process.pid`; el PID se escribe post-bind (A5)
- [x] **CONC-05**: Antes de SIGKILL se compara `started_at` del payload con el arranque real del proceso (`ps -o lstart=`); si no cuadra, se aborta (A6)
- [x] **CONC-06**: Dos `polling start` concurrentes no arrancan dos daemons — lock `O_EXCL` (M20)
- [x] **CONC-07**: `migrateConfigIfNeeded` escribe vía `writeFileAtomic` (M16)
- [x] **CONC-08**: El dedup de sesiones no-GSD es cross-proceso — lock por `task_id` (M17)
- [x] **CONC-09**: La ubicación real de los worktrees está verificada empíricamente (sesión GSD real) y documentada — cierra M13

### Fiabilidad de entrega y backstop (Ola 3 — causas raíz T4, T5)

- [x] **DELIV-01**: El cursor de polling solo incorpora el `updated_at` de un issue a `maxUpdatedAt` si su dispatch resolvió (`await` + timeout); un dispatch fallido se reintenta en el siguiente tick; el webhook sigue fire-and-forget (A7)
- [x] **DELIV-02**: El primer tick distingue "cache ausente" de "primer tick observado" — centinela (M10)
- [x] **DELIV-03**: `adopt` es idempotente — busca por `task_url` antes de `createTask` (M11)
- [x] **DELIV-04**: Si al `SessionEnd` la tarea sigue "In Progress" y la sesión terminó limpia, el hook transiciona a "In Review" y comenta "cierre automático" — backstop mecánico; la instrucción al LLM pasa a ser optimización, no única vía (T5; decisión de producto 2026-07-05)

### Higiene, DX y verdad documental (Ola 4)

- [x] **HYG-01**: El stop hook solo auto-commitea si `KODO_ORCHESTRATOR=1` (inyectada al lanzar el workspace orquestador) y con pathspec completo (`git commit -- .claude/skills/kodo-orchestrate/`) (A8)
- [x] **HYG-02**: El flag `kodo up --url` se elimina (decisión 2026-07-05: borrar, no cablear) (A9)
- [x] **HYG-03**: `startHealthLoop` se elimina y el README deja de prometerlo (decisión 2026-07-05: borrar, no cablear) (M18)
- [x] **HYG-04**: Coloreado de workspace, notify y nudge se mueven de `Stop` a `SessionEnd` (M19)
- [x] **HYG-05**: Batch de endurecimiento de config: rechazar `__proto__|constructor|prototype` (M3), chmod 0600 si hay `*_secret` (M5), `split` con `join` del resto (M14), B5, B7
- [x] **HYG-06**: Batch de BAJAS mecánicas: B1, B2, B3, B4, B8, B9, B12 + M12 (`[-–—]` en roadmap) — diffs de 1–5 líneas
- [ ] **HYG-07**: El dashboard hace strip de `\x1b` en contenido externo (comentarios) — M4, rebajada de prioridad tras Ola 1
- [ ] **HYG-08**: Pasada de README: stop hook real, `kodo status` vs `dashboard`, rutas `src/providers/…`, owner del repo, comandos indocumentados, y documentar `--dangerously-skip-permissions` en sesiones GSD

### Robustez del trigger del orchestrator (Phase 73 — hallazgo dogfooding 2026-07-07)

- [ ] **ORCH-01**: `launchOrchestrator()` en su rama «workspace ya existe» (`src/orchestrator/launch.js:141-149`) no re-envía el nudge más de una vez por ventana de debounce — N llamadas consecutivas dentro de la ventana → ≤1 `cmux.send` (probado con `cmux.send` espiado + reloj inyectable)
- [ ] **ORCH-02**: El refresh-nudge se suprime cuando el orchestrator está *waiting-for-input* / mid-turn (no interrumpir con nudges redundantes)
- [ ] **ORCH-03**: El refresh-nudge se suprime cuando las razones de `needsOrchestrator` (`src/check.js runCheck`) no cambiaron desde el último nudge; un cambio real (nueva tarea / sesión que muere) sí vuelve a nudgear. Persistencia de `last_nudge_at` + hash de reasons por workspace, sin endpoints nuevos
- [ ] **ORCH-04**: Se reconcilia el `\n` literal doble entre `launch.js:146` (`text: '…\\n'`) y `cmux/client.js:46` (que vuelve a añadir `'\\n'`) — el nudge submitea con un único salto correcto
- [ ] **ORCH-05**: La discrepancia entre el conteo `pending` de `check.js` (`3 pending, 5 slots`) y la vista del orchestrator en vivo («Cola vacía») queda investigada y corregida o documentada (filtrado de label/estado divergente entre `runCheck` y la skill)

### Plan vivo por-tarea — handoff continuo (Phase 74 — candidata v0.17, features)

_Feature, NO hardening. El artefacto ya existe (`~/.kodo/plans/<uuid>.md`) pero es fire-and-forget: se escribe solo al arranque. Hacerlo vivo cierra la continuidad entre sesiones de una misma tarea._

- [ ] **LIVE-01**: Al cerrar sesión, el hook appendea a `~/.kodo/plans/<uuid>.md` un bloque `## Handoff <fecha>` con `Hecho / Pendiente / NEXT:` (una sola línea el `NEXT`). El fichero deja de escribirse únicamente al arranque; se acumula por sesión con traza.
- [ ] **LIVE-02**: `state.json` guarda por tarea el puntero al plan + el `NEXT:` de una línea (resumen renderizable sin abrir el fichero). La escritura va bajo `withStateLock` (coordina con Phase 70; el hook de cierre es un escritor más).
- [ ] **LIVE-03**: El TUI/dashboard muestra el `NEXT:` en la lista de tareas y ofrece enlace/panel que abre el markdown completo del plan de esa tarea. Read-model: se renderiza, no se edita a mano.
- [ ] **LIVE-04**: Cuando existe un `NEXT:` de handoff, el nudge del orchestrator lo usa como contexto en lugar del genérico «Revisa el estado actual…» (interoperación con ORCH-01..03 / Phase 73).

### Inbox de capturas global (Phase 75 — candidata v0.17, features)

_Feature, NO hardening. Buffer de captura rápida de ideas tangenciales mid-session (tip de config, idea de comando, cambio de sentido) que NO dan para una tarea de Plane. Global, propio de kodo, con destino obligatorio (un buffer sin drenaje es un cementerio)._

- [ ] **CAPT-01**: `kodo capture "<texto>"` (CLI) appendea una línea a `~/.kodo/inbox.md` (global, append-only) con `texto · tag-proyecto · fecha · origen (tarea/sesión)`. La escritura es atómica/con lock (varias sesiones capturan en paralelo).
- [ ] **CAPT-02**: Skill `/kodo-capture` para captura mid-session desde dentro de Claude Code — mismo formato y misma escritura, derivando proyecto/tarea del contexto de la sesión activa.
- [ ] **CAPT-03**: `kodo inbox` lista las capturas abiertas y enruta cada una → tarea Plane / fase roadmap / config aplicada / descartada. Las capturas se marcan con estado (`abierta`/`enrutada`/`descartada`), no se borran — queda traza de qué se convirtió en qué.
- [ ] **CAPT-04**: El enrutado a destino delega en `gsd-capture` (no reimplementa el «a dónde va»); kodo aporta solo el punto de entrada (sesión orquestada) y el triage.

## v2 Requirements

Diferidos. Trackeados pero fuera del roadmap actual.

### Cliente Plane

- **PLANE-F1**: Respetar `Retry-After` en 429 (M7) — impacto acotado, entra solo si sobra hueco
- **PLANE-F2**: Filtro server-side por label kodo en polling (M8)
- **PLANE-F3**: Paginación del listado de work items (M9)

### Rendimiento

- **PERF-F1**: Reconcile asíncrono / fuera del event loop (M21) — **medir antes de arreglar**: solo si `/health` muestra latencias reales

## Out of Scope

| Feature | Reason |
|---------|--------|
| Rediseño "un solo escritor de estado" (mutaciones vía HTTP al server) | El lockfile advisory (CONC-01) cubre el riesgo a ~1/20 del coste; reescribir hooks/CLI/doctor es sobreingeniería hoy. Revisitar solo si aparecen más escritores |
| Cablear `kodo up --url` | Feature especulativa que ya nació muerta una vez — se borra (HYG-02) |
| Cablear `startHealthLoop` | Nadie lo echó de menos desde que existe; añadiría carga al event loop que M21 ya señala — se borra (HYG-03) |
| M4 (OSC-52) antes de la Ola 1 | Tras cerrar la red, el vector exige un colaborador malicioso en tu propio Plane; strip barato como HYG-07 |

## Traceability

Which phases cover which requirements. Updated during roadmap creation (2026-07-06).

| Requirement | Phase | Status |
|-------------|-------|--------|
| NET-01 | Phase 69 | Complete |
| NET-02 | Phase 69 | Complete |
| NET-03 | Phase 69 | Complete |
| NET-04 | Phase 69 | Complete |
| NET-05 | Phase 69 | Complete |
| NET-06 | Phase 69 | Complete |
| CONC-01 | Phase 70 | Complete |
| CONC-02 | Phase 70 | Complete |
| CONC-03 | Phase 70 | Complete |
| CONC-04 | Phase 70 | Complete |
| CONC-05 | Phase 70 | Complete |
| CONC-06 | Phase 70 | Complete |
| CONC-07 | Phase 70 | Complete |
| CONC-08 | Phase 70 | Complete |
| CONC-09 | Phase 70 | Complete |
| DELIV-01 | Phase 71 | Complete |
| DELIV-02 | Phase 71 | Complete |
| DELIV-03 | Phase 71 | Complete |
| DELIV-04 | Phase 71 | Complete |
| HYG-01 | Phase 72 | Complete |
| HYG-02 | Phase 72 | Complete |
| HYG-03 | Phase 72 | Complete |
| HYG-04 | Phase 72 | Complete |
| HYG-05 | Phase 72 | Complete |
| HYG-06 | Phase 72 | Complete |
| HYG-07 | Phase 72 | Pending |
| HYG-08 | Phase 72 | Pending |

**Coverage:**

- v0.16 requirements: 27 total
- Mapped to phases: 27 ✓ (Phase 69: 6 · Phase 70: 9 · Phase 71: 4 · Phase 72: 8)
- Unmapped: 0

**Phase map:**

- **Phase 69 Red y autenticación (Ola 1):** NET-01..06
- **Phase 70 Concurrencia y ciclo de vida de procesos (Ola 2):** CONC-01..09
- **Phase 71 Fiabilidad de entrega y backstop (Ola 3):** DELIV-01..04
- **Phase 72 Higiene, DX y verdad documental (Ola 4):** HYG-01..08

**Candidatas v0.17 (features, fuera del cómputo v0.16 — no planificar hasta cerrar v0.16):**

- **Phase 74 Plan vivo por-tarea (handoff continuo):** LIVE-01..04
- **Phase 75 Inbox de capturas global:** CAPT-01..04

---
*Requirements defined: 2026-07-05*
*Last updated: 2026-07-06 — traceability mapeada a Phases 69-72 (roadmap v0.16 creado, 27/27 cobertura)*
