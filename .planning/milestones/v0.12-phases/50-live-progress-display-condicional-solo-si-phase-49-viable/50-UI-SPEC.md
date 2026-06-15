---
phase: 50
slug: live-progress-display-condicional-solo-si-phase-49-viable
status: draft
shadcn_initialized: false
preset: none
created: 2026-06-12
---

# Phase 50 — UI Design Contract

> Contrato visual e interacción de la columna `prog` (progreso vivo `N/M`) del dashboard TUI.
> Generado por gsd-ui-researcher, verificado por gsd-ui-checker.

> **NATURALEZA DEL "UI":** Esto NO es UI web. Es **una columna de tabla de caracteres de ancho
> fijo** en el dashboard TUI (terminal ink/React) — `src/cli/dashboard/SessionTable.js`. El
> "design system" es el propio `COLS` + el molde de celda `cell()` ya shipped (Phases 36/38/43/44).
> Las decisiones visuales están **LOCKED por CONTEXT.md (D-06/D-07/D-09)**: este documento las
> formaliza como contrato, NO las reinventa. Las secciones web del template estándar (Spacing px,
> Typography, Color hex, Registry shadcn) **NO APLICAN** y se marcan N/A con justificación — son
> dimensiones de un medio (DOM/CSS) que este medio (caracteres de terminal) no tiene.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (TUI de caracteres — no hay design system web; el sistema ES `SessionTable.js`) |
| Preset | not applicable (no shadcn — render ink vía `React.createElement` plano, sin build step) |
| Component library | ink (`Box`/`Text`) — ya presente; cero componentes nuevos |
| Icon library | not applicable — único glifo es `✓` (U+2713) como sufijo de celda; sin librería de iconos |
| Font | terminal monospace del operador (no controlado por kodo); ancho de carácter fijo es el supuesto base |

**Color-isolation invariante (D-12 Phase 34, LOCKED):** todo color sale de props de `<Text>` de ink
(string name / `dimColor` / `bold`). La columna `prog` es **cero-color**: nunca recibe `color`, solo
`dim` (vía `dimColor`) para los degradados. CERO `picocolors`, CERO ANSI inline. El walker
`test/format-isolation.test.js` cubre este archivo automáticamente.

---

## Spacing Scale

**N/A — medio de caracteres, no CSS.** No hay píxeles, padding ni márgenes en una celda de terminal.
La única "métrica de espacio" es el **ancho de columna en caracteres** (`COLS`), gobernado por el
contrato de columna abajo. No declarar escala de 4/8/16/24.

Referencia del `COLS` real ya shipped (`SessionTable.js:54`):

```
COLS = { gutter: 2, state: 18, task_ref: 10, repo: 18, phasemode: 11, status: 18, task: 12, age: 7 }
```

`prog` se inserta **entre `status` (18) y la dupla `task` (12) / `age` (7)** — la zona "entre status
y age" que D-06 especifica. Como `task` (provider_state, Phase 43) ya vive en esa zona, el orden de
columnas resultante es: `… status → prog → task → age`.

---

## Typography

**N/A — medio de caracteres, no tipografía web.** No hay tamaños de fuente (px), pesos web ni
line-height. El único atributo "tipográfico" disponible es `bold` de ink, y se aplica **solo a la
fila seleccionada** (patrón fzf/vim ya shipped, gutter `› ` + `bold`), igual que toda otra celda —
la columna `prog` NO introduce énfasis tipográfico propio. No declarar sizes/weights.

Atributos de carácter que SÍ usa la celda `prog` (heredados del molde `cell()`):

| Atributo | Cuándo | Origen |
|----------|--------|--------|
| `bold` | fila seleccionada (igual que todas las celdas) | prop `selected` del row |
| `dimColor` (`dim`) | estados degradados `—` y `?` | `progCell().dim === true` |
| `wrap: 'truncate-end'` | desbordamiento anti-DoS (`truncate:true`) | red de seguridad T-43-03 |

---

## Color

**N/A para esta columna — cero-color por contrato (D-07 LOCKED).** La celda `prog` **nunca** recibe
un `color`; es el espejo EXACTO de la columna no-color `provider_state`/`task` (Phase 43): el rojo
queda reservado al eje local (zombie en la celda `state`); introducir una segunda paleta semántica
está explícitamente rechazado.

| Role | Value | Usage |
|------|-------|-------|
| Dominant | terminal default fg | texto crudo `N/M` y `N/M✓` (sin `color`) |
| Degraded dim | `dimColor` de ink (no un hex) | `—` (sin progreso) y `?` (fallo transiente) atenuados |
| Accent | **prohibido en esta columna** | n/a — cero-color es el invariante |
| Destructive | n/a | esta columna no tiene acciones; es ambient/read-only |

**Cero-color reservado para:** nada — la regla es la ausencia de color. El `dim` NO es color: es el
atributo `dimColor` de ink que sobrevive `NO_COLOR` y se mapea desde el bool plano `progCell().dim`.

---

## Column Contract — `prog` (el núcleo de esta fase)

> Esta sección **reemplaza** las dimensiones web del template. Es el contrato real que el planner y
> el executor consumen. Cada fila marcada **[LOCKED]** viene de CONTEXT.md D-06/D-07/D-09 y NO es
> negociable; **[DISCRECIÓN PLANNER]** son los dos únicos grados de libertad finos.

### Ubicación y condicionalidad

| Propiedad | Valor | Estado |
|-----------|-------|--------|
| Posición en `COLS` | entre `status` (18) y `task` (12) → orden `status → prog → task → age` | **[LOCKED D-06]** |
| Visibilidad | **condicional ambient** — la columna (cabecera + TODA celda de datos) se emite solo si alguna fila tiene progreso; se omite el elemento y ink recupera el ancho vía flex (cero aritmética de anchos) | **[LOCKED D-06]** |
| Flag de control | `deriveAnyProgress(sorted)` clonado de `deriveAnyGsd` — computado sobre el set **SIN filtrar** (`sorted`, no `filtered`) para que la columna NO parpadee al teclear `/` (Pitfall 5 / Phase 44 Pitfall 4) | **[LOCKED — espejo deriveAnyGsd]** |
| Acción del operador | **ninguna** — visibilidad ambient, sin tecla. El overlay-bajo-tecla fue rechazado | **[LOCKED D-06]** |

### Ancho y cabecera

| Propiedad | Valor | Estado |
|-----------|-------|--------|
| Ancho fino (`COLS.prog`) | **6 ó 7 caracteres** — debe alojar `N/M` + sufijo `✓` + ellipsis. Recomendación del researcher: **6** cubre `N/M✓` hasta `9/9✓` (4 chars) con padding; `M` de dos dígitos (`12/15✓` = 6) llena justo; sube a **7** si se quiere padding visible tras dobles dígitos (espejo de cómo `state` subió 16→18 por padding). Alinear con el estilo de `COLS` (anchos pares/legibles). | **[DISCRECIÓN PLANNER]** |
| Texto de cabecera | string literal corto, dimColor, emitido como `h(Text, { dimColor: true }, 'prog')`. Recomendación: **`prog`** (4 chars, cabe en 6/7; espejo de `task`/`age`/`repo` — labels lowercase cortos). Alternativa `prg` si se elige ancho 6 muy ajustado, pero `prog` es preferible (más legible, cabe). | **[DISCRECIÓN PLANNER]** |
| Alineación | left (default de ink `Box`, como todas las columnas de la tabla) — sin `justifyContent`. NO right-align: rompería la consistencia con el resto de `COLS` | **[LOCKED — consistencia COLS]** |
| Truncado anti-DoS | `truncate: true` (→ `wrap:'truncate-end'`, ellipsis nativo `…`) — un artefacto con `n`/`m` absurdos se trunca a la columna, NO desborda la tabla (mold T-43-03) | **[LOCKED D-07]** |
| Reserva de ancho para `✓` | el ancho fino DEBE contar el sufijo `✓` como parte del peor caso (`N/M✓`), no solo `N/M` | **[LOCKED D-07]** |

### Los 4 estados visuales de la celda (mold exacto de `taskCell`/`provider_state`)

`progCell(session) → { text, dim }` — espejo byte-a-byte de la forma de `taskCell` (Phase 43).
Render vía el `cell()` existente: `cell({ width: COLS.prog, text: pc.text, dim: pc.dim, bold: selected, truncate: true })`.

| # | Estado | `text` | `dim` | Cuándo | Estado |
|---|--------|--------|-------|--------|--------|
| 1 | En progreso | `N/M` crudo (p. ej. `1/3`, `2/3`) | `false` | artefacto legible, `m > 0`, `n < m` | **[LOCKED D-07]** |
| 2 | Completado | `N/M✓` (p. ej. `3/3✓`) | `false` | `completed === true` (`m > 0 && n === m`) — sufijo `✓` (U+2713) | **[LOCKED D-07]** |
| 3 | Sin progreso | `—` (em dash U+2014) | `true` | ENOENT / sin artefacto / sin todos. Espejo de `taskCell` `unsupported`→`—` | **[LOCKED D-09]** |
| 4 | Fallo transiente | `?` | `true` | error de lectura (EACCES / JSON corrupto) + **keep-last-good** lo gestiona App.js (último N/M conocido sobrevive en memoria). Espejo de `taskCell` `fetch-failed`→`?` | **[LOCKED D-09]** |

**Cohorte legacy / Task*-tools sin progreso (D-09):** una sesión sin tasks-dir → el hook nunca
dispara → no hay artefacto → estado #3 (`—`). **Tolerada por diseño**, igual que `provider_state`
tolera providers sin `getTaskState`. NO rompe la tabla.

**Monotonía (D-04):** el `N/M` es acumulado de toda la sesión y monótono (no resetea por wave). El
display NO deriva nada del progreso — lee `{ n, m, completed }` ya calculados por el productor.

---

## Copywriting Contract

> Esta es una columna de tabla **ambient/read-only**, sin CTA, sin empty-state heading propio, sin
> diálogos. El "copy" se reduce a los glifos/strings de celda y la cabecera — todos LOCKED arriba.

| Element | Copy | Notas |
|---------|------|-------|
| "CTA" primaria | **n/a** — columna ambient sin acción del operador (D-06) | no hay tecla ni interacción |
| Cabecera de columna | `prog` (DISCRECIÓN, ver arriba) | string literal dimColor |
| "Empty state" de celda | `—` (em dash) | sin artefacto / sin todos (estado #3) — NO un mensaje, un glifo |
| "Error state" de celda | `?` | fallo transiente + keep-last-good (estado #4) — NO un mensaje, un glifo |
| Completado | sufijo `✓` sobre `N/M` (`3/3✓`) | señal de "hecho" sin color |
| Confirmación destructiva | **n/a** — esta fase no tiene acciones destructivas (read-only, cero endpoints, cero escritura desde el dashboard; el hook escribe filesystem fire-and-forget, no es UI) | invariante read-only preservado |

**Consistencia con precedentes shipped:** los glifos `—` y `?` son los MISMOS que ya usa la columna
`provider_state`/`task` (Phase 43) para sus degradados — el operador ya conoce su semántica. Reusar
el vocabulario visual existente, NO inventar glifos nuevos (p. ej. evitar `n/a`, `--`, `err`).

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| shadcn official | n/a | not applicable — no shadcn, no React web, no registry |
| third-party | none | not applicable — cero paquetes nuevos (Node builtins + ink/react ya presentes, ver RESEARCH §Standard Stack) |

**Sin dependencias nuevas:** esta fase no instala nada (`package.json` intacto). Vetting gate de
registro no aplica.

---

## Interaction / Lifecycle Notes (no-template, load-bearing)

- **Read-only invariante preservado:** el dashboard solo LEE `~/.kodo/progress/<task_id>.json`
  filesystem-style (mold `readLightPlan`, never-throws, anti-ReDoS guard reusado). Cero endpoints
  nuevos. La única escritura de la fase es el hook fire-and-forget (no es UI). **[LOCKED D-08]**
- **Keep-last-good (D-09):** ante fallo transiente de lectura, App.js conserva en memoria el último
  `N/M` bueno; la celda muestra `?` pero el dato previo no se pierde entre polls. La política de
  keep-last-good vive en App.js (enriquecimiento), NO en `progCell` (puro/presentacional).
- **Persistencia post-mortem (D-10):** al morir/dismiss/completar, el artefacto persiste con el N/M
  final congelado (`3/3✓` o `2/3`). El display no distingue "sesión viva" de "sesión muerta con
  último estado" — pinta lo que el artefacto diga. Sin limpieza/TTL en esta fase.
- **NO_COLOR-safe:** toda la columna sobrevive `NO_COLOR` (cero color; `dim` y `bold` degradan
  limpio; los glifos `—`/`?`/`✓` son posicionales/textuales, no dependen de color).

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS — glifos `—`/`?`/`✓` + cabecera `prog`; cero CTA (columna ambient)
- [ ] Dimension 2 Visuals: PASS — 4 estados de celda especificados; truncado anti-DoS; ancho reserva `✓`
- [ ] Dimension 3 Color: PASS — cero-color por contrato (espejo `provider_state`); color-isolation intacta
- [ ] Dimension 4 Typography: N/A justificado — medio de caracteres, solo `bold`/`dim` de ink heredados
- [ ] Dimension 5 Spacing: N/A justificado — ancho de columna en caracteres (`COLS`), no CSS px
- [ ] Dimension 6 Registry Safety: N/A justificado — no shadcn, cero paquetes nuevos

**Approval:** pending
