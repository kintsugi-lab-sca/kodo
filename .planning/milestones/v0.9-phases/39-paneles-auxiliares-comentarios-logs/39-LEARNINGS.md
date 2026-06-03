---
phase: 39
phase_name: "paneles-auxiliares-comentarios-logs"
project: "kodo"
generated: "2026-06-02"
counts:
  decisions: 9
  lessons: 4
  patterns: 6
  surprises: 3
missing_artifacts:
  - "39-UAT.md"
---

# Phase 39 Learnings: paneles-auxiliares-comentarios-logs

## Decisions

### `fetchComments` añade discriminante `code` sobre el patrón de `fetchStatus`
Los clientes HTTP de fases previas devolvían `{ok}` plano. `fetchComments` extiende el patrón con `code` (`'not-found'|'http'|'network'`) para que la UI ramifique 404 (tarea ausente) frente a 5xx/red de forma distinta.

**Rationale:** El invariante no-crash de TUI-15 se vuelve estructural en el data layer — la UI elige copy (`not found` vs `error fetching comments`) sin try/catch ni inspección de status codes en el render.
**Source:** 39-01-SUMMARY.md

### `comments: []` vacío es `{ok: true}`, no un error
La ausencia de comentarios se trata como estado de UI exitoso (copy `no comments yet`), no como fallo.

**Rationale:** Distinguir "no hay comentarios" de "no se pudieron obtener" es semánticamente distinto para el operador; colapsarlos ocultaría errores reales.
**Source:** 39-01-SUMMARY.md

### `grepLogs` vive en `select.js` (derive), no en `format.js` (presentación)
El filtro de logs se ubica en la capa de derivación junto a `applyFilter`, no en el módulo de proyección de celdas.

**Rationale:** Es un filtro de datos, no un cell projector. Coherente con la separación derive/presentación ya establecida en Phase 36.
**Source:** 39-01-SUMMARY.md

### Overlay como TERCER sub-modo del `useInput` existente (no un segundo `useInput`)
`mode:'overlay'` se añade al mode-gate existente (`list`/`filter`); la rama overlay consume `Esc`/`↑`/`↓` y traga el resto ANTES del mode-gate de filtro/lista.

**Rationale:** Un segundo `useInput` competiría por los eventos de teclado. Un único punto de routing mantiene el control de foco determinista.
**Source:** 39-02-SUMMARY.md

### `overlaySnapshot` es un objeto frozen proyectado a strings al abrir
El handler proyecta comentarios/logs a `lines: string[]` y congela `status` en `{ kind, taskRef, status, lines }`; el render solo slicea y elige copy.

**Rationale:** Cero re-fetch o re-cálculo bajo el poll — el contenido no salta mientras el operador lee (base de D-05).
**Source:** 39-02-SUMMARY.md

### `Esc` preserva el cursor GRATIS — nunca toca `selectedTaskId`
Abrir/cerrar el overlay no modifica `selectedTaskId`; `resolveSelection` re-deriva la misma fila por identidad al volver a `mode:'list'`.

**Rationale:** D-06 sin estado extra — la preservación del cursor es emergente del modelo de selección por identidad de Phase 36, no requiere guardar/restaurar índice.
**Source:** 39-02-SUMMARY.md

### `renderOverlay` como early-return en `SessionTable.js`, no un `Overlay.js` separado
El overlay full-screen se renderiza con un early-return dentro de SessionTable en lugar de un componente nuevo.

**Rationale:** Menor diff; SessionTable sigue siendo el único punto de render y queda cubierto por el walker `format-isolation.test.js` sin ampliar su lista de archivos.
**Source:** 39-02-SUMMARY.md

### Etiqueta honesta `OVERLAY_LOGS_LABEL` es load-bearing, no cosmética
El header del overlay de logs declara en línea propia (yellow) "grep of shared buffer — may include other sessions".

**Rationale:** Disposición de la amenaza T-39-03 (info disclosure) = accept + disclose. El buffer `/logs` es compartido y no tiene `session_id`; la etiqueta es la mitigación (D-04/SC#3).
**Source:** 39-02-SUMMARY.md

### `OVERLAY_VIEWPORT` movido a `App.js` como única fuente de verdad
Durante la resolución del code review, la constante del viewport (18) se movió de `SessionTable.js` a `App.js` (exportada), importada por SessionTable.

**Rationale:** El clamp de scroll (App.js) y el slice del render (SessionTable.js) deben usar el MISMO valor; tenerla duplicada causó el drift de WR-01 (clamp usaba `length-1`, render slicaba por 18).
**Source:** 39-REVIEW.md (resolution)

---

## Lessons

### El self-check del executor en aislamiento NO detecta bugs de corrección async
Ambos planes reportaron `Self-Check: PASSED` y "sin desviaciones de comportamiento", pero el code review post-merge encontró CR-01: los handlers `c`/`l` son `async` y ejecutaban `setMode('overlay')` tras el `await` sin comprobar si el operador había encolado otra apertura o cerrado con `Esc` — reabriendo un overlay obsoleto.

**Context:** El bug emerge de la interacción async + cola de eventos, invisible a un test unitario que abre un solo overlay y espera. Confirma el blind spot del Generator-self-evaluation: un agente reporta PASSED aunque la interacción real falle. El gate de code review post-merge es donde se atrapó.
**Source:** 39-REVIEW.md

### "Tests PASSED" ≠ "feature cubierta": verificar que el test ejercite la feature
El plan exigía tests de scroll `↑`/`↓`; el SUMMARY declaró PASSED, pero ninguno de los 9 tests originales ejercitaba la navegación por scroll. Por eso WR-01 (clamp que dejaba 1 sola línea visible) pasó desapercibido.

**Context:** La ausencia de un test no se nota si solo se cuenta "tests verdes". Hay que mapear cada criterio del plan a una aserción concreta. Los 3 tests añadidos en la resolución (scroll ↓, scroll ↑, race CR-01) están construidos para FALLAR con el código viejo.
**Source:** 39-REVIEW.md

### Extender un test preexistente en vez de recrearlo (y el Write fallido como señal)
`test/dashboard-select.test.js` ya existía (Phase 36/38). El primer intento de `Write` falló por "archivo no leído" — lo que confirmó su preexistencia y evitó destruir los tests de TUI-08/09/11/12.

**Context:** El error de "read before write" funcionó como salvaguarda. Ante un archivo de test compartido entre fases, extender el bloque, nunca sobrescribir.
**Source:** 39-01-SUMMARY.md

### Los guards de acceptance basados en `grep` no son comment-aware
Dos falsos positivos en la misma fase: `grep "new RegExp" select.js` disparó por una frase del JSDoc, y `grep "picocolors" App.js` por un comentario load-bearing de Phase 36 que documenta la invariante de color-isolation.

**Context:** Un acceptance criterion `grep X = 0` mide texto, no código. Reformular el comentario (cuando es seguro) o documentar el falso positivo; nunca borrar comentarios load-bearing solo para satisfacer el grep.
**Source:** 39-01-SUMMARY.md, 39-02-SUMMARY.md

---

## Patterns

### never-throws + `code` discriminante
Cliente HTTP que colapsa cualquier fallo (HTTP, red, JSON corrupto) a `{ok: false, code}` para que React ramifique sin `try/catch`.

**When to use:** Cualquier fetch consumido por un render reactivo donde distintos modos de fallo necesitan UI distinta (404 vs 5xx vs red).
**Source:** 39-01-SUMMARY.md

### grep substring OR anti-ReDoS
`needles = [task_ref, workspace_ref].filter(Boolean)`, match por `String.includes` contra `entry.msg`, nunca compila `new RegExp`. Needles vacíos → `[]` (no inunda).

**When to use:** Filtrado de texto sobre input que el usuario no controla pero que podría contener metacaracteres regex; evita ReDoS por construcción.
**Source:** 39-01-SUMMARY.md

### Sub-modo overlay como guard al tope del mode-gate
Un tercer `mode` en el `useInput` existente cuya rama consume las teclas relevantes (`Esc`/scroll) y traga el resto, declarada antes que los modos `filter`/`list`.

**When to use:** Añadir un modo modal full-screen a una TUI con un único `useInput`, sin introducir un segundo handler que compita por eventos.
**Source:** 39-02-SUMMARY.md

### Snapshot congelado (freeze-on-open) bajo poll vivo
El contenido del overlay se congela al abrir; el poll de fondo sigue (keep-last-good intacto) pero `onResult` no re-escribe el snapshot → cero thrash de re-render mientras se lee.

**When to use:** Vista de detalle modal sobre datos que se refrescan periódicamente por debajo; evita que el texto salte bajo el lector.
**Source:** 39-02-SUMMARY.md

### Token de generación (`reqId` ref) para invalidar handlers async en vuelo
Cada apertura toma `reqId = ++ref.current`; cerrar/reabrir avanza el ref; el handler, tras el `await`, descarta si `ref.current !== reqId`.

**When to use:** Cualquier handler de input async en UI donde el usuario puede encolar otra acción o cancelar durante la latencia (race condition de "resultado obsoleto que pisa el estado actual").
**Source:** 39-REVIEW.md (fix CR-01)

### Clamp de scroll contra el viewport, no contra `length-1`
El offset máximo de scroll es `max(0, lines.length - VIEWPORT)`, compartiendo la constante del viewport entre el clamp (handler) y el slice (render).

**When to use:** Body scrollable de altura fija; usar `length-1` deja la última pantalla casi vacía (1 línea visible). La constante del viewport debe tener una única fuente de verdad.
**Source:** 39-REVIEW.md (fix WR-01)

---

## Surprises

### SC#4 ya estaba satisfecho — una tarea entera fue solo verificación, cero diff
La Task 3 del Plan 01 (corregir el wording de `/logs` en PROJECT.md) resultó en cero cambios: el texto ya decía "best-effort substring grep / no hay session_id real". La tarea se cerró sin commit.

**Impact:** Confirma que vale la pena verificar el estado actual antes de asumir trabajo. El plan asumió un wording defectuoso que ya había sido corregido en una fase anterior.
**Source:** 39-01-SUMMARY.md

### El ciclo de import App.js ↔ SessionTable.js funciona (consumo en runtime)
SessionTable importa las constantes `OVERLAY_*` de App.js, que a su vez importa SessionTable. No hay error de inicialización porque las constantes solo se consumen dentro de `renderOverlay` (runtime), no en tiempo de carga del módulo.

**Impact:** La alternativa "limpia" (tercer módulo de constantes) se rechazó por añadir un archivo sin beneficio. El code review lo marcó como Info (frágil ante cambios de nivel de módulo), pero la suite 111/111 confirma que es seguro hoy.
**Source:** 39-02-SUMMARY.md

### Un blocker real sobrevivió a dos self-checks PASSED y emergió solo en code review
Ambos planes declararon "sin desviaciones de comportamiento" y self-check verde, y la verificación de fase habría pasado — pero el gate de code review post-merge encontró la race condition CR-01, un bug de corrección genuino en la interacción async + Esc.

**Impact:** Validó el gate de code review como red de seguridad independiente del self-report del executor. Sin él, un overlay que se reabre solo habría llegado a producción. Reforzó la regla de mapear cada criterio del plan a un test que falle con el código defectuoso.
**Source:** 39-REVIEW.md, 39-VERIFICATION.md
