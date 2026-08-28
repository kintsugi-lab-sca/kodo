// @ts-check
//
// test/providers/plane/labels.test.js — KODO-50
//
// `src/providers/plane/labels.js` era el ÚNICO fichero de `src/providers/` sin ningún
// test. Aquí queda cubierto su contrato entero.
//
// AVISO para quien lo mantenga: hoy `resolveLabels` NO tiene ningún consumidor en
// `src/` — el propio plan que lo movió aquí (v0.2 fase 05) ya anotaba "no external
// consumer currently imports resolveLabels". Estos tests fijan el contrato para que
// recablearlo sea seguro; no son evidencia de que esté en uso.
//
// Sin red: `PlaneClient` se sustituye por un doble con solo `.request` — es el único
// método que el módulo toca. Eso también permite afirmar lo más importante del fast
// path: cuándo NO se hace la llamada a la API.

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { resolveLabels } from '../../../src/providers/plane/labels.js';

/**
 * Doble de `PlaneClient` que registra los paths pedidos y devuelve una respuesta fija.
 * @param {any} response
 */
function fakePlane(response) {
  /** @type {string[]} */
  const requests = [];
  return {
    requests,
    /** @param {string} path */
    async request(path) {
      requests.push(path);
      return response;
    },
  };
}

const PROJECT = 'proj-1';

describe('resolveLabels — cortocircuitos sin tocar la API', () => {
  test('lista vacía → [] y CERO requests', async () => {
    const plane = fakePlane({ results: [] });
    assert.deepEqual(await resolveLabels(/** @type {any} */ (plane), PROJECT, []), []);
    assert.deepEqual(plane.requests, []);
  });

  test('no-array (null / undefined / objeto) → [] sin lanzar ni pedir nada', async () => {
    const plane = fakePlane({ results: [] });
    for (const input of [null, undefined, {}, 'kodo']) {
      assert.deepEqual(
        await resolveLabels(/** @type {any} */ (plane), PROJECT, /** @type {any} */ (input)),
        [],
      );
    }
    assert.deepEqual(plane.requests, []);
  });

  test('ya son objetos con `name` → se devuelven TAL CUAL, sin request', async () => {
    // Es el caso normal: el webhook de Plane manda los labels ya expandidos. Ahorrarse
    // el round-trip aquí es la razón de ser del fast path (ver CONCERNS.md: N+1).
    const labels = [{ id: 'l1', name: 'kodo' }, { id: 'l2', name: 'gsd' }];
    const plane = fakePlane({ results: [] });

    const out = await resolveLabels(/** @type {any} */ (plane), PROJECT, labels);
    assert.equal(out, labels, 'debe ser la MISMA referencia, no una copia');
    assert.deepEqual(plane.requests, []);
  });

  test('el fast path se decide por el PRIMER elemento (contrato asumido: lista homogénea)', async () => {
    // Documenta el comportamiento real: basta con que labels[0] traiga `name`. Una lista
    // mixta no se normaliza — si algún día el webhook la produce, esto es lo que pasa.
    const mixtos = [{ id: 'l1', name: 'kodo' }, 'l2'];
    const plane = fakePlane({ results: [{ id: 'l2', name: 'gsd' }] });

    assert.deepEqual(await resolveLabels(/** @type {any} */ (plane), PROJECT, mixtos), mixtos);
    assert.deepEqual(plane.requests, []);
  });
});

describe('resolveLabels — resolución de IDs contra la API', () => {
  test('IDs string → pide los labels del proyecto y filtra por id', async () => {
    const plane = fakePlane({
      results: [
        { id: 'l1', name: 'kodo' },
        { id: 'l2', name: 'gsd' },
        { id: 'l3', name: 'otro' },
      ],
    });

    const out = await resolveLabels(/** @type {any} */ (plane), PROJECT, ['l1', 'l3']);

    assert.deepEqual(plane.requests, [`/projects/${PROJECT}/labels/`]);
    assert.deepEqual(out, [{ id: 'l1', name: 'kodo' }, { id: 'l3', name: 'otro' }]);
  });

  test('acepta la respuesta paginada `{results:[…]}` y también el array pelado', async () => {
    const pelado = fakePlane([{ id: 'l1', name: 'kodo' }]);
    assert.deepEqual(
      await resolveLabels(/** @type {any} */ (pelado), PROJECT, ['l1']),
      [{ id: 'l1', name: 'kodo' }],
    );
  });

  test('un ID que el proyecto no tiene se DESCARTA (no cuela un label fantasma)', async () => {
    const plane = fakePlane({ results: [{ id: 'l1', name: 'kodo' }] });

    assert.deepEqual(
      await resolveLabels(/** @type {any} */ (plane), PROJECT, ['l1', 'inexistente']),
      [{ id: 'l1', name: 'kodo' }],
    );
  });

  test('ningún ID coincide → [] (no devuelve la lista entera del proyecto)', async () => {
    const plane = fakePlane({ results: [{ id: 'l1', name: 'kodo' }] });

    assert.deepEqual(await resolveLabels(/** @type {any} */ (plane), PROJECT, ['zzz']), []);
  });

  test('objetos SIN `name` se tratan como IDs: se resuelven por su `.id`', async () => {
    const plane = fakePlane({ results: [{ id: 'l2', name: 'gsd' }] });

    const out = await resolveLabels(/** @type {any} */ (plane), PROJECT, [{ id: 'l2' }]);
    assert.deepEqual(plane.requests, [`/projects/${PROJECT}/labels/`]);
    assert.deepEqual(out, [{ id: 'l2', name: 'gsd' }]);
  });

  test('el projectId va INTERPOLADO en el path — un proyecto distinto pide otra URL', async () => {
    const plane = fakePlane({ results: [] });
    await resolveLabels(/** @type {any} */ (plane), 'otro-proyecto', ['l1']);

    assert.deepEqual(plane.requests, ['/projects/otro-proyecto/labels/']);
  });

  test('UNA sola request aunque se pidan muchos IDs (no hay N+1 por label)', async () => {
    const plane = fakePlane({ results: [] });
    await resolveLabels(/** @type {any} */ (plane), PROJECT, ['a', 'b', 'c', 'd', 'e']);

    assert.equal(plane.requests.length, 1);
  });

  test('un fallo de la API PROPAGA — no degrada a lista vacía', async () => {
    const plane = {
      async request() {
        throw new Error('plane 500');
      },
    };

    await assert.rejects(
      () => resolveLabels(/** @type {any} */ (plane), PROJECT, ['l1']),
      /plane 500/,
    );
  });
});
