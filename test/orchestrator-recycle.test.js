// @ts-check
//
// test/orchestrator-recycle.test.js — KODO-67, el aviso por tamaño de transcript.
//
// EL TEST QUE IMPORTA es el del debounce: `Stop` dispara al final de CADA turno y el
// transcript solo crece, así que sin debounce cruzar el umbral una vez produciría un
// evento por turno para siempre. El criterio de éxito de la tarea lo dice literalmente —
// «evento recycle-suggested exactamente una vez».
//
// `maybeSuggestRecycle` acepta `statFn`, `listFn`, `enqueueFn` y `now` por inyección, así
// que TODA la suite corre sin tocar disco ni `state.json`: no hace falta el aislamiento
// por subproceso de las suites de la bandeja porque ningún camino de aquí llega al HOME.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import {
  DEFAULT_RECYCLE_MB,
  RECYCLE_DEBOUNCE_MS,
  RECYCLE_KIND,
  buildRecycleText,
  maybeSuggestRecycle,
  resolveRecycleMb,
  shouldSuggestRecycle,
} from '../src/orchestrator/recycle.js';
import { ORCHESTRATOR_EVENT_KINDS, buildOrchestratorEvent, summarizeInbox } from '../src/orchestrator/inbox.js';

const MB = 1024 * 1024;

/** Fabrica el `opts` completo de un caso: nada llega a disco ni a state.json. */
function harness({ bytes = 20 * MB, inbox = [], mb = 8, now = Date.parse('2026-09-01T10:00:00.000Z') } = {}) {
  /** @type {any[]} */
  const enqueued = [];
  return {
    enqueued,
    opts: {
      transcriptPath: '/fake/transcript.jsonl',
      config: { orchestrator: { recycle_mb: mb } },
      statFn: () => ({ size: bytes }),
      listFn: () => inbox,
      enqueueFn: /** @type {any} */ ((input) => {
        enqueued.push(input);
        return { ok: true, value: { ...input, id: `id${enqueued.length}` } };
      }),
      now: () => new Date(now),
    },
  };
}

/** Entrada de bandeja del kind de reciclado, con la antigüedad que pida el caso. */
function priorRecycle({ ts, seen }) {
  return { ...buildOrchestratorEvent({ kind: RECYCLE_KIND, task_ref: 'orquestador' }, ts, 0), seen };
}

// ── resolveRecycleMb: fail-safe ───────────────────────────────────────────────

describe('resolveRecycleMb — PURA y fail-safe', () => {
  it('lee el valor configurado', () => {
    assert.equal(resolveRecycleMb({ orchestrator: { recycle_mb: 12 } }), 12);
  });

  it('config ausente, nulo o sin la clave → default', () => {
    assert.equal(resolveRecycleMb(null), DEFAULT_RECYCLE_MB);
    assert.equal(resolveRecycleMb(undefined), DEFAULT_RECYCLE_MB);
    assert.equal(resolveRecycleMb({}), DEFAULT_RECYCLE_MB);
    assert.equal(resolveRecycleMb({ orchestrator: {} }), DEFAULT_RECYCLE_MB);
  });

  it('un valor basura o no positivo cae al default en vez de dejar el carril indefinido', () => {
    assert.equal(resolveRecycleMb({ orchestrator: { recycle_mb: 'mucho' } }), DEFAULT_RECYCLE_MB);
    assert.equal(resolveRecycleMb({ orchestrator: { recycle_mb: 0 } }), DEFAULT_RECYCLE_MB);
    assert.equal(resolveRecycleMb({ orchestrator: { recycle_mb: -5 } }), DEFAULT_RECYCLE_MB);
    assert.equal(resolveRecycleMb({ orchestrator: { recycle_mb: NaN } }), DEFAULT_RECYCLE_MB);
  });

  it('el default es 8 MB', () => {
    assert.equal(DEFAULT_RECYCLE_MB, 8);
  });
});

// ── shouldSuggestRecycle: las dos reglas del debounce ─────────────────────────

describe('shouldSuggestRecycle — regla 1: nunca dos avisos sin ver a la vez', () => {
  const NOW = Date.parse('2026-09-01T10:00:00.000Z');

  it('bandeja vacía → sí', () => {
    assert.equal(shouldSuggestRecycle([], NOW), true);
  });

  it('con un `recycle-suggested` SIN VER → no (el orquestador ya lo tiene pendiente)', () => {
    const inbox = [priorRecycle({ ts: '2026-08-01T00:00:00.000Z', seen: false })];
    assert.equal(shouldSuggestRecycle(inbox, NOW), false);
  });

  it('un aviso sin ver bloquea aunque sea antiquísimo (regla 1 antes que regla 2)', () => {
    const inbox = [priorRecycle({ ts: '2020-01-01T00:00:00.000Z', seen: false })];
    assert.equal(shouldSuggestRecycle(inbox, NOW), false);
  });

  it('otros kinds sin ver NO bloquean: solo cuentan los de reciclado', () => {
    const inbox = [buildOrchestratorEvent({ kind: 'session-end', task_ref: 'K-1' }, '2026-09-01T09:59:00.000Z', 0)];
    assert.equal(shouldSuggestRecycle(inbox, NOW), true);
  });
});

describe('shouldSuggestRecycle — regla 2: ventana desde el último aviso, ya ackeado', () => {
  const NOW = Date.parse('2026-09-01T10:00:00.000Z');

  it('ackeado hace 1 min → no (ackear no debe reabrir la puerta en el turno siguiente)', () => {
    const inbox = [priorRecycle({ ts: new Date(NOW - 60_000).toISOString(), seen: true })];
    assert.equal(shouldSuggestRecycle(inbox, NOW), false);
  });

  it('ackeado hace más que la ventana → sí (siguió creciendo y no recicló)', () => {
    const inbox = [priorRecycle({ ts: new Date(NOW - RECYCLE_DEBOUNCE_MS - 1).toISOString(), seen: true })];
    assert.equal(shouldSuggestRecycle(inbox, NOW), true);
  });

  it('el límite es inclusivo: exactamente la ventana ya deja pasar', () => {
    const inbox = [priorRecycle({ ts: new Date(NOW - RECYCLE_DEBOUNCE_MS).toISOString(), seen: true })];
    assert.equal(shouldSuggestRecycle(inbox, NOW), true);
  });

  it('el ancla es el MÁS RECIENTE, no el primero de la lista', () => {
    const inbox = [
      priorRecycle({ ts: '2026-01-01T00:00:00.000Z', seen: true }),
      priorRecycle({ ts: new Date(NOW - 60_000).toISOString(), seen: true }),
    ];
    assert.equal(shouldSuggestRecycle(inbox, NOW), false);
  });

  it('un `ts` corrupto NO bloquea: perder el aviso sería peor que repetirlo', () => {
    const inbox = [{ kind: RECYCLE_KIND, ts: 'no-es-una-fecha', seen: true }];
    assert.equal(shouldSuggestRecycle(inbox, NOW), true);
  });

  it('la ventana por defecto es de 30 min', () => {
    assert.equal(RECYCLE_DEBOUNCE_MS, 30 * 60_000);
  });

  it('never-throws ante input arbitrario', () => {
    assert.equal(shouldSuggestRecycle(/** @type {any} */ (null), NOW), true);
    assert.equal(shouldSuggestRecycle(/** @type {any} */ ('x'), NOW), true);
  });
});

// ── maybeSuggestRecycle: el criterio de éxito de la tarea ────────────────────

describe('maybeSuggestRecycle — umbral', () => {
  it('por encima del umbral encola UN evento de kind `recycle-suggested`', () => {
    const { opts, enqueued } = harness({ bytes: 9 * MB, mb: 8 });
    const r = maybeSuggestRecycle(opts);
    assert.equal(r.suggested, true);
    assert.equal(r.reason, 'enqueued');
    assert.equal(enqueued.length, 1);
    assert.equal(enqueued[0].kind, RECYCLE_KIND);
  });

  it('por debajo NO encola nada', () => {
    const { opts, enqueued } = harness({ bytes: 3 * MB, mb: 8 });
    const r = maybeSuggestRecycle(opts);
    assert.equal(r.suggested, false);
    assert.equal(r.reason, 'under-threshold');
    assert.equal(enqueued.length, 0);
  });

  it('justo EN el umbral ya dispara (la comparación es `>=`)', () => {
    const { opts } = harness({ bytes: 8 * MB, mb: 8 });
    assert.equal(maybeSuggestRecycle(opts).suggested, true);
  });

  it('el umbral configurado manda sobre el default', () => {
    const { opts } = harness({ bytes: 9 * MB, mb: 20 });
    assert.equal(maybeSuggestRecycle(opts).reason, 'under-threshold');
  });

  it('reporta los bytes observados en los dos sentidos', () => {
    assert.equal(maybeSuggestRecycle(harness({ bytes: 9 * MB }).opts).bytes, 9 * MB);
    assert.equal(maybeSuggestRecycle(harness({ bytes: 1 * MB }).opts).bytes, 1 * MB);
  });
});

describe('maybeSuggestRecycle — DEBOUNCE: exactamente una vez, no en cada Stop', () => {
  it('tres Stops seguidos con el transcript creciendo producen UN solo evento', () => {
    // La bandeja es real-ish: el harness acumula lo encolado y `listFn` lo devuelve, que
    // es exactamente lo que hace `state.json` entre dos ejecuciones del hook.
    /** @type {any[]} */
    const inbox = [];
    let seq = 0;
    const call = (bytes, atMs) =>
      maybeSuggestRecycle({
        transcriptPath: '/fake.jsonl',
        config: { orchestrator: { recycle_mb: 8 } },
        statFn: () => ({ size: bytes }),
        listFn: /** @type {any} */ (() => inbox),
        enqueueFn: /** @type {any} */ ((input) => {
          const e = buildOrchestratorEvent(input, new Date(atMs).toISOString(), seq++);
          inbox.push(e);
          return { ok: true, value: e };
        }),
        now: () => new Date(atMs),
      });

    const t0 = Date.parse('2026-09-01T10:00:00.000Z');
    const r1 = call(9 * MB, t0);
    const r2 = call(9.5 * MB, t0 + 60_000);
    const r3 = call(10 * MB, t0 + 120_000);

    assert.equal(r1.suggested, true, 'el primer cruce sí avisa');
    assert.equal(r2.reason, 'debounced');
    assert.equal(r3.reason, 'debounced');
    assert.equal(inbox.filter((e) => e.kind === RECYCLE_KIND).length, 1);
  });

  it('el aviso ya presente pero SIN VER es lo que bloquea (no un temporizador en memoria)', () => {
    const inbox = [priorRecycle({ ts: '2026-09-01T09:59:00.000Z', seen: false })];
    const { opts, enqueued } = harness({ bytes: 20 * MB, inbox });
    assert.equal(maybeSuggestRecycle(opts).reason, 'debounced');
    assert.equal(enqueued.length, 0);
  });

  it('pasada la ventana y con el anterior ackeado, vuelve a avisar', () => {
    const now = Date.parse('2026-09-01T10:00:00.000Z');
    const inbox = [priorRecycle({ ts: new Date(now - RECYCLE_DEBOUNCE_MS - 1).toISOString(), seen: true })];
    const { opts } = harness({ bytes: 20 * MB, inbox, now });
    assert.equal(maybeSuggestRecycle(opts).suggested, true);
  });

  it('la bandeja se consulta con `{all: true}`: la regla 2 necesita ver lo YA ACKEADO', () => {
    /** @type {any[]} */
    const seen = [];
    maybeSuggestRecycle({
      ...harness().opts,
      listFn: /** @type {any} */ ((o) => { seen.push(o); return []; }),
    });
    assert.deepEqual(seen, [{ all: true }]);
  });
});

describe('maybeSuggestRecycle — never-throws: un hook de cierre no puede caerse por esto', () => {
  it('sin `transcript_path` no hay medición y no hay aviso', () => {
    assert.equal(maybeSuggestRecycle({ ...harness().opts, transcriptPath: undefined }).reason, 'no-transcript');
    assert.equal(maybeSuggestRecycle({ ...harness().opts, transcriptPath: '' }).reason, 'no-transcript');
  });

  it('un transcript ilegible degrada a `unreadable`, no lanza', () => {
    const r = maybeSuggestRecycle({
      ...harness().opts,
      statFn: () => { throw new Error('ENOENT'); },
    });
    assert.equal(r.reason, 'unreadable');
  });

  it('un lock-timeout al encolar se reporta, no se traga como éxito', () => {
    const r = maybeSuggestRecycle({
      ...harness().opts,
      enqueueFn: /** @type {any} */ (() => ({ ok: false, reason: 'lock-timeout' })),
    });
    assert.equal(r.suggested, false);
    assert.equal(r.reason, 'enqueue-failed');
  });

  it('una bandeja que revienta al leerse degrada a `error`', () => {
    const r = maybeSuggestRecycle({
      ...harness().opts,
      listFn: /** @type {any} */ (() => { throw new Error('state.json corrupto'); }),
    });
    assert.equal(r.reason, 'error');
  });

  it('sin opts en absoluto tampoco lanza', () => {
    assert.equal(maybeSuggestRecycle().reason, 'no-transcript');
  });
});

// ── Integración con la bandeja (KODO-53) ─────────────────────────────────────

describe('el kind nuevo se integra con la bandeja existente', () => {
  it('`recycle-suggested` es un kind ADMITIDO (no degrada a session-end)', () => {
    assert.ok(ORCHESTRATOR_EVENT_KINDS.has(RECYCLE_KIND));
    const e = buildOrchestratorEvent({ kind: RECYCLE_KIND }, '2026-09-01T10:00:00.000Z', 0);
    assert.equal(e.kind, RECYCLE_KIND);
  });

  it('el aviso de una línea lo resume con sujeto propio', () => {
    const e = buildOrchestratorEvent(
      { kind: RECYCLE_KIND, task_ref: 'orquestador' },
      '2026-09-01T10:00:00.000Z',
      0,
    );
    assert.ok(summarizeInbox([e]).includes('orquestador conviene reciclarlo'));
  });

  it('el texto del evento nombra el tamaño, el umbral y la ruta del handoff', () => {
    const text = buildRecycleText(9.5 * MB, 8);
    assert.ok(text.includes('9.5 MB'));
    assert.ok(text.includes('umbral 8 MB'));
    assert.ok(text.includes('~/.kodo/handoff.md'));
  });

  it('el texto sobrevive al saneo de la bandeja sin perder nada', () => {
    const text = buildRecycleText(9 * MB, 8);
    const e = buildOrchestratorEvent({ kind: RECYCLE_KIND, text }, '2026-09-01T10:00:00.000Z', 0);
    assert.equal(e.text, text);
  });
});
