// @ts-check
//
// test/kodo-capture-skill.test.js — Phase 84 Plan 02 (CAPT-02 / D-09..D-15).
//
// ⚠ QUÉ SE ESTÁ BLINDANDO AQUÍ ⚠
//
// `.claude/skills/kodo-capture/SKILL.md` es un PROMPT, no código: no se puede unit-testear
// ejecutando un LLM. Lo que sí se puede blindar —y es lo único que puede desviarse— es **la cadena
// de comando que la skill le dice al modelo que ejecute**. La byte-identidad de CAPT-02 no se
// «logra»: se HEREDA de que solo exista un writer (D-10). La skill shellea `kodo capture` y no
// construye ninguna línea, así que la única superficie de deriva es el markdown.
//
// Por eso este fichero extrae la invocación DEL PROPIO MARKDOWN y la congela (D-14):
//   - unicidad: exactamente UNA invocación y UN bloque cercado (dos comandos = dos caminos).
//   - igualdad de argv: `deepEqual` contra `ARGV_CANONICO`. Es la ÚNICA aserción que detecta un
//     `--` eliminado sin necesidad de un texto adversarial (D-11, §Pitfall 4).
//   - frontmatter: `allowed-tools` con el patrón ESTRECHO, nunca un comodín (D-09, T-84-08).
//
// ⚠ TRAMPA YA VIVIDA (83-01 deviación 2, `test/inbox-cli.test.js:1440-1445`): los detectores van
// anclados a PRINCIPIO DE LÍNEA, jamás a la subcadena suelta del nombre del comando — la prosa del
// propio `SKILL.md` lo menciona y un gate anclado al nombre pondría roja la suite por su propia
// documentación. Por la misma razón NO existe aquí ningún gate negativo sobre el path del inbox:
// el cuerpo lo menciona legítimamente al prohibir la escritura manual. El invariante D-10 se
// comprueba en forma POSITIVA (unicidad + igualdad de argv), nunca por ausencia de una subcadena.
//
// ⚠ DISCIPLINA DE HOME — OBLIGATORIA, SIN EXCEPCIÓN ⚠
//
// TODO test de este fichero que ejercite la captura sandboxea su HOME (carril child) o INYECTA sus
// paths (carril in-process) ANTES de invocar. Ninguno puede tocar el `~/.kodo/` real del operador:
// durante la sesión de research de esta fase una sonda sin sandbox escribió una línea en el inbox
// real y hubo que retirarla a mano. El tmpdir del carril child se limpia en el camino de salida de
// cada test, incluido el de fallo (`finally` + `rmSync({recursive:true, force:true})`).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runCaptureCli } from '../src/cli/capture.js';
import { createFormatter } from '../src/cli/format.js';
import { encodeLine, parseLine } from '../src/inbox/store.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const KODO_BIN = join(REPO, 'bin', 'kodo');

/** El artefacto bajo contrato. `SKILL.md` en MAYÚSCULAS (D-08, convención de Claude Code). */
const SKILL_MD = join(REPO, '.claude', 'skills', 'kodo-capture', 'SKILL.md');

/** Marcador HTML estable que precede al bloque cercado. Es el contrato de extracción. */
const MARCADOR = '<!-- kodo:capture:invocacion -->';

/** Aísla el bloque cercado PRECEDIDO DEL MARCADOR y captura su contenido. */
const BLOCK_RE = /^<!-- kodo:capture:invocacion -->\n```bash\n([\s\S]*?)\n```$/m;

/** Cuenta delimitadores de bloque cercado (apertura + cierre). */
const FENCE_RE = /^```/gm;

/**
 * Detector de invocaciones ANCLADO A PRINCIPIO DE LÍNEA (flags `g` + `m`).
 * NUNCA anclarlo a la subcadena suelta: ver la cabecera de este fichero.
 */
const INVOCATION_RE = /^kodo capture\b.*$/gm;

/** El placeholder del literal LOCKED de D-11: el modelo sustituye y escapa, no el shell. */
const PLACEHOLDER = '<texto>';

/** El argv congelado. Editar la línea del markdown pone rojo el `deepEqual` contra esto. */
const ARGV_CANONICO = Object.freeze(['capture', '--origin', 'skill', '--', PLACEHOLDER]);

/** Nombre del binario que la invocación canónica nombra. */
const BIN = 'kodo';

const FRONTMATTER_RE = /^---\n([\s\S]*?)\n---\n/;
const NAME_RE = /^name: kodo-capture$/m;
const DESCRIPTION_RE = /^description: (\S.*)$/m;
const ARGUMENT_HINT_RE = /^argument-hint: "<texto de la idea>"$/m;
const ALLOWED_TOOLS_RE = /^allowed-tools: Bash\(kodo capture \*\)$/m;

// --- Identidad inyectada, VERBATIM del golden de Phase 83 (`test/inbox-format-golden.test.js`) ---
// No se re-deriva ninguna: el golden es la única fuente de verdad del formato.
const ID = 'a3f9k2';
const TEXT = 'el texto de la idea';
const DATE = '2026-07-25';

/**
 * La forma 1 «abierta» del golden de Phase 83 con el ÚNICO campo que esta fase cambia: el origen.
 * `cli` → `skill`. Si esta cadena se separa un byte del golden, la byte-identidad de CAPT-02 se
 * rompió y el skill-path dejó de ser indistinguible del CLI-path.
 */
const LINEA_GOLDEN_SKILL = '- [ ] a3f9k2 · el texto de la idea · kodo · 2026-07-25 · skill';

/**
 * Texto que EMPIEZA POR GUION: el caso que hace observable la ausencia del separador `--`.
 * Con separador → exit 0; sin él, commander lo lee como opción desconocida (§Pitfall 4).
 */
const TEXTO_ADVERSARIAL = '-3 % de conversión';

/**
 * Texto adversarial con METACARACTERES DE SHELL. Dentro de comillas dobles, `$(...)`, las
 * comillas invertidas y `$VAR` se EXPANDEN: el shell ejecuta el comando y su salida acaba escrita
 * en el inbox (84-REVIEW CR-01, reproducido). Dentro de comillas simples no se expande nada.
 *
 * **El discriminante es `$HOME`, no una palabra centinela.** Una centinela tipo `$(echo PWNED)`
 * NO sirve: la cadena `PWNED` aparece también en el texto SIN expandir, así que buscarla no
 * distingue los dos casos (primer intento de este test, rojo por construcción). La ruta del HOME
 * sandbox, en cambio, no está en el literal por ningún lado: solo puede aparecer si el shell
 * expandió. Los otros dos metacaracteres se verifican por igualdad con el literal completo.
 */
const TEXTO_INYECCION = 'coste: $(id -un) y `hostname` y $HOME';

/**
 * Tokenizador shell-like mínimo: respeta comillas SIMPLES y dobles y las retira del token.
 * No existe helper compartido en el repo (no hay utilidades de test comunes), así que vive aquí.
 * Lanza ante comillas sin cerrar: un tokenizador laxo dejaría pasar un comando que commander
 * rechaza, que es exactamente el fallo que este fichero existe para impedir.
 *
 * Reconoce los DOS estilos a propósito: así el test de igualdad de argv sigue siendo válido
 * si alguien cambia el estilo de comillas, y es el test dedicado de CR-01 —no el tokenizador—
 * el que falla y nombra el motivo. Un tokenizador que solo aceptara simples convertiría un
 * fallo de seguridad legible en un críptico «comilla sin cerrar».
 *
 * @param {string} cadena
 * @returns {string[]}
 */
function tokenize(cadena) {
  /** @type {string[]} */
  const tokens = [];
  let actual = '';
  /** @type {'"' | "'" | null} */
  let comilla = null;
  let hayToken = false;
  for (const ch of cadena) {
    if (comilla === null && (ch === '"' || ch === "'")) {
      comilla = /** @type {'"' | "'"} */ (ch);
      hayToken = true;
      continue;
    }
    if (comilla !== null && ch === comilla) {
      comilla = null;
      hayToken = true;
      continue;
    }
    if (comilla === null && /\s/.test(ch)) {
      if (hayToken) {
        tokens.push(actual);
        actual = '';
        hayToken = false;
      }
      continue;
    }
    actual += ch;
    hayToken = true;
  }
  if (comilla !== null) throw new Error('comilla sin cerrar en la invocación del SKILL.md');
  if (hayToken) tokens.push(actual);
  return tokens;
}

/** Lee el `SKILL.md` una sola vez por proceso de test. Cero escrituras, cero subprocesos. */
const SKILL_SRC = readFileSync(SKILL_MD, 'utf-8');

/**
 * Extrae el contenido del bloque cercado marcado, ya trimmed.
 * @returns {string}
 */
function contenidoDelBloque() {
  const m = SKILL_SRC.match(BLOCK_RE);
  assert.ok(m, `el SKILL.md no contiene el bloque cercado precedido de \`${MARCADOR}\``);
  return m[1].trim();
}

/**
 * Tokeniza la invocación del markdown y devuelve `{ bin, argv }`.
 * @returns {{ bin: string, argv: string[] }}
 */
function invocacionDelMarkdown() {
  const tokens = tokenize(contenidoDelBloque());
  assert.ok(tokens.length > 1, 'la invocación del SKILL.md no tiene argumentos');
  return { bin: tokens[0], argv: tokens.slice(1) };
}

/**
 * Mapea el argv extraído del markdown a las opciones del handler.
 *
 * FALLA el test —en vez de tolerarlo— si el argv no lleva el separador o si aparece un flag
 * después de él: un tokenizador laxo dejaría pasar un comando que commander rechaza, y el carril
 * in-process no ejecuta commander, así que no lo detectaría por su cuenta.
 *
 * @param {string[]} argv  argv del markdown, SIN el nombre del binario.
 * @param {string} text    el texto que sustituye al placeholder.
 * @returns {{ text: string, origin: string }}
 */
function argvToCaptureOpts(argv, text) {
  const sep = argv.indexOf('--');
  assert.notEqual(sep, -1, 'el argv del SKILL.md no lleva el separador `--`: un texto con guion inicial abortaría');
  const cabeza = argv.slice(0, sep);
  const cola = argv.slice(sep + 1);
  for (const token of cola) {
    assert.equal(
      token.startsWith('-'),
      false,
      `\`${token}\` va después del separador: commander lo leería como TEXTO, no como flag`,
    );
  }
  assert.equal(cabeza[0], 'capture', 'la invocación debe ser del subcomando de captura');
  assert.equal(cola.length, 1, 'el texto viaja como UN SOLO elemento de argv, nunca interpolado en una cadena de shell');
  const i = cabeza.indexOf('--origin');
  assert.notEqual(i, -1, '`--origin` es el vocabulario que D-16 de Phase 83 creó para esta fase');
  const origin = cabeza[i + 1];
  assert.ok(origin && !origin.startsWith('-'), '`--origin` debe llevar valor');
  return { text, origin };
}

/**
 * Ejecuta el binario real con HOME SANDBOX y sin color. `cwd: REPO` para que el tag derivado sea
 * el del propio repo. Timeout de 10 s (mismo molde que `test/skill-sync.test.js`).
 *
 * @param {string[]} argv  argv completo tras el binario.
 * @param {string} home    directorio temporal que hace de HOME.
 */
function runKodo(argv, home) {
  return spawnSync(process.execPath, [KODO_BIN, ...argv], {
    cwd: REPO,
    env: { ...process.env, HOME: home, NO_COLOR: '1' },
    encoding: 'utf-8',
    timeout: 10000,
  });
}

/** Crea el HOME sandbox del carril child. Su limpieza es responsabilidad del `finally` del test. */
function sandboxHome() {
  return mkdtempSync(join(tmpdir(), 'kodo-capture-skill-home-'));
}

// --- ESTÁTICOS: el contrato que vive en el markdown (D-11, D-14) ----------------------------

describe('D-14 — la invocación del SKILL.md es única y está congelada', () => {
  it('unicidad: exactamente UNA invocación en el fichero entero (corolario D-14)', () => {
    const matches = SKILL_SRC.match(INVOCATION_RE) || [];
    assert.equal(
      matches.length,
      1,
      `dos invocaciones son dos caminos de escritura y rompen D-10. Encontradas: ${JSON.stringify(matches)}`,
    );
  });

  it('un solo bloque cercado, y es el que sigue al marcador', () => {
    const fences = SKILL_SRC.match(FENCE_RE) || [];
    assert.equal(fences.length, 2, 'el SKILL.md debe tener exactamente UN bloque cercado (2 delimitadores)');
    assert.equal((SKILL_SRC.match(new RegExp(`^${MARCADOR}$`, 'gm')) || []).length, 1);
    const contenido = contenidoDelBloque();
    assert.equal(contenido.split('\n').length, 1, 'el bloque debe contener exactamente UNA línea');
  });

  it('igualdad de argv contra ARGV_CANONICO — la aserción de verdad (D-11)', () => {
    const { bin, argv } = invocacionDelMarkdown();
    assert.equal(bin, BIN, 'la invocación debe llamar al binario de kodo');
    assert.deepEqual(
      argv,
      [...ARGV_CANONICO],
      'el `--origin skill` y el separador `--` son contrato: su ausencia pone rojo este test aunque el texto sea benigno',
    );
  });

  it('CR-01: el texto va entre comillas SIMPLES — las dobles dejarían expandir al shell', () => {
    const contenido = contenidoDelBloque();
    assert.ok(
      contenido.includes(`'${PLACEHOLDER}'`),
      `el placeholder debe ir entre comillas simples. Con dobles, un texto que contenga $(...) o ` +
        'comillas invertidas se EJECUTA al construir la llamada a Bash (84-REVIEW CR-01, reproducido) ' +
        `y su salida acaba escrita en el inbox. Encontrado: ${JSON.stringify(contenido)}`,
    );
    assert.ok(
      !contenido.includes('"'),
      'ninguna comilla doble en la invocación: es el metacarácter que abre la expansión',
    );
  });

  it('CR-01: la regla de escape de comillas simples está documentada en el cuerpo', () => {
    // Sin esta regla el modelo, ante un apóstrofo en el texto, «arreglaría» el comando
    // volviendo a las dobles — reabriendo exactamente el agujero que la línea cierra.
    assert.ok(
      SKILL_SRC.includes(`'\\''`),
      'el cuerpo debe enseñar la secuencia de escape `\'\\\'\'` para un texto con apóstrofo',
    );
  });

  it('frontmatter presente y `allowed-tools` con el patrón ESTRECHO (D-09, T-84-08)', () => {
    const fm = SKILL_SRC.match(FRONTMATTER_RE);
    assert.ok(fm, 'el SKILL.md debe abrir con un bloque de frontmatter (a diferencia de kodo-orchestrate/skill.md)');
    const bloque = fm[1];
    assert.match(bloque, NAME_RE, '`name` debe ser exactamente `kodo-capture`');
    const desc = bloque.match(DESCRIPTION_RE);
    assert.ok(desc, '`description` es lo que hace que Claude sepa CUÁNDO cargar la skill');
    assert.ok(desc[1].length <= 1536, '`description` excede el tope de 1 536 caracteres del listado de skills');
    assert.match(bloque, ARGUMENT_HINT_RE, '`argument-hint` debe estar presente');
    assert.match(
      bloque,
      ALLOWED_TOOLS_RE,
      '`allowed-tools` debe ser exactamente `Bash(kodo capture *)` — un comodín amplio pre-aprobaría ejecución arbitraria',
    );
  });
});

// --- EJECUCIÓN: las dos vías (§Pattern 3 (iii)/(iv)) -----------------------------------------
//
// Ninguna finge determinismo donde no lo hay:
//   - la vía IN-PROCESS es byte-determinista (id y reloj inyectados) pero NO demuestra que el argv
//     funcione: el test lo mapea a opciones él mismo, sin pasar por commander;
//   - la vía CHILD es el commander real (fidelidad total) pero no admite inyección de reloj.
// Hacen falta las dos.

describe('D-14 — el argv del markdown produce la línea del golden y sobrevive al commander real', () => {
  it('vía in-process — byte-identidad con el golden de Phase 83, cambiando SOLO el origen', () => {
    const { argv } = invocacionDelMarkdown();
    const opts = argvToCaptureOpts(argv, TEXT);
    assert.equal(opts.origin, 'skill', 'el origen del skill-path es el vocabulario `skill` (D-16 de Phase 83)');

    /** @type {string[]} */
    const escritas = [];
    const code = runCaptureCli(opts, {
      idFn: () => ID,
      clockFn: () => DATE,
      // Basename `kodo` → el tag del golden. El tag lo calcula el WRITER (D-12): ni la skill ni
      // este test lo deciden.
      cwdFn: () => '/x/kodo',
      projectsFn: () => ({}),
      // Paths INYECTADOS a un tmpdir que ni siquiera se crea: con `appendFn` capturando en memoria
      // este carril no hace UN SOLO acceso al filesystem, y menos aún al HOME real.
      pathsFn: () => ({
        inboxPath: join(tmpdir(), 'kodo-capture-skill-inproc', 'inbox.md'),
        lockPath: join(tmpdir(), 'kodo-capture-skill-inproc', 'inbox.lock'),
      }),
      appendFn: (line) => {
        escritas.push(line);
        return { ok: /** @type {true} */ (true), coordinated: true };
      },
      writeFn: () => {},
      errFn: () => {},
      formatterFn: () => createFormatter({ isTTY: false }, { NO_COLOR: '1' }),
    });

    assert.equal(code, 0, 'la captura del skill-path debe salir 0');
    assert.deepEqual(
      escritas,
      [`${LINEA_GOLDEN_SKILL}\n`],
      'la línea del skill-path debe ser byte-idéntica al golden de Phase 83 salvo el campo de origen',
    );
  });

  it('vía child-process — commander real con un texto que empieza por guion (§Pitfall 4)', () => {
    const home = sandboxHome();
    try {
      const { argv } = invocacionDelMarkdown();
      const real = argv.map((t) => (t === PLACEHOLDER ? TEXTO_ADVERSARIAL : t));
      const r = runKodo(real, home);
      assert.equal(r.status, 0, `el argv del SKILL.md debe sobrevivir a commander. stderr: ${r.stderr}`);

      const contenido = readFileSync(join(home, '.kodo', 'inbox.md'), 'utf-8');
      const lineas = contenido.split('\n').filter((l) => l.trim() !== '');
      assert.equal(lineas.length, 1, 'una invocación = exactamente una línea');

      const captura = parseLine(lineas[0]);
      assert.ok(captura, 'la línea del skill-path debe parsear con el codec de Phase 83');
      assert.equal(captura.origin, 'skill');
      assert.equal(captura.open, true, 'una captura NACE abierta');
      assert.equal(captura.text, TEXTO_ADVERSARIAL, 'el texto llega VERBATIM, guion inicial incluido');
      // La fecha se DERIVA de la línea producida y solo se asserta su FORMA. Este carril no admite
      // inyección de reloj: comparar dos relojes distintos produce un rojo intermitente e
      // irreproducible al cruzar la medianoche local (§Pitfall 10). La byte-identidad total la da
      // la vía in-process, que es determinista por construcción.
      assert.match(captura.date, /^\d{4}-\d{2}-\d{2}$/);
      assert.equal(encodeLine(captura), lineas[0], 'round-trip byte-exacto contra el codec de Phase 83');
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  // 84-REVIEW CR-01. Los dos carriles de arriba tokenizan la línea en JS y la pasan como argv,
  // así que NUNCA ven un shell — y por eso no podían detectar la expansión. Este carril ejecuta
  // la línea del markdown TAL CUAL por `bash -c`, que es lo que de facto ocurre cuando el modelo
  // la manda a la tool `Bash`. Es el único que muerde el fallo real.
  it('CR-01 — la línea del markdown, ejecutada POR SHELL, no expande `$(...)` ni backticks', () => {
    const home = sandboxHome();
    try {
      const linea = contenidoDelBloque();
      // Sustitución literal del placeholder, exactamente como la haría el modelo.
      const comando = linea.replace(PLACEHOLDER, TEXTO_INYECCION).replace(/^kodo\b/, `"${process.execPath}" "${KODO_BIN}"`);
      const r = spawnSync('bash', ['-c', comando], {
        cwd: REPO,
        env: { ...process.env, HOME: home, NO_COLOR: '1' },
        encoding: 'utf-8',
        timeout: 10000,
      });
      assert.equal(r.status, 0, `la invocación debe salir 0 por shell. stderr: ${r.stderr}`);

      const contenido = readFileSync(join(home, '.kodo', 'inbox.md'), 'utf-8');
      const captura = parseLine(contenido.split('\n').filter((l) => l.trim() !== '')[0]);
      assert.ok(captura, 'la línea debe parsear con el codec de Phase 83');
      assert.ok(
        !captura.text.includes(home),
        `el shell EXPANDIÓ «$HOME»: la ruta del sandbox no se tecleó en ninguna parte, solo puede ` +
          `estar ahí si hubo expansión. Eso es ejecución de comandos arbitrarios (84-REVIEW CR-01). ` +
          `Texto guardado: ${JSON.stringify(captura.text)}`,
      );
      assert.equal(
        captura.text,
        TEXTO_INYECCION,
        'el texto se guarda VERBATIM, con `$(...)`, backticks y `$VAR` intactos (regla 4 del SKILL.md)',
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('CR-01 mordida — la MISMA línea con comillas dobles sí expande (el test detecta el fallo)', () => {
    // Sin esta mordida, el test de arriba pasaría igual aunque el shell no expandiera nada nunca
    // —p. ej. si un cambio futuro dejara de pasar el texto por un shell— y dejaría de vigilar.
    const home = sandboxHome();
    try {
      const vulnerable = `"${process.execPath}" "${KODO_BIN}" capture --origin skill -- "${TEXTO_INYECCION}"`;
      const r = spawnSync('bash', ['-c', vulnerable], {
        cwd: REPO,
        env: { ...process.env, HOME: home, NO_COLOR: '1' },
        encoding: 'utf-8',
        timeout: 10000,
      });
      assert.equal(r.status, 0, `stderr: ${r.stderr}`);
      const contenido = readFileSync(join(home, '.kodo', 'inbox.md'), 'utf-8');
      const captura = parseLine(contenido.split('\n').filter((l) => l.trim() !== '')[0]);
      assert.ok(captura, 'la línea debe parsear');
      assert.ok(
        captura.text.includes(home) && !captura.text.includes('$(id -un)'),
        'con comillas dobles el shell DEBE expandir — si esto deja de cumplirse, el test hermano ' +
          `ya no vigila nada y hay que revisar por qué. Texto guardado: ${JSON.stringify(captura.text)}`,
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });

  it('mordida — el MISMO argv sin el separador `--` falla duro (el `--` es load-bearing)', () => {
    const home = sandboxHome();
    try {
      const { argv } = invocacionDelMarkdown();
      const sinSeparador = argv
        .filter((t) => t !== '--')
        .map((t) => (t === PLACEHOLDER ? TEXTO_ADVERSARIAL : t));
      const r = runKodo(sinSeparador, home);
      assert.notEqual(
        r.status,
        0,
        'sin el separador, commander lee el texto como opción desconocida: quitarlo debe ser un fallo DURO, no un silencio',
      );
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
});
