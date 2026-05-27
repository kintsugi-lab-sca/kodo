---
phase: 36
slug: tabla-viva-render-seleccion-filtros
status: draft
shadcn_initialized: false
preset: none
surface: TUI
created: 2026-05-27
---

# Phase 36 — UI Design Contract (TUI)

> Contrato visual y de interacción para la **tabla viva** del dashboard `kodo dashboard`.
> Generado por gsd-ui-researcher, verificado por gsd-ui-checker.
>
> **⚠ SUPERFICIE = TUI, NO WEB.** No hay CSS, ni Tailwind, ni tokens web. El "sistema de diseño"
> es exclusivamente **ink** (`<Box>` / `<Text>`) + `React.createElement` en `.js` plano (sin JSX,
> sin build step). Las dimensiones web del template (escala de espaciado en px, type scale, tokens
> de color hex, registry shadcn) se han **traducido a sus equivalentes ink**. Donde el template
> pide un token web sin equivalente, la fila se marca explícitamente `N/A (TUI)`.
>
> **Invariante dura cross-milestone (color-isolation, D-12 Phase 34):** CERO `picocolors` bajo
> `src/cli/dashboard/**`; CERO import de `src/cli/format.js`. Todo el color sale de props de
> `<Text>` de ink. Verificado por `test/format-isolation.test.js` (walker extendido al dir TUI).
> El render DEBE degradar bajo `NO_COLOR` — **prohibido depender solo del color** (D-09).

---

## Design System (equivalentes ink)

| Property | Value |
|----------|-------|
| Tool | none (TUI — no shadcn, no `components.json`, no tailwind config; confirmado en scout) |
| Preset | not applicable (TUI) |
| Component library | **ink `^6.8.0`** (`<Box>` Flexbox + `<Text>`), `react@^19.2.0`, `React.createElement` plano |
| Icon library | N/A (TUI) — glifos Unicode inline únicamente: `●` (live), `⚠` (degradado), `…` (truncado), `›` (gutter de selección), `↑↓` (hints) |
| Font | N/A (TUI) — monoespaciada de la terminal del operador (no controlable) |
| Color source | **SOLO** `<Text color>` / `dimColor` / `inverse` / `bold` de ink. Nombres de color ink: `green` `yellow` `cyan` `red` `magenta` `gray`. Prohibido `picocolors`. |
| Test harness | `ink-testing-library@^4.0.0` (`lastFrame()` / `stdin.write()`), `node:test` + `node:assert/strict` |

---

## Spacing Scale (equivalente ink — unidades de `<Box>`)

> En TUI no hay px. El "espaciado" es: ancho de columna en caracteres (`width`), padding/margin de
> `<Box>` en celdas de terminal (enteros), y separación entre columnas. El template web (4/8/16/24…)
> **N/A**. Se declara aquí la grid de la tabla.

### Anchos de columna fijos (D-02 — Discretion resuelta)

| Columna | Ancho (chars) | Truncado | Fuente del dato (D-03) |
|---------|---------------|----------|------------------------|
| _gutter selección_ | 2 | no | `›` + espacio si fila seleccionada, 2 espacios si no (redundancia NO_COLOR del highlight) |
| `task_ref` | 10 | `…` truncate-end | `session.task_ref` directo (`"KL-42"`, `"#42"`) |
| `repo` | 18 | `…` truncate-end | **DERIVADO**: `session.project_name ?? basename(session.project_path)` — NO existe campo `repo` |
| `phase/mode` | 11 | `…` truncate-end | `phase_id` + `gsd_mode` join `/` (p.ej. `36/full`); no-GSD → `—` |
| `status` | 18 | no truncar | `statusLabel(status, alive)` — DEBE caber `running (zombie)` (16 chars) sin truncar |
| `age` | 7 | no truncar | `formatAge(elapsed_min)` → `5m` / `1h3m` / `2h`; null/neg → `—` |

- **Total fila:** 2 + 10 + 18 + 11 + 18 + 7 = **66 chars** + separación de 1 char entre columnas (≈5) ≈ **71 chars**. Cabe en el floor de 80 columnas sin reflow. No hay layout responsive (D-02, YAGNI).
- **Padding del contenedor raíz:** `borderStyle: 'round'` + `paddingX: 1` (conservado de Phase 34 `App.js`).
- **Separación vertical:** header ↔ tabla = `marginY: 1` (patrón existente de la status line Phase 35).
- **Padding de celda:** `padEnd(width)` para alineación a la izquierda; truncado con ink `wrap: 'truncate-end'` (ellipsis nativo `…`) dentro del `<Box width>`. `rowCells` puede pre-truncar para asserts deterministas de `lastFrame()`.

Exceptions: la columna `status` se exime del truncado porque su marca textual `(zombie)` (D-09) es load-bearing para accesibilidad y NO debe perderse por ellipsis.

---

## Typography (equivalente ink — atributos de texto)

> En TUI no hay tamaños de fuente ni line-height. La "tipografía" son los atributos de `<Text>`:
> `bold` / `dimColor` / `inverse` / color. Se declaran exactamente los 3 roles usados.

| Rol | Atributo ink | Uso |
|-----|--------------|-----|
| Banner / título | `bold` | `kodo dashboard` (header, conservado de Phase 34) |
| Cabecera de columnas | `dimColor` | fila de cabeceras `task_ref  repo  phase/mode  status  age` (atenuada para separarla de los datos) |
| Fila de datos (normal) | _(sin atributo)_ + color semántico en celda `status` | celdas de cada sesión; solo la celda `status` lleva color (D-08) |
| Fila seleccionada | `inverse` (toda la fila) + gutter `›` | resalta la fila bajo el cursor (ver Selected-Row Treatment) |
| Hints / footer | `dimColor` | footer `↑↓ move · / filter · q quit` |

- **Regla de no-redundancia de atributos:** una celda NO combina `inverse` + `color` semántico simultáneamente de forma que se anule la lectura; en la fila seleccionada el `inverse` aplica al texto y el color semántico de `status` se mantiene legible (ink compone inverse sobre el color). Test de render debe confirmar que la marca `(zombie)` sigue presente en `lastFrame()` aun en la fila seleccionada.
- **NO usar `bold` para semántica de estado** — el color (celda `status`) + la marca textual son los únicos portadores de semántica de estado.

---

## Color (equivalente ink — paleta semántica `status` + `alive`)

> El modelo web 60/30/10 **N/A** en TUI (el fondo lo controla la terminal del operador). Lo que sí
> es un contrato duro es la **paleta semántica `status` + `alive` → nombre de color ink** (D-08) y la
> **redundancia textual** obligatoria (D-09). Los nombres de color son *strings* que ink convierte a
> ANSI internamente (vía su propio chalk) — NUNCA `picocolors`.

### Paleta de estado (D-08, D-09 — LOCKED, no re-discutir)

| Estado (`status` + `alive`) | Color ink (`<Text color>`) | Marca textual (D-09, NO_COLOR) | Significado |
|-----------------------------|----------------------------|--------------------------------|-------------|
| `running` + `alive` | `green` | `running` | Sesión viva y sana |
| `running` + `!alive` (**ZOMBIE**) | `red` | **`running (zombie)`** | ⚠ Proceso muerto pero marcado running — el caso peligroso de TUI-10 |
| `review` | `cyan` | `review` | Esperando revisión |
| `error` | `magenta` | `error` | Tarea con error (DISTINTO del red del zombie a propósito) |
| `done` | `dimColor: true` (gray) | `done` | Completada |

- **Regla load-bearing (D-09 / Pitfall 4):** el zombie DEBE ser distinguible de un `running` sano **sin color**. La marca `(zombie)` en la celda `status` es la red de seguridad de accesibilidad. Un render con `NO_COLOR=1` que no muestre `(zombie)` es un FALLO de contrato.
- **`statusColor(status, alive)` es una función pura** que devuelve `{ color?: string, dim?: boolean }` (nombre de color ink, jamás ANSI). Testeable sin ink.
- **El red está reservado SOLO para el zombie** (`running`+`!alive`). El error usa `magenta` para no confundir "tarea con error" con "proceso muerto". No reutilizar `red` para nada más en esta fase.

### Indicador de conexión del header (D-10 — reusa Phase 35, NO reinventar)

| Estado de conexión | Glifo + color | Texto | Fuente |
|--------------------|---------------|-------|--------|
| `connected` (último poll ok) | `●` `green` | `● live` | estado `connected` de `App.js` Phase 35 |
| `had good + !connected` (degradado) | `⚠` `yellow` | `⚠ server caído` (+ edad + retrying) | keep-last-good Phase 35 |
| `never had good` (arranque) | _(sin glifo)_ `dimColor` | `waiting for server` | Phase 35 |

> Este indicador YA existe en `App.js` (Phase 35) y se **mueve/integra** al header de la tabla, no se reescribe (D-10).

Accent reserved for: en TUI el único "accent" es el **color semántico de la celda `status`** y el **glifo `●`/`⚠` del indicador live**. Ningún otro elemento lleva color. La selección NO usa color (usa `inverse` + gutter `›`).

---

## Selected-Row Treatment (Discretion resuelta — D-05/D-06/D-07)

> Cómo se ve la fila bajo el cursor. La selección se rastrea por `selectedTaskId` (D-05), nunca por
> índice; el índice visible se deriva en cada render vía `resolveSelection` (D-06).

| Aspecto | Contrato |
|---------|----------|
| Resalte visual | `inverse` aplicado a **toda la fila** (todas las celdas), vía `<Text inverse>` por celda o un `<Box>` con fondo inverso |
| Redundancia NO_COLOR | **gutter `›`** en la columna 0 (ancho 2) de la fila seleccionada; filas no seleccionadas → 2 espacios. Garantiza que la selección sea visible sin depender de `inverse` en terminales que lo ignoren |
| Celda `status` en fila seleccionada | mantiene su color semántico (D-08) **además** del `inverse`; la marca `(zombie)` permanece legible |
| Selección inicial (D-07) | primera fila tras el orden (D-04) cuando hay ≥1 sesión; `null` cuando la lista está vacía |
| Movimiento ↑/↓ (D-07) | mueve el índice derivado y re-fija `selectedTaskId` al row resultante; **clamp en los extremos, SIN wrap-around** |
| Fila seleccionada desaparece (D-06) | fallback al row del mismo índice posicional previo, clampado a `[0, len-1]`; lista vacía → `selectedTaskId = null`. NUNCA apuntar a un `task_id` ausente |

- **React `key` de cada fila = `task_id`** (no índice) — preserva la reconciliación y evita el shuffle de filas (Pitfall 7).
- **El gutter `›` es obligatorio**: es la red de seguridad de la selección bajo NO_COLOR, equivalente accesible al `(zombie)` para el estado.

---

## Layout de la tabla (contrato de render — D-01)

```
╭──────────────────────────────────────────────────────────────────────╮
│ kodo dashboard   ● live   3 running · 1 zombie · 1 review              │   ← header: banner bold + indicador (D-10) + contadores (D-11)
│                                                                        │
│   task_ref   repo               phase/mode  status              age    │   ← cabecera de columnas (dimColor)
│ › KL-42      kodo               36/full     running             5m     │   ← fila seleccionada: inverse + gutter ›  (status verde)
│   KL-7       acme-web           —            review             1h3m   │   ← review cyan
│   KL-99      legacy-svc         12/quick     running (zombie)    2h     │   ← zombie: red + marca textual
│                                                                        │
│ / r:kodo s:running▏                                                    │   ← línea de filtro (solo cuando mode==='filter')
│ ↑↓ move · / filter · q quit                                            │   ← footer (dimColor)
╰──────────────────────────────────────────────────────────────────────╯
```

- **Estructura ink (D-01):** `<Box flexDirection="column">` raíz; header `<Box flexDirection="row">`; lista `<Box flexDirection="column">` con un `<Box flexDirection="row">` por fila; cada celda un `<Text>` dentro de un `<Box width>`.
- **Orden de filas (D-04 — Discretion resuelta): DESCENDENTE por `started_at`** (la sesión más reciente arriba — es el target de attach más probable del operador), con `task_id` como desempate determinista. Sort sobre una **copia** del array (no mutar el resultado de `usePoll`). La dirección es FIJA.
- **Pipeline de derivación (orden obligatorio):** `sortSessions` → `applyFilter` → `resolveSelection` (resolver SIEMPRE contra la lista ya filtrada — Pitfall 3 / D-16).
- **Prohibido:** `formatTable`/`formatRow` de `src/cli/format.js`, `ink-table`, `console.clear()` / ANSI manual, recomputar `age` con timer cliente, selección por índice.

---

## Header de contadores (D-11 — Discretion resuelta)

| Aspecto | Contrato |
|---------|----------|
| Formato | compacto, separador ` · ` (p.ej. `3 running · 1 zombie · 1 review`) |
| Estados incluidos (Discretion) | **TODOS los estados con count ≥ 1**: `running`, `zombie`, `review`, `error`, `done` (no solo "activos") |
| Zombie | contado **aparte** cuando hay ≥1 (`running`+`!alive`); NO se suma al count de `running` |
| Counts en cero | **omitidos** (no se muestra `0 done`) |
| Lista vacía | no se muestran contadores (ver estados vacíos abajo) |
| Fuente | `countByStatus(filteredRows)` — función pura sobre la lista **filtrada** (los contadores reflejan lo visible) |

---

## Copywriting Contract (TUI — copy literal de cada estado)

> El "Primary CTA" web N/A: en TUI las acciones son teclas. El copy crítico son los **estados
> vacíos/degradados** (D-12) y los **hints de teclado**. Tres estados vacíos DISTINTOS con
> precedencia estricta (Pitfall 5).

| Element | Copy literal |
|---------|--------------|
| Hint primario (footer, modo lista) | `↑↓ move · / filter · q quit` |
| Acción de filtro (entrada) | tecla `/` abre la línea de filtro modal (D-13) |
| **Estado degradado (precedencia 1)** | `⚠ server caído   N sessions (last update Ns ago, retrying…)` (Phase 35, por encima de todo) |
| **Estado arranque (precedencia 1)** | `waiting for server` (dimColor, sin contador — Phase 35) |
| **Empty: lista realmente vacía (D-12a, precedencia 2)** | `no active sessions` (poll ok, 0 sesiones) |
| **Empty: filtro sin coincidencias (D-12b, precedencia 3)** | `no sessions match` (hay sesiones pero ninguna matchea el filtro) |
| Línea de filtro activa (D-13) | prompt `/ <query>▏` al pie de la tabla; filtrado **en vivo** a cada pulsación |
| Placeholder phase/mode no-GSD (D-03) | `—` (em-dash) |
| Placeholder age inválida/null (D-03) | `—` |
| Marca textual zombie (D-09) | sufijo ` (zombie)` en la celda `status` |
| Destructive confirmation | **N/A** — esta fase NO tiene acciones destructivas. Attach (`Enter`→cmux) es Phase 37; overlays `c`/`l` son Phase 38; dismissal `d` es v2/out-of-scope |

**Precedencia de estados (Pitfall 5 — load-bearing):** (1) keep-last-good `waiting for server` / `⚠ server caído` (Phase 35, gana siempre) → (2) connected + 0 sesiones → `no active sessions` → (3) connected + N sesiones pero 0 matchean filtro → `no sessions match`. Los tres mensajes son DISTINTOS; conflarlos es un fallo de contrato.

---

## Interaction Contract (teclado — modo-gateado, D-13/D-14/D-15/D-16)

> `useInput` gateado por `isRawModeSupported` (belt-and-suspenders Phase 34). Un flag de estado
> `mode: 'list' | 'filter'` enruta las teclas. La resolución del conflicto `Esc` (D-15) es crítica.

### Modo `list`

| Tecla | Acción |
|-------|--------|
| `↑` / `↓` | mueve el índice derivado, re-fija `selectedTaskId`, clamp sin wrap (D-07) |
| `/` | entra a `mode='filter'` (abre la línea de filtro) |
| `q` | `useApp().exit()` — salida limpia (conservado Phase 34, NO `process.exit`) |
| `Esc` | **DELIBERADAMENTE IGNORADO** en modo lista (reservado para overlays de Phase 38 — D-11 Phase 34 / D-15) |
| `Enter`, `c`, `l` | **NO manejados en esta fase** (Phase 37 attach / Phase 38 overlays) |

### Modo `filter` (contexto MODAL — D-15)

| Tecla | Acción |
|-------|--------|
| char imprimible | `query += char`, re-filtra en vivo (D-13) |
| `Backspace`/`Delete` | `query = query.slice(0,-1)`; si `query === ''` → sale a `mode='list'` |
| `Enter` | confirma: vuelve a `mode='list'` **manteniendo el filtro aplicado** (D-15) |
| `Esc` | **cancela el filtro** (`query=''`) y vuelve a `mode='list'` (scope MODAL — D-15; NO contradice la reserva de `Esc` en modo lista) |

- **Sintaxis del filtro (D-14 — Discretion resuelta: COMBINABLES vía AND):** prefijos en la misma query — `r:<texto>` filtra por columna `repo` derivada; `s:<estado>` por `status` exacto (`running`/`done`/`error`/`review`); texto sin prefijo → substring global sobre celdas visibles (`task_ref` / `repo` / `phase/mode` / `summary`). **Case-insensitive.** Los criterios activos se combinan con **AND**.
- **Matching = substring literal (`String.includes`), NUNCA `new RegExp(query)`** — evita ReDoS / inyección de regex (Security V5).
- **Preservación del cursor (D-16, load-bearing):** como el cursor se rastrea por `selectedTaskId`, al aplicar/limpiar el filtro el cursor sigue a la misma sesión si permanece visible; si el filtro la oculta, fallback clampado dentro de la **lista filtrada** (mecánica D-06). Al limpiar, si la sesión reaparece, el cursor vuelve a ella.

> **Límite modal para Phase 38 (D-15):** `Esc` solo abre/cierra overlays cuando NO hay input de filtro con foco. Phase 38 DEBE honrar este límite.

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| N/A (TUI) | ninguno | not applicable — no shadcn, sin registries de terceros. Componentes hand-rolled con ink. |

> No hay registries de terceros. Las dependencias (`ink@^6.8.0`, `react@^19.2.0`, `ink-testing-library@^4`) ya están declaradas en `package.json` y ejercitadas por la suite verde de Phase 34/35. `ink-text-input` **NO se añade** en esta fase (research A1 / D-13: el input de filtro de una línea se hand-rollea con `useInput`, ~15 LOC; añadir la dep iría contra la cultura minimal-deps). Si el planner lo añadiese, gate `checkpoint:human-verify`.

---

## Trazabilidad requirement → contrato

| Req | Cubierto por |
|-----|--------------|
| TUI-07 | Anchos de columna fijos + mapeo D-03 + layout de tabla (`<Box>`/`<Text>`) |
| TUI-08 | Selected-Row Treatment (selección por `task_id`, clamp en desaparición) |
| TUI-09 | Orden DESCENDENTE estable por `started_at` + desempate `task_id`, sobre copia |
| TUI-10 | Paleta de estado D-08 + marca textual `(zombie)` D-09 (red reservado al zombie) |
| TUI-11 | Indicador live D-10 + contadores D-11 (todos los estados + zombie aparte) + dos estados vacíos D-12 |
| TUI-12 | Modo filtro modal D-13, prefijos `r:`/`s:` AND D-14, `Esc` modal D-15, cursor preservado D-16 |

---

## Checker Sign-Off

> **Nota para gsd-ui-checker:** esta es una UI-SPEC de **TUI**. Las 6 dimensiones web se evalúan
> contra sus equivalentes ink (declarados arriba), no contra px/hex/registries. Las filas `N/A (TUI)`
> son intencionales, no omisiones.

- [ ] Dimension 1 Copywriting: PASS — 3 estados vacíos distintos + hints + marca zombie + placeholders
- [ ] Dimension 2 Visuals (layout/componentes): PASS — `<Box>`/`<Text>` hand-rolled, anchos fijos, truncado `…`
- [ ] Dimension 3 Color: PASS — paleta semántica `status`+`alive`, color SOLO ink, red reservado al zombie, degrada bajo NO_COLOR
- [ ] Dimension 4 Typography (atributos ink): PASS — `bold`/`dimColor`/`inverse` declarados, sin `bold` para semántica de estado
- [ ] Dimension 5 Spacing (grid de columnas): PASS — anchos fijos suman ≈71 chars < 80, padding del contenedor declarado
- [ ] Dimension 6 Registry Safety: PASS — sin registries de terceros, sin deps nuevas, color-isolation verificada por test

**Approval:** pending
