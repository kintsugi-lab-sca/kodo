---
phase: 84
slug: superficies-de-captura-skill-sync-conteo-ambient
status: draft
shadcn_initialized: false
preset: none
created: 2026-07-26
surface: tui-ink + cli-clasico + skill-markdown
---

# Phase 84 — Contrato de Diseño de UI (TUI + CLI clásico)

> Contrato visual y de interacción de las superficies de esta fase. **Esto no es una UI web.** Las
> tres superficies son: (1) la **TUI ink** del dashboard (`src/cli/dashboard/**`, ink@6 + react@19 vía
> `React.createElement`, buffer alterno del terminal, sin build step), (2) el **CLI clásico** con su
> render human coloreado por `createFormatter` (`src/cli/format.js`) y su gemelo `--json`
> byte-determinista, y (3) el **markdown de una skill de Claude Code**, cuyo frontmatter y cuerpo son
> copy que el operador lee. No hay CSS, ni fuentes, ni breakpoints, ni hover/focus, ni tokens en px.
> Cada contrato se ancla en patrones ya vivos del repo y en las decisiones LOCKED de `84-CONTEXT.md`.
> Generado por gsd-ui-researcher; verificado por gsd-ui-checker.

**Superficies de esta fase:**

| # | Req | Superficie | Cambio visual real |
|---|-----|-----------|--------------------|
| A | CAPT-05 | CLI clásico — `kodo skill sync` | El render human pasa de **una línea agregada** a **una línea por skill** (D-05); el payload `--json` gana `skills[]` (D-04) |
| B | CAPT-02 | Skill markdown — `.claude/skills/kodo-capture/SKILL.md` | Fichero **nuevo**: frontmatter (`description`, `argument-hint`) + cuerpo. La copy de confirmación de `kodo capture` **no cambia** |
| C | CAPT-07 | TUI ink — cabecera de `SessionTable` | Elemento **nuevo**: conteo de capturas sin enrutar, junto al indicador de conexión (D-22), oculto en 0 (D-23), sin teclas nuevas (D-24) |

---

## Design System

| Property | Value |
|----------|-------|
| Tool | **none** — TUI/CLI in-house. Invariante cross-milestone: **cero deps npm nuevas** (blindado por el gate de `test/inbox-cli.test.js` que exige exactamente 4 deps de producción). shadcn no aplica en ningún sentido a esta superficie |
| Preset | not applicable |
| Component library | **TUI:** ink@6 (`<Box>`, `<Text>`) + react@19 (`createElement`, sin JSX ni build). **CLI:** `createFormatter` (`src/cli/format.js`). **Skill:** markdown + frontmatter YAML de Claude Code |
| Icon library | none — glifos Unicode ya en uso: `●` `⚠` `✓` `✗` `·` `…` `→`. **Esta fase no introduce ningún glifo nuevo** |
| Font | monospace del terminal del operador — no controlable, no declarado, no declarable |
| Color model | **TUI:** exclusivamente nombres de color de ink en `<Text>` (`color:'yellow'`, `dimColor:true`). **CLI:** exclusivamente métodos de `createFormatter`. **Jamás hex, jamás ANSI inline, jamás `picocolors` fuera de `src/cli/format.js`** (color isolation — `test/format-isolation.test.js` escanea `src/cli/dashboard/**`) |
| Accesibilidad | Legible en temas claro y oscuro del terminal. `NO_COLOR` respetado por `createFormatter` (precedencia `NO_COLOR > FORCE_COLOR > isTTY`) y por ink. **Todo estado nuevo debe ser distinguible sin color**: el conteo lleva su propia palabra (`sin enrutar`), no depende del amarillo para significar. Adaptación al ancho vía wrap/flex de ink, **no** breakpoints |

### Fuera de contrato (no aplica a esta superficie)

Declarado explícitamente para que ni el checker ni el ejecutor busquen lo que no existe:

| Sección web habitual | Por qué no aplica aquí |
|----------------------|------------------------|
| Escala de espaciado en px/rem, 8-point scale | El layout es flex de ink con **anchos enteros de carácter**; el separador es literalmente un número de espacios |
| Tamaños de fuente, line-height, ratios tipográficos | El terminal impone una única fuente monoespaciada y un único tamaño. El único eje tipográfico disponible es `bold` / `dimColor` |
| Breakpoints y diseño responsive | No hay viewports. La única variable es el ancho del terminal, y el mecanismo es el wrap/truncado de ink |
| Hover, focus ring, active, transiciones, animación | No hay puntero ni foco CSS. El único estado de "selección" del dashboard es la fila resaltada con `bold`, y esta fase no lo toca |
| Ratios de contraste WCAG | Los colores los resuelve el tema del terminal del operador; el contraste no es del programa. La contrapartida es la regla de "distinguible sin color" de arriba |
| Registries de componentes / shadcn | No hay componentes de terceros. Ver §Registry Safety |

---

## Spacing Scale

> En estas superficies el "spacing" son **caracteres**: cuántos espacios separan dos elementos de una
> línea y cuántas líneas separan dos bloques. No hay tokens en px. Los valores declarados son los que
> el repo ya usa; esta fase **no inventa ninguno nuevo**.

| Token | Valor | Uso |
|-------|-------|-----|
| `sep-header` | **3 espacios** (`'   '`) | Separador entre hijos de la cabecera de `SessionTable`. Precedente literal: `SessionTable.js:913` (`   ${label}`). **El conteo del inbox usa exactamente este valor** |
| `sep-counts` | `' · '` | Separador interno de `countsLabel` (`format.js:184`). **No se toca**: el conteo del inbox es un hijo `<Text>` aparte, no una entrada más de `countsLabel` |
| `sep-cli-block` | **0 líneas en blanco** | Entre los bloques por skill del render human de `kodo skill sync`. Las líneas van consecutivas, sin separador vertical |
| `indent-cli` | **0** | Ninguna línea del render human se indenta. La atribución la da el prefijo `<skill>:`, no la sangría |

**Contrato de layout de la cabecera (superficie C):** el header es hoy
`h(Box, {flexDirection:'row'}, indicator, label && <Text>)`. Esta fase añade **un tercer hijo
condicional al final**, sin `width`, sin `marginLeft`, sin `paddingX` — el espaciado va dentro del
string, igual que el `label` existente. **No se introduce ningún `<Box>` nuevo, ninguna columna nueva
de `COLS`, ningún cambio en `COLS`.**

Excepciones: ninguna.

---

## Typography

> No hay tamaños ni line-heights. El eje tipográfico disponible es el conjunto de props de estilo de
> ink (`bold`, `dimColor`) y, en el CLI clásico, los helpers de `createFormatter`. El contrato declara
> qué estilo lleva cada elemento **nuevo** y afirma que los existentes no se tocan.

| Superficie | Elemento | Estilo | Racional |
|-----------|----------|--------|----------|
| C (TUI) | Conteo ambient `N sin enrutar` | `color: 'yellow'`, **sin `bold`, sin `dimColor`** | Peso normal: es estado ambient, no un título ni un aviso modal. `bold` competiría con la fila seleccionada, que es el único uso de `bold` en la tabla |
| C (TUI) | Indicador de conexión (`● live` / `⚠ server caído` / `waiting` / no-autorizado) | **intacto, byte-idéntico** | `LiveIndicator` no se modifica: el conteo es un hermano, no una rama nueva |
| C (TUI) | `countsLabel` (`3 running · 1 review`) | **intacto** — sin atributo | Ídem |
| A (CLI) | Prefijo de atribución `<skill>:` | `fmt.dim(...)` | El nombre de la skill es la **etiqueta**, el estado es el dato. Atenuar la etiqueta deja el glifo `✓`/`⚠` como punto focal. Bajo `NO_COLOR` y en stdout no-TTY `dim` es identidad → el prefijo sale en texto plano |
| A (CLI) | Cuerpo de cada línea (`✓ Synced N files to …`, `✓ No drift — …`, `⚠ Legacy symlink replaced at …`, `⚠ Pruned N foreign files`) | **byte-idéntico al actual** tras el prefijo | Ver §Copywriting Contract: la fase **prefija**, no reescribe |
| A (CLI) | Línea de error en stderr | sin color (prefijo `Error: ` literal, como hoy) | Preserva `/^Error: filesystem error: /`, hoy anclado en `test/skill-sync.test.js:526` |
| B (skill) | Cuerpo del `SKILL.md` | markdown estándar; H1 + secciones cortas | Recomendación oficial: < 500 líneas. La invocación canónica va en **bloque cercado**, precedida de su marcador estable (D-14) |

**Regla de no-abreviación:** ninguna etiqueta nueva se abrevia. `sin enrutar` se escribe entero; el
nombre de la skill se escribe entero (`kodo-orchestrate`, no `orchestrate`).

---

## Color

> Paleta **acotada** y heredada. La TUI toma color **solo** de nombres ink en `<Text>`; el CLI clásico
> **solo** de `createFormatter`. El modelo web 60/30/10 no aplica (no hay superficies ni fondos: el
> fondo es el del terminal del operador). La tabla traduce ese modelo al eje real: qué proporción del
> texto va sin atributo, qué va atenuado y qué va acentuado.

| Rol | Valor | Uso en esta fase |
|-----|-------|------------------|
| Dominante (~60%) — neutro | **sin atributo** (foreground del terminal) | `countsLabel`, celdas de la tabla, prosa del `SKILL.md`, cuerpo de los mensajes del CLI |
| Secundario (~30%) — atenuado | `dimColor: true` (TUI) / `fmt.dim` (CLI) | Keybar del pie (existente), rama `waiting for server` (existente), **prefijo `<skill>:` del render human (nuevo)** |
| Acento (~10%) | **`yellow`** — `color:'yellow'` (TUI) / `fmt.yellow` (CLI) | **Reservado en esta fase a exactamente dos elementos**, listados abajo |
| Semántico OK | `green` vía `fmt.ok` (CLI) / `color:'green'` (TUI, rama `● live`) | Sin cambios. El conteo **jamás** es verde |
| Destructivo | `red` / `fmt.fail` | **Sin uso nuevo en esta fase.** La única acción con borrado es `--prune` de `skill sync`, que es **preexistente y no cambia**: reporta en `yellow` (aviso `⚠ … removing foreign`), nunca en rojo — ver §Copywriting Contract, Superficie A. El rojo queda reservado al fallo duro (`Error: filesystem error: …`), que ya existe y conserva su literal |
| Reservado — no usar | `cyan` | Reservado en el dashboard al **prompt armado/accionable** (`SessionTable.js:938-941`). El conteo del inbox **no** puede tomarlo: no es un confirm armado, y tomarlo erosionaría esa reserva |

**El acento amarillo está reservado, en esta fase, a:**

1. El **conteo ambient del inbox** cuando es `> 0` (superficie C).
2. Las líneas de aviso ya existentes del render human de `skill sync` (`⚠ Legacy symlink replaced`,
   `⚠ Pruned N foreign files`) — heredadas, no nuevas.

Y a nada más. Ninguna otra cosa de esta fase toma color.

**Por qué amarillo y no dim/neutro para el conteo (decisión, no default):** en este repo el amarillo
significa *"hay algo pendiente que requiere tu conocimiento o tu acción"* (`⚠ server caído`,
`⚠ no autorizado — revisa KODO_API_TOKEN`, `Pruned N foreign files`), mientras el rojo queda para el
fallo duro. Un backlog de triage es exactamente eso: pendiente, accionable, no roto. Neutro lo haría
indistinguible de `countsLabel` (que está a 3 espacios y tiene la misma forma `N palabra`); `dim` lo
convertiría en ruido de fondo, que es justo lo contrario de la presión ambient que CAPT-07 pide.

**Sin color condicional.** El conteo se pinta amarillo **siempre** que sea `> 0`, incluidas las ramas
degradadas del indicador de conexión. No hay lógica de "atenuar el conteo cuando el server está
caído": el conteo y la conexión son hechos **independientes** (uno viene del filesystem local, el otro
de la red) y acoplarlos añadiría una rama sin ganancia. Que el amarillo aparezca dos veces en la misma
línea es correcto: hay dos cosas pendientes.

**Distinguible sin color (NO_COLOR / temas monocromo):** el conteo se identifica por su **texto**
(`4 sin enrutar`), no por el amarillo. Bajo `NO_COLOR` la cabecera sigue siendo inequívoca.

**Nota V5 (validación de input) — asimetría deliberada frente a la Phase 75:** el conteo es un
**entero derivado de un `length`**, jamás texto externo ni contenido escrito por un LLM. Por tanto
**no requiere `stripControlChars`** y no debe pasarse por ningún saneador: no hay superficie de
inyección de escapes de terminal. (El texto de la captura sí se sanea, pero eso ocurre en el writer de
la Phase 83, que esta fase no toca.) El leaf **nunca** renderiza texto del inbox — solo lo cuenta.

---

## Copywriting Contract

> Toda la copy nueva en **español**; identificadores, rutas, nombres de comando, flags y claves JSON
> **verbatim**. Los literales existentes se declaran fila a fila como intactos cuando lo son — la
> no-regresión de copy es parte del contrato.

### Superficie C — conteo ambient (CAPT-07)

| Elemento | Copy / contrato |
|----------|-----------------|
| Conteo con `N > 0` | **`   {N} sin enrutar`** — 3 espacios de separación + entero + espacio + `sin enrutar`. Ejemplo renderizado: `4 sin enrutar` |
| Conteo con `N === 0` | **nada**. El `<Text>` no se emite (D-23). La cabecera queda **byte-idéntica** a la actual |
| Pluralización | **ninguna rama**. `sin enrutar` es invariante en español: `1 sin enrutar` y `4 sin enrutar` son ambos correctos. **Prohibido** añadir lógica de singular/plural (a diferencia de `file`/`files` del CLI) |
| Formato del número | entero decimal crudo, **sin separador de millares** y sin abreviación (`1500`, no `1.500` ni `1,5k`). Cero dependencia de locale |
| Copy de estado vacío | **no existe**. `0` no se representa: se omite (ver fila anterior). Prohibido `0 sin enrutar`, `inbox vacío`, `—` o cualquier placeholder |
| Copy de error | **no existe**. Un inbox ausente, ilegible o binario cuenta `0` y por tanto no pinta nada (D-20). **Prohibido** cualquier banner, `?`, `⚠` o mensaje de diagnóstico del filesystem en el dashboard |
| Tecla / afordancia | **ninguna** (D-24). El keybar del pie queda **byte-idéntico**. El conteo no es interactivo ni seleccionable |
| Vocabulario | `sin enrutar` es el negativo de `enrutada`, que es literalmente un token del formato de línea congelado en Phase 83. La copy hereda el vocabulario del dato, no inventa uno nuevo |

**Alternativas de copy descartadas (auditables):** `inbox 4` — ambiguo (¿4 qué?, ¿capturas totales?);
`⬚ 4` — glifo nuevo y opaco, exige aprender un símbolo; `4 capturas sin enrutar` — 22 caracteres en una
cabecera que ya puede llevar `⚠ server caído  12 sessions (last update 45s ago, retrying…)`;
`4 pendientes` — colisiona con el vocabulario de estado de sesiones (`pending`).

**Composición con `renderConnIndicator` (D-22, el punto de integración real).** El conteo **no** entra
en `LiveIndicator` ni participa de su cadena de precedencia. `LiveIndicator` conserva sus cuatro ramas
exactamente como están (`unauthorized` → `connected` → `stale` → `waiting`) y sigue devolviendo un
único `<Text>`. El conteo es el **tercer hijo** del `<Box flexDirection="row">` de la cabecera, después
de `countsLabel`:

```
posición 1        posición 2                 posición 3 (NUEVA, condicional)
LiveIndicator  ·  countsLabel (condicional)  ·  conteo del inbox (condicional)
```

Frames de referencia (los 5 estados del indicador × conteo presente/ausente):

```
● live   3 running · 1 review   4 sin enrutar
● live   3 running · 1 review                     ← N === 0: cabecera byte-idéntica a hoy
● live   4 sin enrutar                            ← sin sesiones: countsLabel vacío, se omite
⚠ server caído  12 sessions (last update 45s ago, retrying…)   4 sin enrutar
⚠ no autorizado — revisa KODO_API_TOKEN   4 sin enrutar
waiting for server   4 sin enrutar
```

**Reglas de composición (contrato para el ejecutor):**

- El conteo va **siempre el último**. Nunca se interpone entre el indicador y `countsLabel`.
- El conteo se muestra en **las cuatro ramas** del indicador, sin excepción. La presión de triage no
  depende del estado del servidor.
- El conteo **solo** aparece en el render de tabla por defecto. Los overlays (comments/logs/plan/
  adopt/config/projects/setup) hacen early-return **antes** de la construcción del header
  (`SessionTable.js:865-904`), así que el conteo no se pinta en ellos. Comportamiento heredado,
  deliberado y no se cambia: un overlay es una vista congelada a pantalla completa.
- Las líneas condicionales del pie (`filterLine`, `errorLine`, `derivingLine`, `confirmLine`) no se
  tocan y su precedencia queda intacta.

### Superficie A — `kodo skill sync` (CAPT-05)

| Elemento | Copy / contrato |
|----------|-----------------|
| Línea de estado por skill (stdout) | **`{skill}: {línea actual byte-idéntica}`** — el prefijo es `<nombre>` + `:` + un espacio, con `<nombre>:` en `fmt.dim`. Todo lo que va después **no cambia ni un byte** respecto al render de hoy |
| Ejemplo — noop | `kodo-orchestrate: ✓ No drift — /Users/x/.claude/skills/kodo-orchestrate up to date` |
| Ejemplo — sincronizada | `kodo-capture: ✓ Synced 3 files to /Users/x/.claude/skills/kodo-capture` |
| Ejemplo — symlink legacy | `kodo-orchestrate: ⚠ Legacy symlink replaced at /Users/x/.claude/skills/kodo-orchestrate` |
| Ejemplo — prune | `kodo-capture: ⚠ Pruned 1 foreign file` |
| Orden dentro del bloque de una skill | **intacto**: symlink legacy → estado (noop/synced) → prune. Es el orden actual de `renderHuman` |
| Orden entre skills | **el del registro `KODO_SKILLS`**, secuencial y determinista: `kodo-orchestrate` primero (es la skill de identidad del repo), `kodo-capture` después |
| Separación entre bloques | **ninguna línea en blanco** |
| Error de una skill (stderr) | **`Error: filesystem error: [{skill}] {mensaje}`** — el nombre va **después** del prefijo literal para preservar `/^Error: filesystem error: /`, hoy anclado en `test/skill-sync.test.js:526`. Las demás skills se siguen sincronizando (D-03) y su salida sale igual |
| Gate "no es un repo kodo" (exit 2, stderr) | **byte-idéntico, NO TOCAR**: `Error: not a kodo repository (no .claude/skills/kodo-orchestrate/skill.md found)\n`. Comparado con `assert.equal` en `test/skill-sync.test.js:535-538`. El literal menciona `skill.md` en minúsculas aunque D-07 vuelva el gate case-tolerante — el mensaje **no** se actualiza |
| Payload `--json` | Orden de claves = contrato (DX-06). `{"status":…,"files_changed":…,"skills":[{"name":…,"status":…,"files_changed":…},…]}` + condicionales `files_pruned` / `symlink_replaced` al final, agregadas. El orden de `skills[]` = el de `KODO_SKILLS` |
| CTA primaria | **no aplica** — no hay botones. El "CTA" de esta superficie es el propio comando `kodo skill sync`, cuyo `.description()` de commander puede actualizarse para decir que distribuye las skills de kodo (plural). Redacción exacta: discreción del planner |
| Acción destructiva | **`--prune` es la única acción con borrado**, y **no cambia en esta fase**: sigue siendo opt-in por flag explícito, sin prompt de confirmación (un flag deliberado ya es la confirmación en un CLI no interactivo), y sigue reportando `⚠ Pruned N foreign files` en amarillo. **Prohibido** ampliar su alcance o hacerla default |

### Superficie B — `.claude/skills/kodo-capture/SKILL.md` (CAPT-02)

Copy que el operador ve en el listado de skills y al invocar:

| Elemento | Copy / contrato |
|----------|-----------------|
| `name` (frontmatter) | `kodo-capture` |
| `description` (frontmatter) | Español, una frase de qué + una de cuándo. Contrato de contenido: (a) dice que captura al inbox global `~/.kodo/inbox.md`, (b) dice **cuándo** usarla (el operador suelta una idea o un pendiente ajeno a la tarea en curso y no quiere perder el hilo), (c) dice que **shellea `kodo capture` y nunca escribe el fichero**. Redacción exacta: discreción del planner, respetando el tope de 1 536 caracteres del listado |
| `argument-hint` (frontmatter) | `"<texto de la idea>"` |
| `allowed-tools` (frontmatter) | `Bash(kodo capture *)` — evita el prompt de permiso en el turno de invocación, que es lo que hace la captura mid-session de fricción cero |
| Invocación canónica (cuerpo) | **`kodo capture --origin skill -- "<texto>"`** — literal LOCKED por D-11. **Exactamente una** ocurrencia en todo el fichero, dentro de un bloque cercado precedido de su marcador estable |
| Instrucción de quoting (cuerpo) | El cuerpo debe decir explícitamente: *el texto va como **un solo** argumento, escapando comillas si las hubiera; los flags van **siempre antes** del `--`* |
| Copy de "sin texto" (cuerpo) | El cuerpo instruye: **si no hay texto, pregunta al operador; no ejecutes el comando con el argumento vacío.** (Si aun así se ejecutase, `kodo capture` sale con código 2 y el literal existente `Error: capture text is empty after sanitization` — copy heredada, no se toca) |
| Copy de fallo (cuerpo) | El cuerpo instruye: si `kodo capture` termina con código distinto de 0, **reporta stderr verbatim al operador y detente**. Prohibido explícitamente reintentar escribiendo `~/.kodo/inbox.md` a mano (es el invariante de writer único, D-10) |
| Confirmación de captura | **intacta, heredada de Phase 83**: `✓ Capturado {id} — kodo inbox route {id}` (`src/cli/capture.js:145`). Esta fase **no cambia ni un byte** de la copy del CLI de captura |
| Superficie de triage en la skill | **ninguna** (D-15). La skill no lista, no enruta, no descarta. `kodo inbox` es la única superficie de triage |
| Acción destructiva | **ninguna**. Capturar es puramente aditivo (`O_APPEND`); nada se borra ni se sobrescribe |

---

## UI Considerations

> Cobertura de **estados de UI** de las tres superficies. Las copys de vacío y de error viven arriba
> en `## Copywriting Contract`; esta sección cubre la **cobertura de estado** y las referencia.

Applicable state considerations resolved: **14 covered, 2 backstop, 0 unresolved**

Clasificación de elementos (propose-then-confirm, confirmada por el investigador): el **conteo
ambient** es `static-content` derivado de una `list-collection`; el **render human de `skill sync`** es
`list-collection` (una entrada por skill); el **`SKILL.md`** es `interactive-control` (comando slash) +
`static-content` (su copy).

| Category | Element(s) | Status | Resolution / Reason |
|----------|------------|--------|---------------------|
| empty | Conteo con 0 capturas abiertas (superficie C) | ✅ covered | D-23: el `<Text>` no se emite y la cabecera queda byte-idéntica a la actual. Ver fila «Conteo con `N === 0`» del `## Copywriting Contract`. Verificación: test de render que asserta la ausencia de la subcadena con inbox vacío |
| empty | Inbox inexistente — operador que nunca capturó (superficie C) | ✅ covered | Indistinguible de 0 por diseño (D-20): el leaf devuelve `0` y no se pinta nada. Cero onboarding, cero placeholder |
| error | Inbox ilegible, sin permisos, binario o corrupto (superficie C) | ✅ covered | D-20 never-throws de cuerpo entero → `0` → nada pintado. **Jamás** un banner: el dashboard no diagnostica el filesystem. Ver fila «Copy de error» del `## Copywriting Contract` |
| populated | Conteo con N > 0 (superficie C) | ✅ covered | `   {N} sin enrutar` en `yellow`, tercer hijo del header. Frames de referencia en el `## Copywriting Contract` |
| partial | Inbox con líneas hand-editadas que no parsean (superficie C) | ✅ covered | El fichero es human-editable por diseño; un `- [ ] comprar leche` **no** cuenta. La regex del leaf es la especialización a línea-abierta de `LINE_RE`, **no** un prefijo de checkbox (RESEARCH §Pitfall 6: prefijo cuenta 7, oráculo cuenta 2). Anclado por el test anti-drift de D-18 contra `listCaptures(...).filter(open)` |
| loading | Primer render antes del primer tick de `usePoll` (superficie C) | ✅ covered | **No existe estado de carga**: la lectura es síncrona en el cuerpo del render (D-21, piggyback). Prohibido spinner, skeleton, `…` o placeholder transitorio |
| zero-one-many | 1 vs 4 vs 1500 capturas abiertas (superficie C) | ✅ covered | Copy invariante en español, **sin rama de plural**; entero crudo sin separador de millares. Ver `## Copywriting Contract` |
| long-text | Conteo de muchos dígitos (p. ej. 50 000 capturas) | ✅ covered | El número no se formatea ni se abrevia; ancho máximo realista ≈ 6 caracteres. El volumen extremo está cubierto por CAPT-F2 (rotación), diferido a v2 |
| overflow | Cabecera en terminal estrecho: rama stale (≈ 60 chars) + `countsLabel` + conteo | 🧪 backstop | El conteo es el **último** hijo del `<Box row>`, así que es lo primero que ink desplaza/envuelve — el indicador de conexión nunca se recorta ni se desplaza. **No se añade ninguna aritmética de ancho** (sería estado y complejidad por 12 caracteres). Verificación pendiente: test de render con ancho estrecho que confirme que el indicador conserva su posición |
| populated | Render human con las 2 skills sincronizadas (superficie A) | ✅ covered | Una línea por skill con prefijo `<skill>:`, orden del registro, sin líneas en blanco. D-05 |
| partial | Una skill OK y la otra en error (superficie A) | ✅ covered | D-03 resiliencia: el bucle no aborta; la OK imprime su línea en stdout, la fallida su línea en stderr, exit agregado `1`. El operador ve **cuál** falló por el prefijo `[skill]` |
| error | Skill del registro ausente en el repo / error de filesystem (superficie A) | ✅ covered | `Error: filesystem error: [{skill}] {mensaje}` preservando el prefijo anclado en `test/skill-sync.test.js:526`. El gate exit 2 sigue siendo **solo** de `kodo-orchestrate` (D-02) con su literal intacto |
| zero-one-many | El registro con 1 vs 2 entradas (superficie A) | ✅ covered | El render es un bucle sin caso especial: con una entrada la salida es la de hoy más el prefijo. Añadir una tercera skill en el futuro no exige tocar el render |
| overflow | Rutas de destino largas en el render human (superficie A) | ✅ covered | **Sin truncado** — comportamiento actual invariable; el terminal envuelve. Truncar una ruta la vuelve inútil para copiar/pegar |
| empty | `/kodo-capture` invocado sin texto (superficie B) | ✅ covered | El cuerpo del `SKILL.md` instruye pedir el texto en vez de ejecutar con argumento vacío; el backstop duro es el exit 2 + `Error: capture text is empty after sanitization` heredado del CLI. Ver `## Copywriting Contract` |
| error | `kodo` ausente del PATH o `kodo capture` con exit ≠ 0 (superficie B) | 🧪 backstop | La mitad verificable **sí** está blindada: el test de D-14 exige **exactamente una** invocación en el fichero y la igualdad de argv, lo que impide que aparezca un segundo camino de escritura. La mitad restante (que el modelo reporte el stderr verbatim y se detenga) es comportamiento de prompt, no verificable por unit test — se declara como backstop, no como cubierto |

**Estado transversal — "todo degrada a silencio":** los cuatro caminos de dato ausente del conteo
(inbox inexistente, ilegible, vacío, o con 0 abiertas) resuelven al **mismo** resultado visual: la
cabecera de hoy, sin un byte de más. Es el invariante de calidad primario de la superficie C, y es lo
que hace que el amarillo signifique algo cuando por fin aparece.

---

## Registry Safety

**No aplica.** Estas superficies son TUI/CLI in-house. No hay shadcn, no hay componentes de terceros,
no hay registries. Invariante cross-milestone: **cero dependencias npm nuevas**, con gate automático
(`test/inbox-cli.test.js` exige exactamente 4 deps de producción — cualquier `npm install` pone roja
la suite). El planner **no debe** emitir ninguna tarea de instalación.

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| none | none | not applicable |

**Vector de distribución (lo análogo a un registry en esta fase, y merece su gate propio):**
`kodo skill sync` **escribe en el HOME del operador** (`~/.claude/skills/`). El control equivalente a
un registry safety gate es **D-01: allowlist explícita en código** (`KODO_SKILLS`), nunca un glob de
`.claude/skills/*`. El repo ya contiene `worktree-cleanup`, una skill de trabajo local que **no** es
un producto distribuible: un glob la publicaría en el HOME de todos los operadores en la siguiente
sync, en silencio. Añadir una skill al carril de distribución debe ser un acto deliberado y revisable
en diff.

| Vector | Entradas | Gate |
|--------|----------|------|
| `kodo skill sync` → `~/.claude/skills/` | `kodo-orchestrate`, `kodo-capture` | allowlist `KODO_SKILLS` en código (D-01) — revisable en diff; `--prune` sigue siendo opt-in |

---

## Checker Sign-Off

- [ ] Dimension 1 Copywriting: PASS
- [ ] Dimension 2 Visuals: PASS
- [ ] Dimension 3 Color: PASS
- [ ] Dimension 4 Typography: PASS
- [ ] Dimension 5 Spacing: PASS
- [ ] Dimension 6 Registry Safety: PASS

**Approval:** pending
