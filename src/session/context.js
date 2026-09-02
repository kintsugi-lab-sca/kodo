// @ts-check
//
// src/session/context.js — el bloque de contexto que recibe una sesión de kodo al
// arrancar: quién eres, qué tarea, cómo se cierra, dónde va el plan y el handoff.
//
// KODO-19: vivía dentro de `hooks/session-start.js` y se movió aquí SIN tocar una coma
// del texto (el guard de golden bytes HOOK-01 lo verifica). El motivo del movimiento es
// que ahora tiene DOS consumidores por caminos opuestos:
//
//   - `hooks/session-start.js` — Claude Code ejecuta el hook y kodo le devuelve este
//     bloque como `additionalContext`. Es el camino histórico.
//   - `session/manager.js` — para un agente que NO ejecuta los hooks de kodo (OpenCode),
//     no hay hook que lo inyecte, así que el bloque se mete DENTRO del prompt inicial.
//
// El fichero es una HOJA a propósito: su único import es `KODO_DIR`. `session-start.js`
// arrastra `logger.js` por `import()` dinámico, y el guard de aislamiento LOG-12
// (test/check-isolation.test.js) prohíbe que ese logger entre en el grafo de `check.js`
// — que es exactamente lo que pasaría si `manager.js` importase el hook entero.

import { join } from 'node:path';
import { KODO_DIR } from '../config.js';

/**
 * Build the additional context block injected into kodo sessions.
 * Pure: no I/O, no globals — fully testable.
 *
 * KODO-19: el texto es EL MISMO para todos los agentes; lo que cambia es cómo llega.
 * Claude Code lo recibe como `additionalContext` del hook SessionStart; OpenCode lo
 * recibe dentro de su prompt inicial, porque no ejecuta ese hook.
 *
 * @param {import('./state.js').Session} session
 * @param {{ provider: string, providers: Record<string, any> }} config
 * @returns {string}
 */
export function buildSessionContext(session, config) {
  const providerName = session.provider || config.provider;
  const providerCfg = (config.providers && config.providers[providerName]) || {};
  const mcpHint = providerCfg.mcp_hint || `MCP de ${providerName}`;
  const reviewState = providerCfg.states?.review || 'In Review';

  // Phase 20 HOOK-01 (no-GSD ES): bloque "Anti-push-fantasma" al FINAL del array preserva
  // golden bytes anteriores (HOOK-02 satisfied-by-construction).
  return [
    `# kodo ${session.task_ref}`,
    '',
    `Estás trabajando en **${session.task_ref}: ${session.summary}**`,
    `- Proyecto path: ${session.project_path}`,
    `- Session ID: ${session.session_id}`,
    `- Work item ID: ${session.task_id} | Project ID: ${session.project_id}`,
    '',
    '## Tu responsabilidad',
    '',
    `Tú gestionas el ciclo completo de esta tarea: trabajar → documentar → mover a "${reviewState}" → cerrar sesión. Usa ${mcpHint} para todas las interacciones con ${providerName}.`,
    '',
    '## Flujo esperado',
    '',
    '**1. Al empezar** — comenta tu plan de acción (qué vas a hacer, qué archivos esperas tocar).',
    '',
    '**2. Durante el trabajo** — comenta hitos importantes: features completadas, bugs encontrados, decisiones técnicas tomadas, blockers detectados.',
    '',
    // KODO-62: el camino MCP no pasa por `addComment`, así que el backstop de kodo
    // (providers/plane/normalize.js toCommentHtml) no puede rescatarlo — la única
    // corrección posible es que la sesión escriba bien el `comment_html`. Solo para
    // Plane: GitHub recibe Markdown LITERAL (D-24) y una instrucción de HTML lo rompería.
    ...(providerName === 'plane'
      ? [
          '**Formato de todos esos comentarios** — el `comment_html` de Plane se guarda y se renderiza TAL CUAL: escribe HTML crudo (`<p>texto</p>`, `<ul><li>…</li></ul>`, `<code>x</code>`), nunca entidades escapadas (`&lt;p&gt;`) ni Markdown. Nadie des-escapa por ti en el camino, así que un `&lt;p&gt;` enviado es un `&lt;p&gt;` literal visible en la tarea.',
          '',
        ]
      : []),
    '**3. Al terminar** — antes de cerrar la sesión, haz en orden:',
    '',
    '   a. **Escribe un comentario final de resumen** con:',
    '      - ✅ Qué se ha completado (features, fixes, cambios)',
    '      - 📁 Archivos modificados/creados (lista)',
    '      - ⚠️ Pendientes o limitaciones (si las hay)',
    '      - 🔍 Qué debe revisar el humano para aprobar',
    '',
    `   b. **Mueve la tarea al estado "${reviewState}"** vía ${mcpHint}. Esto señala que está lista para revisión humana.`,
    '',
    `   c. **Cierra la sesión con \`/exit\`** (el hook limpiará el estado local, sin tocar ${providerName}).`,
    '',
    '## Criterios para dar la tarea por terminada',
    '',
    '- La funcionalidad pedida está implementada y probada (si aplica)',
    '- El código está commiteado si era trabajo de código',
    '- La documentación/output solicitado está generado',
    '- Has dejado constancia clara de lo hecho en el comentario final',
    '',
    'Si no puedes terminar (falta info, hay blocker, requiere decisión humana): comenta el estado actual con detalle, **no muevas a revisión**, y cierra con `/exit`. La tarea quedará visible en el dashboard para que el humano intervenga.',
    '',
    '## Anti-push-fantasma',
    '',
    'kodo NO hace `git push` automático. Antes de afirmar deploy, publicación o cambios remotos, verifica con `git push` real, o redacta la afirmación en condicional ("una vez se haga push…").',
    '',
    'Ejemplos:',
    '- Bad: "Feature publicada en producción."',
    '- Good: "Feature commiteada localmente, pendiente de `git push` al remoto."',
    '- Bad: "Deploy hecho."',
    '- Good: "Deploy quedará efectivo una vez se haga `git push origin main`."',
    // Phase 45 PLAN-03: append al FINAL preserva golden bytes (HOOK-02 satisfied-by-construction).
    // D-03: el hook solo emite el string; la sesión escribe el fichero. D-05 markdown plano,
    // D-07 una sola línea para el NEXT, D-08 ES.
    //
    // Phase 74 D-10 + LIVE-02: la semántica «sobrescribe si ya existe» (Phase 45 D-06,
    // latest-wins) queda INVERTIDA a preservar-y-appendear. El historial de la tarea ES el
    // dato: una segunda sesión debe acumular su bloque sobre el de la primera, no destruirlo
    // en el arranque. Esta instrucción es la mitad OPTIMISTA del patrón LLM+backstop — el
    // bloque mecánico de D-03 (en session-end.js) es la garantía cuando el LLM no cumple.
    // El formato del bloque es el de D-01, con el session_id RESUELTO: es lo que permite a
    // findSessionBlock (D-04) saber de qué sesión es cada bloque. Markdown plano sin emojis:
    // este texto cae dentro del slice que vigila el guard D-02b de HOOK-01.
    '',
    `Además, al empezar escribe un plan corto (qué vas a hacer + pasos previstos) en \`${join(KODO_DIR, 'plans', `${session.task_id}.md`)}\`. Si el fichero ya existe, NO lo sobrescribas: añade tu plan al final, conservando íntegro lo que ya hubiera.`,
    // KODO-69: la FUENTE del alcance del oráculo mecánico. Sin este bloque el check `scope`
    // queda en `skip` para siempre — kodo NO adivina qué debía tocar una tarea, porque un
    // alcance inventado daría un `fail` que nadie puede defender. El marcador es contrato de
    // parsing (`src/integration/scope.js`), así que va literal en las dos ramas de idioma.
    '',
    'En ese mismo plan, declara el ALCANCE: los ficheros que esperas tocar, como globs, dentro de este bloque exacto. Al cerrar, kodo compara lo declarado con el diff real de tu rama (`kodo oracle`), así que un fichero fuera de alcance se ve. Sin bloque, esa comprobación se salta — no se adivina.',
    '',
    '```markdown',
    '<!-- kodo:scope v=1 -->',
    '- src/integration/**',
    '- test/oracle-*.test.js',
    '<!-- /kodo:scope -->',
    '```',
    '',
    'Y al cerrar la sesión, añade al final de ese mismo fichero un bloque de handoff, sin borrar los bloques anteriores, con este formato exacto:',
    '',
    '```markdown',
    `## Handoff <fecha-hora local YYYY-MM-DD HH:MM> <!-- kodo:handoff v=1 session=${session.session_id} author=llm at=<timestamp ISO-8601 UTC> -->`,
    '',
    '**Hecho:** qué has completado en esta sesión',
    '**Pendiente:** qué queda abierto',
    '**NEXT:** la siguiente acción concreta, en una sola línea',
    '```',
  ].join('\n');
}
