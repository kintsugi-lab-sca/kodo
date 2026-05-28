# Phase 37: Attach — handoff a cmux - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-28
**Phase:** 37-attach-handoff-cmux
**Areas discussed:** Estructura de attach.js + DI, Alt-screen + cursor durante el handoff, UX del error (zombie / ENOENT), Señales + UAT formato

---

## Estructura de attach.js + DI

### Q1: ¿Dónde vive el loop unmount→spawn→re-render del attach?

| Option | Description | Selected |
|--------|-------------|----------|
| En index.js (runDashboard) | App.js emite intent vía callback prop; runDashboard hace el loop `while(true) { render; waitUntilExit; if attach intent { spawn; continue } else break }`. Único dueño del proceso. | ✓ |
| En App.js (handler de Enter) | Enter orquesta unmount + spawn + re-render desde dentro de React. Más tight coupling con React lifecycle. | |
| attach.js puro + glue mínimo | ARCHITECTURE.md exacta: `runAttach({instance, spawn, ref})`. Decisión de quién lo llama se difiere al planner. | |

**User's choice:** index.js (runDashboard) — recomendado.
**Notes:** Mantiene la responsabilidad declarada de index.js (alt-screen, SIGTERM, exit code). React solo emite intent. → D-01.

### Q2: ¿Patrón de comunicación entre App.js y el loop de runDashboard?

| Option | Description | Selected |
|--------|-------------|----------|
| Object ref `intent.value` + onAttach prop | Mutable ref por iteración + callback `onAttach(ref) => { intent.value = ref; exit(); }`. Sin promesas extra. | ✓ |
| Deferred/Promise inyectado | `runDashboard` crea un Deferred; App lo resuelve con el intent. Más idiomatic JS pero promesa paralela a waitUntilExit. | |
| Diferir al planner | Lockear solo "App emite intent vía callback prop y exit()" y dejar la forma exacta al planner. | |

**User's choice:** Object ref + onAttach prop — recomendado.
**Notes:** Simple, flat, sin promesas extra paralelas a `waitUntilExit`. → D-02.

### Q3: ¿Dónde corre el guard de `alive===false` (success criterio #3)?

| Option | Description | Selected |
|--------|-------------|----------|
| En App.js antes de emitir intent | Handler de Enter chequea row.alive; si false, fija `attachError` local y NO llama onAttach. Cero unmount, cero spawn. | ✓ |
| En runDashboard tras recibir intent | App emite siempre; runDashboard chequea antes del spawn. Implica pasar la row completa o re-fetch. | |
| En attach.js como helper puro | `runAttach` chequea alive y retorna `{ok:false, reason:'gone'}`. Más ceremonia, mismo resultado. | |

**User's choice:** App.js antes de emitir intent — recomendado.
**Notes:** TTY nunca se toca para un attach que va a fallar. Más simple y más seguro. → D-05.

---

## Alt-screen + cursor durante el handoff

### Q1: ¿Apagamos y re-encendemos el alt-screen alrededor del spawn de cmux?

| Option | Description | Selected |
|--------|-------------|----------|
| Sí: `\x1b[?1049l` antes del spawn, `\x1b[?1049h` tras detach | Handoff limpio simétrico: cmux propietario único del alt-screen mientras corre. Patrón estándar nested TUIs. | ✓ |
| No: dejar alt-screen de kodo on durante el attach | Asume que cmux maneja todo. Frágil: si cmux entra a alt-screen, su `\x1b[?1049l` al detach apaga el de kodo → frame fantasma. | |
| Diferir al UAT | Empezar con A, validar manualmente, ajustar. Riesgo: UAT caro de iterar. | |

**User's choice:** Toggle simétrico — recomendado.
**Notes:** Load-bearing para el criterio #1. Patrón estándar (vim shell-out, tmux nested, claude code). → D-06.

### Q2: ¿Qué estado se preserva al volver del attach?

| Option | Description | Selected |
|--------|-------------|----------|
| Preservar selectedTaskId + query + mode vía snapshot en intent | Intent incluye snapshot `{selectedTaskId, query, mode}`. Próximo render: `<App initialSnapshot={...} />`. Cursor sobrevive al handoff. | ✓ |
| Solo preservar selectedTaskId | Cursor vuelve a la fila correcta, filtro se pierde. Compromiso intermedio. | |
| Fresh App cada vez | Re-render limpio sin snapshot. Operador siempre vuelve a primera fila + sin filtro. Peor UX. | |

**User's choice:** Snapshot completo en el intent — recomendado.
**Notes:** El operador acaba de hacer attach a una sesión específica; perder el cursor es jarring. resolveSelection de Phase 36 D-06 cubre el caso "esa sesión terminó durante el attach". → D-08.

---

## UX del error (zombie / ENOENT)

### Q1: ¿Dónde y cómo se muestra el mensaje de error de attach?

| Option | Description | Selected |
|--------|-------------|----------|
| Footer reemplazado, persiste hasta la siguiente tecla | El footer `↑↓ move · / filter · q quit` se reemplaza por mensaje rojo. Próxima tecla limpia el error. Sin timers, no choca con reserva de Esc. | ✓ |
| Banner sobre el header, persistente hasta próximo intento | Fila roja arriba del header. Más visible pero ocupa espacio vertical permanentemente. | |
| Inline efímero (3s auto-clear vía timer) | Toast bajo el footer 3s. Anti-pattern Pitfall 8 (re-render por timer cosmético). | |

**User's choice:** Footer reemplazado hasta próxima tecla — recomendado.
**Notes:** Sin timers, sin overlays nuevos, persistente. → D-09.

### Q2: ¿Granularidad de los mensajes de error de attach?

| Option | Description | Selected |
|--------|-------------|----------|
| Tres mensajes distintos por causa | Zombie: `[!] workspace gone (alive=false) — press any key`. ENOENT: `[!] cmux not found in PATH — press any key`. Otros: `[!] cmux attach failed (code N) — press any key`. | ✓ |
| Dos categorías: pre-flight vs post-spawn | Zombie específico; todos los errores post-spawn colapsados en `[!] cmux attach failed: <stderr|err.code>`. | |
| Un solo mensaje genérico | `[!] attach failed — press any key`. Operador adivina. | |

**User's choice:** Tres mensajes específicos — recomendado.
**Notes:** El operador sabe inmediatamente si arreglar PATH, refrescar la lista, o investigar cmux. → D-10/D-11.

---

## Señales + UAT formato

### Q1: ¿Cómo manejamos las señales durante la ventana del attach?

| Option | Description | Selected |
|--------|-------------|----------|
| No-op SIGINT install + remover SIGTERM handler durante el attach | `process.on('SIGINT', noop)` (cmux maneja Ctrl-C como detach; kodo no muere). Remover SIGTERM handler de Phase 34 D-10 (App ya desmontado). Reinstalación inversa al volver. | ✓ |
| Ignorar señales por completo durante el attach | noop tanto SIGINT como SIGTERM. Simple pero pierde semántica de SIGTERM. | |
| Confiar en exitOnCtrlC default de ink | ink ya hizo cleanup en unmount — esto NO funciona durante la ventana. Node mata por SIGINT default. Descartar. | |

**User's choice:** No-op SIGINT + remover SIGTERM, reinstalación inversa — recomendado.
**Notes:** Patrón estándar para CLI tools que spawnean interactive children. Verificable con `process.listenerCount('SIGINT'/'SIGTERM')` antes/durante/después. → D-12.

### Q2: ¿Formato de cada escenario en `37-HUMAN-UAT.md`?

| Option | Description | Selected |
|--------|-------------|----------|
| Pasos + observable esperado + slot 'observado' + sign-off | (1) Setup, (2) Steps numerados, (3) Expected observable (textual y verificable), (4) Slot 'observado', (5) Pass/Fail + fecha + firma. Los 4 escenarios del criterio #5 listados explícitamente. | ✓ |
| Checklist plano con criterios textuales | Lista de bullets con check. Menos verbose pero pierde el slot 'observado' estructurado. | |
| Sin formato fijo, prosa libre | Phase decide al ejecutar. Pierde reproducibilidad y consistencia con UATs previos del proyecto. | |

**User's choice:** Formato estructurado con sign-off por escenario — recomendado.
**Notes:** Patrón v0.3 `07-HUMAN-UAT.md` y commit reciente `e93a1dc test(36): close HUMAN-UAT — 3/3 passed in TTY`. Sin sign-off (4/4 obligatorios), la fase NO está completa. → D-13.

---

## Claude's Discretion

- Estructura granular dentro de `attach.js`: módulo único vs split en helpers (mapAttachError, dismissAttachError).
- Forma exacta del discriminated union de `runAttach`: nombres de los `code` propuestos pueden ajustarse mientras preserven el mapeo 1:1 a los 3 mensajes de D-10.
- Tests automatizables vs manual UAT: mínimo automatizable definido (ordering + alive guard + ENOENT mapping + snapshot pass-through); resto al planner.
- Ubicación exacta del render del footer-error: en `SessionTable.js` (donde ya vive el footer) o izado a `App.js` / nuevo `Footer.js` extraído.
- Persistencia del `initialError`: un solo render vs `useState(initialError)` con clear-on-any-input. Implementación natural recomendada en el segundo modelo.

## Deferred Ideas

- Overlays `c` (comentarios) y `l` (logs) → Phase 38 (TUI-15/TUI-16).
- `kodo gsd doctor` (limpieza proactiva de zombies + worktrees huérfanos) → post-v0.9.
- Argumentos extra a `cmux attach <ref>` → no hay caso de uso definido.
- Reconexión semántica si Ctrl-C no detach correctamente → bug de cmux, fuera de scope.
- Notificación visual al volver del attach (toast/sound) → innecesario.

### Reviewed Todos (not folded)

- **"Surface provider state in dashboard (Plane In Review / GitHub equivalent)"** (`2026-05-28-surface-provider-state-in-dashboard-plane-in-review.md`, matched score 0.9 por keyword/área "dashboard") — **scope creep**: requiere modificar `src/server.js`, providers, `SessionTable.js`, `select.js`. Phase 37 es estrictamente el handoff TTY a cmux. Belongs en una fase futura. Todo permanece abierto para roadmap backlog.
