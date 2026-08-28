// @ts-check
//
// src/cli/insecure-gate.js — KODO-52 (blindaje anti-uso accidental de `--insecure`).
//
// `kodo start --insecure` salta la verificación HMAC del webhook (server.js:311):
// cualquiera que alcance el puerto puede disparar sesiones de Claude. Un solo flag
// de CLI es demasiado poca fricción para eso — se copia de un README, se queda en
// un script de arranque y acaba en un host expuesto sin que nadie lo note.
//
// El gate exige DOS señales independientes y de canales distintos: el flag (línea
// de comandos, efímero) MÁS `KODO_ALLOW_INSECURE=1` (entorno, deliberado). Ninguna
// de las dos se activa por accidente cuando la otra no está.
//
// Se vive en su propio módulo (no inline en cli.js) por dos razones: cli.js ejecuta
// `program.parse()` al import y no es testeable, y el núcleo aquí es una función
// PURA — mismo precedente que src/cli/config-args.js.
//
// ALCANCE (deliberadamente estrecho): solo cubre el flag `--insecure` de
// `kodo start`. `KODO_DEV=1` — el otro bypass del gate de secret en server.js — NO
// se toca: ya es una señal ambiental explícita, que es justo la fricción que este
// cambio añade al flag.

/** Nombre de la variable de entorno que autoriza el modo inseguro. */
export const ALLOW_INSECURE_ENV = 'KODO_ALLOW_INSECURE';

/** Valor EXACTO (tras trim) que la variable debe tener. Nada de 'true'/'yes'/'on': */
/* un único valor válido no deja dudas sobre qué escribir ni margen a typos que "casi" valen. */
const ALLOW_INSECURE_VALUE = '1';

/**
 * Decide si `--insecure` puede activarse. Función PURA: no lee `process.env` ni
 * imprime — recibe el entorno y devuelve el veredicto con su texto ya redactado.
 *
 * @param {{ insecure?: boolean, env?: Record<string, string|undefined> }} opts
 * @returns {{ allowed: boolean, blocked: boolean, message: string|null }}
 *   - `insecure` falsy            → { allowed:true,  blocked:false, message:null } (arranque normal)
 *   - flag sin la env var         → { allowed:false, blocked:true,  message:<error accionable> }
 *   - flag + `KODO_ALLOW_INSECURE=1` → { allowed:true, blocked:false, message:<warning visible> }
 */
export function checkInsecureGate({ insecure = false, env = {} } = {}) {
  // Sin flag no hay nada que blindar: el arranque normal no pasa por aquí.
  if (!insecure) return { allowed: true, blocked: false, message: null };

  const raw = env[ALLOW_INSECURE_ENV];
  const authorized = typeof raw === 'string' && raw.trim() === ALLOW_INSECURE_VALUE;

  if (!authorized) {
    return {
      allowed: false,
      blocked: true,
      message: [
        '[kodo] --insecure desactiva la verificación HMAC del webhook: cualquiera que',
        '[kodo] alcance este puerto puede disparar sesiones de Claude.',
        '[kodo]',
        `[kodo] Si es lo que quieres, decláralo también en el entorno:`,
        `[kodo]   ${ALLOW_INSECURE_ENV}=${ALLOW_INSECURE_VALUE} kodo start --insecure`,
        '[kodo]',
        '[kodo] En cualquier host que no sea tu máquina local, configura el secreto en su',
        '[kodo] lugar: KODO_WEBHOOK_SECRET_<PROVIDER> (ej. KODO_WEBHOOK_SECRET_PLANE).',
      ].join('\n'),
    };
  }

  return {
    allowed: true,
    blocked: false,
    message: [
      '[kodo] ⚠  MODO INSEGURO — verificación HMAC del webhook DESACTIVADA',
      `[kodo] ⚠  (--insecure + ${ALLOW_INSECURE_ENV}=${ALLOW_INSECURE_VALUE}).`,
      '[kodo] ⚠  Cualquiera que alcance este puerto puede disparar sesiones. Solo desarrollo local.',
    ].join('\n'),
  };
}

/**
 * Aplica el gate como efecto de borde para el CLI: imprime el veredicto y, si está
 * bloqueado, sale con exit 1 ANTES de que `startServer` levante nada. Envoltorio
 * fino sobre `checkInsecureGate` — la lógica testeable vive allí.
 *
 * @param {boolean|undefined} insecure - valor de `opts.insecure` de commander.
 * @returns {void}
 */
export function enforceInsecureGate(insecure) {
  const verdict = checkInsecureGate({ insecure, env: process.env });
  if (verdict.blocked) {
    console.error(verdict.message);
    process.exit(1);
  }
  if (verdict.message) console.warn(verdict.message);
}
