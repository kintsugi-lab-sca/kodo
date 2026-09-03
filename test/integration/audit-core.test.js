// @ts-check
//
// test/integration/audit-core.test.js — KODO-74: el núcleo PURO del audit gate.
//
// Cero I/O y cero DI: todo lo que se prueba aquí son funciones totales. Es deliberado — la
// decisión del gate (`decideAudit`) es lo único que separa «segunda pasada de verdad» de «doble
// tecleo», así que tiene que ser auditable sin montar un repo.
//
// Lo que este fichero congela:
//   - el fingerprint es determinista y CAMBIA cuando cambia cualquiera de sus ocho campos;
//   - el artefacto solo cuenta si está firmado contra EL reto vigente (no vale copiarlo);
//   - `findings=0` es una afirmación válida y firmada, no un caso degenerado;
//   - las cuatro salidas de `decideAudit`, incluidas las dos que hacen que el gate no sea un
//     doble tecleo (`rechallenge`) y que una auditoría no sea para siempre (`challenge/stale`);
//   - `AUDIT_REQUIRED` es literal de contrato y el bloque que se imprime es PARSEABLE por el
//     propio parser (ida y vuelta).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  AUDIT_VERSION,
  auditArtifactName,
  computeFingerprint,
  decideAudit,
  hashWorkingTree,
  parseAuditArtifact,
  renderAuditRequired,
  shortFingerprint,
} from '../../src/integration/audit.js';

const FP = 'a'.repeat(64);
const HEAD = 'b'.repeat(40);
const OTHER = 'c'.repeat(40);

/** @param {object} [o] */
function gate(o = {}) {
  return {
    status: 'pending',
    count: 1,
    fingerprint: FP,
    evidence: null,
    findings: null,
    commit: null,
    challenge_commit: HEAD,
    base_commit: null,
    opened_at: '2026-09-03T08:00:00.000Z',
    audited_at: null,
    ...o,
  };
}

const CANDIDATE = {
  session_id: 'sess-74',
  task_id: 'uuid-74',
  task_ref: 'KODO-74',
  project_path: '/repo/kodo',
  branch: 'feat/audit',
  head: HEAD,
  base_commit: 'd'.repeat(40),
  dirty: null,
};

describe('computeFingerprint — la identidad del candidato', () => {
  it('es determinista: mismo candidato, mismo fingerprint', () => {
    assert.equal(computeFingerprint(CANDIDATE), computeFingerprint({ ...CANDIDATE }));
    assert.match(computeFingerprint(CANDIDATE), /^[0-9a-f]{64}$/);
  });

  it('CADA uno de los ocho campos mueve el fingerprint', () => {
    const base = computeFingerprint(CANDIDATE);
    for (const k of Object.keys(CANDIDATE)) {
      const mutated = computeFingerprint({ ...CANDIDATE, [k]: 'otro-valor' });
      assert.notEqual(mutated, base, `cambiar ${k} tiene que cambiar el fingerprint`);
    }
  });

  it('`null`, `undefined` y cadena vacía son el MISMO hecho (ausencia), no tres', () => {
    const a = computeFingerprint({ ...CANDIDATE, base_commit: null });
    const b = computeFingerprint({ ...CANDIDATE, base_commit: '' });
    const c = computeFingerprint({ ...CANDIDATE, base_commit: undefined });
    assert.equal(a, b);
    assert.equal(a, c);
  });

  it('el árbol sucio forma parte del candidato', () => {
    const limpio = computeFingerprint({ ...CANDIDATE, dirty: null });
    const sucio = computeFingerprint({ ...CANDIDATE, dirty: hashWorkingTree(' M src/x.js') });
    assert.notEqual(limpio, sucio);
  });

  it('nunca lanza, sea cual sea la entrada', () => {
    assert.match(computeFingerprint(/** @type {any} */ (undefined)), /^[0-9a-f]{64}$/);
    assert.match(computeFingerprint(/** @type {any} */ ({ head: 42 })), /^[0-9a-f]{64}$/);
  });
});

describe('hashWorkingTree — limpio es ausencia, no un valor', () => {
  it('un árbol limpio da `null`', () => {
    assert.equal(hashWorkingTree(''), null);
    assert.equal(hashWorkingTree('   \n  '), null);
    assert.equal(hashWorkingTree(null), null);
  });

  it('un árbol sucio da 16 hex estables', () => {
    const h = hashWorkingTree(' M a.js\n?? b.js');
    assert.match(/** @type {string} */ (h), /^[0-9a-f]{16}$/);
    assert.equal(h, hashWorkingTree(' M a.js\n?? b.js'));
    assert.notEqual(h, hashWorkingTree(' M a.js'));
  });
});

describe('parseAuditArtifact — el artefacto FIRMA un reto concreto', () => {
  const block = (fp, findings = 0) =>
    `## Auditoría\n<!-- kodo:audit v=${AUDIT_VERSION} fp=${fp} findings=${findings} at=2026-09-03T08:00:00Z -->\n`;

  it('reconoce un bloque firmado con el fingerprint completo', () => {
    const hit = parseAuditArtifact(block(FP, 2), FP);
    assert.deepEqual(hit, { findings: 2, fp: FP, at: '2026-09-03T08:00:00Z' });
  });

  it('acepta el fingerprint ABREVIADO — es lo que el comando imprime', () => {
    const hit = parseAuditArtifact(block(shortFingerprint(FP), 1), FP);
    assert.equal(hit?.findings, 1);
  });

  it('`findings=0` es una afirmación válida: sin hallazgos, FIRMADO', () => {
    assert.equal(parseAuditArtifact(block(FP, 0), FP)?.findings, 0);
  });

  it('un artefacto de OTRO reto no vale — no se puede copiar de otra tarea', () => {
    assert.equal(parseAuditArtifact(block('e'.repeat(64), 3), FP), null);
  });

  it('gana el ÚLTIMO bloque del fichero (append-only, una entrada por reto)', () => {
    const md = block(FP, 5) + '\ntexto\n' + block(FP, 0);
    assert.equal(parseAuditArtifact(md, FP)?.findings, 0);
  });

  it('una versión distinta del marcador NO se interpreta a ciegas', () => {
    const md = `<!-- kodo:audit v=99 fp=${FP} findings=0 -->`;
    assert.equal(parseAuditArtifact(md, FP), null);
  });

  it('un `fp` demasiado corto no casa: firmaría casi cualquier reto', () => {
    const md = `<!-- kodo:audit v=1 fp=${FP.slice(0, 4)} findings=0 -->`;
    assert.equal(parseAuditArtifact(md, FP), null);
  });

  it('TOTAL: entradas basura devuelven null en vez de lanzar', () => {
    assert.equal(parseAuditArtifact(undefined, FP), null);
    assert.equal(parseAuditArtifact(/** @type {any} */ (42), FP), null);
    assert.equal(parseAuditArtifact('texto sin bloque', FP), null);
    assert.equal(parseAuditArtifact(block(FP), ''), null);
    assert.equal(parseAuditArtifact(block(FP), /** @type {any} */ (null)), null);
  });

  it('el regex global no se contamina entre llamadas (lastIndex)', () => {
    const md = block(FP, 7);
    assert.equal(parseAuditArtifact(md, FP)?.findings, 7);
    assert.equal(parseAuditArtifact(md, FP)?.findings, 7, 'la segunda llamada da lo mismo');
  });
});

describe('decideAudit — el núcleo determinista del gate', () => {
  it('sin reto: se abre uno. NADA se marca como auditado en la primera invocación', () => {
    assert.deepEqual(decideAudit({ gate: null, head: HEAD }), { action: 'challenge', reason: 'first' });
    assert.deepEqual(decideAudit({}), { action: 'challenge', reason: 'first' });
  });

  it('segundo intento SIN nada nuevo: NO cierra. Es lo que impide el doble tecleo', () => {
    assert.deepEqual(decideAudit({ gate: gate(), head: HEAD, artifactMd: null }), { action: 'rechallenge' });
  });

  it('segundo intento con COMMIT NUEVO: cierra por evidencia de commit', () => {
    assert.deepEqual(decideAudit({ gate: gate(), head: OTHER }), {
      action: 'audited', evidence: 'commit', findings: null,
    });
  });

  it('segundo intento con ARTEFACTO firmado: cierra, y el «sin hallazgos» cuenta', () => {
    const md = `<!-- kodo:audit v=1 fp=${FP} findings=0 -->`;
    assert.deepEqual(decideAudit({ gate: gate(), head: HEAD, artifactMd: md }), {
      action: 'audited', evidence: 'artifact', findings: 0,
    });
  });

  it('con las DOS evidencias manda el artefacto: dice cuántos hallazgos hubo', () => {
    const md = `<!-- kodo:audit v=1 fp=${FP} findings=4 -->`;
    assert.deepEqual(decideAudit({ gate: gate(), head: OTHER, artifactMd: md }), {
      action: 'audited', evidence: 'artifact', findings: 4,
    });
  });

  it('ya auditado y la rama quieta: idempotente', () => {
    const g = gate({ status: 'audited', evidence: 'artifact', findings: 0, commit: HEAD });
    assert.deepEqual(decideAudit({ gate: g, head: HEAD }), { action: 'already-audited' });
  });

  it('ya auditado y la rama AVANZÓ: reto nuevo — una auditoría no es para siempre', () => {
    const g = gate({ status: 'audited', evidence: 'commit', commit: HEAD });
    assert.deepEqual(decideAudit({ gate: g, head: OTHER }), { action: 'challenge', reason: 'stale' });
  });

  it('sin punta legible NO se inventa un desfase sobre una auditoría que sí consta', () => {
    const g = gate({ status: 'audited', evidence: 'commit', commit: HEAD });
    assert.deepEqual(decideAudit({ gate: g, head: null }), { action: 'already-audited' });
  });

  it('reto sin `challenge_commit`: la evidencia de commit no puede medirse → re-reto', () => {
    assert.deepEqual(decideAudit({ gate: gate({ challenge_commit: null }), head: OTHER }), {
      action: 'rechallenge',
    });
  });
});

describe('renderAuditRequired — el texto ES lo que el gate compra', () => {
  const base = { taskRef: 'KODO-74', branch: 'feat/audit', fingerprint: FP, count: 1 };

  it('`AUDIT_REQUIRED` va en la primera línea: es el literal que se grepea', () => {
    const out = renderAuditRequired(base);
    assert.equal(out.split('\n')[0].startsWith('AUDIT_REQUIRED'), true);
    assert.match(out, /KODO-74/);
    assert.match(out, /feat\/audit/);
    assert.match(out, new RegExp(shortFingerprint(FP)));
    assert.match(out, /reto 1/);
  });

  it('nombra los cuatro criterios con una fuente que se puede abrir', () => {
    const out = renderAuditRequired(base);
    assert.match(out, /enunciado/i);
    assert.match(out, /requisito/i);
    assert.match(out, /diff/i);
    assert.match(out, /`git status`/);
  });

  it('con base conocida da el comando de diff EXACTO; sin ella NO adivina la rama base', () => {
    const conBase = renderAuditRequired({ ...base, base: 'd'.repeat(40) });
    assert.match(conBase, new RegExp(`git diff ${'d'.repeat(40)}\\.\\.\\.HEAD`));
    const sinBase = renderAuditRequired(base);
    assert.equal(/git diff/.test(sinBase), false, 'sin base no se sugiere ningún rango');
  });

  it('el bloque que imprime es PARSEABLE por el propio parser (ida y vuelta)', () => {
    const out = renderAuditRequired({ ...base, artifactPath: '/home/.kodo/audits/uuid-74.md', at: '2026-09-03T08:00:00.000Z' });
    assert.match(out, /audits\/uuid-74\.md/);
    const hit = parseAuditArtifact(out, FP);
    assert.equal(hit?.findings, 0, 'el bloque de ejemplo tiene que casar con el reto que lo imprime');
  });

  it('sin artefacto disponible lo DICE en vez de ofrecer una vía que no existe', () => {
    const out = renderAuditRequired({ ...base, artifactPath: null });
    assert.equal(parseAuditArtifact(out, FP), null, 'no se imprime bloque que firmar');
    assert.match(out, /no disponible/);
  });
});

describe('auditArtifactName — un fichero por tarea, y uno por reto cuando no hay tarea', () => {
  it('con task_id, el artefacto es el historial de la tarea', () => {
    assert.equal(auditArtifactName({ taskId: 'uuid-74', fingerprint: FP }), 'uuid-74.md');
  });

  it('sin task_id cae al fingerprint, que es seguro como nombre por construcción', () => {
    assert.equal(auditArtifactName({ taskId: null, fingerprint: FP }), `${shortFingerprint(FP)}.md`);
    assert.equal(auditArtifactName({ fingerprint: FP }), `${shortFingerprint(FP)}.md`);
  });
});
