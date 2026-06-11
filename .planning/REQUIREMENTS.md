# Requirements: kodo v0.12 — Atajos al gestor y progreso vivo

**Defined:** 2026-06-11
**Core Value:** Cualquier sistema de tareas puede ser el motor de kodo — cambiar de proveedor no requiere reescribir la lógica de sesiones, health checks ni orquestación. v0.12 profundiza el dashboard en dos direcciones desde la fila de sesión: *hacia afuera* (abrir la tarea en el gestor — Plane/GitHub — sin salir de la TUI) y *hacia adentro* (ver el progreso vivo de la sesión, condicional a que un spike confirme que la captura es viable en el Claude Code actual).

## v1 Requirements

Requirements del milestone v0.12. Cada uno mapea a una fase del roadmap.

### Open in Manager (OPEN)

Driver: extensión simétrica del `Enter → cmux select-workspace` de v0.9 Phase 37 (foco *interno*) — ahora una tecla abre la tarea en su gestor (foco *externo*). El research (`.planning/research/`) verificó que el round-trip de la URL **ya está construido**: `TaskItem.url` es campo canónico (GitHub `issue.html_url` en `normalize.js:102`; Plane browse-URL en `normalize.js:76`), `manager.js:48` ya persiste `task_url` en el `SessionRecord`, y `GET /status` ya lo expone por fila. El trabajo real es el launcher TUI + la corrección de un bug latente de URL de Plane, no construir plumbing. Diseño elegido: URL como **campo estático de `TaskItem`** persistido al lanzar (espejo de `worktree_path`), **no** método opcional `getTaskUrl` (ese patrón — `getTaskState` — se justifica para estado *vivo*; una URL es inmutable). Contrato `TaskProvider` sigue FROZEN en 9.

- [ ] **OPEN-01**: El operador pulsa una tecla dedicada (`o`, libre junto a `q`/`/`/`c`/`l`/`p`/`d`/`Enter`) sobre una fila y se abre la URL de la tarea (Plane/GitHub) en el navegador del sistema, vía `open` con `child_process.execFile` fire-and-forget — un `src/cli/dashboard/open.js` clonado de `focus.js` (mismo discriminante never-throws `{ok}`, misma DI del binario inyectable con default `'open'`, misma cobertura de color-isolation por el walker). Lee la `task_url` ya persistida en la fila; cero endpoints nuevos.
- [ ] **OPEN-02**: La acción es **never-throws** end-to-end (ENOENT / navegador ausente / exit≠0 → footer-error, el panel permanece montado, cero unmount, cero toggle de alt-screen) y es un **no-op con feedback claro** cuando la fila no tiene `task_url` (SessionRecords legacy previos al campo).
- [ ] **OPEN-03**: El launcher solo abre URLs `http(s)` — un allowlist de protocolo rechaza `file://`, `javascript:` y la inyección de flags vía URLs con `-` inicial hacia `open` (la URL se pasa como argumento literal, nunca como string de shell).
- [ ] **OPEN-04**: Las web-URLs de Plane resuelven a un **link vivo** en deploys self-hosted con web/API separados — config opcional `plane.web_url` con default a `base_url` (hoy `normalize.js:76` construye desde el host de API `base_url`+`/api/v1`, produciendo links muertos en deploys partidos), y el fallback de identificador `UNKNOWN-<seq>` no emite links muertos.

### Live Progress (PROG)

Driver: mostrar el progreso vivo de cada sesión en el dashboard (p. ej. `3/7 pasos`), sucesor de los diferidos PLAN-F1/PLAN-F2 de v0.11. **Mitad incierta del milestone, gobernada por un gate duro.** El research encontró señales contradictorias que solo un spike empírico resuelve: los nuevos `Task*` tools (`TaskCreate`/`TaskUpdate`/…, migración desde `TodoWrite` deprecado, Claude Code ~v2.1.142) **bypassean `PostToolUse`/`PreToolUse`** (anthropics/claude-code #20243 — el playbook de v0.11 no transfiere), pero los eventos dedicados `TaskCreated`/`TaskCompleted` *podrían* disparar en sesiones interactivas, y el transcript JSONL (que kodo ya correlaciona vía `transcript_path`, LOG-10) es un fallback robusto. **INVIABLE es el default esperado.**

- [ ] **PROG-01** *(spike — gate duro)*: Veredicto empírico **VIABLE / INVIABLE** sobre si el task-state vivo de una sesión `claude --worktree` interactiva puede capturarse en la build instalada de Claude Code vía una superficie soportada, evaluadas en orden de preferencia: (1) eventos hook `TaskCreated`/`TaskCompleted`, (2) watcher del transcript JSONL, (3) lectura de `~/.claude/tasks/` (último recurso, frágil). **VIABLE** exige las 4: la superficie dispara/se lee de hecho en la versión instalada · payload estable para derivar `N/M` · correlación determinista con `task_id` · cero latencia/ruptura de la sesión + artefacto kodo-controlado. Cualquier fallo → INVIABLE.
- [ ] **PROG-02** *(condicional a PROG-01 VIABLE)*: Si VIABLE, kodo **captura y persiste** el progreso de cada sesión a un archivo kodo-controlado bajo `~/.kodo/` (espejo del seam productor↔consumidor del plan ligero de v0.11), correlacionado por `task_id`, sin depender de rutas internas no documentadas de Claude Code y preservando los golden-bytes de los bloques existentes de `session-start.js` (HOOK-02).
- [ ] **PROG-03** *(condicional a PROG-01 VIABLE)*: Si VIABLE, el dashboard **muestra el progreso por sesión** (p. ej. `N/M`) leyendo ese artefacto filesystem-style como el overlay de plan (cero endpoints nuevos), con estados degradados honestos (sin todos → `—`; fallo transiente de captura → `?` + keep-last-good; cohortes legacy/Task-tools toleradas) — patrón de la columna no-color `provider_state` de v0.10 Phase 43.

### Nyquist Debt Backfill (NYQ)

Driver: saldar la deuda Nyquist heredada de v0.11 (citation-based, sin re-ejecutar la suite — espejo de v0.11 Phase 47 / v0.8 Phase 33 Bloque B). Doc-only Tier 1, independiente del resto del milestone.

- [ ] **NYQ-03**: Phases **44, 45, 46** (v0.11) tienen `VALIDATION.md` citation-based con `nyquist_compliant: true`, citando la evidencia existente (VERIFICATION.md + integration check + UAT), reemplazando los stubs `draft` / `nyquist_compliant: false` registrados en STATE.md `## Deferred Items`.

## v2 Requirements

Diferidos a un milestone futuro. Reconocidos pero fuera del roadmap actual.

### Live Progress fallback

- **PROG-F1**: Si PROG-01 sale **INVIABLE**, la captura de task-state vivo se difiere a un milestone futuro, cuando Claude Code estabilice/documente una superficie de persistencia o eventos hook que disparen en sesiones interactivas. El milestone cierra con OPEN-* + NYQ-03 sin penalización.

### Provider reach (heredados, sin cambios)

- **CLICKUP-F1**: Adapter ClickUp como 3er `TaskProvider`.
- **LOCAL-F1**: Adapter local (JSON/Markdown) + file watcher.
- **GH-F1**: Webhook GitHub ingress real-time · GitHub Enterprise (`base_url`) · OAuth GitHub App.

## Out of Scope

Explícitamente excluido. Documentado para prevenir scope creep.

| Feature | Reason |
|---------|--------|
| Picker de desambiguación multi-URL | 1 sesión = 1 `task_id` = 1 URL; no hay ambigüedad que resolver |
| Apertura cross-platform del navegador (`xdg-open`/Windows `start`) | Runtime fijado a macOS; el path no-mac degrada con refuse-with-guidance (patrón `kodo polling`), no crashea — no se implementa apertura activa |
| Web view embebida del gestor en la TUI | El navegador del sistema es suficiente; embeber contradice "CLI/TUI ligera sin frameworks" |
| Barras de porcentaje / sparklines / checklist inline del progreso | Over-engineering para herramienta personal; `N/M` + item actual es table-stakes suficiente |
| Endpoint nuevo en `src/server.js` para URL o progreso | Invariante desde v0.10: la TUI lee datos ya persistidos (fila / filesystem), nunca un endpoint nuevo |
| `pbcopy` clipboard fallback de la URL | P3 nice-to-have; fuera de v0.12, reconsiderable si el `open` resulta insuficiente |
| Lectura del schema on-disk de `~/.claude/tasks/` como fuente primaria | Formato no documentado, frágil entre versiones (la clase de fragilidad que v0.11 ya rechazó); solo aceptable como último recurso si el spike lo valida |

## Traceability

Qué fases cubren qué requirements. Se completa durante la creación del roadmap.

| Requirement | Phase | Status |
|-------------|-------|--------|
| OPEN-01 | Phase 48 | Pending |
| OPEN-02 | Phase 48 | Pending |
| OPEN-03 | Phase 48 | Pending |
| OPEN-04 | Phase 48 | Pending |
| PROG-01 | Phase 49 | Pending |
| PROG-02 | Phase 50 (conditional — Phase 49 = VIABLE) | Pending |
| PROG-03 | Phase 50 (conditional — Phase 49 = VIABLE) | Pending |
| NYQ-03 | Phase 51 | Pending |
