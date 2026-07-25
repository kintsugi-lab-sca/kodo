# Phase 83: Inbox foundation — captura + triage - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-25
**Phase:** 83-Inbox foundation — captura + triage
**Mode:** `--auto` — sin `AskUserQuestion`; en cada pregunta se auto-selecciona la opción recomendada, registrada aquí para auditoría.
**Areas discussed:** Modelo de estado del marcado, Formato de línea e identidad, Seam de enrutado, Superficie CLI, Derivación de tag-proyecto y origen, Degradación del reader, Validación de concurrencia

---

## Modelo de estado del marcado

`[auto]` Q: "¿Lock compartido `withFileLock` o event-log append-only para el marcado?"

| Opción | Descripción | Selected |
|--------|-------------|----------|
| Lock compartido `withFileLock` (recomendada) | Ambos carriles toman el mismo lock; el marcado es el único que reescribe; la línea conserva su estado y su destino | ✓ |
| Event-log append-only puro | El marcado appendea una línea de evento; el estado se pliega en lectura; cero locks | |
| Marcado in-place posicional | `pwrite` de un token de estado de ancho fijo a un offset calculado; regiones disjuntas del append | |

**Selección:** Lock compartido `withFileLock` (recomendada) → D-01.
**Notas:** El event-log choca con dos cosas ya fijadas: CAPT-06 exige el trace pointer **«en su línea»** (en un event-log el destino vive en la línea de evento), y §Out of Scope justifica no hacer editor TUI porque *el fichero es human-editable en markdown*. El marcado posicional queda descartado por CAPT-06 también: el `→ destino` es de longitud variable, así que hay RMW igual — la fragilidad de offsets no compraría nada. El `Depends on` del ROADMAP ya apuntaba a `withFileLock`.

`[auto]` Q: "¿Qué hace `kodo capture` si el lock hace timeout?"

| Opción | Descripción | Selected |
|--------|-------------|----------|
| Fail-open: appendear igual + warn (recomendada) | Agotado el presupuesto de reintentos, appendea con `O_APPEND` y avisa por stderr | ✓ |
| Fallar con exit code no-cero | La captura se rechaza y el operador reintenta | |

**Selección:** Fail-open (recomendada) → D-03.
**Notas:** Principio GTD — una idea perdida es peor que una línea escrita sin coordinación. Riesgo residual acotado y documentado: solo pierde si el timeout (~160 ms de reintentos) coincide además con la ventana read→rename de un marcado. No se enmascara.

---

## Formato de línea e identidad de la captura

`[auto]` Q: "¿Cómo se identifica una captura para marcarla?"

| Opción | Descripción | Selected |
|--------|-------------|----------|
| ID corto opaco en la línea (recomendada) | Generado en captura con `node:crypto`; handle estable de `route`/`discard` | ✓ |
| Índice de línea | Sin ruido visual, pero posicional | |
| Hash del contenido | Determinista a partir del texto | |

**Selección:** ID corto opaco (recomendada) → D-06.
**Notas:** El índice se invalida en cuanto el humano edita el fichero — y editarlo a mano es un caso de uso admitido. El hash colisiona con dos capturas de texto idéntico.

`[auto]` Q: "¿Qué forma tiene la línea?"

| Opción | Descripción | Selected |
|--------|-------------|----------|
| Checkbox markdown + campos ` · ` (recomendada) | `- [ ] id · texto · tag · fecha · origen`, cierre con sufijo `enrutada → dest` / `descartada` | ✓ |
| Línea plana sin checkbox | Solo campos separados | |

**Selección:** Checkbox markdown (recomendada) → D-05, D-07, D-08.
**Notas:** El checkbox da abierta/cerrada de un vistazo en cualquier visor markdown; el sufijo discrimina cuál de los dos cierres. El parseo se ancla a la cola (ID al principio, 3 campos estructurados al final) para que el texto del usuario pueda contener ` · ` sin escaparse ni degradarse.

---

## Seam de enrutado a `gsd-capture`

`[auto]` Q: "¿`kodo inbox` invoca `gsd-capture` o el seam es documental?"

| Opción | Descripción | Selected |
|--------|-------------|----------|
| Seam documental puro (recomendada) | kodo expone `route`/`discard`; quién enruta es el operador o el LLM en sesión | ✓ |
| `kodo inbox` shellea `gsd-capture` | Enrutado en un solo paso desde el CLI | |

**Selección:** Seam documental puro (recomendada) → D-09, D-10, D-11.
**Notas:** `gsd-capture` es un skill de Claude Code (destinos: todos, notas, backlog 999.x, seeds), no un binario con contrato de retorno máquina-legible — no hay nada que shellear ni ref que recoger automáticamente. Esto explica de paso por qué CAPT-06 es best-effort: `--dest` es opcional y su ausencia jamás bloquea el marcado.

---

## Superficie CLI de `kodo inbox`

`[auto]` Q: "¿TUI interactivo, flags sobre un comando único, o subcomandos?"

| Opción | Descripción | Selected |
|--------|-------------|----------|
| Subcomandos planos + `--json` (recomendada) | `kodo inbox` / `route <id>` / `discard <id>`, exit codes 0/1/2 | ✓ |
| TUI ink interactivo | Triage navegable en el dashboard | |
| Flags sobre un comando único | `kodo inbox --route <id>` | |

**Selección:** Subcomandos planos (recomendada) → D-12, D-13, D-14.
**Notas:** El TUI in-place está en §Out of Scope explícitamente. Los subcomandos espejan `kodo gsd doctor` / `sidebar doctor` / `skill sync`, con el mismo thin-handler + formatter + exit codes. Sin filtros `--project`/`--open`: CAPT-F1 está diferido a v2.

---

## Derivación de `tag-proyecto` y `origen`

`[auto]` Q: "¿Qué tag lleva una captura hecha desde un cwd no mapeado?"

| Opción | Descripción | Selected |
|--------|-------------|----------|
| `resolveProjectId`, fallback `basename(cwd)` (recomendada) | Un solo campo, siempre poblado e informativo | ✓ |
| Tag vacío `—` | Distingue mapeado de no mapeado, pierde el origen | |
| Literal `unknown` | Explícito pero inútil para el triage | |

**Selección:** `resolveProjectId` con fallback a `basename(cwd)` (recomendada) → D-15, D-17.
**Notas:** Saber de dónde vino una idea es la mitad del valor del tag. Se documenta que un tag no mapeado es sencillamente el directorio. Sin `--project` de override: superficie que la derivación por cwd ya cubre.

`[auto]` Q: "¿Cómo captura Phase 84 sin duplicar el writer?"

| Opción | Descripción | Selected |
|--------|-------------|----------|
| Campo `origen` + flag interno `--origin` (recomendada) | El skill de 84 shellea `kodo capture --origin skill`; un solo writer | ✓ |
| Origen hardcodeado a `cli` | Menos superficie ahora, rompe CAPT-02 después | |

**Selección:** `--origin` interno (recomendada) → D-16.
**Notas:** No es especulación: CAPT-02 exige formato byte-idéntico con un solo writer. Sin el flag en 83, la fase 84 tendría que cambiar el formato o escribir el fichero por su cuenta.

---

## Degradación del reader / fichero human-editable

`[auto]` Q: "¿Qué pasa con una línea que no parsea?"

| Opción | Descripción | Selected |
|--------|-------------|----------|
| Preservar byte a byte + excluir del listado (recomendada) | No es captura válida, pero kodo no la tira | ✓ |
| Mostrarla verbatim en el listado | Visibilidad del ruido a costa de ensuciar el triage | |
| Descartarla al reescribir | Normaliza el fichero, destruye ediciones manuales | |

**Selección:** Preservar + excluir (recomendada) → D-18, D-19, D-20.
**Notas:** La preservación byte a byte de toda línea no marcada es un **invariante** (D-04), no una cortesía: el fichero es human-editable por diseño, y el marcado no puede destruir lo que el humano escribió a mano.

---

## Validación de concurrencia

`[auto]` Q: "¿Cómo se prueba que «una captura concurrente durante el marcado nunca se pierde»?"

| Opción | Descripción | Selected |
|--------|-------------|----------|
| Procesos reales + barrier file (recomendada) | Patrón `test/gsd-lock-race.test.js`, incluye el caso mixto captura↔marcado | ✓ |
| Solo unit tests in-process | Más barato, no ejerce la concurrencia real | |

**Selección:** Procesos reales + barrier (recomendada) → D-21, D-22.
**Notas:** El caso mixto es el que da evidencia al criterio de éxito 3 del ROADMAP; sin él, la decisión del modelo de estado quedaría sin prueba. El golden de formato (D-22) es además el contrato que Phase 84 comparará byte a byte.

---

## Claude's Discretion

Longitud y alfabeto del ID corto · nombre exacto del lockfile · organización de módulos (lógica pura + thin CLI handler, espejo `skill-sync.js` → `skill/sync.js`) · regex del parser anclado a cola · copy de mensajes y listado · N del test de concurrencia · numeración de filas en el listado human.

## Deferred Ideas

- CAPT-F1 (filtros `--project`/`--open`) y CAPT-F2 (archival/rotación) — v2, con su trigger real.
- Phase 84: `/kodo-capture` mid-session, `kodo skill sync` multi-skill, conteo ambient en el dashboard.
- R-82-01 (carrera de 2º orden en `stealLock`, holder VIVO) — ajena a esta fase: el inbox usa `withFileLock`, no `src/gsd/lock.js`.
- Riesgo residual de D-03 — si se materializa, el fix es subir el presupuesto de reintentos de la captura, nunca debilitar el test de D-21.
