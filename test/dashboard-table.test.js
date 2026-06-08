// @ts-check
//
// test/dashboard-table.test.js — Phase 36 Plan 02 + Plan 03 Wave 0 (TUI-07/08/09/10/11/12).
//
// Renderiza el componente `App` del dashboard con ink-testing-library y verifica la TABLA VIVA
// columnar que reemplaza la status line de Phase 35:
//   - columnas (TUI-07): task_ref · repo (derivado D-03) · phase/mode · status · age, con el
//     placeholder `—` para una sesión non-GSD.
//   - marca zombie (TUI-10/D-09): `running (zombie)` para la sesión running+!alive.
//   - contadores del header (TUI-11/D-11): el zombie se cuenta APARTE de running; indicador
//     `● live` (reusado de Phase 35) tras un poll ok.
//   - orden estable DESC (TUI-09): la sesión con `started_at` más reciente renderiza ARRIBA.
//   - estados vacíos (TUI-11/D-12): poll ok con 0 sesiones → `no active sessions`; un fetch que
//     falla desde el primer tick mantiene `waiting for server` (precedencia degradada, D-12).
//   - selección inicial (D-07): la primera fila (la más reciente) muestra el gutter `› `.
//
// Harness hermético reusado VERBATIM de test/dashboard-status-line.test.js: `makeFakeClock` /
// `injectProps` / `drain` / `okResponse`. Sin red ni timers reales (Pitfall 11). ink@4 NO expone
// `waitUntilExit()`, así que las aserciones usan `lastFrame()` tras drenar microtasks / disparar
// el fake schedule.
//
// Estado Wave 0: ROJO hasta que Task 2 modifique `App.js` para renderizar la tabla — hoy `App`
// renderiza la status line de Phase 35 (sin columnas, sin gutter, sin contadores por estado).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App, {
  OVERLAY_COMMENTS_EMPTY,
  OVERLAY_COMMENTS_UNSUPPORTED,
} from '../src/cli/dashboard/App.js';
// Phase 38 Plan 03: pure-function units del render multi-estado (badges + filtros).
import { STATE_BADGES, stateBadge, countsLabel } from '../src/cli/dashboard/format.js';
import { parseFilter, applyFilter } from '../src/cli/dashboard/select.js';

/**
 * Fake clock con un `schedule` determinista para el RE-ARME del tick del loop de polling que
 * vive dentro de `usePoll` (NO usa timers reales — Pitfall 11):
 *   - `schedule(fn, ms)` guarda el callback de tick en `pending` con un handle incremental.
 *   - `cancel(handle)` lo descarta.
 *   - `flushTick()` dispara (y consume) el último callback de tick pendiente — avanza el loop.
 *
 * El timeout de abort de 5s (D-05) se inyecta como `scheduleTimeout` no-op: ni dispara ni cuelga
 * el proceso. `now()` es un reloj controlable (para la edad determinista de D-08).
 */
function makeFakeClock(startMs = 1_000_000) {
  /** @type {Array<{ handle: number, fn: Function }>} */
  let pending = [];
  let nextHandle = 1;
  let nowMs = startMs;

  const schedule = (fn) => {
    const handle = nextHandle++;
    pending.push({ handle, fn });
    return handle;
  };
  const cancel = (handle) => {
    pending = pending.filter((p) => p.handle !== handle);
  };
  // Timeout de abort (5s): no-op inerte para no colgar timers reales ni abortar en tests.
  let nextTimeoutHandle = 10000;
  const scheduleTimeout = () => nextTimeoutHandle++;
  const cancelTimeout = () => {};

  const flushTick = async () => {
    const entry = pending.pop();
    if (!entry) return false;
    await entry.fn();
    return true;
  };

  return {
    schedule,
    cancel,
    scheduleTimeout,
    cancelTimeout,
    flushTick,
    now: () => nowMs,
    advance: (ms) => {
      nowMs += ms;
    },
  };
}

/**
 * Construye las props de inyección que `App` propaga a `usePoll`/`fetchStatus`, más el reloj
 * `now` para la edad. El clock fake se reusa para `schedule`/`cancel`/`scheduleTimeout`/`now`.
 */
function injectProps(clock, fetchFn) {
  return {
    baseUrl: 'http://localhost:9090',
    fetchFn,
    now: clock.now,
    schedule: clock.schedule,
    cancel: clock.cancel,
    scheduleTimeout: clock.scheduleTimeout,
    cancelTimeout: clock.cancelTimeout,
  };
}

/**
 * Drena por completo la cola de microtasks pendientes (cadenas del kick-off `Promise.resolve()
 * .then(tick)` + `await fn()` + los setState/re-render que ink agenda). Más robusto que
 * `await Promise.resolve()` contra cadenas de profundidad variable.
 *
 * Se drena DOS veces: el primer drain absorbe el `onResult` del kick-off (sets connected +
 * sessions); el segundo absorbe el re-render del write-back de la selección inicial (`useEffect`
 * que fija selectedTaskId — D-07). Sin el segundo drain el frame podría capturarse entre los dos
 * renders (flakiness de profundidad de microtasks en el proceso compartido del test runner).
 */
async function drain() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

/** Response-like mínimo con `ok`/`status`/`json()` (forma del fetch que consume client.js). */
function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

// Fixture D-03 (PATTERNS.md líneas 300-303): dos sesiones — una GSD running+alive (KL-1, kodo,
// 36/full, 5m) y una non-GSD zombie running+!alive (KL-2, /x/foo→'foo', sin phase/mode, 1h3m).
// KL-1 tiene el started_at más reciente (10:00 > 09:00) → debe renderizar ARRIBA (DESC, TUI-09).
const FIXTURE = {
  count: 2,
  sessions: [
    {
      task_id: 'a',
      task_ref: 'KL-1',
      status: 'running',
      alive: true,
      started_at: '2026-05-27T10:00:00Z',
      project_name: 'kodo',
      elapsed_min: 5,
      phase_id: '36',
      gsd_mode: 'full',
      summary: '',
      // Phase 43: provider_state ok (reason null) → valor crudo verbatim en la columna `task`.
      provider_state: 'in_review',
      provider_state_reason: null,
    },
    {
      task_id: 'b',
      task_ref: 'KL-2',
      status: 'running',
      alive: false,
      started_at: '2026-05-27T09:00:00Z',
      project_path: '/x/foo',
      elapsed_min: 63,
      summary: '',
      // Phase 43: provider sin soporte (permanente) → '—' dim en la columna `task`.
      provider_state: null,
      provider_state_reason: 'unsupported',
    }, // zombie, non-GSD
  ],
};

describe('TUI-07/09/10/11: tabla viva — columnas, orden DESC, zombie, contadores, vacíos (D-01/D-03/D-07/D-09/D-11/D-12)', () => {
  it('columnas (TUI-07): renderiza task_ref · repo · phase/mode · status · age con — para non-GSD', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse(FIXTURE);

    const { lastFrame } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    const frame = lastFrame();
    assert.match(frame, /KL-1/, `debe mostrar task_ref KL-1\n${frame}`);
    assert.match(frame, /kodo/, `debe mostrar el repo derivado 'kodo' (project_name)\n${frame}`);
    assert.match(frame, /36\/full/, `debe mostrar phase/mode 36/full\n${frame}`);
    assert.match(frame, /5m/, `debe mostrar age 5m\n${frame}`);
    assert.match(frame, /KL-2/, `debe mostrar task_ref KL-2\n${frame}`);
    assert.match(frame, /foo/, `debe mostrar el repo derivado 'foo' (basename de /x/foo)\n${frame}`);
    assert.match(frame, /1h3m/, `debe mostrar age 1h3m (elapsed_min 63)\n${frame}`);
    assert.match(frame, /—/, `debe mostrar el placeholder — para la sesión non-GSD\n${frame}`);
  });

  it('zombie (TUI-10/D-09): el running+!alive muestra la marca textual "running (zombie)"', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse(FIXTURE);

    const { lastFrame } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    const frame = lastFrame();
    assert.match(frame, /running \(zombie\)/, `el zombie (running+!alive) debe mostrar "running (zombie)"\n${frame}`);
  });

  it('contadores del header (TUI-11/D-11): zombie contado aparte de running + indicador ● live', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse(FIXTURE);

    const { lastFrame } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    const frame = lastFrame();
    // El fixture tiene 1 running+alive y 1 zombie → "1 running · 1 zombie" (zombie aparte).
    assert.match(frame, /1 running/, `el header debe contar 1 running (zombie aparte)\n${frame}`);
    assert.match(frame, /1 zombie/, `el header debe contar 1 zombie por separado\n${frame}`);
    // Indicador live reusado de Phase 35 tras un poll ok.
    assert.match(frame, /● live/, `tras poll ok debe mostrar el indicador ● live (reusado Phase 35)\n${frame}`);
  });

  it('orden DESC (TUI-09): la sesión más reciente (KL-1 @10:00) renderiza ARRIBA de KL-2 @09:00', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse(FIXTURE);

    const { lastFrame } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    const frame = lastFrame();
    const idx1 = frame.indexOf('KL-1');
    const idx2 = frame.indexOf('KL-2');
    assert.ok(idx1 !== -1 && idx2 !== -1, `ambas filas deben estar presentes\n${frame}`);
    assert.ok(
      idx1 < idx2,
      `KL-1 (más reciente) debe renderizar ANTES que KL-2 (DESC por started_at)\n${frame}`,
    );
  });

  it('selección inicial (D-07): la primera fila (KL-1, la más reciente) muestra el gutter "› "', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse(FIXTURE);

    const { lastFrame } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    const frame = lastFrame();
    assert.match(
      frame,
      /›.*KL-1/,
      `la fila inicialmente seleccionada (KL-1 newest) debe llevar el gutter "› "\n${frame}`,
    );
  });

  it('empty (TUI-11/D-12a): poll ok con 0 sesiones muestra "no active sessions" (no "no sessions match")', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse({ count: 0, sessions: [] });

    const { lastFrame } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    const frame = lastFrame();
    assert.match(frame, /no active sessions/, `poll ok + 0 sesiones debe mostrar "no active sessions"\n${frame}`);
    assert.doesNotMatch(
      frame,
      /no sessions match/,
      `con 0 sesiones reales NO debe mostrar "no sessions match" (eso es filtro sin match)\n${frame}`,
    );
  });

  it('precedencia degradada (D-12): un fetch que falla desde el primer tick mantiene "waiting for server" sin "no active sessions"', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => {
      throw new Error('ECONNREFUSED');
    };

    const { lastFrame } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    const frame = lastFrame();
    assert.match(frame, /waiting for server/, `sin dato bueno debe mostrar "waiting for server"\n${frame}`);
    assert.doesNotMatch(
      frame,
      /no active sessions/,
      `el estado degradado (waiting) tiene precedencia sobre el vacío de la lista\n${frame}`,
    );
  });
});

// ---------------------------------------------------------------------------
// Phase 43 Plan 01 (PSTATE-05; D-01/D-02/D-03/D-04/D-05/D-08): columna dedicada `task`
// (eje provider) entre `status` y `age`, con los 3 reason-states distinguibles sin color.
// ---------------------------------------------------------------------------

// Fixture específico de los 3 reason-states del provider_state (Phase 40 D-05) en una sola tabla.
const FIXTURE_PSTATE = {
  count: 3,
  sessions: [
    {
      task_id: 'p1',
      task_ref: 'PS-1',
      status: 'running',
      alive: true,
      started_at: '2026-05-27T12:00:00Z',
      project_name: 'kodo',
      elapsed_min: 1,
      summary: '',
      provider_state: 'in_review', // ok → verbatim
      provider_state_reason: null,
    },
    {
      task_id: 'p2',
      task_ref: 'PS-2',
      status: 'running',
      alive: true,
      started_at: '2026-05-27T11:00:00Z',
      project_name: 'kodo',
      elapsed_min: 2,
      summary: '',
      provider_state: null, // unsupported → '—' dim
      provider_state_reason: 'unsupported',
    },
    {
      task_id: 'p3',
      task_ref: 'PS-3',
      status: 'running',
      alive: true,
      started_at: '2026-05-27T10:30:00Z',
      project_name: 'kodo',
      elapsed_min: 3,
      summary: '',
      provider_state: null, // fetch-failed → '?' dim
      provider_state_reason: 'fetch-failed',
    },
  ],
};

describe('PSTATE-05: columna task — header entre status y age, 3 reason-states (D-01/D-02/D-03/D-04)', () => {
  it('D-03: la cabecera incluye `task` posicionada entre `status` y `age`', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse(FIXTURE_PSTATE);

    const { lastFrame, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    const frame = lastFrame();
    const idxStatus = frame.indexOf('status');
    const idxTask = frame.indexOf('task'); // header literal 'task' (no 'task_ref', que es más largo)
    const idxAge = frame.indexOf('age');
    assert.ok(idxStatus !== -1 && idxAge !== -1, `header status y age deben existir\n${frame}`);
    // 'task' aparece primero en 'task_ref'; la cabecera dedicada 'task' debe estar DESPUÉS de 'status'.
    const idxTaskAfterStatus = frame.indexOf('task', idxStatus);
    assert.ok(
      idxTaskAfterStatus !== -1 && idxTaskAfterStatus > idxStatus && idxTaskAfterStatus < idxAge,
      `la cabecera 'task' debe ir entre 'status' (${idxStatus}) y 'age' (${idxAge}), fue ${idxTaskAfterStatus}\n${frame}`,
    );
    assert.ok(idxTask !== -1, 'header task presente');
    unmount(); // higiene: no dejar el render (con su stdin/useInput) activo para el siguiente test.
  });

  it('D-04 ok: una fila con provider_state in_review muestra el valor crudo verbatim', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse(FIXTURE_PSTATE);

    const { lastFrame, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    const frame = lastFrame();
    assert.match(frame, /in_review/, `la fila ok debe mostrar 'in_review' verbatim en la columna task\n${frame}`);
    unmount();
  });

  it('D-04 degradados: unsupported renderiza `—` y fetch-failed renderiza `?`', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse(FIXTURE_PSTATE);

    const { lastFrame, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    const frame = lastFrame();
    assert.match(frame, /—/, `la fila unsupported debe mostrar el glyph '—'\n${frame}`);
    assert.match(frame, /\?/, `la fila fetch-failed debe mostrar el glyph '?'\n${frame}`);
    unmount();
  });
});

// ---------------------------------------------------------------------------
// Plan 03 Wave 0 — interacción de teclado (TUI-08 navegación + TUI-12 filtro modal).
//
// Se conduce el teclado con `stdin.write(...)` del handle de render (el fake Stdin de
// ink-testing-library tiene `isTTY=true`, así que `isRawModeSupported` es true y el useInput
// gateado está ACTIVO). Códigos verificados contra ink@6.8.0 (parse-keypress.js / input-parser.js):
//   ↑ = '\x1b[A'   ↓ = '\x1b[B'   Esc = '\x1b'   Enter = '\r'   Backspace = '\x7f'
// El Esc solitario se emite vía un flush diferido con `setImmediate` (App.js schedulePendingInputFlush),
// que el doble-`setImmediate` de `drain()` ya absorbe — por eso basta `await drain()` tras cada write.
// Char imprimible multi-byte ('s:running') llega como UN solo evento `input` → el handler lo
// concatena de golpe a la query (live append, D-13).
//
// Estado Wave 0: ROJO hasta Task 2 — hoy App.js solo maneja `q` (sin mode/query state) y
// SessionTable no tiene línea de filtro ni la rama `no sessions match`.
describe('TUI-08: navegación ↑/↓ — mueve el cursor por identidad, clamp sin wrap (D-07)', () => {
  it('↓ mueve el gutter de KL-1 (newest) a KL-2; otro ↓ clampa (sin wrap); ↑ vuelve a KL-1; otro ↑ clampa', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse(FIXTURE);

    const { lastFrame, stdin } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    // Estado inicial (D-07): gutter en KL-1 (la más reciente, arriba).
    assert.match(lastFrame(), /›.*KL-1/, `inicial: el gutter debe estar en KL-1\n${lastFrame()}`);

    // ↓ → el gutter baja a KL-2.
    stdin.write('\x1b[B');
    await drain();
    assert.match(lastFrame(), /›.*KL-2/, `tras ↓ el gutter debe estar en KL-2\n${lastFrame()}`);
    assert.doesNotMatch(lastFrame(), /›.*KL-1/, `tras ↓ el gutter ya NO debe estar en KL-1\n${lastFrame()}`);

    // ↓ de nuevo → clamp en el extremo inferior (NO wrap a KL-1).
    stdin.write('\x1b[B');
    await drain();
    assert.match(lastFrame(), /›.*KL-2/, `otro ↓ debe CLAMPAR en KL-2 (sin wrap-around)\n${lastFrame()}`);

    // ↑ → vuelve a KL-1.
    stdin.write('\x1b[A');
    await drain();
    assert.match(lastFrame(), /›.*KL-1/, `tras ↑ el gutter debe volver a KL-1\n${lastFrame()}`);

    // ↑ de nuevo → clamp en el extremo superior (NO wrap a KL-2).
    stdin.write('\x1b[A');
    await drain();
    assert.match(lastFrame(), /›.*KL-1/, `otro ↑ debe CLAMPAR en KL-1 (sin wrap-around)\n${lastFrame()}`);
  });
});

describe('TUI-12: filtro modal — / abre, filtra en vivo, Esc cancela, Enter confirma, no-match, Esc en lista ignorado (D-13/D-14/D-15/D-16)', () => {
  it('/ abre la línea de filtro modal (prompt al pie)', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse(FIXTURE);

    const { lastFrame, stdin } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    stdin.write('/');
    await drain();
    // El prompt modal lleva el cursor `▏` (UI-SPEC:191) — marcador inequívoco de la línea de filtro
    // (lo distingue del `/ filter` del footer de hints).
    assert.match(lastFrame(), /▏/, `tras '/' debe abrirse la línea de filtro (prompt con cursor ▏)\n${lastFrame()}`);
  });

  it('filtra EN VIVO (D-13/D-14): s:running deja ambas; añadir r:kodo deja solo KL-1', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse(FIXTURE);

    const { lastFrame, stdin } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    stdin.write('/');
    await drain();

    // s:running → ambas sesiones son running (KL-1 alive, KL-2 zombie) → las dos siguen visibles.
    stdin.write('s:running');
    await drain();
    assert.match(lastFrame(), /KL-1/, `con s:running KL-1 (running+alive) debe seguir visible\n${lastFrame()}`);
    assert.match(lastFrame(), /KL-2/, `con s:running KL-2 (running zombie) debe seguir visible\n${lastFrame()}`);

    // Añadir ' r:kodo' → AND con repo 'kodo' → solo KL-1 (repo kodo); KL-2 (repo 'foo') se oculta.
    stdin.write(' r:kodo');
    await drain();
    assert.match(lastFrame(), /KL-1/, `con r:kodo solo KL-1 (repo kodo) debe quedar\n${lastFrame()}`);
    assert.doesNotMatch(lastFrame(), /KL-2/, `r:kodo debe OCULTAR KL-2 (repo foo) — filtro en vivo AND\n${lastFrame()}`);
  });

  it('Esc CANCELA el filtro (D-15): limpia query, vuelve a la lista completa, cursor preservado (D-16)', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse(FIXTURE);

    const { lastFrame, stdin } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    stdin.write('/');
    await drain();
    stdin.write('r:kodo'); // oculta KL-2
    await drain();
    assert.doesNotMatch(lastFrame(), /KL-2/, `precondición: r:kodo oculta KL-2\n${lastFrame()}`);

    // Esc → cancela: la línea de filtro desaparece, la lista completa vuelve, el cursor sigue en KL-1.
    stdin.write('\x1b');
    await drain();
    assert.doesNotMatch(lastFrame(), /▏/, `tras Esc la línea de filtro (cursor ▏) debe desaparecer\n${lastFrame()}`);
    assert.match(lastFrame(), /KL-2/, `tras Esc (cancela) la lista completa vuelve — KL-2 visible de nuevo\n${lastFrame()}`);
    assert.match(lastFrame(), /›.*KL-1/, `tras cancelar, el cursor preservado sigue en KL-1 (D-16)\n${lastFrame()}`);
  });

  it('Enter CONFIRMA (D-15): cierra la línea de filtro pero MANTIENE el filtro aplicado', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse(FIXTURE);

    const { lastFrame, stdin } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    stdin.write('/');
    await drain();
    stdin.write('r:kodo'); // oculta KL-2
    await drain();

    // Enter → confirma: la línea de filtro se cierra pero el resultado filtrado se mantiene (KL-2 oculta).
    stdin.write('\r');
    await drain();
    assert.doesNotMatch(lastFrame(), /▏/, `tras Enter la línea de filtro (cursor ▏) debe cerrarse\n${lastFrame()}`);
    assert.match(lastFrame(), /KL-1/, `tras Enter KL-1 (matchea r:kodo) sigue visible\n${lastFrame()}`);
    assert.doesNotMatch(lastFrame(), /KL-2/, `tras Enter (confirma) el filtro se MANTIENE — KL-2 sigue oculta\n${lastFrame()}`);
  });

  it('CR-01/D-16: filtro que oculta TODA la lista → al limpiar, el cursor vuelve a la sesión seleccionada (no a la primera fila)', async () => {
    // LOAD-BEARING (CR-01 / D-16 / TUI-12): cubre el agujero que dejó pasar el bug en verde.
    // Los tests previos de D-16 solo ejercen el filtro que CONSERVA la fila seleccionada; este
    // ejerce el camino donde el filtro la oculta POR COMPLETO y luego se limpia. El bug vive en el
    // write-back useEffect de App (sel.taskId === null pisaba selectedTaskId), así que solo se
    // manifiesta a través del render real — un assert puro de resolveSelection no lo capturaría.
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse(FIXTURE);

    const { lastFrame, stdin } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    // Llevar la selección a KL-2 (la fila INFERIOR, NO la selección inicial KL-1) SIN usar teclas de
    // flecha: filtrar a un subconjunto que solo contiene KL-2 (repo 'foo') hace que el cursor caiga a
    // KL-2 por clamp (D-06), fijando selectedTaskId='b'. (Las secuencias de escape '\x1b[A/B' del fake
    // stdin de ink dejan un flush diferido que interfiere con el texto de filtro posterior; este
    // camino por filtro es equivalente y ejerce la misma identidad seleccionada.)
    stdin.write('/');
    await drain();
    stdin.write('r:foo');
    await drain();
    await drain();
    assert.match(lastFrame(), /›.*KL-2/, `precondición: filtrar a repo foo deja el cursor en KL-2\n${lastFrame()}`);
    assert.doesNotMatch(lastFrame(), /KL-1/, `precondición: r:foo oculta KL-1\n${lastFrame()}`);

    // Extender la query a 'r:foozzz' → no matchea NINGUNA fila → lista filtrada vacía → "no sessions match".
    stdin.write('zzz');
    await drain();
    await drain();
    assert.match(lastFrame(), /no sessions match/, `precondición: el filtro sin match debe vaciar la lista\n${lastFrame()}`);

    // Esc → cancela el filtro: la lista completa vuelve. El cursor debe RE-ENCONTRAR KL-2 por
    // identidad — NO saltar a KL-1 (la primera fila). Sin el fix de CR-01, selectedTaskId fue
    // pisado a null mientras la lista estaba vacía y el cursor cae a KL-1 (fallo).
    stdin.write('\x1b');
    await drain();
    await drain();
    assert.match(lastFrame(), /KL-2/, `tras limpiar el filtro KL-2 debe estar visible de nuevo\n${lastFrame()}`);
    assert.match(
      lastFrame(),
      /›.*KL-2/,
      `CR-01/D-16: el cursor debe VOLVER a la sesión seleccionada (KL-2), no saltar a la primera fila\n${lastFrame()}`,
    );
    assert.doesNotMatch(
      lastFrame(),
      /›.*KL-1/,
      `CR-01: el cursor NO debe haber saltado a KL-1 (identidad destruida por el write-back)\n${lastFrame()}`,
    );
  });

  it('no-match (D-12b): un filtro sin coincidencias muestra "no sessions match", no "no active sessions"', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse(FIXTURE);

    const { lastFrame, stdin } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    stdin.write('/');
    await drain();
    stdin.write('r:zzzznomatch');
    await drain();

    assert.match(lastFrame(), /no sessions match/, `un filtro sin match debe mostrar "no sessions match" (D-12b)\n${lastFrame()}`);
    assert.doesNotMatch(
      lastFrame(),
      /no active sessions/,
      `hay sesiones reales (las oculta el filtro) → NO debe decir "no active sessions"\n${lastFrame()}`,
    );
  });

  it('Esc en modo LISTA es ignorado (D-15): no sale de la app ni abre la línea de filtro', async () => {
    const clock = makeFakeClock();
    const fetchFn = async () => okResponse(FIXTURE);

    const { lastFrame, stdin } = render(createElement(App, injectProps(clock, fetchFn)));
    await drain();

    // Esc en modo lista (sin filtro abierto): deliberadamente NO-OP (reservado Phase 38, D-15).
    stdin.write('\x1b');
    await drain();

    const frame = lastFrame();
    assert.match(frame, /KL-1/, `tras Esc en lista la tabla sigue montada (App no se desmonta)\n${frame}`);
    assert.doesNotMatch(frame, /▏/, `Esc en lista NO debe abrir una línea de filtro (cursor ▏)\n${frame}`);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Phase 38 Plan 03 (TUI-19 / SC#3): render multi-estado — badges, filtros
// s:<state> + s:active, countsLabel extendido.
//
// Tests PURE-FUNCTION (sin render ink): ejercen las unidades de format.js y
// select.js directamente. RED hasta Task 2/3.
// ─────────────────────────────────────────────────────────────────────────────

describe('Phase 38 SC#3: stateBadge + STATE_BADGES (badges literal-stable D-06)', () => {
  it('badge running → ▶ green', () => {
    assert.deepEqual(stateBadge('running'), { glyph: '▶', color: 'green', label: 'running' });
  });
  it('badge idle → ⏸ yellow', () => {
    assert.deepEqual(stateBadge('idle'), { glyph: '⏸', color: 'yellow', label: 'idle' });
  });
  it('badge needs-input → 🔔 cyan', () => {
    assert.deepEqual(stateBadge('needs-input'), { glyph: '🔔', color: 'cyan', label: 'needs-input' });
  });
  it('badge dead → ✗ red', () => {
    assert.deepEqual(stateBadge('dead'), { glyph: '✗', color: 'red', label: 'dead' });
  });
  it("'closed' NO se renderiza en sessions list → {} (D-06)", () => {
    assert.deepEqual(stateBadge('closed'), {});
  });
  it('estado desconocido → {} (no rompe el render)', () => {
    assert.deepEqual(stateBadge('review'), {});
    assert.deepEqual(stateBadge(''), {});
    assert.deepEqual(stateBadge(undefined), {});
  });
  it('STATE_BADGES es literal-stable (byte-determinismo de la UX)', () => {
    assert.deepEqual(STATE_BADGES, {
      running: { glyph: '▶', color: 'green', label: 'running' },
      idle: { glyph: '⏸', color: 'yellow', label: 'idle' },
      'needs-input': { glyph: '🔔', color: 'cyan', label: 'needs-input' },
      dead: { glyph: '✗', color: 'red', label: 'dead' },
    });
  });
});

describe('Phase 38 SC#3: filtros s:<state> + s:active (D-06)', () => {
  // Fixtures: 1 running + 1 idle + 1 needs-input + 1 dead (campo `state` de v3).
  const rows = [
    { task_id: 'a', task_ref: 'KL-1', state: 'running', project_name: 'kodo' },
    { task_id: 'b', task_ref: 'KL-2', state: 'idle', project_name: 'kodo' },
    { task_id: 'c', task_ref: 'KL-3', state: 'needs-input', project_name: 'kodo' },
    { task_id: 'd', task_ref: 'KL-4', state: 'dead', project_name: 'kodo' },
  ];
  const repo = (s) => s.project_name ?? '';

  it("s:idle matchea SOLO state === 'idle'", () => {
    const out = applyFilter(rows, parseFilter('s:idle'), repo);
    assert.deepEqual(out.map((r) => r.task_id), ['b']);
  });
  it("s:needs-input matchea SOLO 'needs-input'", () => {
    const out = applyFilter(rows, parseFilter('s:needs-input'), repo);
    assert.deepEqual(out.map((r) => r.task_id), ['c']);
  });
  it("s:dead matchea SOLO 'dead'", () => {
    const out = applyFilter(rows, parseFilter('s:dead'), repo);
    assert.deepEqual(out.map((r) => r.task_id), ['d']);
  });
  it("s:active matchea running+idle+needs-input, excluye dead (alias OR D-06)", () => {
    const out = applyFilter(rows, parseFilter('s:active'), repo);
    assert.deepEqual(out.map((r) => r.task_id), ['a', 'b', 'c']);
  });
  it('s:running sigue matcheando running (Phase 36 retrocompat)', () => {
    const out = applyFilter(rows, parseFilter('s:running'), repo);
    assert.deepEqual(out.map((r) => r.task_id), ['a']);
  });
  it('no-match: s:zzzz retorna [] (no rompe el render)', () => {
    const out = applyFilter(rows, parseFilter('s:zzzz'), repo);
    assert.deepEqual(out, []);
  });
});

describe('Phase 38 SC#3: countsLabel extendido (idle/needs-input/dead)', () => {
  it('incluye los 4 estados nuevos separados por ·, orden running→idle→needs-input→dead', () => {
    const label = countsLabel({ running: 2, zombie: 0, review: 0, error: 0, done: 0, idle: 1, 'needs-input': 1, dead: 1 });
    assert.match(label, /2 running/);
    assert.match(label, /1 idle/);
    assert.match(label, /1 needs-input/);
    assert.match(label, /1 dead/);
    // orden: running antes que idle antes que needs-input antes que dead
    assert.ok(label.indexOf('running') < label.indexOf('idle'));
    assert.ok(label.indexOf('idle') < label.indexOf('needs-input'));
    assert.ok(label.indexOf('needs-input') < label.indexOf('dead'));
  });
  it('counts en 0 NO aparecen en el label', () => {
    const label = countsLabel({ running: 1, zombie: 0, review: 0, error: 0, done: 0, idle: 0, 'needs-input': 0, dead: 0 });
    assert.doesNotMatch(label, /idle/);
    assert.doesNotMatch(label, /needs-input/);
    assert.doesNotMatch(label, /dead/);
  });
});

// ── TUI-15 / D-07 / D-08: overlay 'unsupported' (provider sin listComments) ──────────────────
//
// El server señala `supported:false` en /comments/ cuando el provider no implementa listComments.
// El overlay DEBE pintar OVERLAY_COMMENTS_UNSUPPORTED (estado permanente), DISTINTO de
// OVERLAY_COMMENTS_EMPTY (sin comentarios aún, transitorio). El mensaje es legible bajo NO_COLOR
// (redundancia textual: la distinción NO depende del color). Reusa el harness fake-clock + drain
// de este archivo; el fetchFn enruta /status (poll) vs /comments/ (overlay).
describe("TUI-15: overlay 'unsupported' — supported:false → mensaje distinto de empty (D-07/D-08)", () => {
  it('OVERLAY_COMMENTS_UNSUPPORTED es byte-estable y distinto de OVERLAY_COMMENTS_EMPTY', () => {
    assert.equal(OVERLAY_COMMENTS_UNSUPPORTED, 'comments not supported by this provider');
    assert.notEqual(OVERLAY_COMMENTS_UNSUPPORTED, OVERLAY_COMMENTS_EMPTY);
  });

  it('c con supported:false pinta el copy unsupported y NO el copy empty', async () => {
    const clock = makeFakeClock();
    // Router: /status devuelve el FIXTURE (lo consume el poll); /comments/ devuelve la shape
    // del server tras Task 1: { comments: [], supported: false }.
    const fetchFn = async (url) => {
      const u = String(url);
      if (u.includes('/comments/')) return okResponse({ comments: [], supported: false });
      return okResponse(FIXTURE);
    };
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('c');
      await drain();
      const frame = lastFrame();
      assert.match(
        frame,
        new RegExp(OVERLAY_COMMENTS_UNSUPPORTED),
        `supported:false → ${OVERLAY_COMMENTS_UNSUPPORTED}\n${frame}`,
      );
      // CRÍTICO: NO debe mostrar el mensaje de "sin comentarios aún" (sería indistinguible).
      assert.doesNotMatch(
        frame,
        new RegExp(OVERLAY_COMMENTS_EMPTY),
        `unsupported NO debe colapsar a empty\n${frame}`,
      );
    } finally {
      unmount();
    }
  });

  it('c con supported:true + comments vacíos sigue pintando empty (sin regresión)', async () => {
    const clock = makeFakeClock();
    const fetchFn = async (url) => {
      const u = String(url);
      if (u.includes('/comments/')) return okResponse({ comments: [], supported: true });
      return okResponse(FIXTURE);
    };
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('c');
      await drain();
      const frame = lastFrame();
      assert.match(
        frame,
        new RegExp(OVERLAY_COMMENTS_EMPTY),
        `supported:true + vacío → ${OVERLAY_COMMENTS_EMPTY}\n${frame}`,
      );
      assert.doesNotMatch(
        frame,
        new RegExp(OVERLAY_COMMENTS_UNSUPPORTED),
        `vacío NO debe mostrar el copy unsupported\n${frame}`,
      );
    } finally {
      unmount();
    }
  });
});
