---
phase: 75
slug: superficie-del-next-dashboard-y-nudge
status: draft
shadcn_initialized: false
preset: none
created: 2026-07-17
surface: tui-ink
---

# Phase 75 — Contrato de Diseño de UI (TUI)

> Contrato visual y de interacción para la **superficie TUI** (ink@6 + react@19, `React.createElement`,
> sin build step). NO es UI web: no hay CSS, fuentes, breakpoints ni ratios WCAG. Cada contrato se
> ancla en los patrones TUI ya vivos del directorio `src/cli/dashboard/**` y en las decisiones
> LOCKED de `75-CONTEXT.md`. Generado por gsd-ui-researcher, verificado por gsd-ui-checker.

**Superficies de esta fase:**
1. **Tabla del dashboard (LIVE-05)** — columna condicional `next` leída de `state.json`.
2. **Overlay de plan renderizado (LIVE-06)** — mini-renderer markdown line-based, solo carril
   `phaseId == null` (light-plan), strip del marcador `<!-- kodo:handoff … -->`.
3. **Nudge del orquestador (LIVE-07)** — línea adicional ES en `buildStopNudgeText` cuando hay `NEXT:`.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (TUI in-house — cero deps npm nuevas, invariante cross-milestone) |
| Preset | not applicable |
| Component library | ink@6 (`<Box>`, `<Text>`) + react@19 (`createElement`) — no build step |
| Icon library | none — glifos Unicode inline ya en uso (`▶`, `⚠`, `●`, `…`, `✓`) |
| Font | monospace del terminal del usuario (no controlable, no declarado) |
| Color model | **nombres de color de ink `<Text>` únicamente** — jamás hex, jamás picocolors, jamás ANSI inline (color isolation, `test/format-isolation.test.js` escanea `src/cli/dashboard/**`) |
| Accesibilidad | legible en temas claro/oscuro de terminal; `NO_COLOR` respetado por ink/patrones existentes; adaptación de ancho vía truncado/flex, NO breakpoints |

---

## Spacing Scale

> En una TUI el "spacing" son **anchos de columna en caracteres** (`COLS`, `SessionTable.js:95`) y el
> layout flex de ink, NO múltiplos de 4px. El contrato aquí es el ancho y el orden de la columna nueva.

| Token (columna) | Ancho (chars) | Uso |
|-----------------|---------------|-----|
| `next` (nuevo) | Claude's Discretion del planner, ancho flexible; recomendado `~40` como base, última posición | Celda del `NEXT:` por tarea; columna condicional al FINAL del orden actual |

**Orden de columnas resultante (D-04):** `gutter → state → task_ref → repo → [phasemode] → status → [prog] → task → age → [next]`.

- La columna `next` va **después de `age`** (última posición). Es **condicional**: solo se emite si `anyNext === true` (mismo mecanismo que `prog` y `phasemode`); cuando se omite, ink recupera el ancho vía flex.
- Ancho exacto y comportamiento flex/fijo: **Claude's Discretion** respetando el objeto `COLS`.
- El valor ya llega acotado a 200 chars desde `state.json` (74 D-02); la celda **trunca adicionalmente** al ancho de columna con `cell({ truncate: true })` → ellipsis nativo `…` de ink (`wrap:'truncate-end'`). Doble acotado (Pitfall 6).

Excepciones: ninguna. No se toca ningún `COLS` existente; solo se añade la clave `next`.

---

## Typography

> En una TUI no hay tamaños de fuente ni line-height. El "peso/estilo tipográfico" son **props de estilo
> de ink `<Text>`**: `bold`, `dimColor`, `color`. El contrato declara qué prop aplica a cada elemento.

| Elemento | Estilo ink | Racional |
|----------|-----------|----------|
| Header de columna `next` | `dimColor: true`, texto `next` | Espejo literal de los headers `prog`/`age` existentes |
| Celda `next` (fila normal) | sin atributo, `truncate: true` | Espejo de `taskCell`/`progCell`; texto plano truncado |
| Celda `next` (fila seleccionada) | `bold: true`, `truncate: true` | Consistencia con el resaltado de fila seleccionada existente (`bold: selected`) |
| Overlay — heading markdown (`#`, `##`) | `bold: true`, `color: 'cyan'` | Jerarquía visual best-effort del mini-renderer (D-05) |
| Overlay — línea `**Label:**` | `bold: true` | Etiqueta destacada, best-effort |
| Overlay — bullet (`- `, `* `) | sin atributo | Línea de lista plana, best-effort |
| Overlay — code fence (dentro de ` ``` `) | `dimColor: true` | Bloque de código atenuado |
| Overlay — párrafo/otras líneas | sin atributo | Texto plano por defecto |

**Nota de abreviación del header:** `next` cabe sin abreviar; si el planner elige un ancho menor, abreviar el header es Claude's Discretion (mientras siga siendo legible). Header en minúscula, coherente con `prog`/`task`/`age`.

---

## Color

> **Solo nombres de color de ink `<Text>`** (`color: 'cyan'`, `dimColor: true`). Cero hex, cero
> picocolors, cero ANSI. Invariante forzado por `test/format-isolation.test.js`. No aplica el modelo
> 60/30/10 web — el contrato es minimalista y por defecto atenuado.

| Rol | Valor (ink) | Uso |
|-----|-------------|-----|
| Neutro dominante | sin atributo (color de foreground del terminal) | Celda `next`, párrafos y bullets del overlay — el grueso del texto |
| Atenuado (secundario) | `dimColor: true` | Header de columna `next`, code fences del overlay |
| Acento | `color: 'cyan'` | **Reservado exclusivamente** a los headings markdown (`#`/`##`) del overlay light-plan |
| Destructivo | no aplica | Esta fase no tiene acciones destructivas |

Acento reservado para: **solo los headings markdown del overlay light-plan** (D-05). NO se usa color de acento en la celda `next` de la tabla (texto neutro/atenuado, coherente con `prog`/`task`).

**Invariante de saneo previo al color (V5 Input Validation):** el valor `next` proviene de `state.json` y es contenido escrito por un LLM. DEBE pasar por `stripControlChars` (`src/cli/format.js`, el mismo que ya sanea `task_ref`/`summary` en `App.js:737-741`) ANTES de renderizarse en la celda `next`. Igual para las líneas del plan en el mini-renderer si el carril de lectura no las saneó ya. Neutraliza inyección de escapes de terminal (OSC-52/CSI/C1) — Tampering (STRIDE).

---

## Copywriting Contract

> Los "copies" de esta fase son: (1) el contenido de la celda cuando falta `NEXT:`, (2) las copias
> discriminadas del overlay ya existentes, y (3) la línea del nudge. Todo en español (identificadores
> y rutas en su forma original).

| Elemento | Copy / Contrato |
|----------|-----------------|
| Celda `next` sin dato (SC#5) | **cadena vacía `''`** — sin placeholder, sin guion, sin "N/A". Cero ruido visual (`nextCell` devuelve `''` cuando `next` es falsy) |
| Celda `next` con dato | el valor `next` saneado, truncado al ancho con ellipsis `…` |
| Overlay — estado `ok` (light-plan) | markdown renderizado line-based, marcador `<!-- kodo:handoff … -->` **invisible** (strippeado, D-06) |
| Overlay — estado `no-light-plan` | copia existente **intacta** (plan ausente); no se reescribe |
| Overlay — estado `error` | copia existente **intacta** (lectura fallida); no se reescribe |
| Overlay — estados GSD (`no-phase`/`no-plan`/`ok` GSD) | copias existentes **byte-idénticas** — el mini-renderer NO toca la rama GSD (SC#3, D-07) |
| Nudge SIN `NEXT:` | texto por-modo actual **byte-idéntico** (quick/full/no-GSD) — degradación limpia, tests del nudge intactos (D-09) |
| Nudge CON `NEXT:` | +1 línea ES al final del texto por-modo: `Siguiente paso sugerido por la sesión: <next>` (redacción literal = Claude's Discretion; debe ser ES, una línea, escape `\\n` convención D-04 Phase 10). Aplica a los 3 modos (D-10) |
| Acción destructiva | ninguna en esta fase |

**Nota de no-regresión (SC#3):** la copia de cualquier overlay GSD y el nudge sin `NEXT:` deben quedar byte-idénticos; hay tests de no-regresión explícitos que lo verifican.

---

## UI Considerations

> Cobertura de **estados de UI** de la superficie TUI. Las copias de estado vacío/error viven arriba en
> `## Copywriting Contract`; esta sección cubre la cobertura de estado y las referencia.

Applicable state considerations resolved: **7 covered, 1 backstop, 0 unresolved**
(probe ejecutado post-verificación bajo `--auto`; kinds confirmados por Claude: E1 celda de tabla/lista,
E2 vista de contenido read-only, E3 copy de texto — el clasificador heurístico marcó E1/E3
`unclassified` por cues en español, resueltos aquí por kind-identification, nunca auto-dismiss)

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | celda `next` (tarea sin `NEXT:`) | ✅ covered | `nextCell` devuelve `''`; celda vacía sin placeholder (SC#5). Cubierto por `test/dashboard-format.test.js` |
| empty | columna `next` completa (ninguna fila con dato) | ✅ covered | `deriveAnyNext` → `false` → la columna no se emite; ink recupera el ancho vía flex. Computado sobre `enriched` sin filtrar (Pitfall 4) |
| empty | nudge sin `NEXT:` (tarea sin dato persistido) | ✅ covered | Texto por-modo **byte-idéntico** al actual (D-09) — ver fila «Nudge SIN `NEXT:`» del `## Copywriting Contract`; tests de no-regresión del nudge |
| error | `readTasks` sobre `state.json` ausente/corrupto/sin clave `tasks` | ✅ covered | Reader leaf never-throws colapsa a `{}` → celdas vacías, cero ruido, TUI never-throws (SC#5). `test/dashboard-tasks.test.js` (Wave 0) |
| error | overlay light-plan con plan ausente/ilegible | ✅ covered | Estados `no-light-plan`/`error` existentes, copias intactas; el mini-renderer solo actúa sobre `ok` |
| overflow | celda `next` con valor largo (hasta 200 chars) | ✅ covered | Doble acotado: 200 en el dato (74 D-02) + `cell({ truncate:true })` al ancho de columna → ellipsis `…` (Pitfall 6) |
| partial | filtro `/` activo mientras hay filas con `next` | ✅ covered | `anyNext` se computa sobre el set SIN filtrar → la columna no parpadea al teclear la query (Pitfall 4) |
| long-text / overflow | overlay light-plan con plan muy largo (handoffs acumulados) | 🧪 backstop | El mini-renderer pinta snapshot sin scroll propio hoy (overflow = mismo root: contenido excede el contenedor); scroll/paginación está OUT OF SCOPE (diferido v0.18, M21). El render best-effort (headings/labels/bullets/fences, NO CommonMark) es suficiente para el UAT de LIVE-06 — si el UAT humano exige más (tablas/links/nested), es fricción a confirmar con el operador (A3) |

**Estado transversal (SC#5) — "todo degrada limpio":** los cinco caminos de dato ausente (tarea recién creada, handoff mecánico sin `NEXT:`, plan ausente, plan ilegible, `state.json` corrupto) resuelven a celda vacía + nudge sin contexto + TUI never-throws, sin logs nuevos ni placeholders. Es el invariante de calidad primario de la fase.

---

## Registry Safety

**No aplica** — esta superficie es una TUI in-house (ink + react), no usa shadcn ni registries de componentes. Invariante cross-milestone: cero dependencias npm nuevas. El mini-renderer markdown (D-05) es explícitamente in-house para NO añadir `marked`/`ink-markdown`.

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| none | none | not applicable |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
