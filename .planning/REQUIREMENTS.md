# Requirements: kodo — Milestone v0.16 Hardening

**Defined:** 2026-07-05
**Core Value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación.
**Input:** `.compound/AUDITORIA-ADVERSARIAL-2026-07-03.md` (9 ALTA re-verificados 2026-07-05) + `.compound/PROPUESTA-MEJORAS-AUDITORIA-2026-07-05.md`

## v0.16 Requirements

Requirements de este milestone. Cada uno mapea a fases del roadmap. Entre paréntesis, el hallazgo de la auditoría que cierra.

### Red y autenticación (Ola 1 — causa raíz T3)

- [ ] **NET-01**: El server bindea a `127.0.0.1` por defecto; `config.server.bind` permite exponerlo explícitamente (A1)
- [ ] **NET-02**: El carril no-webhook (`GET /status`, `/logs`, `/comments/:id`, `DELETE /sessions/:id`) exige `Authorization: Bearer <token>` — 401 sin token; el dashboard lee el token de config y lo envía; `/webhook` conserva HMAC y `/health` queda abierto (M2)
- [ ] **NET-03**: `readBody` corta a 1 MB pre-auth → 413 (M1)
- [ ] **NET-04**: Los errores 500 devuelven mensaje neutro al cliente; `err.message` solo al log (B10)
- [ ] **NET-05**: `sessionId` validado con `/^[A-Za-z0-9_-]+$/` antes de tocar filesystem (B6)
- [ ] **NET-06**: La topología multi-nodo está documentada — bind a IP tailscale + ACL para recibir el webhook de Plane desde otro nodo (decisión 2026-07-05)

### Concurrencia y ciclo de vida de procesos (Ola 2 — causas raíz T1, T2)

- [ ] **CONC-01**: Los ~6 escritores de `state.json` pasan por `withStateLock(fn)` (lockfile `O_EXCL` + retry, re-lee→muta→guarda); el comentario falso "ÚNICO escritor" de `server.js:682` se corrige en el mismo commit (A2)
- [ ] **CONC-02**: `acquireGsdLock` es atómico (`flag:'wx'`, `EEXIST` → tomado); `stealLock` vía tmp+rename (A3)
- [ ] **CONC-03**: Una sesión zombi libera su slot de `max_parallel` — reconcile `state:'dead'` deriva `status:'idle'` o el gate filtra por `alive` (A4)
- [ ] **CONC-04**: `teardown` solo borra `kodo.pid` si `payload.pid === process.pid`; el PID se escribe post-bind (A5)
- [ ] **CONC-05**: Antes de SIGKILL se compara `started_at` del payload con el arranque real del proceso (`ps -o lstart=`); si no cuadra, se aborta (A6)
- [ ] **CONC-06**: Dos `polling start` concurrentes no arrancan dos daemons — lock `O_EXCL` (M20)
- [ ] **CONC-07**: `migrateConfigIfNeeded` escribe vía `writeFileAtomic` (M16)
- [ ] **CONC-08**: El dedup de sesiones no-GSD es cross-proceso — lock por `task_id` (M17)
- [ ] **CONC-09**: La ubicación real de los worktrees está verificada empíricamente (sesión GSD real) y documentada — cierra M13

### Fiabilidad de entrega y backstop (Ola 3 — causas raíz T4, T5)

- [ ] **DELIV-01**: El cursor de polling solo incorpora el `updated_at` de un issue a `maxUpdatedAt` si su dispatch resolvió (`await` + timeout); un dispatch fallido se reintenta en el siguiente tick; el webhook sigue fire-and-forget (A7)
- [ ] **DELIV-02**: El primer tick distingue "cache ausente" de "primer tick observado" — centinela (M10)
- [ ] **DELIV-03**: `adopt` es idempotente — busca por `task_url` antes de `createTask` (M11)
- [ ] **DELIV-04**: Si al `SessionEnd` la tarea sigue "In Progress" y la sesión terminó limpia, el hook transiciona a "In Review" y comenta "cierre automático" — backstop mecánico; la instrucción al LLM pasa a ser optimización, no única vía (T5; decisión de producto 2026-07-05)

### Higiene, DX y verdad documental (Ola 4)

- [ ] **HYG-01**: El stop hook solo auto-commitea si `KODO_ORCHESTRATOR=1` (inyectada al lanzar el workspace orquestador) y con pathspec completo (`git commit -- .claude/skills/kodo-orchestrate/`) (A8)
- [ ] **HYG-02**: El flag `kodo up --url` se elimina (decisión 2026-07-05: borrar, no cablear) (A9)
- [ ] **HYG-03**: `startHealthLoop` se elimina y el README deja de prometerlo (decisión 2026-07-05: borrar, no cablear) (M18)
- [ ] **HYG-04**: Coloreado de workspace, notify y nudge se mueven de `Stop` a `SessionEnd` (M19)
- [ ] **HYG-05**: Batch de endurecimiento de config: rechazar `__proto__|constructor|prototype` (M3), chmod 0600 si hay `*_secret` (M5), `split` con `join` del resto (M14), B5, B7
- [ ] **HYG-06**: Batch de BAJAS mecánicas: B1, B2, B3, B4, B8, B9, B12 + M12 (`[-–—]` en roadmap) — diffs de 1–5 líneas
- [ ] **HYG-07**: El dashboard hace strip de `\x1b` en contenido externo (comentarios) — M4, rebajada de prioridad tras Ola 1
- [ ] **HYG-08**: Pasada de README: stop hook real, `kodo status` vs `dashboard`, rutas `src/providers/…`, owner del repo, comandos indocumentados, y documentar `--dangerously-skip-permissions` en sesiones GSD

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

Which phases cover which requirements. Updated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| (pendiente de roadmap) | — | — |

**Coverage:**
- v0.16 requirements: 27 total
- Mapped to phases: 0
- Unmapped: 27 ⚠️ (roadmap pendiente)

---
*Requirements defined: 2026-07-05*
*Last updated: 2026-07-05 after initial definition (milestone v0.16)*
