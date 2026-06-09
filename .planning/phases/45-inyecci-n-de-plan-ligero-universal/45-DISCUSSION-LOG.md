# Phase 45: Inyección de plan ligero universal - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-10
**Phase:** 45-Inyección de plan ligero universal
**Areas discussed:** Ruta del artefacto, Alcance de inyección, Formato y escritura, Fuerza de la instrucción

---

## Ruta del artefacto

| Option | Description | Selected |
|--------|-------------|----------|
| `~/.kodo/plans/<task_id>.md` | Kodo home, fuera del repo. Resoluble por hook y overlay vía task_id sin tocar worktree_path. Sobrevive al cleanup de worktrees. Cero ruido en git. Misma convención que logs/polling-state. | ✓ |
| In-repo bajo worktree/project | Ej. `<base>/.kodo/plan.md` dentro del worktree. Consistente con dónde viven los PLAN.md GSD, pero se pierde si el worktree se elimina, ensucia git status, y non-GSD no tiene estructura .planning. | |
| `~/.kodo/plans/<session_id>.md` | Igual que la recomendada pero keyed por session_id. Más preciso si una task reabre varias sesiones, pero el overlay correlaciona filas por task_id — añadiría un lookup indirecto. | |

**User's choice:** `~/.kodo/plans/<task_id>.md`
**Notes:** Correlación por task_id alinea con la selección por identidad del overlay. La creación del dir la hace el tool Write de la sesión, no el hook.

---

## Alcance de inyección

| Option | Description | Selected |
|--------|-------------|----------|
| Non-GSD + quick | Exactamente lo que pide PLAN-03. `buildSessionContext` entero + rama quick de `buildGsdContext`. Phase y bootstrap excluidas. | ✓ |
| Non-GSD + quick + bootstrap | Añade la rama bootstrap. Cubre el hueco teórico de una sesión GSD sin fase, pero amplía scope más allá de PLAN-03 y solapa con el plan que GSD escribirá. | |

**User's choice:** Non-GSD + quick
**Notes:** Bootstrap queda fuera; cuando resuelva fase, GSD genera su propio PLAN.md.

---

## Formato y escritura

### Formato

| Option | Description | Selected |
|--------|-------------|----------|
| Markdown simple, sin frontmatter | Prosa/bullets cortos: objetivo + pasos. Render limpio en el overlay. Correlación vía nombre de fichero. | ✓ |
| Markdown con frontmatter task_id | Bloque YAML con task_id/session_id para integridad/debug. Coste: overlay mostraría `---` crudos salvo stripping en Phase 46. | |

### Escritura

| Option | Description | Selected |
|--------|-------------|----------|
| Overwrite al empezar | Escribe una vez al inicio; re-dispatch sobrescribe (latest-wins). Coherente con snapshot-at-open. | ✓ |
| Write-once (no tocar si existe) | Preserva el primer plan, pero un re-run mostraría plan viejo desalineado. | |
| Append por re-run | Conserva historia, pero el overlay acumularía bloques stale y crecería sin límite. | |

**User's choice:** Markdown simple sin frontmatter + Overwrite al empezar
**Notes:** El overlay renderiza líneas planas → frontmatter sería ruido crudo y la correlación ya está en el nombre de fichero.

---

## Fuerza de la instrucción

| Option | Description | Selected |
|--------|-------------|----------|
| Imperativa de una línea | Frase directiva, sin ceremonia. ES en bloque non-GSD, EN en bloque quick. Mantiene quick ligero pero fiable. | ✓ |
| Opcional / suave | Tono 'si quieres'. Respeta el one-shot pero Claude la saltaría a menudo → artefacto ausente con frecuencia. | |
| Multi-paso / enfática | Bloque con 'debes' y formato impuesto. Máxima fiabilidad, pero contradice 'quick sigue ligero'. | |

**User's choice:** Imperativa de una línea
**Notes:** Coherencia idiomática por bloque (ES/EN). Redacción "además/also" para no chocar con el "comenta tu plan de acción" existente (que es un comentario al provider, no un fichero local).

---

## Claude's Discretion

- Posición exacta del append dentro de cada builder (debe preservar golden-bytes / HOOK-02).
- Mecánica de interpolar la ruta absoluta resuelta en el string inyectado.
- Microcopy exacta de la instrucción dentro de los límites D-05/D-07/D-08/D-09.

## Deferred Ideas

- Limpieza/retención de `~/.kodo/plans/` (purga de artefactos viejos) — candidato a higiene futura (`doctor`/cleanup), fuera de scope de PLAN-03.
- Frontmatter con metadata verificable — descartado ahora; reconsiderar solo si Phase 46 necesitara integridad explícita.
- Overlay que muestra el artefacto → Phase 46 (PLAN-04), ya en roadmap.
