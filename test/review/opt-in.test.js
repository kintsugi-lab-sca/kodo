// @ts-check
//
// test/review/opt-in.test.js — KODO-75: el opt-in viaja de la etiqueta al aviso.
//
// Cubre el tramo que conecta las dos mitades de la feature y que, si se rompe, no lo nota
// ningún otro test: la etiqueta `kodo:review` del tablero tiene que sobrevivir al cierre de
// la sesión de trabajo para que alguien sepa que hay que lanzar el reviewer.
//
// El camino completo es:
//   etiqueta kodo:review → flags → buildSessionFromTask persiste `review: true`
//   → SessionEnd lo lee → evento `review-requested` en la bandeja del orquestador
//   → el orquestador ejecuta `kodo review start`.
//
// Aquí se fijan los dos saltos que kodo controla: la PERSISTENCIA (sin ella el dato se pierde
// al cerrar, porque `Session` no guarda las etiquetas) y el AVISO. El último salto lo da el
// orquestador leyendo su bandeja, que es comportamiento suyo, no código de este repo.
//
// Se prueba `buildSessionFromTask` (pura) directamente en vez de arrancar un launch entero:
// es la única función que decide si el campo se persiste, y no toca ni disco ni red.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { buildSessionFromTask } from '../../src/session/manager.js';
import { KODO_LABEL_REVIEW, parseKodoLabels } from '../../src/labels.js';

/** TaskItem mínimo con la forma que `buildSessionFromTask` consume. */
const TASK = {
  id: 'uuid-75',
  ref: 'KODO-75',
  title: 'Rol reviewer adversarial',
  projectId: 'proj-1',
  url: 'https://plane.example/KODO-75',
  projectName: 'kodo',
};

/** Flags tal y como salen del carril real (etiquetas → parseKodoLabels). */
function flagsFrom(...labelNames) {
  return parseKodoLabels(labelNames.map((name) => ({ name }))).flags;
}

function build(flags) {
  return buildSessionFromTask({
    task: /** @type {any} */ (TASK),
    providerName: 'plane',
    projectPath: '/repo/kodo',
    workspaceRef: 'workspace:1',
    sessionId: 'sid-1',
    workspaceId: null,
    flags,
  });
}

describe('KODO-75 — el opt-in se PERSISTE en la sesión', () => {
  it('con kodo:review la sesión lleva review: true', () => {
    const s = build(flagsFrom('kodo', KODO_LABEL_REVIEW));
    assert.equal(/** @type {any} */ (s).review, true);
  });

  it('SIN la etiqueta el campo NO existe — un state.json previo se lee exactamente igual', () => {
    const s = build(flagsFrom('kodo'));
    assert.ok(
      !('review' in s),
      'spread condicional: la ausencia es el comportamiento previo, no un `review: false`',
    );
  });

  it('convive con GSD sin pisarlo: son dimensiones independientes', () => {
    const s = /** @type {any} */ (build(flagsFrom('kodo:gsd', KODO_LABEL_REVIEW)));
    assert.equal(s.review, true);
    assert.equal(s.gsd, true);
    assert.equal(s.gsd_mode, 'full');
  });

  it('el campo se persiste porque SessionEnd ya no tiene las etiquetas — este es su único origen', () => {
    // Documenta la razón del campo: `Session` no guarda `flags`, así que sin `review` el dato
    // sería irrecuperable en el cierre salvo volviendo a preguntarle al provider — una llamada
    // de red dentro de un hook fail-open, que fallaría justo cuando el provider está caído.
    const s = build(flagsFrom('kodo', KODO_LABEL_REVIEW));
    assert.ok(!('flags' in s), 'la sesión NO guarda las etiquetas crudas');
    assert.equal(/** @type {any} */ (s).review, true, 'por eso el opt-in se sella como campo propio');
  });
});
