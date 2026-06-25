// @ts-check
//
// src/cli/dashboard/enrich.js — Phase 62 Plan 01 (ORCH-02).
//
// Derivador LLM one-shot never-throws para la adopción inteligente desde el dashboard.
// Lee la intención de la sesión (primer prompt del transcript) como señal PRIMARIA + contexto
// de fondo (GSD: PROJECT.md/ROADMAP.md/STATE.md; non-GSD: git log), lo inyecta en un prompt
// mínimo orientado a la TAREA de esta sesión, y spawnea
// `claude -p --model claude-haiku-4-5 --output-format json --json-schema <SCHEMA>` para
// derivar `{ title, description }`. CUALQUIER fallo (ENOENT, timeout, exit≠0, is_error,
// parse-fail, sync-throw) → fail-open a `{}` → App.js cae a surface.title/basename(cwd).
//
// Invariantes (CONTEXT.md D-01..D-15):
//   - D-02: subproceso SIN tools (sin Read/Bash); contexto pre-leído e inline.
//   - D-03: never-throws / fail-open; timeout ~25s (Pitfall 1 — latencias reales 8.7-21.9s).
//   - D-06: primer prompt del transcript = intención; resolveTranscriptPath reusado.
//   - D-07: prompt nuevo, mínimo (NO la prosa del orquestador).
//   - D-11: suelo 0-token del core intacto — el LLM vive SOLO aquí.
//   - D-12: el output pasa por sanitizeAdoptionData AGUAS ABAJO (en adoptSession). No re-saneo.
//   - D-13: execFile argv literal → inyección estructuralmente inerte.
//   - D-15: 'claude' por PATH (NO config.claude.binary, que apunta a un binario inexistente).
//
// El spawn se INYECTA por DI (`spawnFn`) SIN default → leak guard estructural (espejo de
// runAdopt en adopt.js): omitirlo produce un TypeError visible, nunca toca el `claude` real.
// CERO import de child_process, CERO color/ANSI inline (color-isolation D-12,
// verificado por test/format-isolation.test.js que escanea src/cli/dashboard/**).

import { join } from 'node:path';
import { resolveTranscriptPath } from '../../logger-events.js'; // D-06: NO reinventar el path
import { isGsdProject } from '../../adopt.js'; // D-04/D-05: NO existsSync ad-hoc

/**
 * Schema estricto para `--json-schema`: fuerza `result` a JSON estricto (sin fence markdown,
 * Pitfall 2). Sin schema, `result` llega envuelto en ```json ... ``` → parse frágil.
 */
export const SCHEMA = JSON.stringify({
  type: 'object',
  properties: { title: { type: 'string' }, description: { type: 'string' } },
  required: ['title', 'description'],
  additionalProperties: false,
});

/** Timeout por defecto del spawn de Haiku. ~25s — NO 8s (Pitfall 1: cortaría casi todas). */
const DEFAULT_TIMEOUT_MS = 25_000;

/**
 * Spawn one-shot de `claude -p` + parse de doble capa (envelope → result), fail-open a {}.
 *
 * @param {{
 *   spawnFn: (cmd: string, args: string[], opts: object, cb: (err: any, stdout: string, stderr: string) => void) => any,
 *   prompt: string,
 *   timeoutMs?: number,
 * }} args
 * @returns {Promise<{ title?: string, description?: string }>} {} en CUALQUIER fallo
 */
export function spawnDerive({ spawnFn, prompt, timeoutMs = DEFAULT_TIMEOUT_MS }) {
  // Leak guard ESTRUCTURAL (espejo de runAdopt): el `spawnFn` DI NO lleva default → omitirlo
  // lanza un TypeError visible, NO un fallback silencioso al binario real. Va ANTES del
  // new Promise para que el TypeError propague síncronamente (no atrapado por el try/catch).
  if (typeof spawnFn !== 'function') {
    throw new TypeError(
      'spawnDerive: `spawnFn` is required (no default — leak guard). ' +
        'Inject `(await import("node:child_process")).execFile` from the caller.',
    );
  }
  return new Promise((resolve) => {
    try {
      const argv = [
        '-p',
        '--model',
        'claude-haiku-4-5',
        '--output-format',
        'json',
        '--json-schema',
        SCHEMA,
        prompt, // argv literal — execFile, NO shell → injection-inerte (D-13)
      ];
      // 'claude' por PATH (D-15 / Pitfall 3): NO config.claude.binary.
      const child = spawnFn('claude', argv, { timeout: timeoutMs }, (err, stdout) => {
        if (err) return resolve({}); // ENOENT / timeout(killed) / exit≠0
        try {
          const env = JSON.parse(stdout); // capa 1: envelope
          if (!env || env.is_error || typeof env.result !== 'string') return resolve({});
          const inner = JSON.parse(env.result); // capa 2: result JSON estricto (con --json-schema)
          const out = {};
          if (typeof inner.title === 'string' && inner.title.trim()) out.title = inner.title.trim();
          if (typeof inner.description === 'string' && inner.description.trim()) {
            out.description = inner.description.trim();
          }
          resolve(out);
        } catch {
          resolve({}); // parse-fail → fail-open
        }
      });
      // Cierra stdin (≈ `< /dev/null`): sin esto `claude` espera 3s a recibir entrada antes de
      // proceder (Pitfall 1bis). Esos 3s, sumados a la latencia API (8.7-21.9s), rozan el timeout
      // de 25s y causan fail-open intermitente (síntoma: título=surface.title sin descripción).
      // `execFile` ignora `stdio` cuando lleva callback, así que cerramos el stream del child.
      // El `?.` protege a los spawnFn fake de los tests, que no devuelven un child.
      try {
        child?.stdin?.end();
      } catch {
        /* sin child / sin stdin → noop */
      }
    } catch {
      resolve({}); // spawn sync-throw → fail-open
    }
  });
}

/**
 * Lee un archivo capeado, never-throws (ENOENT/permiso → '').
 *
 * @param {(p: string, enc: string) => string} readFileFn
 * @param {string} path
 * @param {number} cap
 * @returns {string}
 */
function readCapped(readFileFn, path, cap) {
  try {
    return readFileFn(path, 'utf8').slice(0, cap);
  } catch {
    return '';
  }
}

/**
 * Memoria GSD capeada (Pitfall 4): PROJECT.md ≤3000, ROADMAP.md ≤2000, STATE.md ≤2000.
 *
 * @param {{ cwd: string, readFileFn: (p: string, enc: string) => string }} args
 * @returns {string}
 */
function gsdContext({ cwd, readFileFn }) {
  const p = (f) => join(cwd, '.planning', f);
  return [
    readCapped(readFileFn, p('PROJECT.md'), 3000),
    readCapped(readFileFn, p('ROADMAP.md'), 2000),
    readCapped(readFileFn, p('STATE.md'), 2000),
  ]
    .filter(Boolean)
    .join('\n\n---\n\n');
}

/**
 * `git log --oneline -20` vía el MISMO spawnFn DI; barato y rápido (NO es el LLM), never-throws.
 *
 * @param {{ cwd: string, spawnFn: Function }} args
 * @returns {Promise<string>} '' on err, cap 2000
 */
function gitLog({ cwd, spawnFn }) {
  return new Promise((resolve) => {
    try {
      spawnFn('git', ['-C', cwd, 'log', '--oneline', '-20'], { timeout: 3000 }, (err, stdout) =>
        resolve(err ? '' : (stdout || '').slice(0, 2000)),
      );
    } catch {
      resolve('');
    }
  });
}

/**
 * Primer turno `type:'user'` con texto real del transcript `.jsonl` (D-06). Salta líneas
 * no-parseables (queue-operation) y turnos tool_result-only. never-throws → ''.
 *
 * @param {{ cwd: string, sessionId: string, readFileFn: (p: string, enc: string) => string }} args
 * @returns {string} cap 1500
 */
export function firstUserPrompt({ cwd, sessionId, readFileFn }) {
  try {
    const raw = readFileFn(resolveTranscriptPath(cwd, sessionId), 'utf8'); // ENOENT → catch → ''
    for (const line of raw.split('\n')) {
      if (!line.trim()) continue;
      let o;
      try {
        o = JSON.parse(line);
      } catch {
        continue; // líneas no-mensaje (queue-operation) → saltar
      }
      if (!o || o.type !== 'user' || typeof o.message !== 'object' || o.message === null) continue;
      const c = o.message.content;
      let text = '';
      if (typeof c === 'string') {
        text = c;
      } else if (Array.isArray(c)) {
        const hasToolResult = c.some((b) => b && b.type === 'tool_result');
        const texts = c.filter((b) => b && b.type === 'text').map((b) => b.text);
        if (hasToolResult && texts.length === 0) continue; // tool_result-only → no es prompt
        text = texts.join(' ');
      }
      if (text && text.trim()) return text.trim().slice(0, 1500);
    }
    return '';
  } catch {
    return '';
  }
}

/**
 * Prompt mínimo NUEVO (D-07) — en inglés, sin mandato charset/single-quote (la shell-safety
 * la da execFile argv literal, D-13). Pide derivar la TAREA de esta sesión (el trabajo en
 * curso), no el alcance global del proyecto, no el directorio, no el último commit.
 *
 * @param {{ contextLabel: string, contextBody: string }} args
 * @returns {string}
 */
function buildDerivePrompt({ contextLabel, contextBody }) {
  return [
    'Derive a concise title and a one-paragraph description for the SPECIFIC TASK this',
    'coding session is working on, based PRIMARILY on the session intent below. The title',
    'must name the task / work in progress (what this session is doing) — NOT the overall',
    'project, NOT the directory name, NOT the latest commit. Use any project background',
    'only to disambiguate domain terms, never as the title subject itself.',
    'Return ONLY the structured fields requested.',
    '',
    `## ${contextLabel}`,
    contextBody,
  ].join('\n');
}

/**
 * Derivador completo never-throws. Ramifica GSD vs non-GSD vía isGsdProject (D-04/D-05),
 * construye el contexto inline, y delega en spawnDerive. fail-open a {}.
 *
 * @param {{
 *   spawnFn: Function,
 *   readFileFn: (p: string, enc: string) => string,
 *   existsSyncFn?: (p: string) => boolean,
 *   cwd: string,
 *   sessionId: string,
 *   timeoutMs?: number,
 * }} args
 * @returns {Promise<{ title?: string, description?: string }>}
 */
export async function deriveAdoptionMeta({ spawnFn, readFileFn, existsSyncFn, cwd, sessionId, timeoutMs }) {
  try {
    let contextLabel;
    let contextBody;
    if (isGsdProject(cwd, existsSyncFn)) {
      // D-04 (revisado tras UAT 2026-06-25): el título debe reflejar la TAREA de esta sesión,
      // no el alcance global. El primer prompt del transcript = intención PRIMARIA; la memoria
      // GSD pasa a ser contexto de fondo desambiguador, no el sujeto del título.
      const intent = firstUserPrompt({ cwd, sessionId, readFileFn });
      const memory = gsdContext({ cwd, readFileFn });
      contextLabel = 'Session intent + project background (GSD)';
      contextBody = [
        intent && `### Session intent (PRIMARY — what the user asked in this session)\n${intent}`,
        memory && `### Project background (context only — do NOT make this the title subject)\n${memory}`,
      ]
        .filter(Boolean)
        .join('\n\n---\n\n');
    } else {
      // D-05: non-GSD — intención (primer prompt, PRIMARIA) + actividad (git log, secundaria).
      const intent = firstUserPrompt({ cwd, sessionId, readFileFn });
      const log = await gitLog({ cwd, spawnFn });
      contextLabel = 'Session intent + recent activity';
      contextBody = [
        intent && `### Session intent (PRIMARY — what the user asked in this session)\n${intent}`,
        log && `### Recent activity (context only)\n${log}`,
      ]
        .filter(Boolean)
        .join('\n\n---\n\n');
    }
    const prompt = buildDerivePrompt({ contextLabel, contextBody });
    return spawnDerive({ spawnFn, prompt, timeoutMs });
  } catch {
    return {}; // fail-open total (D-03)
  }
}
