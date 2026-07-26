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

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');

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

/**
 * Tokenizador shell-like mínimo: respeta comillas dobles y las retira del token.
 * No existe helper compartido en el repo (no hay utilidades de test comunes), así que vive aquí.
 * Lanza ante comillas sin cerrar: un tokenizador laxo dejaría pasar un comando que commander
 * rechaza, que es exactamente el fallo que este fichero existe para impedir.
 *
 * @param {string} cadena
 * @returns {string[]}
 */
function tokenize(cadena) {
  /** @type {string[]} */
  const tokens = [];
  let actual = '';
  let enComillas = false;
  let hayToken = false;
  for (const ch of cadena) {
    if (ch === '"') {
      enComillas = !enComillas;
      hayToken = true;
      continue;
    }
    if (!enComillas && /\s/.test(ch)) {
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
  if (enComillas) throw new Error('comilla doble sin cerrar en la invocación del SKILL.md');
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
