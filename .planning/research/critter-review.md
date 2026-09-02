# KODO-81 — Revisión de `andyhmltn/critter`

**Fecha:** 2026-09-02 · **Alcance:** análisis, cero cambios en código de kodo
**Fuente:** `github.com/andyhmltn/critter` — TUI de revisión de PRs en Rust, 4 MB, 9 commits, 55 ★
**Metadatos verificados vía API:** creado **2026-08-19**, último push **2026-08-25**, 4 issues abiertos, **sin licencia**, no archivado

---

## Veredicto en una línea

**No integrar.** Hay **un bloqueador legal duro** (sin licencia = todos los derechos reservados), tres choques de stack que harían el port más caro que escribir la pieza desde cero, y su feature estrella (`peer-review`) es lo que kodo ya tiene en KODO-75. Queda **una idea que sí vale**, y no es de las que se ven en el README: el **carril de feedback humano** que a kodo le falta. Y una segunda, barata, para el visor de diff — que consiste precisamente en **no** construirlo.

---

## 1. Qué es critter

TUI en Rust para revisar pull requests de GitHub sin salir de la terminal. Navegación vim (`j`/`k` por hunks, `h`/`l` por ficheros), comentarios inline que quedan **locales hasta enviar**, `P` para aprobar / pedir cambios / comentar, `o` para abrir el fichero en `$EDITOR`. Requiere toolchain de Rust, `gh` y sesión autenticada.

Tres piezas más allá del visor:

- **Feedback loop con agentes** — `reviewer pr-tmux --wait` / `local-tmux --wait`. El humano anota el diff; al salir, critter **imprime los comentarios como prompt listo** y lo inyecta en el pane de tmux del agente. El ciclo se repite sin publicar nada en GitHub.
- **Plugin Codex** — el mismo flujo bajo `$local-review`, con un binding tmux que guarda el `pane_id` del agente en `REVIEWER_CODEX_PANE` y abre critter en otra ventana (`codex-tmux --target-pane`).
- **`peer-review`** — revisión IA profunda en segundo plano (`peer-review` / `peer-review-status`), cacheada en local y visible en la UI. Explícitamente **nunca se lanza sola**.

Extras: búsqueda `/` sobre líneas modificadas, marcar fichero como visto (`v`), binding para `gh-dash`, alcances `--unstaged` / `--last-commit` / `--base main`.

### Diferencia estructural con kodo (decide todo lo que sigue)

| | critter | kodo |
|---|---|---|
| Naturaleza | Herramienta **interactiva** de un solo uso | **Daemon** + CLI + hooks, dirigido por el board |
| Quién revisa | El **humano**, siempre | Un **agente reviewer** adversarial (KODO-75) |
| Momento | Mientras el agente está **vivo** en su pane | Cuando la sesión del coder ya **cerró** |
| Transporte del feedback | Texto inyectado en un pane de tmux | Artefacto en `review/` + `state.review_cycles` bajo lock |
| Origen del trabajo | Un PR de GitHub | Task de Plane (webhook) o GitHub Issues (polling) |
| Runtime | Rust compilado (`cargo install`) | Node ≥ 22 puro, `brew` / `npm -g` |

La fila del transporte es la que más importa y la desarrollo en §3.

---

## 2. Los bloqueadores

### 2.1 Sin licencia — **bloqueador duro, no negociable**

`license: null` en la API de GitHub, y no hay `LICENSE` en el árbol. Un repo público sin licencia **no es open source**: por defecto son todos los derechos reservados. Se puede leer y se puede aprender de él; **no** se puede vendorizar, forkear como base, redistribuir ni derivar código. Homebrew tampoco empaqueta lo que no tiene licencia.

Esto no cierra la puerta a las ideas —una arquitectura no es copyrightable— pero sí cierra cualquier lectura de "integrar" que signifique traerse código o declararlo dependencia distribuible.

### 2.2 Rust dentro de una cadena de distribución Node

kodo se instala con `brew install kodo` o `npm install -g` y su única exigencia es Node ≥ 22. Meter critter significa una de dos: exigir toolchain de Rust al operador (`cargo install` en la guía de instalación, incluida la de Pop!\_OS/Ubuntu de `packaging/linux/`), o asumir compilación cruzada y distribución de binarios por plataforma. Ambas cosas son coste de packaging permanente por una herramienta que el operador puede instalarse por su cuenta si la quiere.

### 2.3 tmux, que es justo el multiplexor que kodo no usa

El mecanismo que hace útil a critter para agentes es tmux-específico de arriba abajo: `pane_id`, `set-environment -gF`, `--target-pane`, `new-window`. kodo tiene tres hosts —cmux, Orca, BB— y ninguno es tmux. Portar esto **no es adaptar**: es reescribir la pieza entera contra `src/host/`, momento en el cual de critter no queda nada más que la idea.

### 2.4 GitHub-only, con Plane como proveedor de primera clase en kodo

Todo critter cuelga de `gh`. En kodo, GitHub Issues es el carril de *polling*; el de webhook, el que dispara el flujo completo, es Plane. Una herramienta que solo entiende PRs de GitHub cubre la mitad del producto.

### 2.5 Madurez: seis días de vida cuando se escribe esto

Creado el 19 de agosto de 2026, último push el 25. Nueve commits, cuatro issues abiertos, dos forks. Y una señal concreta de inestabilidad, no una impresión: **el propio README instala desde `andyhmltn/reviewer`**, y el binario se llama `reviewer`, no `critter`. El proyecto se renombró y su documentación aún no ha convergido. Es un repo interesante para mirar; no es una dependencia sobre la que construir.

---

## 3. Lo que ya está en kodo bajo otro nombre

**`peer-review` ≈ KODO-75, y kodo llega más lejos.** La revisión IA de fondo con caché que critter presenta como su pieza inteligente es, en kodo, un subsistema completo: sesión de reviewer adversarial en su propio worktree sobre la rama del coder (`review/launch.js`), artefactos con frontmatter obligatorio (`review/artifacts.js`), guard mecánico que restringe el commit al pathspec `review/` (`review/guard.js`), y un bucle con **tope de rondas y escalada al operador** que no termina nunca en silencio (`review/cycle.js`). critter no tiene contabilidad de rondas, ni escalada, ni garantía de que el reviewer no "arregle" lo que debía criticar. Aquí no hay nada que importar.

**El modo `--wait` es el nudge efímero que kodo ya decidió abandonar.** critter imprime la review y la inyecta en un pane: si el agente no está vivo, o si el operador no actúa en ese momento, el feedback se pierde. Es literalmente el fallo que documenta el README de kodo al explicar por qué existe la cola de integración — *"esa información viajaba solo en el nudge efímero del hook Stop: si no actuabas en el momento, se perdía y acababas revisando sesión a sesión de memoria"*—, y el mismo razonamiento que llevó después a la bandeja del orquestador. Adoptar `--wait` sería reintroducir a mano el problema que dos milestones de kodo se dedicaron a quitar.

**`--unstaged` / árbol local sucio no aplica.** critter revisa cambios sin commitear porque su agente sigue tecleando al lado. En kodo la revisión ocurre **después** de `SessionEnd`, sobre una rama cerrada: no hay working tree sucio que mirar, y `kodo integrate` se niega por contrato a operar sobre uno.

---

## 4. Las ideas que sí valen

### 4.1 Carril de feedback humano en el ciclo de revisión — **ADOPTAR** (recomendación principal)

**El hueco, dicho con precisión.** Hoy, en kodo, el único que puede escribir `review/recommendations/NNN.md` y abrir una ronda es el **agente reviewer** que lanza `kodo review start <ref>`. El humano que mira una rama y ve tres cosas que arreglar no tiene carril: o gasta una sesión de agente para que llegue (quizá) a las mismas conclusiones, o escribe el feedback fuera del sistema —un comentario en Plane, un mensaje— donde no cuenta como ronda, no queda anclado a un `reviewedHead`, y no lo lee el siguiente coder.

Eso es exactamente el patrón que critter resuelve para su topología, y es lo único suyo que kodo no tiene ya.

**La forma que le toca en kodo**, y es barata porque todo el andamiaje existe: un `kodo review reject <ref> -m <texto>` / `-F <fichero>` que escriba el artefacto de recomendación **con el mismo frontmatter** (`branch`, `commit`, `round`), lo commitee por el guard de `review/guard.js` y registre la ronda vía `recordReviewOutcome`. El humano entra en el bucle con el mismo formato, la misma ancla al commit y la misma contabilidad de rondas que el agente. Sin sesión, sin tokens, sin tmux.

**Dos detalles con miga, no cosméticos:**

- **El gate `KODO_REVIEWER=1`.** El guard exige ese marcador de entorno para dejar commitear en `review/`, y lo pone el prefijo de la línea que lanza la sesión de reviewer. Un comando de operador no lo trae. Hay que decidir explícitamente si `reject` es un segundo carril autorizado del guard o si lo exporta él mismo — y dejarlo escrito, porque ese gate es la garantía de que nadie más escribe ahí.
- **El tope de rondas es compartido.** Una ronda humana consume del mismo presupuesto de `max_rounds` (3 por defecto). Correcto, y hay que quererlo así: el tope existe para que el desacuerdo escale a un humano, y si el humano ya está dentro del bucle la escalada tiene que significar otra cosa. Vale la pena decidirlo antes de implementar, no después.

**Coste estimado:** una fase pequeña — un subcomando, la decisión sobre el guard, y tests. Reusa `artifacts.js`, `cycle.js` y `guard.js` sin tocarlos por dentro.

### 4.2 Ver el diff sin salir de kodo — **ADOPTAR LA VERSIÓN BARATA, no la de critter**

**El hueco es real.** La heurística de `kodo integrate` sugiere `pr` para migraciones, auth, billing o diffs de más de 400 líneas, y `review` cuando el diff no es inspeccionable. En los dos casos le está diciendo al operador *"ve a mirar esto"* — y kodo no le enseña nada: en todo `src/` solo hay dos llamadas a `git diff`, una con `--numstat` para contar y otra con `--quiet` en el guard. El operador se va a GitHub o a `git` a mano.

**Y aquí es donde toca ser crítico con la lectura fácil.** La conclusión tentadora es *"kodo ya tiene un dashboard en Ink, construyamos ahí el visor de diff"*. Es mala idea: un visor decente son hunks, scroll, resaltado de sintaxis, selección de líneas y búsqueda —semanas— para competir con `delta`, `difftastic`, `tig`, `lazygit`, `gh pr diff` y el propio critter, todos mejores y ya instalados en la máquina del operador. Sería la pieza más cara del repo resolviendo un problema que no es de kodo.

**Lo que sí:** que `kodo integrate` sepa **abrir** el diff con la herramienta del operador. Un flag —`--show`, o una acción en la fila del dashboard— que ejecute `git diff <base>...<branch>` a través de un `integrate.diff_command` configurable (default: el pager de git, que ya respeta el `delta` de quien lo tenga). kodo aporta el contexto que ya calculó —qué rama, contra qué base— y delega el render. Decenas de líneas, cero dependencias nuevas, y quien quiera critter como visor lo pone ahí.

**Coste estimado:** una tarea pequeña, independiente de 4.1.

### 4.3 Detalles menores, para tenerlos vistos y no volver

- **"Nunca lanza revisiones IA automáticamente"** — critter lo dice como principio de producto. kodo toma la decisión contraria y con razón (el disparo desde el board *es* el producto), pero la asimetría merece quedar anotada: la revisión adversarial cuesta dinero en cada vuelta y el tope de rondas de KODO-75 es lo único que lo acota hoy.
- **Marcar fichero como visto (`v`)** — solo tiene sentido dentro de un visor propio. Descartado con 4.2.
- **Binding de `gh-dash`** — kodo ya tiene su propio dashboard y su cola. No aporta.

---

## 5. Resumen ejecutable

| Idea | Veredicto | Coste |
|---|---|---|
| Integrar critter como dependencia | **NO** — sin licencia, Rust, tmux, GitHub-only, 6 días de vida | — |
| `peer-review` / revisión IA de fondo | **YA ESTÁ** — KODO-75, y más completo | — |
| Modo `--wait` (feedback por pane) | **NO** — reintroduce el nudge efímero que kodo eliminó | — |
| **Carril de feedback humano (`kodo review reject`)** | **ADOPTAR** — el hueco real | Fase pequeña |
| **Abrir el diff con la herramienta del operador** | **ADOPTAR** — versión barata, no visor propio | Tarea pequeña |
| Visor de diff propio en Ink | **NO** — semanas para competir con `delta`/`tig` | — |

**Dependencia entre las dos:** ninguna. 4.2 es independiente y da valor inmediato; 4.1 es la que de verdad completa KODO-75.
