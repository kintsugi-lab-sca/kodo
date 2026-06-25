---
phase: 62
slug: adopci-n-inteligente-desde-el-dashboard
status: draft
shadcn_initialized: false
preset: none
surface: tui-ink
created: 2026-06-25
---

# Phase 62 — UI Design Contract (TUI / ink)

> **Superficie:** terminal UI con **ink (React para CLI)** — `src/cli/dashboard/App.js` + `src/cli/dashboard/SessionTable.js`. NO hay HTML/CSS/Tailwind/browser. El contrato de "diseño" aquí es **estados de interacción, transiciones, feedback de terminal (spinner/texto), keybindings, copy literal-estable (en español) y estados de fallo/vacío**, expresado con el vocabulario ink que el código ya usa (`Box`, `Text`, color por nombre).
>
> Las 6 dimensiones del checker se reinterpretan: Spacing→layout ink (`marginTop`/`paddingX`), Typography→`bold`/`dimColor`/anchos de columna, Color→nombres de color ink (color-isolation D-12), Copywriting→constantes literal-estables, Visuals→spinner + render del confirm, Registry Safety→N/A (cero dependencias npm nuevas).
>
> **Esta fase NO re-litiga UX.** Todas las decisiones de flujo están LOCKED en `62-CONTEXT.md` (D-01..D-15) y refinadas empíricamente en `62-RESEARCH.md`. Este documento las convierte en un contrato de interacción/estado preciso para el planner/executor.

---

## Design System

| Property | Value |
|----------|-------|
| Tool | none (TUI ink, no web design system; sin `components.json`, sin `tailwind.config`) |
| Preset | not applicable |
| Component library | ink (`Box`, `Text`, `useInput`, `useStdin`, `useStdout`) — ya en deps |
| Icon library | none (glifos Unicode inline: `●` `⚠` `↑↓` `…` `·`; spinner ASCII/Unicode, ver §Spinner) |
| Font | terminal monospace del operador (no controlable) |
| Color isolation | **LOCKED (D-12 Phase 34):** todo color sale de la prop `color`/`dimColor`/`bold` de `<Text>` de ink. **CERO** import de `picocolors` o ANSI inline en `App.js`/`SessionTable.js` (verificado por `test/format-isolation.test.js`). |

---

## Spacing / Layout (reinterpretación TUI de "Spacing Scale")

No hay escala de 4px. El layout ink usa los tokens enteros que el código YA usa. **Regla:** el nuevo estado `'deriving'` y el confirm extendido reusan EXACTAMENTE el mismo molde de footer que `errorLine`/`confirmLine`/`filterLine` — **no introducir un layout nuevo**.

| Token ink | Valor | Uso en esta fase |
|-----------|-------|------------------|
| `marginTop: 1` | 1 fila | Slot de footer (spinner de derivación, confirm con propuesta). Espejo EXACTO de `errorLine`/`confirmLine` (SessionTable.js:344-370). |
| `paddingX: 1` | 1 col | Box raíz + body (conservado de Phase 34; no tocar). |
| `marginY: 1` | 1 fila | Body de la tabla (conservado; no tocar). |
| Ancho columnas | fijos | Si la propuesta `{title}` se renderiza en el confirm, respetar el ancho del viewport; truncar con `…` (ver §Confirm render). |

Excepciones: ninguna. El estado `'deriving'` NO abre un overlay nuevo de pantalla completa — vive en el slot de footer (1 fila) para enmascarar latencia sin reflow del body.

---

## Typography (reinterpretación TUI: énfasis de texto)

ink no tiene tamaños de fuente. El "peso/jerarquía" se expresa con 3 niveles de énfasis ya en uso. **Exactamente 3 niveles (≤ el cap de 3-4):**

| Rol | Mecanismo ink | Uso en esta fase |
|-----|---------------|------------------|
| Énfasis fuerte | `bold: true` | Banner `kodo dashboard` (conservado). El título propuesto en el confirm **puede** ir `bold` para distinguirlo del prompt. |
| Texto normal | `<Text>` sin prop | Copy del spinner de derivación, copy del confirm. |
| Atenuado | `dimColor: true` | Hint del footer (`↑↓ move · … · a adopt · q quit`), descripción truncada bajo el título propuesto (señal secundaria). |

Line-height/ratios: N/A (terminal). Una línea = una fila.

---

## Color (reinterpretación TUI: nombres de color ink)

No hay split 60/30/10 ni hex. El "color" es el conjunto de nombres semánticos de ink que el dashboard YA usa de forma consistente. Esta fase **reusa la paleta existente sin añadir colores nuevos**.

| Rol semántico | Color ink | Reservado para (lista explícita) |
|---------------|-----------|----------------------------------|
| Neutral / en progreso | `dimColor` (o sin color) | **Spinner "derivando…"** (estado transitorio, no es ni éxito ni error). Descripción truncada en el confirm. |
| Armed / accionable | `cyan` | **Prompt del confirm** `ADOPT_DERIVED_CONFIRM` (espejo EXACTO de `ADOPT_CONFIRM`/`DISMISS_CONFIRM`, ya cyan). Único color "accent". |
| Éxito transitorio | `green` | `ADOPT_OK` (conservado de Phase 56; sin cambios). |
| No-op / aviso | `yellow` | `ADOPT_ALREADY`, `ADOPT_NONE` (conservados; sin cambios). |
| Error real | `red` | `ADOPT_NO_PROJECT`, `ADOPT_ERR_ENOENT`, `adoptErrFailed` (conservados; sin cambios). |

**Accent (`cyan`) reservado para:** únicamente el prompt persistente del confirm. **NO** colorear el spinner de cyan (es neutral/transitorio, no accionable todavía). **NO** colorear el título propuesto de un color semántico (es contenido, no estado).

**Fail-open visual (D-03):** cuando la derivación cae a `basename(cwd)` (Haiku falló/timeout/parse-error/ausente), el confirm debe reflejarlo **graciosamente** — NO mostrar un error rojo. La propuesta sigue siendo válida (basename es un título legítimo). Ver §Copywriting → `derivación degradada`.

---

## Interaction Contract (núcleo de la fase — reemplaza "Visuals")

### Máquina de estados de `mode` (App.js)

`mode` actual: `'list' | 'filter' | 'overlay' | 'confirm'`. **Esta fase añade `'deriving'`** entre el armado de la surface (primer `a` en el picker) y el confirm.

```
'list'
  │  (a)
  ▼
'overlay' (picker de surfaces adoptables)          ← Phase 56, SIN CAMBIOS
  │  (a sobre surface bajo cursor; projectId resuelto OK)
  ▼
'deriving'  ── spinner "derivando…" (NUEVO) ───────────────────────┐
  │  (await onDerive({cwd, sessionId}) → {title?, description?})    │ never-throws
  ▼                                                                 │ fail-open → {}
'confirm' (muestra {title, description} propuestos)  ◄──────────────┘
  │  (segunda `a`)            (Esc / cualquier otra tecla)
  ▼                                  ▼
runAdopt(--title --description)    'list'  (cancela; v1 no-editable, D-09)
  ▼
'list' + footer ADOPT_OK / ADOPT_ALREADY / error
```

### Transiciones precisas

| # | Estado origen | Disparador | Acción | Estado destino |
|---|---------------|-----------|--------|----------------|
| T1 | `overlay` (picker, `kind==='adopt'`) | `a` sobre surface bajo cursor, `resolveProjectId` = match único | `setArmedSessionId` + `setArmedSurface({...})` → **`setMode('deriving')`** → `await onDerive({cwd, sessionId})` | `deriving` |
| T2 | `overlay` (picker) | `a` sobre surface, `resolveProjectId` = none/ambiguous | `setFocusError(ADOPT_NO_PROJECT(cwd))` (rojo), cierra picker | `list` (NO deriva, NO arma) |
| T3 | `deriving` | `onDerive` resuelve `{title, description}` (no vacío) | fusiona `{title, description}` en `armedSurface` → `setMode('confirm')` | `confirm` |
| T4 | `deriving` | `onDerive` resuelve `{}` (fail-open: timeout/ENOENT/parse-fail) | NO fusiona título → `armedSurface` queda sin `title`/`description` (o conserva el `surface.title` de cmux de Phase 56 si existe) → `setMode('confirm')` | `confirm` (modo degradado, ver §Copywriting) |
| T5 | `deriving` | Operador pulsa `Esc` mientras `onDerive` en vuelo | invalida la derivación con token de generación (espejo `overlayReqRef`); el resultado tardío NO reabre el confirm | `list` (cancela) |
| T6 | `confirm` (armado por `armedSessionId`) | segunda `a` | `await onAdopt(armedSurface)` con `title`/`description` en argv → footer por código de resultado | `list` |
| T7 | `confirm` | `Esc` o cualquier otra tecla (incl. `d`) | `setArmedSessionId(null)` + `setArmedSurface(null)`, sin mensaje | `list` (cancela; D-09) |

**Invariantes de interacción preservados:**
- **never-throws (D-03/D-13):** `onDerive` y `onAdopt` jamás lanzan; el panel ink permanece montado. El `await` en el handler `useInput` async es legal (ya se usa con `onAdopt`/`onFocus`).
- **Armado por identidad (Phase 56 D-04):** la surface se captura por `sessionId`, nunca por índice. El poll sigue corriendo bajo `deriving`/`confirm`; `armedSurface` está congelado.
- **Esc cancela en `confirm` (D-09):** v1 no-editable. Editar el título/descripción en el overlay queda DIFERIDO (Deferred Idea). El escape-hatch es `kodo adopt --title '…'` manual.
- **Token de generación (T5, espejo `overlayReqRef` App.js:347):** una derivación que llega tras Esc no debe reabrir el confirm. Bajo riesgo pero limpio (RESEARCH Open Question 2).

### Keybindings (esta fase)

| Tecla | Contexto (`mode`) | Comportamiento |
|-------|-------------------|----------------|
| `a` | `overlay` (picker) | Arma surface bajo cursor → entra a `deriving` (T1) |
| `a` | `deriving` | **Tragada / ignorada** (el operador espera la derivación; no encolar un segundo adopt) |
| `a` | `confirm` (armed adopt) | Confirma → `runAdopt` con título/descripción derivados (T6) |
| `Esc` | `deriving` | Cancela derivación en vuelo → `list` (T5) |
| `Esc` / otra | `confirm` | Cancela (T7) |

---

## Spinner de derivación (estado `'deriving'`)

| Propiedad | Valor |
|-----------|-------|
| **Ubicación** | Slot de footer (1 fila, `marginTop: 1`), mismo molde que `confirmLine`/`errorLine`. NO overlay de pantalla completa. |
| **Color** | `dimColor` (neutral/transitorio — NO cyan, NO verde, NO rojo). |
| **Copy** | `derivando título…` (literal-estable; ver §Copywriting `DERIVE_PROGRESS`). |
| **Animación** | El glifo del spinner es **discreción del executor**. Opciones aceptables: (a) glifo estático `⠿`/`…` sin animación (más simple, suficiente — la latencia es 15-22s); (b) frames cíclicos `⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏` vía `setInterval` desmontado en cleanup. **Recomendación: spinner animado simple** (la espera real es de varios segundos, RESEARCH Pitfall 1) para que el operador perciba progreso y no cuelgue. Si se anima, el `setInterval` DEBE limpiarse al salir de `deriving` (cleanup de `useEffect`) — never-leak. |
| **Bloqueo** | NO bloqueante: el poll de `/status` sigue corriendo por debajo; el body de la tabla se sigue refrescando. El spinner solo ocupa el slot de footer. |
| **Precedencia de footer** | Mientras `mode==='deriving'`, el footer muestra el spinner. Reusar la cadena de precedencia existente extendida: `derivingLine ?? confirmLine ?? errorLine ?? filterLine`. |

---

## Confirm render (mostrar `{title, description}` propuestos — D-08)

El confirm actual (`ADOPT_CONFIRM`, App.js:184) solo muestra el `workspaceRef`. **Esta fase lo extiende** para mostrar la propuesta derivada.

| Elemento | Render | Color/énfasis |
|----------|--------|---------------|
| Título propuesto | `título: <title>` (truncado a ancho viewport con `…`) | normal o `bold` (discreción; `bold` ayuda a distinguir del prompt) |
| Descripción propuesta | `desc: <description>` truncada a **1-2 líneas** (RESEARCH Open Question 1: el footer es estrecho; truncar) | `dimColor` (señal secundaria) |
| Prompt de confirmación | `ADOPT_DERIVED_CONFIRM(ref)` (ver §Copywriting) | `cyan` (armed, espejo de `ADOPT_CONFIRM`) |

**Layout del confirm extendido** (recomendado, dentro del slot de footer ampliado a 2-4 filas mientras `mode==='confirm'` con propuesta):
```
título: <title derivado, truncado…>
desc: <description derivada, 1-2 líneas truncadas…>
adoptar <ref>? pulsa a de nuevo · Esc cancela
```
- Si NO hay título derivado (fail-open, T4) → omitir las líneas `título:`/`desc:` y mostrar el prompt degradado (ver §Copywriting `ADOPT_DERIVED_CONFIRM_FALLBACK`). El operador igual confirma; el core cae a `basename(cwd)`.
- Truncado: usar `…` (un solo carácter, espejo de la convención `OPEN_OK`/`ADOPT_OK`), nunca `...`.

---

## Copywriting Contract (español — copy literal-estable)

> **Patrón obligatorio (espejo Phase 56):** todas las cadenas son **constantes EXPORTADAS** desde `App.js` (junto a `ADOPT_*`), para que los tests las importen y asseren equality sin duplicar strings. La LITERAL copy es el contrato; los nombres son guía. **Todo en español** (el dashboard kodo está en español; verificado contra `ADOPT_*` existentes que están en inglés — **excepción consciente:** las constantes Phase 56 están en inglés; las NUEVAS de Phase 62 se escriben en español por mandato de CONTEXT, aceptando la mezcla. El planner puede unificar si lo decide, pero el mandato de la fase es español).

| Constante (nombre guía) | Copy literal (español) | Color | Estado |
|-------------------------|------------------------|-------|--------|
| `DERIVE_PROGRESS` | `derivando título…` | `dimColor` | `deriving` (spinner) |
| `ADOPT_DERIVED_CONFIRM(ref)` | `adoptar ${ref}? pulsa a de nuevo · Esc cancela` | `cyan` | `confirm` con propuesta |
| `ADOPT_DERIVED_CONFIRM_FALLBACK(ref)` | `adoptar ${ref} (título por defecto)? pulsa a de nuevo · Esc cancela` | `cyan` | `confirm` degradado (fail-open D-03) |
| Prefijo título propuesto | `título: ` | normal/`bold` | `confirm` con propuesta |
| Prefijo descripción propuesta | `desc: ` | `dimColor` | `confirm` con propuesta |

**Notas de copy:**
- **CTA primaria:** "adoptar" (verbo + objeto implícito = la surface por `ref`). Es la segunda `a` del double-confirm.
- **Estado "vacío":** N/A en el sentido web. El estado análogo es **`ADOPT_NONE`** (`no adoptable sessions found`, Phase 56, conservado) cuando no hay surfaces adoptables — el flujo de derivación NUNCA se alcanza.
- **Estado de error:** la derivación NUNCA produce un error rojo propio (D-03 fail-open → cae a basename). Los errores rojos del slot pertenecen al adopt en sí (conservados de Phase 56): `ADOPT_NO_PROJECT`, `ADOPT_ERR_ENOENT`, `adoptErrFailed`.
- **Derivación degradada (fail-open):** se comunica con `ADOPT_DERIVED_CONFIRM_FALLBACK` (cyan, NO rojo) + ausencia de las líneas `título:`/`desc:`. El operador entiende que se usará el nombre del directorio, sin alarma.
- **Acción destructiva:** **ninguna.** La adopción crea una tarea (no destruye). El único confirm es el double-`a` ya existente (D-08), que NO es destructivo — es un gate anti-accidente. Esc cancela sin efecto.
- **Ellipsis:** usar `…` (un carácter), nunca `...`.

### Copy del prompt de derivación LLM (NO es UI; va al subproceso `claude -p`)

Distinto del copy de la TUI: es el prompt inyectado al subproceso Haiku (D-07, prompt nuevo y mínimo). **Idioma: inglés** (instrucción al modelo; el OUTPUT `{title, description}` puede salir en el idioma del contexto del proyecto). Forma de referencia (RESEARCH Code Examples; el planner fija el wording exacto):
- Debe pedir derivar `{title, description}` que reflejen el **ALCANCE del proyecto**, NO el nombre del directorio NI el último commit (corrige F2 del UAT ROMAN-194).
- NO copiar la prosa de `kodo-orchestrate/skill.md` (D-07). Sin mandato de charset/single-quote (la shell-safety la da `execFile` argv literal, D-13).
- Salida forzada vía `--json-schema` (no pedir JSON en prosa; RESEARCH Pattern 2).

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| N/A (TUI ink) | ninguno | **not applicable** — cero dependencias npm nuevas (RESEARCH §Package Legitimacy Audit: solo `node:*` builtins + el CLI `claude` preexistente, D-15). Sin shadcn, sin registries de terceros. |

---

## Notas para el planner (contrato → implementación)

1. **Estado nuevo `'deriving'`** en la unión de `mode` (App.js:339) + render del spinner en el slot de footer (extender la cadena de precedencia `SessionTable.js:378/387` a `derivingLine ?? confirmLine ?? errorLine ?? filterLine`).
2. **Punto de inserción exacto** (RESEARCH Pattern 4): entre `resolveProjectId` OK (App.js:524) y `setMode('confirm')` (App.js:548) → `setMode('deriving')` → `await onDerive(...)` → fusión en `armedSurface` → `setMode('confirm')`.
3. **`onDerive` es DI** (prop never-throws inyectada por `index.js`, espejo de `onAdopt`/`onAdoptDiscover`): `(args:{cwd, sessionId}) => Promise<{title?, description?}>`, fail-open a `{}`. El módulo nuevo `src/cli/dashboard/enrich.js` (`deriveAdoptionMeta`) lo respalda.
4. **`runAdopt` extendido** con `--description` (espejo argv literal de `--title`, adopt.js:123). El flag CLI `kodo adopt --description` YA existe (RESEARCH A1 VERIFIED).
5. **Confirm render extendido** para mostrar `título:`/`desc:` (truncados) cuando `armedSurface.title` esté presente; degradar a `ADOPT_DERIVED_CONFIRM_FALLBACK` cuando no.
6. **Timeout ~25-30s** (NO 8s — RESEARCH Pitfall 1, evidencia empírica 8.7-21.9s). El spinner enmascara la latencia.
7. **Token de generación** para invalidar derivación tras Esc (T5; espejo `overlayReqRef`).
8. **Constantes literal-estables EXPORTADAS** desde App.js, en español, testeadas por equality (espejo del patrón `ADOPT_*`/`DISMISS_*`).

---

## Checker Sign-Off

> Reinterpretado para TUI (ver nota de cabecera).

- [ ] Dimension 1 Copywriting (constantes literal-estables, español, fail-open sin alarma): PASS
- [ ] Dimension 2 Visuals (spinner `deriving` + confirm con propuesta, slot de footer): PASS
- [ ] Dimension 3 Color (paleta ink existente; cyan reservado al prompt; spinner neutral; color-isolation D-12): PASS
- [ ] Dimension 4 Typography (3 niveles de énfasis: bold/normal/dim): PASS
- [ ] Dimension 5 Spacing/Layout (reusa molde de footer existente; sin layout nuevo): PASS
- [ ] Dimension 6 Registry Safety (N/A — cero dependencias nuevas): PASS

**Approval:** pending
