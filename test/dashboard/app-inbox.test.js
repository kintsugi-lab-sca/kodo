// @ts-check
//
// test/dashboard/app-inbox.test.js — KODO-76.
//
// Integration con ink-testing-library de la pantalla dedicada del inbox: apertura con `i`,
// navegación, panel de detalle, double-confirm de promoción y descarte, picker de proyecto y
// vuelta a la lista de sesiones.
//
// AISLAMIENTO (load-bearing): `readInboxRowsFn` y `onInboxAction` van SIEMPRE por DI. Sin el
// primero, un test leería el inbox real del desarrollador; sin el segundo, `p` shellearía
// `kodo inbox promote` de verdad y crearía una tarea en el tablero de producción. Los dos
// defaults existen para el binario, no para la suite.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App from '../../src/cli/dashboard/App.js';
import {
  INBOX_EMPTY,
  INBOX_PROMOTE_CONFIRM,
  INBOX_DISCARD_CONFIRM,
  INBOX_PROMOTE_OK,
} from '../../src/cli/dashboard/InboxScreen.js';

const tick = () => new Promise((r) => setTimeout(r, 80));

/**
 * Literal → RegExp, escapando los metacaracteres. La copy de la pantalla lleva `?` y `·`, así que
 * un `new RegExp(literal)` casaría por accidente (o no casaría) sin que el fallo dijera por qué.
 *
 * @param {string} s
 */
const rx = (s) => new RegExp(s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

const UUID_KODO = '7246e3fe-3dc4-4f24-9078-1911ad477e0d';
const PROJECTS = Object.freeze({
  [UUID_KODO]: { default: '/Users/alex/dev/klab/kodo' },
  'ff000000-1111-2222-3333-444444444444': { default: '/Users/alex/dev/klab/liken' },
});

const LONG_TEXT =
  'Fuga de la suite al log real: cada npm test escribe entradas dispatch.decision con fixtures ' +
  'KODO-42 en el log del operador, y parece un relanzamiento de tareas Done al leer la traza.';

const ROWS = Object.freeze([
  {
    id: 'aaa111',
    headline: 'Fuga de la suite al log real',
    text: LONG_TEXT,
    tag: 'kodo',
    date: '2026-09-03',
    origin: 'cli',
    open: true,
    estado: null,
    dest: null,
  },
  {
    id: 'ccc333',
    headline: 'Idea sin proyecto mapeado',
    text: 'Idea sin proyecto mapeado',
    tag: 'fantasma',
    date: '2026-09-02',
    origin: 'skill',
    open: true,
    estado: null,
    dest: null,
  },
]);

const makeFetch = (sessions = []) => async () => ({
  ok: true,
  status: 200,
  json: async () => ({ sessions, count: sessions.length, pending: [] }),
});

/**
 * Monta el dashboard con el inbox aislado. `rows` es lo que devuelve el reader inyectado;
 * `onInboxAction` registra las invocaciones para poder aseverar sobre ellas.
 *
 * @param {{ rows?: any[], actionResult?: any }} [opts]
 */
function mount({ rows = [...ROWS], actionResult = { ok: true, stdout: '{"ref":"KODO-99"}' } } = {}) {
  const actions = [];
  const app = render(
    createElement(App, {
      baseUrl: 'http://localhost:9090',
      fetchFn: makeFetch(),
      projects: PROJECTS,
      inboxCountFn: () => rows.filter((r) => r.open).length,
      queueCountFn: () => 0,
      readInboxRowsFn: () => rows,
      onInboxAction: async (/** @type {any} */ a) => {
        actions.push(a);
        return actionResult;
      },
    }),
  );
  return { ...app, actions };
}

describe('KODO-76 — apertura de la pantalla del inbox', () => {
  it('`i` abre la pantalla: titulares, proyecto y detalle de la fila del cursor', async () => {
    const { stdin, lastFrame, unmount } = mount();
    try {
      await tick();
      assert.doesNotMatch(lastFrame(), /Fuga de la suite/, 'pre: la tabla de sesiones no lista capturas');
      stdin.write('i');
      await tick();
      const frame = lastFrame().replace(/[│\s]+/g, ' ');
      assert.match(frame, /Fuga de la suite al log real/, 'el titular de la primera captura');
      assert.match(frame, /Idea sin proyecto mapeado/, 'y el de la segunda');
      assert.match(frame, /kodo · 2026-09-03 · cli/, 'proyecto, fecha y origen de cada fila');
      assert.match(frame, /aaa111 · detalle/, 'el panel de detalle es de la fila del cursor');
      assert.match(frame, /parece un relanzamiento de tareas Done/, 'y muestra el texto ÍNTEGRO');
    } finally {
      unmount();
    }
  });

  it('las columnas se ALINEAN: la metadata de cada fila arranca en la misma posición', async () => {
    // El bug que este test fija: con titular y metadata fluyendo en la misma línea, la metadata
    // quedaba pegada al final de cada titular —a una sangría distinta por fila— y las filas largas
    // envolvían perdiendo el gutter del cursor. Una lista así no se escanea, se lee fila a fila.
    const { stdin, lastFrame, unmount } = mount();
    try {
      await tick();
      stdin.write('i');
      await tick();
      const lines = lastFrame().split('\n');
      const at = lines
        .filter((l) => /· 2026-09-0\d ·/.test(l))
        .map((l) => l.indexOf('kodo · 2026-09-03') >= 0 ? l.indexOf('kodo · 2026-09-03') : l.indexOf('fantasma · 2026-09-02'));
      assert.equal(at.length, 2, 'ambas filas deben pintar su metadata');
      assert.equal(at[0], at[1], `la metadata no está alineada: columnas ${at[0]} y ${at[1]}`);
      assert.ok(at[0] > 20, 'y no pegada al titular');
    } finally {
      unmount();
    }
  });

  it('el titular se recorta al ancho de SU columna, sin invadir la metadata', async () => {
    const { stdin, lastFrame, unmount } = mount();
    try {
      await tick();
      stdin.write('i');
      await tick();
      const row = lastFrame().split('\n').find((l) => l.includes('2026-09-03')) ?? '';
      const metaAt = row.indexOf('kodo · 2026-09-03');
      const headline = row.slice(0, metaAt);
      assert.ok(/…\s\s/.test(headline) || /\s\s$/.test(headline), `sin aire antes de la metadata: ${JSON.stringify(headline)}`);
      assert.ok(!headline.includes('parece un relanzamiento'), 'el titular no derrama el texto entero');
    } finally {
      unmount();
    }
  });

  it('el detalle sigue al cursor', async () => {
    const { stdin, lastFrame, unmount } = mount();
    try {
      await tick();
      stdin.write('i');
      await tick();
      stdin.write('[B'); // ↓
      await tick();
      assert.match(lastFrame().replace(/[│\s]+/g, ' '), /ccc333 · detalle/);
    } finally {
      unmount();
    }
  });

  it('Esc devuelve a la lista de sesiones', async () => {
    const { stdin, lastFrame, unmount } = mount();
    try {
      await tick();
      stdin.write('i');
      await tick();
      stdin.write('');
      await tick();
      assert.doesNotMatch(lastFrame(), /detalle/);
      assert.match(lastFrame().replace(/[│\s]+/g, ' '), /a adopt · i inbox · e config/, 'footer normal');
    } finally {
      unmount();
    }
  });

  it('un inbox vacío abre igualmente y dice cómo capturar', async () => {
    const { stdin, lastFrame, unmount } = mount({ rows: [] });
    try {
      await tick();
      stdin.write('i');
      await tick();
      assert.match(lastFrame().replace(/[│\s]+/g, ' '), rx(INBOX_EMPTY));
    } finally {
      unmount();
    }
  });
});

describe('KODO-76 — promoción a tarea (double-confirm)', () => {
  it('la primera `p` ARMA y no invoca nada', async () => {
    const { stdin, lastFrame, actions, unmount } = mount();
    try {
      await tick();
      stdin.write('i');
      await tick();
      stdin.write('p');
      await tick();
      assert.equal(actions.length, 0, 'un solo `p` NUNCA crea una tarea');
      assert.match(lastFrame().replace(/[│\s]+/g, ' '), rx(INBOX_PROMOTE_CONFIRM('aaa111')));
    } finally {
      unmount();
    }
  });

  it('la segunda `p` promueve con el proyecto resuelto del tag', async () => {
    const { stdin, lastFrame, actions, unmount } = mount();
    try {
      await tick();
      stdin.write('i');
      await tick();
      stdin.write('p');
      await tick();
      stdin.write('p');
      await tick();
      assert.deepEqual(actions, [
        { verb: 'promote', id: 'aaa111', project: UUID_KODO, tag: undefined },
      ]);
      assert.match(lastFrame().replace(/[│\s]+/g, ' '), rx(INBOX_PROMOTE_OK('KODO-99')));
    } finally {
      unmount();
    }
  });

  it('Esc cancela el armado SIN cerrar la pantalla', async () => {
    const { stdin, lastFrame, actions, unmount } = mount();
    try {
      await tick();
      stdin.write('i');
      await tick();
      stdin.write('p');
      await tick();
      stdin.write('');
      await tick();
      assert.equal(actions.length, 0);
      const frame = lastFrame().replace(/[│\s]+/g, ' ');
      assert.doesNotMatch(frame, /pulsa p de nuevo/, 'el armado se canceló');
      assert.match(frame, /aaa111 · detalle/, 'pero la pantalla sigue abierta');
    } finally {
      unmount();
    }
  });

  it('moverse DESARMA: el armado es de una fila concreta', async () => {
    const { stdin, lastFrame, actions, unmount } = mount();
    try {
      await tick();
      stdin.write('i');
      await tick();
      stdin.write('p'); // arma aaa111
      await tick();
      stdin.write('[B'); // ↓ a ccc333
      await tick();
      stdin.write('p'); // esto ARMA ccc333, no confirma aaa111
      await tick();
      assert.equal(actions.length, 0, 'ni una acción: el armado no sobrevive al movimiento');
    } finally {
      unmount();
    }
  });

  it('un tag que no mapea abre el picker de proyecto en vez de armar algo que fallaría', async () => {
    const { stdin, lastFrame, actions, unmount } = mount();
    try {
      await tick();
      stdin.write('i');
      await tick();
      stdin.write('[B'); // ↓ a ccc333 (tag `fantasma`, sin mapeo)
      await tick();
      stdin.write('p');
      await tick();
      const frame = lastFrame().replace(/[│\s]+/g, ' ');
      assert.equal(actions.length, 0);
      assert.match(frame, /crear la tarea en…/, 'se abre el picker, no el confirm');
      assert.match(frame, /kodo/);
      assert.match(frame, /liken/);
    } finally {
      unmount();
    }
  });

  it('elegir en el picker ARMA el confirm, no promueve', async () => {
    const { stdin, lastFrame, actions, unmount } = mount();
    try {
      await tick();
      stdin.write('i');
      await tick();
      stdin.write('[B');
      await tick();
      stdin.write('p'); // abre el picker
      await tick();
      stdin.write('\r'); // elige el primero
      await tick();
      assert.equal(actions.length, 0, 'elegir el destino no es confirmar la creación');
      assert.match(lastFrame().replace(/[│\s]+/g, ' '), rx(INBOX_PROMOTE_CONFIRM('ccc333')));
      stdin.write('p');
      await tick();
      assert.equal(actions.length, 1);
      assert.equal(actions[0].id, 'ccc333');
      assert.equal(typeof actions[0].project, 'string');
    } finally {
      unmount();
    }
  });

  it('un fallo del shell se enseña con el mensaje del CLI, no con un código', async () => {
    const { stdin, lastFrame, unmount } = mount({
      actionResult: {
        ok: false,
        code: 'NON_ZERO_EXIT',
        detail: 2,
        stderr: 'Error: no se pudo crear la tarea: 502 bad gateway',
      },
    });
    try {
      await tick();
      stdin.write('i');
      await tick();
      stdin.write('p');
      await tick();
      stdin.write('p');
      await tick();
      assert.match(lastFrame().replace(/[│\s]+/g, ' '), /no se pudo crear la tarea: 502 bad gateway/);
    } finally {
      unmount();
    }
  });
});

describe('KODO-76 — descarte y reasignación de proyecto', () => {
  it('`x` exige double-confirm', async () => {
    const { stdin, lastFrame, actions, unmount } = mount();
    try {
      await tick();
      stdin.write('i');
      await tick();
      stdin.write('x');
      await tick();
      assert.equal(actions.length, 0);
      assert.match(lastFrame().replace(/[│\s]+/g, ' '), rx(INBOX_DISCARD_CONFIRM('aaa111')));
      stdin.write('x');
      await tick();
      assert.deepEqual(actions, [
        { verb: 'discard', id: 'aaa111', project: undefined, tag: undefined },
      ]);
    } finally {
      unmount();
    }
  });

  it('`t` abre el picker y Enter reasigna el proyecto', async () => {
    const { stdin, lastFrame, actions, unmount } = mount();
    try {
      await tick();
      stdin.write('i');
      await tick();
      stdin.write('t');
      await tick();
      assert.match(lastFrame().replace(/[│\s]+/g, ' '), /reasignar a…/);
      stdin.write('\r');
      await tick();
      assert.equal(actions.length, 1);
      assert.equal(actions[0].verb, 'retag');
      assert.equal(actions[0].id, 'aaa111');
      assert.equal(typeof actions[0].tag, 'string');
      assert.notEqual(actions[0].tag, '');
    } finally {
      unmount();
    }
  });

  it('el picker arranca sobre el proyecto que la captura YA tiene', async () => {
    const { stdin, actions, unmount } = mount();
    try {
      await tick();
      stdin.write('i');
      await tick();
      stdin.write('t');
      await tick();
      stdin.write('\r');
      await tick();
      assert.equal(actions[0].tag, 'kodo', 'el cursor no arranca a ciegas en el primero');
    } finally {
      unmount();
    }
  });

  it('Esc en el picker vuelve a la lista sin tocar nada', async () => {
    const { stdin, lastFrame, actions, unmount } = mount();
    try {
      await tick();
      stdin.write('i');
      await tick();
      stdin.write('t');
      await tick();
      stdin.write('');
      await tick();
      assert.equal(actions.length, 0);
      assert.match(lastFrame().replace(/[│\s]+/g, ' '), /aaa111 · detalle/);
    } finally {
      unmount();
    }
  });
});
