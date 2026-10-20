---
name: kodo-recycle
description: Ritual de salida del orquestador de kodo en un solo comando. Comprueba que el estado es estable, escribe el resumen compound de la sesión, vuelca las lecciones a la skill del orquestador, ackea la bandeja, escribe `~/.kodo/handoff.md` y hace `/exit` para que el daemon relance un orquestador limpio. Úsala al recibir un `recycle-suggested`, cuando el operador diga «recicla» o invoque /kodo-recycle. Sin preguntas intermedias.
argument-hint: "[force]"
---

# kodo:recycle

Eres el orquestador de kodo cerrándote para que el daemon te relance limpio. El
porqué, el formato del handoff y lo que hace el daemon después viven en
§«Reciclado del orquestador» de `.claude/skills/kodo-orchestrate/SKILL.md`:
**esa sección manda**; esta skill solo fija el orden y no lo repite.

Argumento (opcional):

- `force` — sáltate el paso 1. Solo cuando el operador lo pide explícitamente.

Ejecuta los seis pasos **en este orden, sin saltarte ninguno y sin preguntar
nada al operador**. El único punto de parada es el paso 1.

## 1. ¿Se puede reciclar? (se salta con `force`)

Antes de escribir nada:

```bash
cat ~/.kodo/state.json     # sessions, integration_queue, orchestrator_inbox
kodo inbox-orch            # eventos sin ver, en legible
```

Para en cuanto se cumpla cualquiera de estas:

- **Integración a medias en esta conversación**: lanzaste un `kodo integrate
  <ref> --ff|--merge|--pr` que no terminó con código 0, o el operador pidió
  integrar algo y aún no se ha hecho.
- **Merge o rebase en curso** en el repo de alguna entrada `pending` de la cola o
  en el repo de kodo:
  `git -C <path> rev-parse -q --verify MERGE_HEAD || git -C <path> rev-parse -q --verify REBASE_HEAD`
  (cualquier salida = en curso).
- **Decisión del operador abierta en la conversación**: le hiciste una pregunta
  que no ha contestado, o te pidió algo que aún no has terminado.

Si para, responde **una sola línea** y no hagas nada más:

```
No reciclo: <motivo con su ref>. Resuélvelo o usa /kodo-recycle force.
```

No bloquean (van al handoff, paso 5): entradas `pending` de la cola sin acción
empezada, sesiones vivas trabajando, eventos sin ver de la bandeja.

## 2. Compound

Sigue la regla global de `~/.claude/CLAUDE.md` §«Compound — Resumen de sesión»
al pie de la letra (criterio, formato y conteos). Lo propio de aquí:

- **Fuente**: las observaciones de claude-mem-lite de esta sesión, filtradas por
  el proyecto del cwd, `klab--kodo` (`mem_recent`, o la CLI `recent` con la ruta
  absoluta que dan las instrucciones del servidor `mem-lite`). No lo redactes de
  memoria.
- **Ruta**: `.compound/$(date +%Y-%m-%d-%H%M)-<slug>.md` en tu cwd, que es la
  raíz del repo de kodo. Nunca sobrescribas un fichero existente.
- **No lo merece** (solo rondas sin incidencias, nada generalizable): no
  escribas y guarda la frase para el paso 6.
- **Commitéalo tú, solo ese fichero.** El hook Stop solo commitea
  `.claude/skills/kodo-orchestrate/`, y un fichero sin commitear en el repo hace
  que `kodo integrate` aborte con `worktree-dirty`:

  ```bash
  git -c commit.gpgsign=false add -- .compound/<fichero>.md
  git -c commit.gpgsign=false commit -m "docs(compound): <slug>" -- .compound/<fichero>.md
  ```

  Sin push. Si el commit falla, no bloquea: dilo en el paso 6.

## 3. Lecciones

Vuelca a §«Lecciones aprendidas» de `.claude/skills/kodo-orchestrate/SKILL.md`
lo aprendido en la sesión, con el criterio y el formato de §«Cómo actualizar
este skill» (`- [YYYY-MM-DD] …`, las nuevas arriba). Incluye las «Lecciones aún
no volcadas» que trajera tu propio handoff de entrada. El commit lo hace el hook
Stop.

Si no hay nada nuevo, no toques el fichero.

## 4. Ack de la bandeja

```bash
kodo inbox-orch ack --all
```

Antes, cualquier evento sin ver que pida acción (un `session-end` con `NEXT:`,
una sesión en Review) tiene que quedar en el handoff: tras el ack el entrante ya
no lo verá como nuevo.

## 5. Handoff

Escribe `~/.kodo/handoff.md` con las cinco secciones fijas, en este orden:

```markdown
## Sesiones vivas
## Decisiones del operador pendientes
## Refs calientes
## Lecciones aún no volcadas a la skill
## Siguiente acción
```

- Contenido y reglas: los de §«El fichero: `~/.kodo/handoff.md`» de la skill del
  orquestador. Solo lo que el entrante no puede derivar de `state.json` ni del
  provider.
- Las entradas `pending` de la cola y los eventos del paso 4 van a «Refs
  calientes» con su ref.
- «Lecciones aún no volcadas» queda vacía si el paso 3 las volcó todas.
- Una sección sin contenido se deja vacía, no se rellena.
- Comprueba el tamaño: `wc -c ~/.kodo/handoff.md` < 32768. Si no, recórtalo
  (estás volcando historia) antes de seguir.

## 6. Salida

Tres líneas al operador, nada más:

```
Compound: .compound/<fichero>.md (commit <sha corto>)  |  no escrito: <la frase del paso 2>
Handoff: ~/.kodo/handoff.md (<N> bytes)
Siguiente: <la «Siguiente acción» del handoff>
```

Y `/exit`. El daemon detecta que no hay orquestador y te relanza con el handoff
inyectado.
