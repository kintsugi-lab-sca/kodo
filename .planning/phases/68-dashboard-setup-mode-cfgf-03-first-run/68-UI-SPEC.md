---
phase: 68
slug: dashboard-setup-mode-cfgf-03-first-run
status: draft
shadcn_initialized: false
preset: none
created: 2026-07-02
surface: tui-ink
---

# Phase 68 — Contrato de Diseño de UI (TUI)

> Contrato visual y de interacción del **modo `setup`** del dashboard (onboarding first-run).
> Superficie: **terminal (ink + react)** — NO web. No hay CSS, ni tokens rem/px, ni fuentes.
> "Diseño" aquí = layout de `Box`/`Text`, flujo lineal de 4 pasos, copy literal-estable
> (constantes `SETUP_*` exportadas), afordancias de cursor/selección, campo enmascarado (`•`),
> uso de color ink/chalk ya establecido, y teclado (`useInput`).
> Generado por gsd-ui-researcher. Verificado por gsd-ui-checker.

**Fuentes upstream (pre-pobladas, no re-preguntadas):** 68-CONTEXT.md (D-01..D-13),
68-RESEARCH.md (Patterns 1-5, Pitfalls 1-6), App.js:239-260 (molde de copy), SessionTable.js:296-360
(molde `renderConfigOverlay`), cli.js:588-595 (molde selector de provider).

---

## Design System

| Property | Value |
|----------|-------|
| Tool | **none** (TUI ink — shadcn N/A: no hay navegador/DOM/CSS) |
| Preset | not applicable |
| Component library | `ink` (`Box`/`Text`) + `react` (`useState`/`useInput`) — ya instalados, cero deps nuevas (invariante LOCKED) |
| Icon library | N/A — glifos de texto (`›`, `•`, `[ ]`); sin librería de iconos |
| Font | N/A — fuente del emulador de terminal del operador; no la controla la app |

**Registro de estado del sistema existente:** el dashboard ya envía 14 modos en la state-machine de
`App.js` con un lenguaje visual LOCKED. El modo `setup` es el **15º** y DEBE calcar los overlays
existentes (`config`/`config-edit`, `projects`). Regla dominante: **reuso, no reinvención**
(RESEARCH §Don't Hand-Roll). No se especifica nada que el proyecto ya tenga.

---

## Spacing Scale — mapeado a primitivos TUI

> N/A el sistema web de 4px. En TUI el "espaciado" son columnas de caracteres, anchos fijos de `Box`
> y `marginBottom`/`marginTop` en filas de terminal. Se hereda EXACTO del molde `renderConfigOverlay`.

| Token TUI | Valor | Uso | Fuente |
|-----------|-------|-----|--------|
| Gutter del cursor | `Box width:2` (`'› '` / `'  '`) | Columna de la afordancia de selección a la izquierda de cada fila | SessionTable.js:321,355 |
| Columna de etiqueta | `Box width:24` (`` `${label}:` ``) | Ancho fijo de la etiqueta de campo → alinea los valores en columna | SessionTable.js:322,356 |
| Separación cabecera→cuerpo | `marginBottom:1` | Una línea en blanco bajo el título del overlay | SessionTable.js:300 |
| Separación cuerpo→status | `marginTop:1` | Una línea en blanco antes de la línea de error/aviso | SessionTable.js:364 |
| Layout de columna | `flexDirection:'column'` (cuerpo) / `'row'` (fila de campo) | Estructura del overlay | SessionTable.js:318-320 |

**Excepciones:** ninguna. El modo `setup` NO introduce anchos ni márgenes nuevos — replica el molde
de `renderConfigOverlay` para no romper la alineación visual con `config`/`projects`.

---

## Typography — mapeado a atributos de texto ink

> N/A tamaños en px / pesos numéricos / line-height. En ink la "tipografía" es el conjunto de
> atributos de `Text`: `bold`, `dimColor`, `inverse`. Se hereda EXACTO del molde existente.

| Rol | Atributo ink | Uso | Fuente |
|-----|--------------|-----|--------|
| Título de overlay | `bold` + `color:'cyan'` | `SETUP_OVERLAY_TITLE` en la cabecera | SessionTable.js:301 |
| Fila seleccionada (etiqueta/gutter/valor) | `bold: selected` | Resalta el paso/campo activo | SessionTable.js:321-322,355-356 |
| Fila no seleccionada / valor por defecto | sin atributo (peso normal) | Filas inactivas del wizard | SessionTable.js:316 |
| Estado atenuado / degradación | `dimColor` | `[sin configurar]`, mensaje non-TTY (D-13) | SessionTable.js:340,350 |
| Cursor de text-input | `inverse` sobre 1 code-unit | Bloque de cursor dentro del campo en edición | SessionTable.js:314,346 |

**Regla load-bearing (Pitfall 11/D-11):** el valor de la API key NUNCA se renderiza raw. En edición
del paso key se pinta la máscara `'•'.repeat(buffer.length)` y el cursor `inverse` opera sobre la
máscara (1 code-unit por char → posición 1:1 con el buffer ASCII). SessionTable.js:342-346.

---

## Color — paleta ink/chalk ya establecida (aislamiento de color LOCKED)

> N/A hex web y split 60/30/10. La TUI usa la paleta de nombres de chalk que el dashboard ya reserva
> por semántica. El modo `setup` NO introduce colores nuevos: reusa la asignación LOCKED.

| Rol | Color ink | Reservado para | Fuente |
|-----|-----------|----------------|--------|
| Título / acento estructural | `cyan` (bold) | SOLO el título del overlay de setup | App.js:239, SessionTable.js:301 |
| Aviso transitorio de reinicio | `yellow` (ámbar) | SOLO el aviso honesto tras guardar con éxito (D-08) | App.js:240,257 (patrón `*_SAVED_RESTART`) |
| Error de validación / escritura | `red` | SOLO fallo de `validateEnvValue`/`writeEnvVar`/`saveConfig` (estado dedicado, no `focusError`) | App.js:241,258-259, SessionTable.js:365 |
| Estado atenuado / no-configurado / non-TTY | `dimColor` | `[sin configurar]`, degradación non-TTY (D-13) | SessionTable.js:340,350 |

**Acento reservado para:** exclusivamente el título del overlay (`cyan`) y el aviso de reinicio
(`yellow`). NUNCA colorear todos los elementos interactivos. **Aislamiento de color (invariante):** el
color de estado de sesión (verde/rojo/zombie) es de la tabla, no del setup — no mezclar paletas.

---

## Copywriting Contract — constantes `SETUP_*` a exportar

> **El núcleo del contrato.** Copy literal-estable EXPORTADA desde `App.js` (mismo patrón
> `CONFIG_*`/`API_KEY_*`/`PROJECTS_*`, App.js:239-260) para que tests y `SessionTable.js` la importen
> y aseveren igualdad sin duplicar strings (mata el drift code/render). Todo en **español**.

### Nuevas constantes a declarar (naming/estilo calcado de App.js:239-260)

| Constante | Valor literal | Color | Requisito |
|-----------|---------------|-------|-----------|
| `SETUP_OVERLAY_TITLE` | `configuración inicial de kodo` | cyan/bold | SETUP-02 |
| `SETUP_INTRO` | `Bienvenido a kodo. Configura tu provider para empezar.` | normal | SETUP-01/02 |
| `SETUP_STEP_PROVIDER` | `paso 1/4 · provider` | dim | SETUP-02 (progreso) |
| `SETUP_STEP_BASE_URL` | `paso 2/4 · base_url` | dim | SETUP-02 |
| `SETUP_STEP_WORKSPACE` | `paso 3/4 · workspace_slug` | dim | SETUP-02 |
| `SETUP_STEP_APIKEY` | `paso 4/4 · API key` | dim | SETUP-02 |
| `SETUP_PROVIDER_LABEL` | `provider activo` | bold/selected | D-05 |
| `SETUP_PROVIDER_HINT` | `↑/↓ para elegir · Enter para confirmar` | dim | D-05 |
| `SETUP_GITHUB_REDIRECT` | `GitHub se configura con `kodo config` — el asistente guiado cubre solo Plane` | yellow | D-06 |
| `SETUP_BASE_URL_LABEL` | `base_url` | bold/selected | SETUP-02 |
| `SETUP_WORKSPACE_LABEL` | `workspace_slug` | bold/selected | SETUP-02 |
| `SETUP_COMPLETE_RESTART` | `config guardada — reinicia kodo (`kodo up`) para aplicar` | yellow | **D-08 (literal SC#4)** |
| `SETUP_WEBHOOK_NOTE` | `nota: el webhook secret del provider se configura por fuera del asistente` | dim | **D-12** |
| `SETUP_NO_RAWMODE` | `Terminal no interactiva — usa `kodo config` para completar la configuración inicial` | dim | **D-13 (non-TTY)** |
| `SETUP_INVALID` | `valor inválido (no puede estar vacío ni contener espacios, # o =)` | red | Pitfall 14 (validateEnvValue) |
| `SETUP_SAVE_FAILED` | `[!] no se pudo guardar — el archivo previo quedó intacto` | red | Pitfall (never-throws, PERSIST-05) |

### Constantes REUSADAS de Phase 67 (NO redeclarar)

| Constante existente | Uso en el modo setup |
|---------------------|----------------------|
| `API_KEY_LABEL` (`API key del provider`) | Etiqueta del paso 4/4 (NUNCA el nombre de la env var ni el valor — Pitfall 11) |
| `API_KEY_CONFIGURED` (`[configurado]`) / `API_KEY_UNSET` (`[sin configurar]`) | Indicador de PRESENCIA de la key (D-09) — jamás el valor |
| `API_KEY_INVALID` | Rechazo de `validateEnvKey`/`validateEnvValue` en el paso key |

### Mapa a la tabla estándar del template

| Elemento | Copy |
|----------|------|
| Primary CTA (por paso) | `Enter` confirma el paso → avanza; en paso 4/4 guarda la key y muestra el aviso de reinicio |
| Empty state (first-run) | `SETUP_INTRO` = `Bienvenido a kodo. Configura tu provider para empezar.` |
| Error state | `SETUP_INVALID` (validación) / `SETUP_SAVE_FAILED` (I/O) — problema + "archivo previo intacto" |
| Confirmación honesta de cierre | `SETUP_COMPLETE_RESTART` + `SETUP_WEBHOOK_NOTE` (D-08/D-12) |
| Degradación non-TTY | `SETUP_NO_RAWMODE` (D-13, never-throws — no cuelga el first-run) |

> Los valores literales son **recomendación prescriptiva** siguiendo el estilo exportado existente. El
> planner puede ajustar la redacción exacta, pero DEBE: (a) exportarlas desde `App.js`, (b) mantener el
> español, (c) preservar el literal de D-08 en `SETUP_COMPLETE_RESTART`, (d) NUNCA incluir el valor del
> secreto ni el nombre de la env var en ninguna cadena user-facing.

---

## Interaction Contract — flujo lineal de 4 pasos (D-04)

> Sub-estados del modo `setup` en la state-machine (`useInput` mode-gated). Molde: `config-edit`
> (text-input buffer/cursor) + selector estilo wizard (cli.js:588-595). Clamp de cursor sin wrap.

### Paso 1/4 — Selector de provider (D-05, D-06)

- **Render:** lista de 2 opciones `['plane','github']` con afordancia de cursor (`›`), atributo
  `bold` en la opción seleccionada. Cabecera `SETUP_STEP_PROVIDER` + `SETUP_PROVIDER_HINT`.
- **Teclado:** `↑`/`↓` mueven el cursor (clamp-sin-wrap, molde `fieldCursor`); `Enter` confirma.
- **Rama `plane`:** `saveConfig(config.provider='plane')` → avanza al paso 2/4.
- **Rama `github`:** muestra `SETUP_GITHUB_REDIRECT` (yellow) y **NO continúa** el guiado (D-06).
  GitHub sigue configurable por `kodo config` headless.
- **`Esc`:** never-throws — cierra el overlay/cancela sin escribir (coherente con overlays existentes).

### Paso 2/4 — `base_url` (text-input controlado)

- **Render:** fila con `SETUP_BASE_URL_LABEL:` (width 24) + text-input `buffer`/`cursor` con cursor
  `inverse`. Cabecera `SETUP_STEP_BASE_URL`.
- **Teclado:** inserción-en-cursor, `Backspace`/`Delete`, `←`/`→` (molde App.js:1097-1102).
- **`Enter`:** valida no-vacío → `saveConfig(base_url)` → avanza al paso 3/4. Si inválido:
  `SETUP_INVALID` (red), no avanza.

### Paso 3/4 — `workspace_slug` (text-input controlado)

- Idéntico al paso 2 con `SETUP_WORKSPACE_LABEL` / `SETUP_STEP_WORKSPACE`. `Enter` válido →
  `saveConfig(workspace_slug)` → avanza al paso 4/4.

### Paso 4/4 — API key (campo enmascarado — reuso literal de Phase 67)

- **Render:** fila `API_KEY_LABEL:` con máscara `'•'.repeat(buffer.length)` y cursor `inverse` sobre
  la máscara (Pitfall 11). Cabecera `SETUP_STEP_APIKEY`. En read-only muestra PRESENCIA
  `API_KEY_CONFIGURED`/`API_KEY_UNSET` (D-09), jamás el valor.
- **`Enter`:** `onSaveApiKey(api_key_env, buffer)` → `writeEnvVar` (0600) + `process.env[key]=value`
  in-proceso (D-09). Al éxito: `setBuffer('')` + `setMaskValue(false)` (limpia el secreto de memoria,
  Pitfall 5) y muestra `SETUP_COMPLETE_RESTART` + `SETUP_WEBHOOK_NOTE` (D-08/D-12).
- **Fallo I/O:** `SETUP_SAVE_FAILED` (red, estado dedicado); el `.env` previo queda intacto.
- **Validación:** `API_KEY_INVALID` si `validateEnvValue` rechaza (vacío/espacios/`#`/`=`).

### Cross-cutting — degradación non-TTY (D-13, Pitfall 16)

- Si `isRawModeSupported === false` (pipe/CI/wrapper): el overlay renderiza **solo**
  `SETUP_NO_RAWMODE` (dim) — **never-throws**, no cuelga el first-run, remite a `kodo config`. No se
  convierte el guard non-TTY de `index.js:90-93` (D-13: menos superficie/riesgo).

### Afordancia de progreso

Cada paso muestra su cabecera `SETUP_STEP_*` (`paso N/4`) en `dimColor` para orientación lineal.

---

## Security / Higiene del secreto (boundary PERSIST-04 — LOCKED)

> Eje de seguridad de la fase. El render del modo setup NO debe abrir un nuevo vector de fuga.

- El valor de la key entra SOLO por el campo enmascarado (D-11), se enmascara a `•`, y se limpia del
  buffer al guardar/cancelar. NUNCA a logger/evento/argv/snapshot/`/status` (Pitfall 5/11).
- El grep de higiene held-out de Phase 67 (los 5 sinks) DEBE seguir verde tras añadir el modo setup.
- El text-input usa substring puro (`String.includes`), nunca compila regex desde input (anti-ReDoS).

---

## Registry Safety

| Registry | Blocks Used | Safety Gate |
|----------|-------------|-------------|
| N/A | ninguno | not applicable — proyecto TUI ink, cero registries shadcn/third-party, cero deps npm nuevas (invariante LOCKED) |

---

## Checker Sign-Off

- [ ] Dimensión 1 Copywriting: PASS — constantes `SETUP_*` exportadas, español, literal D-08 preservado
- [ ] Dimensión 2 Visuals: PASS — molde `renderConfigOverlay` (gutter/label/cursor), sin reinvención
- [ ] Dimensión 3 Color: PASS — paleta ink reservada (cyan/yellow/red/dim), aislamiento respetado
- [ ] Dimensión 4 Typography: PASS — atributos ink (bold/dimColor/inverse), máscara del secreto
- [ ] Dimensión 5 Spacing: PASS — anchos/márgenes heredados del molde (width 2/24, margin 1)
- [ ] Dimensión 6 Registry Safety: PASS — N/A (sin registries, sin deps nuevas)

**Approval:** pending
