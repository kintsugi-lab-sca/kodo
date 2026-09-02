# Spike KODO-70 — Revisión de `unclebob/swarm-forge`

**Fecha:** 2026-09-02 · **Alcance:** análisis, cero cambios en código de kodo
**Fuente:** `github.com/unclebob/swarm-forge` — ramas `main`, `two-pack`, `six-pack`, `adversaries`, `lieutenant`, `project-manager` (clonado en scratchpad, ~8.6k líneas)

---

## Veredicto en una línea

Hay **dos ideas que valen la pena** (el *audit gate* de dos llamadas y el rol *reviewer* con permisos de escritura restringidos) y **una regla de higiene** que además destapa deuda real en la suite de kodo. Todo lo demás o ya está en kodo bajo otro nombre, o pertenece a una topología de producto distinta que kodo no debería adoptar.

---

## 1. Qué es swarm-forge

Plataforma de orquestación de agentes sobre **tmux + git worktrees + Babashka**. Un *pack* es un pipeline fijo de roles (2, 4 o 6) que se instala **dentro de un repo existente**. Cada rol tiene: su worktree, su rama, su sesión tmux, su prompt y su buzón de correo. Una tarea recorre el pipeline rol por rol (`specifier → coder → cleaner → architect → hardender → QA`), y cada tránsito es un commit + un *handoff* entregado por un daemon.

Números: 8.6k líneas, ~60 % scripts Babashka (`.bb`) con envoltorios `.sh` de 5 líneas, ~15 % prompts de rol y "constitución", ~2k líneas de dashboard web. Sin dependencias de servicio: todo el estado es sistema de ficheros.

**Madurez, dicho sin adornos.** Proyecto joven, de un autor con opiniones muy marcadas, sin usuarios reportados ni evidencia empírica publicada. La pieza más ambiciosa (`platoon-brainstorm.md`, 402 líneas de jerarquía lieutenant → squads con contratos de interfaz versionados) es **un brainstorm no implementado**. El `README` de `main` dedica su primera línea a advertir sobre un token cripto que suplanta el nombre. Nada de esto invalida las ideas, pero sí obliga a evaluarlas por su mecánica, no por su tracción.

### Diferencia estructural con kodo (importa para todo lo que sigue)

| | swarm-forge | kodo |
|---|---|---|
| Unidad de trabajo | 1 tarea → **N agentes** en N worktrees del mismo repo | 1 tarea → **1 sesión** en 1 worktree |
| Origen del trabajo | Board TSV local (`tasks.tsv`), lane = rol | Kanban externo (Plane webhook / GitHub polling) |
| Transporte | Ficheros `.handoff` en maildir + daemon + wake-up tmux | `state.json` bajo lock + hooks + `orchestrator_inbox` |
| Supervisión | Ninguna: el pipeline es la coordinación | Orquestador LLM por rondas |
| Vida del agente | **Persistente** — el pane queda vivo esperando correo | **Efímera** — la sesión cierra y el estado durable queda fuera |
| Decisión de merge | El rol receptor mergea al aceptar el handoff | Cola de integración; el operador ejecuta |

Esa última fila —agente persistente vs. efímero— es la que decide qué se puede portar y qué no. Varias ideas de swarm-forge presuponen un agente que sigue vivo después de entregar; en kodo ese agente ya no existe.

---

## 2. Las ideas que valen algo

### 2.1 Audit gate de dos llamadas — **ADAPTAR** (recomendación principal)

**Qué hace.** `swarm_handoff.sh` es la única puerta por la que un rol puede entregar trabajo. La **primera** invocación válida **no encola nada**: calcula un fingerprint del candidato (`sender`, `task_id`, destinatarios, prioridad, commit canónico, `task_base_commit`, SHA-256 del borrador), lo escribe en `.swarmforge/handoffs/audit_pending/`, incrementa un contador acumulativo de auditorías en la card del board, e imprime `AUDIT_REQUIRED` seguido de un texto que ordena releer el payload completo, trazar cada requisito a evidencia, revisar el diff entero y los cambios no relacionados del working tree, y arreglar todo hallazgo. Solo cuando el agente **repite la invocación con el fingerprint idéntico** se encola el handoff. Cualquier cambio invalida el reto y arranca uno nuevo (`swarm_handoff.bb:460-474`).

**Por qué no lo cubre KODO-69.** El oráculo mecánico verifica el **artefacto** con herramientas (compila, tests, lint, schema, diff-scope). El audit gate ataca la clase de fallo que ninguna herramienta ve: el requisito del enunciado que nadie implementó, el caso límite que no se consideró, el "pasan los tests" sobre tests que no cubren lo pedido. Son ortogonales y complementarios: KODO-69 es *evidencia ejecutada*, esto es *un turno de relectura forzado en el momento exacto*.

**Crítica, y es seria.** Su mecánica determinista solo verifica **que invocaste dos veces con los mismos bytes**. No verifica que auditaras. Un agente que recibe `AUDIT_REQUIRED` y vuelve a teclear el comando pasa el gate en dos segundos sin haber leído nada. Lo que el gate compra de verdad es un **turno extra donde el texto de auditoría entra en la ventana de contexto** — que no es poco (los modelos sí encuentran cosas cuando se les pide releer con criterios concretos), pero hay que llamarlo por su nombre: es *inyección de prompt oportuna*, no verificación. Swarm-forge no resuelve esto y su propia constitución depende enteramente de la obediencia al prompt.

**La adaptación que lo hace verificable.** Exigir que el segundo intento traiga **algo distinto**: un commit nuevo, o un artefacto de auditoría (`review/audit-NNN.md` con hallazgos o un "sin hallazgos" firmado contra el fingerprint). Entonces el "no encontré nada" **cuesta algo** y el gate deja de ser un doble tecleo. Con eso, además, el contador de auditorías se vuelve una señal legible en la cola de integración: *esta rama necesitó 3 retos*.

**Dónde encaja en kodo — y dónde no.** No puede vivir en el hook `SessionEnd`: para cuando ese hook corre, la sesión ya cerró y no hay nadie a quien pedirle una segunda pasada. Tiene que ser un **comando explícito que la sesión invoca antes de cerrar** (`kodo handoff` / paso previo al `/exit` que ya prescribe el prompt de sesión), y su salida decide si la entrada entra en la cola de integración marcada como *auditada* o *sin auditar*. Encaja con el diseño de kodo: determinista, en el núcleo, nunca en el prompt del orquestador. El `audit_count` viviría en la entrada de `integration_queue`, con el mismo idioma aditivo que el resto de campos.

**Coste estimado:** una fase pequeña (comando + campo + render en la cola), más el diseño del artefacto de auditoría, que es la parte con miga. **Dependencia:** conviene después de KODO-69, para que ambas señales se presenten juntas.

---

### 2.2 Rol *reviewer* adversarial con escritura restringida — **ADAPTAR**

**Qué hace.** La rama `adversaries` es el pack más pequeño y el más interesante: dos roles, `coder` y `reviewer`, en bucle. El reviewer:

- **No puede tocar código de producción, tests, scripts de build ni comportamiento.** Textual: *"los únicos ficheros que puedes cambiar son artefactos de revisión bajo `review/`"*.
- Escribe `review/recommendations/NNN-recommendations.md` numerado secuencialmente, con secciones obligatorias: rama y commit revisados, número de secuencia, resumen de preocupaciones, una lista `Things To Address` donde **cada item nombra el problema, el riesgo y el cambio esperado**, y los huecos de verificación.
- Si está satisfecho escribe `review/approval.md` (rama, commit, razón, riesgos residuales) y **para** — no manda otro handoff de trabajo.
- Revisa en cuatro fases fijas: separación UI/núcleo, regla de dependencias, ocultación de información, calidad local.

**Por qué es aprovechable en kodo.** Hoy la verificación de una sesión es **autodeclarada**: la propia sesión escribe `VERIFICATION.md` y `kodo gsd verify` lo lee. Es un juez que se evalúa a sí mismo. Un segundo agente sobre la **misma rama**, con permiso de escritura restringido a `review/`, produce un artefacto con **criterio de cierre determinista** que el núcleo puede leer sin LLM:

- existe `review/approval.md` apuntando al HEAD de la rama → la entrada de la cola sube de confianza
- existe un `NNN-recommendations.md` nuevo → hay trabajo pendiente, relanzar

La restricción de escritura ya tiene precedente exacto en kodo: el auto-commit del orquestador está *gated* por `KODO_ORCHESTRATOR=1` **+ pathspec**. Es el mismo mecanismo.

**Crítica.** (a) El bucle `coder ↔ reviewer` **no tiene tope** en swarm-forge: el reviewer decide cuándo está satisfecho, y nada impide que pida cambios indefinidamente. En kodo haría falta un máximo de rondas y escalada al operador. (b) Duplica el coste por tarea, así que no puede ser el default: tiene sentido como **label opt-in** (`kodo:review`) para tareas de alto blast radius —migraciones, auth, el primitivo de locks—, que es justo el Tier 3 de la política de merge del operador. (c) Es una topología nueva —dos sesiones sobre una tarea— y eso toca el dispatcher, la cola y el modelo de estado. No es barato.

**Coste estimado:** milestone pequeño, no una fase. **Es la idea con mejor relación valor/riesgo a medio plazo**, pero llega después de las dos primeras.

---

### 2.3 "No pinees el wording de los prompts en tests" — **ADOPTAR** (matizada)

El `AGENTS.md` de swarm-forge es de seis líneas y dice una sola cosa: *no testees el texto de los prompts con tests automáticos — ni artículos de la constitución, ni prompts de rol, ni ficheros de instrucciones generados. El wording de un prompt no es comportamiento de producción que pinear con `str/includes?`*.

**Esto destapa deuda real en kodo.** La suite actual sí pinea prosa:

```
test/orchestrator-gsd.test.js:10   assert.ok(prompt.includes('## Sesiones GSD'), …)
test/orchestrator-gsd.test.js:15   assert.ok(prompt.includes('kodo gsd verify <session-id>'))
test/orchestrator-handoff-launch.test.js:140  assert.ok(prompt.includes('Situación actual'), …)
```

**Pero la regla de unclebob es demasiado absolutista y copiarla tal cual sería un error.** Hay tres cosas distintas mezcladas en esos asserts:

| Assert | Qué pinea | Veredicto |
|---|---|---|
| `prompt.includes('{{provider_name}}')` | Placeholder de plantilla | **Legítimo** — es el contrato de sustitución |
| `prompt.includes('kodo gsd verify <session-id>')` | Nombre de un comando del CLI | **Legítimo** — si el prompt deja de nombrarlo, el orquestador no lo llama; es una arista real |
| `prompt.includes('## Sesiones GSD')` / `'Situación actual'` | Encabezado y prosa | **Frágil** — reescribir la sección rompe la suite sin que cambie ningún comportamiento |

La versión útil de la regla: **pinea el contrato (marcadores, placeholders, nombres de comando), nunca la prosa ni los encabezados.** Coste: una tarea de higiene pequeña, del mismo tipo que DOC-01 de la Phase 88.

---

### 2.4 Guard de "no aceptes trabajo nuevo con una entrega en vuelo" — **ADOPTAR** (como aviso, no como bloqueo)

`ready_for_next_task.bb` se niega a aceptar una tarea nueva si el rol tiene un `git_handoff` propio todavía en outbox o retenido para aprobación: imprime `WAITING_FOR_APPROVAL` y lista los ficheros (`ready_for_next_guard.bb:112-114`).

**El análogo en kodo es concreto y el riesgo ya se ha observado en este proyecto**: el dispatcher lanza hasta 3 sesiones en paralelo **sin mirar la cola de integración**. Nada avisa de que se va a abrir una rama nueva sobre un repo que ya tiene dos ramas sin integrar — y las ramas paralelas sobre el mismo árbol conflictúan (swarm-forge lo asume explícitamente: *"parallel cards on one tree will conflict; that is expected"*).

**Adaptación:** un **aviso** en el dispatcher y en la ronda del orquestador ("KODO-71 va a un repo con 2 entradas `pending` en la cola"), **no un bloqueo**. Bloquear rompería el paralelismo que es el punto de kodo, y el propio KODO-69 ya razona por qué un gate que molesta acaba apagado. Coste: muy bajo — el dato ya está en `state.json`, cero llamadas a git.

---

### 2.5 `task_base_commit` capturado al aceptar la tarea — **ADAPTAR** (menor)

`ready_for_next_task.bb:145` escribe `task_base_commit` con el HEAD del worktree **en el momento de aceptar** la tarea, y ese valor entra en el fingerprint del audit gate.

kodo calcula `base_ok` y `commits_ahead` **al cerrar**. Con la base de arranque persistida se puede distinguir *"la rama está detrás porque main avanzó mientras trabajabas"* de *"la rama nació de una base rara"*, que hoy se ven igual. Valor moderado, coste casi nulo (un campo más en el registro de sesión). Solo merece la pena si entra junto a otra cosa que toque ese carril.

---

## 3. Lo que se descarta, y por qué

| Idea de swarm-forge | Veredicto | Razón |
|---|---|---|
| **Wake-up lossy + cola durable** — notificación tmux genérica que no nombra el fichero, para no sesgar al receptor; el estado real vive en el inbox | **DESCARTAR — ya implementado** | Es literalmente KODO-53: eventos persistidos en `orchestrator_inbox`, teclado reservado a un aviso de una línea, solo si idle, con debounce. **Convergencia independiente: confirma el diseño de kodo, no lo amplía.** |
| **Retención para aprobación humana** (`pending_approval/`, `should-hold?` en el daemon) | **DESCARTAR — duplicado** | Es la cola de integración: la entrada queda `pending` hasta que el operador ejecuta `--ff/--merge/--pr/--drop`, y kodo nunca hace push por su cuenta. |
| **Estado de cola por ubicación de fichero** (maildir `new/in_process/completed`, `sent/failed`) | **DESCARTAR** | kodo ya tiene `state.json` con `withStateLock`, transiciones que nunca borran y eviction FIFO. Migrar compraría crash-safety que temp+rename ya da, a cambio de reescribir el núcleo y romper el invariante de escritura atómica. |
| **Pipeline fijo de 6 roles** (`specifier → … → QA`) | **DESCARTAR** | Topología de producto distinta: multiplicaría por 6 el coste por tarea y exigiría reescribir el dispatcher. Además kodo ya tiene ese pipeline **dentro** de una sesión, vía GSD (`discuss → plan → execute → verify`). Lo aprovechable del pipeline es el par adversarial, que va en §2.2. |
| **Modo de recepción `batch`** (consumir todos los handoffs de igual prioridad como un lote) | **DESCARTAR** | El paso 5b de la ronda ya presenta la cola de integración **en bloque**. No hay problema que resolver. |
| **Broadcast terminal** (el último rol difunde a todos; ese conjunto marca Done) | **DESCARTAR** | Artefacto del pipeline de N roles. Con una sesión por tarea no hay a quién difundir. |
| **Watchdog de ventanas + kill-all** (reabre ventanas desaparecidas; si muere la ventana dueña del cleanup, mata todo el swarm) | **DESCARTAR** | `reconcileTick` + `kodo check` + cleanup de worktrees cubren la parte sana. El kill-all en kodo sería destructivo: mataría sesiones de trabajo del operador. |
| **Merge idempotente** (`merge-base --is-ancestor` antes de mergear) | **DESCARTAR — ya razonado** | `src/integration/capture.js:89-91` documenta explícitamente por qué kodo **no** usa `--is-ancestor` bajo su seam (comunica por exit code, no por stdout). No es un descuido. |
| **Constitución compartida + capas locales** (artículos versionados en el repo central, `local-*.prompt` por pack, prohibición de que un pack pise los filenames compartidos) | **DESCARTAR — mayormente cubierto** | `kodo skill sync` + la Phase 88 ya hacen distribución de skills. Lo único no cubierto es el guard "un proyecto no puede sobrescribir el fichero compartido", y no hay evidencia de que ese fallo haya ocurrido. |
| **Platoon / lieutenant / contratos de interfaz versionados** | **DESCARTAR el aparato** | Es un brainstorm **no implementado**. Adoptar un diseño sin una sola ejecución detrás es mal negocio. Ver §4 para la única primitiva que sí falta. |
| **`platoonctl`: "todo lo determinista va a la herramienta; el LLM decide y la invoca"** | **DESCARTAR — ya es el principio de kodo** | Núcleo determinista + orquestador LLM que lo shellea. Otra convergencia independiente. |
| **Rechazo de estados ambiguos sin auto-reparación** ("los helpers no ofrecen modos de recuperación") | **DESCARTAR — ya es la filosofía** | Mismo criterio fail-closed que `isOrchestratorIdle` y el resto de guards. |

---

## 4. Un hueco que el spike destapa (no viene de swarm-forge, lo señala por contraste)

kodo **no tiene ningún concepto de dependencia entre tareas**: lanza por prioridad y slots libres. El platoon dedica media página a orquestar dependencias con contratos de interfaz — aparato desproporcionado, pero apunta a una carencia real.

**La versión mínima y barata:** que el dispatcher **respete los bloqueos que el proveedor ya modela**. Plane tiene relaciones (`blocked_by`), y el MCP las expone (`list_work_item_relations`). Hoy una tarea bloqueada con label `kodo` se lanza igual. No hace falta inventar contratos ni squads: basta con no lanzar lo que el board ya declara bloqueado. Coste bajo, datos existentes, cero conceptos nuevos.

---

## 5. Recomendación final, priorizada

1. **Higiene de asserts de prompt** — despinear prosa y encabezados; conservar los asserts de contrato (placeholders, marcadores, nombres de comando). *Barato, arregla deuda ya medible, no depende de nada.*
2. **Aviso de cola de integración en el dispatcher** (§2.4) — el dato ya está en `state.json`; cero llamadas a git; aviso, nunca bloqueo.
3. **Respetar `blocked_by` del proveedor en el dispatcher** (§4) — usa datos que ya existen, cero conceptos nuevos.
4. **Audit gate adaptado** (§2.1) — **después de KODO-69**, para que oráculo y `audit_count` se presenten juntos en la cola. Con el requisito de que el segundo intento traiga commit o artefacto: sin eso es un doble tecleo.
5. **Rol reviewer adversarial opt-in** (§2.2) — milestone propio, con label `kodo:review`, tope de rondas y escalada. Mejor valor a medio plazo, mayor coste.

`task_base_commit` (§2.5) queda como acompañante de cualquier fase que ya toque el registro de sesión; no justifica trabajo propio.

**Lo que NO hay que hacer:** portar el transporte de handoffs, el maildir, el pipeline de roles ni el platoon. Las tres primeras están resueltas en kodo con otro idioma y mejor encaje; la cuarta no existe todavía ni en swarm-forge.

---

## Anexo — Convergencias independientes

Tres decisiones a las que los dos proyectos llegaron por separado. No son adopciones; son evidencia de que el diseño de kodo va por donde debe:

1. **Notificación lossy, cola durable.** Ambos concluyeron que teclear el trabajo al agente es frágil y que el estado tiene que vivir en disco, con la notificación reducida a "hay correo, míralo si estás libre".
2. **Determinista al núcleo, juicio al LLM.** `platoonctl` describe exactamente la frontera CLI/daemon vs. orquestador de kodo.
3. **Fail-closed ante estado ambiguo.** Ninguno de los dos auto-repara: paran y reportan.
