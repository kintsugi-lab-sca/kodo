# Convenciones de la suite

## Asserts sobre texto de prompts y skills (KODO-71)

Los prompts (`src/orchestrator/prompt.md`) y las skills (`.claude/skills/*/skill.md`) son
markdown que se reescribe a menudo. Un `includes()` sobre su redacción convierte cada
reescritura en un fallo de la suite, sin que haya cambiado ningún comportamiento.

La regla NO es «no testees prompts». Es esta: **pinea el contrato, nunca la prosa.**

| Qué pinea el assert | Veredicto |
|---|---|
| Placeholder de plantilla (`{{provider_name}}`) | **Conservar** — es el contrato de sustitución |
| Nombre de comando del CLI (`kodo gsd verify <session-id>`) | **Conservar** — si el prompt deja de nombrarlo, el orquestador no lo llama |
| Marcador estructural (`<!-- BEGIN reporting -->`, `<task_title>`, `<!-- kodo:handoff v=1 -->`) | **Conservar** — es contrato de parsing |
| Nombre de call MCP, label, tag o status (`list-issues`, `parent_id`, `kodo:gsd-child`, `[GSD quick]`, `pass`/`fail`) | **Conservar** — el agente los emite o los filtra por ese literal |
| Literal de log grepeable (`[kodo:reporting] MCP failure on phase N:`) | **Conservar** — alguien lo busca en stdout |
| Formato de dato que otro paso lee (`Phase N:`, `Plan N-MM`, `Goal:`) | **Conservar** — es contrato de formato |
| Encabezado de sección o prosa | **Despinear** |

### Cómo despinear sin perder cobertura

Lo que el assert frágil quería garantizar casi siempre se puede afirmar sin tocar la
redacción:

1. **«La sección se compone»** → pinea un literal de contrato que viva dentro de ella (un
   comando, un placeholder). Si la sección desaparece, ese literal se va con ella.
2. **«El bloque se inyecta / se retira entero»** → deriva el aserto del propio fichero:
   localiza el bloque por sus marcadores y comprueba que ninguna de sus líneas sobrevive al
   gate y que el texto de fuera queda intacto (`test/prompt.test.js`, SR4). Eso sigue
   valiendo cuando el cuerpo se reescriba entero.
3. **«El orden entre secciones»** → ancla en los literales de contrato de cada una, no en
   sus encabezados (`test/prompt.test.js`, SR2).
4. **«El fixture entra en el prompt»** → afirma contra la variable del fixture, no contra
   una frase suya elegida a mano (`test/orchestrator-handoff-launch.test.js`).
5. **Encabezado compuesto en código** → expórtalo como constante y que el test importe la
   constante (`CONTEXT_HEADING` en `src/orchestrator/launch.js`, `HANDOFF_HEADING` en
   `src/orchestrator/handoff.js`).

### Lo que la regla NO cubre

- **Texto que kodo genera desde código** (el prompt de sesión de `session/manager.js`, el
  contexto GSD del dashboard, los mensajes de stderr del CLI). Ahí el literal vive en un
  `.js` y el test es un golden legítimo del propio output: pinearlo es lo correcto.
- **Lints de idioma** (`PM7`, `RC15`, `SR6`: sin `you must` / `please` en un prompt escrito
  en español). No fijan una redacción, sólo la excluyen.

### Criterio de verificación

Antes de dar por buena una tanda de asserts de prompt, muerde el fichero en los dos
sentidos:

- Reescribe encabezados y prosa sin tocar comandos, placeholders ni marcadores → la suite
  debe seguir **verde**.
- Quita un comando, un placeholder o un marcador → la suite debe ponerse **roja**.
