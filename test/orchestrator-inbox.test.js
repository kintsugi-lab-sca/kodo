// @ts-check
//
// test/orchestrator-inbox.test.js — KODO-53: la bandeja del orquestador.
//
// Dos mitades, y la separación es la del módulo:
//   1. Los helpers PUROS (`buildOrchestratorEvent`, `isOrchestratorIdle`, `shouldNotify`,
//      `summarizeInbox`, `resolveNudgeMode`) — cero I/O, cero HOME.
//   2. Los mutadores bajo `withStateLock` (`enqueue`/`ack`/`markNotified`) y el lector —
//      estos SÍ tocan `~/.kodo/state.json`, así que corren con un HOME aislado en un
//      tmpdir. Sin el aislamiento, cada `npm test` encolaría eventos falsos en la bandeja
//      real del operador; es la misma clase de fuga que T-74-15 documentó para los planes.
//
// EL AISLAMIENTO ES POR SUBPROCESO, no por `process.env.HOME`. `src/config.js:11` evalúa
// `homedir()` en MODULE-LOAD y `session/state.js` cachea `STATE_PATH` desde ahí, así que
// pisar `HOME` DESPUÉS del import llega tarde. El único aislamiento honesto para los
// mutadores es lanzar un `node` hijo con el HOME ya fijado en su entorno — mismo motivo y
// misma técnica que usan las suites de concurrencia del inbox de capturas.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  MAX_EVENT_TEXT_LEN,
  NOTICE_DEBOUNCE_MS,
  SEEN_CAP,
  buildOrchestratorEvent,
  isOrchestratorIdle,
  resolveNudgeMode,
  shouldNotify,
  summarizeInbox,
} from '../src/orchestrator/inbox.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

// ── Mitad 1: helpers PUROS ────────────────────────────────────────────────────

describe('buildOrchestratorEvent — construcción PURA de la entrada', () => {
  const TS = '2026-08-28T10:00:00.000Z';

  it('emite las 9 claves SIEMPRE y en orden fijo (contrato del --json, DX-06)', () => {
    const e = buildOrchestratorEvent({ kind: 'session-end', task_ref: 'K-1', text: 'x' }, TS, 0);
    assert.deepEqual(Object.keys(e), [
      'id', 'ts', 'kind', 'task_ref', 'session_id', 'text', 'seen', 'seen_at', 'notified_at',
    ]);
  });

  it('nace SIN VER y sin sellos de tiempo', () => {
    const e = buildOrchestratorEvent({ task_ref: 'K-1' }, TS, 0);
    assert.equal(e.seen, false);
    assert.equal(e.seen_at, null);
    assert.equal(e.notified_at, null);
  });

  it('un `kind` desconocido NO se rechaza: degrada a session-end (la bandeja jamás bloquea un cierre)', () => {
    assert.equal(buildOrchestratorEvent({ kind: 'inventado' }, TS, 0).kind, 'session-end');
    assert.equal(buildOrchestratorEvent({}, TS, 0).kind, 'session-end');
  });

  it('los tres kinds legítimos se preservan', () => {
    for (const k of ['session-end', 'session-launched', 'integration']) {
      assert.equal(buildOrchestratorEvent({ kind: k }, TS, 0).kind, k);
    }
  });

  it('SANEA task_ref y text (invariante STATE.md:176 — contenido no confiable hacia el terminal)', () => {
    // OSC-52 (escritura al portapapeles del operador) + CSI + un newline REAL, que en el
    // carril de keystroke del resumen sería un Enter espurio.
    const e = buildOrchestratorEvent(
      { task_ref: 'K-1\x1b]52;c;cGF5bG9hZA==\x07', text: 'linea1\nlinea2\x1b[31m' },
      TS,
      0,
    );
    assert.ok(!e.task_ref.includes('\x1b'), 'ESC fuera del task_ref');
    assert.ok(!e.task_ref.includes('\x07'), 'BEL fuera del task_ref');
    assert.ok(!e.text.includes('\n'), 'el newline REAL se colapsa a espacio');
    assert.ok(!e.text.includes('\x1b'), 'la secuencia CSI desaparece del texto');
  });

  it('el terminador `\\n` LITERAL de buildStopNudgeText no se persiste (se lee, no se teclea)', () => {
    // `buildStopNudgeText` cierra con el `\n` de dos chars que necesitaba `cmux send`.
    // En la bandeja ese terminador ya no significa nada.
    const e = buildOrchestratorEvent({ text: 'La sesión K-1 ha terminado.\\n' }, TS, 0);
    assert.equal(e.text, 'La sesión K-1 ha terminado.');
  });

  it('acota el texto a MAX_EVENT_TEXT_LEN (state.json lo lee cada tick del TUI)', () => {
    const e = buildOrchestratorEvent({ text: 'a'.repeat(MAX_EVENT_TEXT_LEN + 500) }, TS, 0);
    assert.equal(e.text.length, MAX_EVENT_TEXT_LEN);
  });

  it('session_id: solo strings no vacías; cualquier otra cosa es null', () => {
    assert.equal(buildOrchestratorEvent({ session_id: 's-1' }, TS, 0).session_id, 's-1');
    assert.equal(buildOrchestratorEvent({ session_id: '' }, TS, 0).session_id, null);
    assert.equal(buildOrchestratorEvent({}, TS, 0).session_id, null);
  });

  it('dos eventos del MISMO milisegundo no comparten id (el seq los separa)', () => {
    const a = buildOrchestratorEvent({ task_ref: 'A' }, TS, 0);
    const b = buildOrchestratorEvent({ task_ref: 'B' }, TS, 1);
    assert.notEqual(a.id, b.id);
    assert.match(a.id, /^[0-9a-z]{8}$/);
  });
});

describe('isOrchestratorIdle — la puerta del aviso, FAIL-CLOSED', () => {
  it('prompt VACÍO = idle', () => {
    assert.equal(isOrchestratorIdle('salida previa\n❯'), true);
    assert.equal(isOrchestratorIdle('salida previa\n> '), true);
    assert.equal(isOrchestratorIdle('salida\n│ ❯ │'), true);
  });

  it('el marcador [kodo:idle] de la skill = idle', () => {
    assert.equal(isOrchestratorIdle('nada pendiente\n[kodo:idle]'), true);
  });

  it('prompt CON BORRADOR = NO idle (aquí diverge de detectIdle, que solo mira el prefijo)', () => {
    // `detectIdle` (session/health.js) devuelve true para cualquier línea que empiece por
    // `>`; aquí eso sería teclear encima de lo que el operador está escribiendo.
    assert.equal(isOrchestratorIdle('salida\n❯ arregla el test'), false);
    assert.equal(isOrchestratorIdle('salida\n> revisa KODO-53'), false);
  });

  it('pensando = NO idle', () => {
    assert.equal(isOrchestratorIdle('✻ Thinking… (12s · 3.1k tokens)'), false);
    assert.equal(isOrchestratorIdle('● Read(src/cli.js)\n  ⎿ 40 lines'), false);
  });

  it('pantalla vacía o ilegible = NO idle (ante la duda, no se teclea)', () => {
    assert.equal(isOrchestratorIdle(''), false);
    assert.equal(isOrchestratorIdle('   \n\n  '), false);
    assert.equal(isOrchestratorIdle(null), false);
    assert.equal(isOrchestratorIdle(undefined), false);
    assert.equal(isOrchestratorIdle(/** @type {any} */ (42)), false);
  });

  it('ignora las líneas en blanco del final (el prompt suele traer relleno detrás)', () => {
    assert.equal(isOrchestratorIdle('salida\n❯\n\n   \n'), true);
  });
});

describe('shouldNotify — debounce: tres cierres seguidos son UN aviso', () => {
  const NOW = Date.parse('2026-08-28T10:00:00.000Z');
  const mk = (over = {}) => ({ id: 'x', ts: '', kind: 'session-end', task_ref: 'K', session_id: null, text: '', seen: false, seen_at: null, notified_at: null, ...over });

  it('sin nada sin ver → no se avisa', () => {
    assert.equal(shouldNotify([], NOW), false);
    assert.equal(shouldNotify([mk({ seen: true })], NOW), false);
  });

  it('con algo sin ver y nunca notificado → se avisa', () => {
    assert.equal(shouldNotify([mk()], NOW), true);
  });

  it('dentro de la ventana de debounce → NO se avisa', () => {
    const hace10s = new Date(NOW - 10_000).toISOString();
    assert.equal(shouldNotify([mk({ notified_at: hace10s }), mk()], NOW), false);
  });

  it('pasada la ventana → vuelve a avisarse', () => {
    const viejo = new Date(NOW - NOTICE_DEBOUNCE_MS - 1).toISOString();
    assert.equal(shouldNotify([mk({ notified_at: viejo }), mk()], NOW), true);
  });

  it('un notified_at basura no bloquea el aviso (never-throws, se ignora)', () => {
    assert.equal(shouldNotify([mk({ notified_at: 'no-es-una-fecha' })], NOW), true);
  });

  it('las YA VISTAS no cuentan para el debounce ni para el disparo', () => {
    const hace1s = new Date(NOW - 1000).toISOString();
    // Una vista y notificada hace nada NO debe silenciar a una nueva sin ver.
    assert.equal(shouldNotify([mk({ seen: true, notified_at: hace1s }), mk()], NOW), true);
  });
});

describe('summarizeInbox — el aviso de UNA línea', () => {
  const mk = (task_ref, kind = 'session-end', seen = false) => ({
    id: task_ref, ts: '', kind, task_ref, session_id: null, text: 'texto largo que NO debe salir', seen, seen_at: null, notified_at: null,
  });

  it('la forma exacta del criterio de éxito de KODO-53', () => {
    const line = summarizeInbox([mk('ITCLIP-119'), mk('ITCLIP-121', 'session-launched')]);
    assert.equal(line, '[kodo] 2 eventos nuevos — ITCLIP-119 en Review, ITCLIP-121 lanzada. Ronda.');
  });

  it('singular con un solo evento', () => {
    assert.equal(summarizeInbox([mk('K-1')]), '[kodo] 1 evento nuevo — K-1 en Review. Ronda.');
  });

  it('NO lleva el texto largo — eso es justo el ruido que KODO-53 retira', () => {
    assert.ok(!summarizeInbox([mk('K-1')]).includes('texto largo'));
  });

  it('es UNA línea: sin `\\n`, para no inyectar un Enter espurio al teclearla', () => {
    const line = summarizeInbox([mk('K-1'), mk('K-2'), mk('K-3'), mk('K-4')]);
    assert.ok(!line.includes('\n'));
  });

  it('con más de 3 refs, resume el resto en vez de crecer', () => {
    const line = summarizeInbox([mk('K-1'), mk('K-2'), mk('K-3'), mk('K-4'), mk('K-5')]);
    assert.match(line, /^\[kodo\] 5 eventos nuevos — K-1 en Review, K-2 en Review, K-3 en Review, y 2 más\. Ronda\.$/);
  });

  it('ignora las ya vistas', () => {
    assert.equal(summarizeInbox([mk('K-1', 'session-end', true)]), '');
  });

  it('SANEA el task_ref: el aviso sale por el carril de keystroke', () => {
    // Un state.json editado a mano puede meter una entrada sin pasar por
    // `buildOrchestratorEvent`; el saneo del punto de composición es el que protege.
    const line = summarizeInbox([mk('K-1\x1b]52;c;x\x07')]);
    assert.ok(!line.includes('\x1b'));
    assert.ok(!line.includes('\x07'));
  });

  it('un task_ref vacío no deja un hueco ilegible', () => {
    assert.match(summarizeInbox([mk('')]), /— sesión en Review\./);
  });
});

describe('resolveNudgeMode — FAIL-SAFE al default `inbox`', () => {
  it('los tres modos legítimos se respetan', () => {
    assert.equal(resolveNudgeMode({ orchestrator: { nudges: 'inbox' } }), 'inbox');
    assert.equal(resolveNudgeMode({ orchestrator: { nudges: 'keystroke' } }), 'keystroke');
    assert.equal(resolveNudgeMode({ orchestrator: { nudges: 'off' } }), 'off');
  });

  it('config ausente, vacío o con valor desconocido → `inbox`', () => {
    assert.equal(resolveNudgeMode(null), 'inbox');
    assert.equal(resolveNudgeMode(undefined), 'inbox');
    assert.equal(resolveNudgeMode({}), 'inbox');
    assert.equal(resolveNudgeMode({ orchestrator: {} }), 'inbox');
    assert.equal(resolveNudgeMode({ orchestrator: { nudges: 'todos' } }), 'inbox');
  });
});

// ── Mitad 2: mutadores contra un state.json REAL, en un HOME aislado ──────────

describe('bandeja persistida — enqueue/list/ack/markNotified bajo withStateLock', () => {
  let home;
  before(() => {
    home = mkdtempSync(join(tmpdir(), 'kodo-orch-inbox-'));
  });
  after(() => {
    rmSync(home, { recursive: true, force: true });
  });

  /**
   * Corre `code` en un `node` HIJO con el HOME aislado ya en su entorno.
   *
   * Obligatorio, no cosmético: `config.js` evalúa `homedir()` en module-load, así que
   * pisar `process.env.HOME` desde un fichero con imports estáticos llega TARDE y los
   * mutadores escribirían en el `~/.kodo/state.json` real del operador.
   *
   * @param {string} code módulo ESM; su última línea imprime el JSON del resultado.
   * @returns {any}
   */
  function inChildHome(code) {
    const out = execFileSync(process.execPath, ['--input-type=module', '-e', code], {
      cwd: REPO_ROOT,
      env: { ...process.env, HOME: home },
      encoding: 'utf-8',
    });
    return JSON.parse(out.trim().split('\n').pop());
  }

  it('encola, lista y acka — y el ack NO borra: transiciona', () => {
    const r = inChildHome(`
      import { enqueueOrchestratorEvent, listOrchestratorInbox, ackOrchestratorEvents } from './src/orchestrator/inbox.js';
      const a = enqueueOrchestratorEvent({ kind: 'session-end', task_ref: 'K-1', text: 'cerrada' });
      const b = enqueueOrchestratorEvent({ kind: 'session-launched', task_ref: 'K-2', text: 'lanzada' });
      const antes = listOrchestratorInbox({}).length;
      const ack = ackOrchestratorEvents({ ids: [a.value.id] });
      console.log(JSON.stringify({
        antes,
        acked: ack.value.acked,
        missing: ack.value.missing,
        sinVer: listOrchestratorInbox({}).map(e => e.task_ref),
        todas: listOrchestratorInbox({ all: true }).length,
        seenAt: listOrchestratorInbox({ all: true }).find(e => e.id === a.value.id).seen_at !== null,
        idB: b.value.id,
      }));
    `);
    assert.equal(r.antes, 2, 'las dos entran sin ver');
    assert.equal(r.acked.length, 1);
    assert.deepEqual(r.missing, []);
    assert.deepEqual(r.sinVer, ['K-2'], 'solo queda sin ver la que no se ackeó');
    assert.equal(r.todas, 2, 'la ackeada NO se borra — sigue en la traza');
    assert.equal(r.seenAt, true, 'el ack sella seen_at');
  });

  it('`ack --all` marca todo lo sin ver y es IDEMPOTENTE (dos rondas solapadas no son un error)', () => {
    const r = inChildHome(`
      import { enqueueOrchestratorEvent, listOrchestratorInbox, ackOrchestratorEvents } from './src/orchestrator/inbox.js';
      enqueueOrchestratorEvent({ task_ref: 'A' });
      enqueueOrchestratorEvent({ task_ref: 'B' });
      const first = ackOrchestratorEvents({ all: true });
      const second = ackOrchestratorEvents({ all: true });
      console.log(JSON.stringify({
        first: first.value.acked.length,
        second: second.value.acked.length,
        sinVer: listOrchestratorInbox({}).length,
      }));
    `);
    assert.ok(r.first >= 2, 'el primer ack marca las pendientes');
    assert.equal(r.second, 0, 'el segundo no re-marca nada — idempotente');
    assert.equal(r.sinVer, 0);
  });

  it('un id inexistente sale por `missing`, y los que sí existen se ackean igual (no es transaccional)', () => {
    const r = inChildHome(`
      import { enqueueOrchestratorEvent, ackOrchestratorEvents } from './src/orchestrator/inbox.js';
      const a = enqueueOrchestratorEvent({ task_ref: 'X' });
      const ack = ackOrchestratorEvents({ ids: [a.value.id, 'nooo'] });
      console.log(JSON.stringify({ acked: ack.value.acked.length, missing: ack.value.missing }));
    `);
    assert.equal(r.acked, 1);
    assert.deepEqual(r.missing, ['nooo']);
  });

  it('un id YA VISTO no es `missing` — existe, solo que ya estaba cerrado', () => {
    const r = inChildHome(`
      import { enqueueOrchestratorEvent, ackOrchestratorEvents } from './src/orchestrator/inbox.js';
      const a = enqueueOrchestratorEvent({ task_ref: 'Y' });
      ackOrchestratorEvents({ ids: [a.value.id] });
      const again = ackOrchestratorEvents({ ids: [a.value.id] });
      console.log(JSON.stringify({ acked: again.value.acked.length, missing: again.value.missing }));
    `);
    assert.equal(r.acked, 0);
    assert.deepEqual(r.missing, [], 'existe → no es un id desconocido');
  });

  it('markOrchestratorEventsNotified sella el ancla del debounce sin marcar nada como visto', () => {
    const r = inChildHome(`
      import { enqueueOrchestratorEvent, listOrchestratorInbox, markOrchestratorEventsNotified } from './src/orchestrator/inbox.js';
      const a = enqueueOrchestratorEvent({ task_ref: 'Z' });
      const n = markOrchestratorEventsNotified([a.value.id]);
      const e = listOrchestratorInbox({ all: true }).find(x => x.id === a.value.id);
      console.log(JSON.stringify({ count: n.value, notified: e.notified_at !== null, seen: e.seen }));
    `);
    assert.equal(r.count, 1);
    assert.equal(r.notified, true);
    assert.equal(r.seen, false, 'notificar NO es ver: el evento sigue esperando la ronda');
  });

  it(`la eviction FIFO solo toca las VISTAS: las sin ver sobreviven por encima de SEEN_CAP (${SEEN_CAP})`, () => {
    // Perder una entrada sin ver por presión de tamaño sería perder justo el trabajo que
    // la bandeja existe para no perder.
    const r = inChildHome(`
      import { enqueueOrchestratorEvent, listOrchestratorInbox, ackOrchestratorEvents, SEEN_CAP } from './src/orchestrator/inbox.js';
      for (let i = 0; i < SEEN_CAP + 20; i++) enqueueOrchestratorEvent({ task_ref: 'seen-' + i });
      ackOrchestratorEvents({ all: true });
      for (let i = 0; i < 5; i++) enqueueOrchestratorEvent({ task_ref: 'fresh-' + i });
      const all = listOrchestratorInbox({ all: true });
      console.log(JSON.stringify({
        vistas: all.filter(e => e.seen).length,
        sinVer: all.filter(e => !e.seen).length,
        cap: SEEN_CAP,
      }));
    `);
    assert.equal(r.vistas, r.cap, 'las vistas se recortan al cap');
    assert.equal(r.sinVer, 5, 'ninguna sin ver se evicta');
  });

  it('un state.json SIN la clave (previo a KODO-53) se lee como bandeja vacía, no como error', () => {
    const r = inChildHome(`
      import { writeFileSync, mkdirSync } from 'node:fs';
      import { join } from 'node:path';
      import { homedir } from 'node:os';
      const dir = join(homedir(), '.kodo');
      mkdirSync(dir, { recursive: true });
      writeFileSync(join(dir, 'state.json'), JSON.stringify({ schema_version: 3, sessions: {}, history: [] }) + '\\n');
      const { listOrchestratorInbox, enqueueOrchestratorEvent } = await import('./src/orchestrator/inbox.js');
      const vacia = listOrchestratorInbox({ all: true }).length;
      enqueueOrchestratorEvent({ task_ref: 'primero' });
      console.log(JSON.stringify({ vacia, tras: listOrchestratorInbox({ all: true }).length }));
    `);
    assert.equal(r.vacia, 0);
    assert.equal(r.tras, 1, 'el guard defensivo crea la clave al primer encolado');
  });

  it('encolar NO pisa las claves hermanas de state.json (tasks / integration_queue / orchestrator)', () => {
    const r = inChildHome(`
      import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
      import { join } from 'node:path';
      import { homedir } from 'node:os';
      const dir = join(homedir(), '.kodo');
      const path = join(dir, 'state.json');
      mkdirSync(dir, { recursive: true });
      writeFileSync(path, JSON.stringify({
        schema_version: 3, sessions: {}, history: [],
        tasks: { t1: { plan_path: '/p', next: 'seguir', updated_at: 'x' } },
        integration_queue: [{ task_ref: 'K-9', branch: 'feat/x', status: 'pending' }],
        orchestrator: { workspace_ref: 'workspace:3', workspace_id: null, session_id: 's', started_at: 'x' },
      }) + '\\n');
      const { enqueueOrchestratorEvent } = await import('./src/orchestrator/inbox.js');
      enqueueOrchestratorEvent({ task_ref: 'nuevo' });
      const after = JSON.parse(readFileSync(path, 'utf-8'));
      console.log(JSON.stringify({
        tasks: after.tasks?.t1?.next,
        queue: after.integration_queue?.length,
        orch: after.orchestrator?.workspace_ref,
        inbox: after.orchestrator_inbox?.length,
      }));
    `);
    assert.equal(r.tasks, 'seguir');
    assert.equal(r.queue, 1);
    assert.equal(r.orch, 'workspace:3');
    assert.equal(r.inbox, 1);
  });
});
