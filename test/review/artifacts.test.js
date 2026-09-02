// @ts-check
//
// test/review/artifacts.test.js — KODO-75: la derivación DETERMINISTA del estado de revisión.
//
// Este fichero congela la propiedad que justifica el milestone entero: el núcleo sabe si una
// rama está revisada leyendo FICHEROS y `git`, sin preguntarle a ningún LLM. Todo lo de aquí
// corre sin red, sin modelo y sin `~/.kodo` — el módulo no toca state.json, así que no
// necesita el aislamiento de HOME que sí exigen los tests de `cycle`.
//
// El grupo que más importa es «el ancla»: por qué se compara contra el `reviewedHead` y no
// contra `HEAD`, y qué pasa cuando el coder empuja después de una aprobación.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  deriveReviewState,
  formatRecommendationName,
  nextRecommendationName,
  parseReviewFrontmatter,
  readReviewArtifacts,
  recommendationSeq,
  reviewConfidence,
} from '../../src/review/artifacts.js';

const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);

/** Crea un árbol temporal con los artefactos indicados. Devuelve el dir raíz. */
function fixture({ approval, recommendations = {} } = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'kodo-review-'));
  if (approval !== undefined) {
    mkdirSync(join(dir, 'review'), { recursive: true });
    writeFileSync(join(dir, 'review', 'approval.md'), approval);
  }
  const names = Object.keys(recommendations);
  if (names.length > 0) {
    mkdirSync(join(dir, 'review', 'recommendations'), { recursive: true });
    for (const name of names) {
      writeFileSync(join(dir, 'review', 'recommendations', name), recommendations[name]);
    }
  }
  return dir;
}

/** Frontmatter mínimo válido. */
function fm(commit, extra = '') {
  return `---\nbranch: feat/x\ncommit: ${commit}\n${extra}---\n\ncuerpo\n`;
}

describe('KODO-75 — parseReviewFrontmatter', () => {
  it('extrae branch, commit y round de un frontmatter bien formado', () => {
    const r = /** @type {any} */ (parseReviewFrontmatter(fm(SHA_A, 'round: 2\n')));
    assert.equal(r.error, undefined);
    assert.equal(r.commit, SHA_A);
    assert.equal(r.branch, 'feat/x');
    assert.equal(r.round, 2);
  });

  it('acepta un SHA abreviado de 7 (lo que un humano copia de git log --oneline)', () => {
    const r = /** @type {any} */ (parseReviewFrontmatter(fm('a1b2c3d')));
    assert.equal(r.error, undefined);
    assert.equal(r.commit, 'a1b2c3d');
  });

  it('normaliza el commit a minúsculas (git emite hex en minúscula; un humano puede pegarlo en mayúsculas)', () => {
    const r = /** @type {any} */ (parseReviewFrontmatter(fm('A1B2C3D')));
    assert.equal(r.commit, 'a1b2c3d');
  });

  it('RECHAZA un commit que no es un SHA — un `commit: HEAD` es frontmatter roto, no una comparación laxa', () => {
    for (const bad of ['HEAD', 'el último commit', 'abc', 'zzzzzzz']) {
      const r = /** @type {any} */ (parseReviewFrontmatter(fm(bad)));
      assert.ok(r.error, `esperaba error para commit: ${bad}`);
    }
  });

  it('exige el commit: sin ancla el artefacto no dice a qué código se refiere', () => {
    const r = /** @type {any} */ (parseReviewFrontmatter('---\nbranch: feat/x\n---\n'));
    assert.match(r.error, /missing field commit/);
  });

  it('sin bloque de frontmatter → error, no silencio', () => {
    const r = /** @type {any} */ (parseReviewFrontmatter('# Solo prosa\n'));
    assert.match(r.error, /no frontmatter/);
  });

  it('ignora un comentario YAML inline pero conserva el # pegado a texto', () => {
    const r = /** @type {any} */ (parseReviewFrontmatter(`---\nbranch: feat/a#b\ncommit: ${SHA_A}  # revisado\n---\n`));
    assert.equal(r.commit, SHA_A);
    assert.equal(r.branch, 'feat/a#b');
  });

  it('un round no numérico NO invalida el artefacto (el número canónico es el del nombre del fichero)', () => {
    const r = /** @type {any} */ (parseReviewFrontmatter(fm(SHA_A, 'round: dos\n')));
    assert.equal(r.error, undefined);
    assert.equal(r.round, null);
  });
});

describe('KODO-75 — numeración de rondas', () => {
  it('reconoce exactamente 3 dígitos y rechaza el resto', () => {
    assert.equal(recommendationSeq('001-recommendations.md'), 1);
    assert.equal(recommendationSeq('042-recommendations.md'), 42);
    assert.equal(recommendationSeq('1-recommendations.md'), null);
    assert.equal(recommendationSeq('0001-recommendations.md'), null);
    assert.equal(recommendationSeq('001-notes.md'), null);
  });

  it('formatea con relleno a 3 para que el orden lexicográfico coincida con el numérico', () => {
    assert.equal(formatRecommendationName(1), '001-recommendations.md');
    assert.equal(formatRecommendationName(12), '012-recommendations.md');
  });

  it('numera desde el MÁXIMO+1: un hueco no hace que la siguiente pise una traza existente', () => {
    // La 002 se borró a mano. La siguiente debe ser la 004, no la 003.
    assert.equal(
      nextRecommendationName(['001-recommendations.md', '003-recommendations.md']),
      '004-recommendations.md',
    );
  });

  it('sin ficheros previos empieza en 001', () => {
    assert.equal(nextRecommendationName([]), '001-recommendations.md');
  });
});

describe('KODO-75 — readReviewArtifacts', () => {
  it('un directorio sin review/ se lee como «no hay artefactos», nunca como error', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kodo-review-'));
    try {
      const r = readReviewArtifacts(dir);
      assert.equal(r.approval, null);
      assert.deepEqual(r.recommendations, []);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ordena las rondas ascendentemente aunque readdir las devuelva desordenadas', () => {
    const dir = fixture({
      recommendations: {
        '003-recommendations.md': fm(SHA_A),
        '001-recommendations.md': fm(SHA_A),
        '002-recommendations.md': fm(SHA_A),
      },
    });
    try {
      const r = readReviewArtifacts(dir);
      assert.deepEqual(r.recommendations.map((x) => x.seq), [1, 2, 3]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignora ficheros del directorio que no son rondas válidas', () => {
    const dir = fixture({
      recommendations: { '001-recommendations.md': fm(SHA_A), 'README.md': 'notas' },
    });
    try {
      assert.equal(readReviewArtifacts(dir).recommendations.length, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('KODO-75 — deriveReviewState: EL ANCLA (reviewedHead, no HEAD)', () => {
  it('approval anclado al reviewedHead → approved', () => {
    const dir = fixture({ approval: fm(SHA_A) });
    try {
      const r = deriveReviewState({ dir, reviewedHead: SHA_A });
      assert.equal(r.state, 'approved');
      assert.equal(reviewConfidence(r), 'reviewed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('EL CASO QUE MOTIVA EL ANCLA: el coder commitea DESPUÉS de aprobar → stale-approval, NUNCA approved', () => {
    // El reviewer aprobó SHA_A; después el coder empujó y el reviewedHead se movió a SHA_B.
    // Una aprobación de código que ya no es el código que hay es exactamente el fallo que
    // este milestone existe para no tener.
    const dir = fixture({ approval: fm(SHA_A) });
    try {
      const r = deriveReviewState({ dir, reviewedHead: SHA_B });
      assert.equal(r.state, 'stale-approval');
      assert.equal(reviewConfidence(r), 'stale');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('la aprobación GANA a las recomendaciones previas: el ancla resuelve el orden sin mirar mtimes', () => {
    // Hubo dos rondas y luego el reviewer aprobó. Como el approval apunta al reviewedHead
    // vigente, se escribió necesariamente después (cualquier commit de código posterior lo
    // habría dejado stale). No hace falta comparar fechas de fichero, que un checkout reescribe.
    const dir = fixture({
      approval: fm(SHA_A),
      recommendations: {
        '001-recommendations.md': fm(SHA_A),
        '002-recommendations.md': fm(SHA_A),
      },
    });
    try {
      const r = deriveReviewState({ dir, reviewedHead: SHA_A });
      assert.equal(r.state, 'approved');
      assert.equal(r.round, 2, 'la ronda alcanzada se conserva en el veredicto');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('un SHA abreviado en el approval casa por prefijo con el reviewedHead completo', () => {
    const dir = fixture({ approval: fm(SHA_A.slice(0, 8)) });
    try {
      assert.equal(deriveReviewState({ dir, reviewedHead: SHA_A }).state, 'approved');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('KODO-75 — deriveReviewState: el resto de la precedencia', () => {
  it('sin approval y con rondas → changes-requested, con la ronda MÁS ALTA', () => {
    const dir = fixture({
      recommendations: {
        '001-recommendations.md': fm(SHA_A),
        '002-recommendations.md': fm(SHA_B),
      },
    });
    try {
      const r = /** @type {any} */ (deriveReviewState({ dir, reviewedHead: SHA_B }));
      assert.equal(r.state, 'changes-requested');
      assert.equal(r.round, 2);
      assert.equal(reviewConfidence(r), 'changes-requested');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('sin nada → none, y la confianza es «sin revisar»', () => {
    const dir = mkdtempSync(join(tmpdir(), 'kodo-review-'));
    try {
      const r = deriveReviewState({ dir, reviewedHead: SHA_A });
      assert.equal(r.state, 'none');
      assert.equal(reviewConfidence(r), 'unreviewed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('FAIL-CLOSED: un approval con frontmatter roto es malformed, y su confianza es «sin revisar»', () => {
    const dir = fixture({ approval: '---\nbranch: feat/x\n---\n(sin commit)\n' });
    try {
      const r = deriveReviewState({ dir, reviewedHead: SHA_A });
      assert.equal(r.state, 'malformed');
      assert.equal(
        reviewConfidence(r),
        'unreviewed',
        'un artefacto que no se entiende vale lo mismo que uno que no existe — jamás sube la confianza',
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('FAIL-CLOSED: sin reviewedHead resoluble (git mudo) → malformed, nunca approved', () => {
    const dir = fixture({ approval: fm(SHA_A) });
    try {
      const r = deriveReviewState({ dir, reviewedHead: null });
      assert.equal(r.state, 'malformed');
      assert.equal(reviewConfidence(r), 'unreviewed');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('never-throws ante entrada degenerada', () => {
    assert.equal(deriveReviewState(/** @type {any} */ ({})).state, 'malformed');
    assert.equal(deriveReviewState(/** @type {any} */ (null)).state, 'malformed');
  });
});
