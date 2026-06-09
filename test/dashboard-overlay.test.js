// @ts-check
//
// test/dashboard-overlay.test.js — Phase 39 Plan 02 Wave 0 (TUI-15/TUI-16; SC#1/SC#2/SC#3).
//
// Renderiza el componente `App` del dashboard con ink-testing-library y verifica los DOS overlays
// a pantalla completa sobre la fila seleccionada:
//   - `c` (TUI-15/SC#1): comentarios por task_id. 404 → "task not found"; vacío → "no comments yet";
//     error → "error fetching comments". Esc vuelve al MISMO cursor.
//   - `l` (TUI-16/SC#2): logs por grep substring (task_ref/workspace_ref). no-match → mensaje claro.
//     La ETIQUETA HONESTA (D-04/SC#3) "may include other sessions" es visible en el header.
//   - Snapshot congelado (D-05): un flushTick del poll con datos distintos NO cambia el contenido
//     del overlay (el poll sigue por debajo, el overlaySnapshot no se re-escribe).
//   - Sub-modo de scroll (D-06): Esc cierra y restaura mode:'list' con el cursor intacto.
//
// Harness hermético reusado VERBATIM de test/dashboard-table.test.js (makeFakeClock/injectProps/
// drain/okResponse). El fetchFn fake responde DISTINTO según la URL: `/status` → sesiones (lo
// consume el poll), `/comments/<id>` → comentarios de esa tarea, `/logs` → buffer compartido.
//
// DISCIPLINA: cada test que renderiza App captura el handle y llama `unmount()` en un `finally`
// (el fake clock intercepta el setTimeout de usePoll, pero unmount es el cinturón de seguridad
// contra cuelgues del runner — lección de fases recientes).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import App, {
  OVERLAY_COMMENTS_EMPTY,
  OVERLAY_COMMENTS_NOT_FOUND,
  OVERLAY_COMMENTS_ERROR,
  OVERLAY_LOGS_EMPTY,
  OVERLAY_LOGS_ERROR,
  OVERLAY_LOGS_LABEL,
  OVERLAY_PLAN_NO_PHASE,
  OVERLAY_PLAN_NO_PLAN,
} from '../src/cli/dashboard/App.js';

// ── Fake clock (idéntico a dashboard-table.test.js) ──────────────────────────
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

async function drain() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}

function okResponse(body) {
  return { ok: true, status: 200, json: async () => body };
}

function notFoundResponse() {
  return { ok: false, status: 404, json: async () => ({ error: 'task not found' }) };
}

function serverErrorResponse() {
  return { ok: false, status: 500, json: async () => ({ error: 'boom' }) };
}

// Fixture: KL-1 (task_id 'a', workspace_ref 'ws-a') es la fila seleccionada inicial (newest, arriba).
const STATUS_FIXTURE = {
  count: 2,
  sessions: [
    {
      task_id: 'a',
      task_ref: 'KL-1',
      workspace_ref: 'ws-a',
      status: 'running',
      alive: true,
      started_at: '2026-05-27T10:00:00Z',
      project_name: 'kodo',
      elapsed_min: 5,
      phase_id: '36',
      gsd_mode: 'full',
      summary: '',
    },
    {
      task_id: 'b',
      task_ref: 'KL-2',
      workspace_ref: 'ws-b',
      status: 'running',
      alive: false,
      started_at: '2026-05-27T09:00:00Z',
      project_path: '/x/foo',
      elapsed_min: 63,
      summary: '',
    },
  ],
};

/**
 * Construye un fetchFn que enruta por URL. `routes` mapea sufijos de path a una factory de Response.
 *  - '/status'          → STATUS_FIXTURE (lo consume el poll de usePoll).
 *  - '/comments/<id>'   → routes.comments (recibe el id decodificado).
 *  - '/logs'            → routes.logs.
 */
function makeRouter({ status = STATUS_FIXTURE, comments, logs } = {}) {
  return async (url) => {
    const u = String(url);
    if (u.endsWith('/status')) return okResponse(status);
    if (u.includes('/comments/')) {
      const id = decodeURIComponent(u.split('/comments/')[1]);
      if (typeof comments === 'function') return comments(id);
      return okResponse({ comments: comments ?? [] });
    }
    if (u.endsWith('/logs')) {
      if (typeof logs === 'function') return logs();
      return okResponse({ logs: logs ?? [] });
    }
    return okResponse(status);
  };
}

describe('TUI-15/SC#1: overlay de comentarios (c) — abre, copy por caso, Esc restaura cursor', () => {
  it('c abre el overlay de comentarios de la fila seleccionada (KL-1)', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter({
      comments: (id) =>
        okResponse({ comments: id === 'a' ? [{ body: 'looks good to me' }] : [] }),
    });
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('c');
      await drain();
      const frame = lastFrame();
      // El overlay debe mostrar el contenido del comentario o el task_ref de la fila.
      assert.match(frame, /looks good to me|KL-1/, `c debe abrir el overlay de comentarios de KL-1\n${frame}`);
    } finally {
      unmount();
    }
  });

  it('c sobre tarea 404 muestra OVERLAY_COMMENTS_NOT_FOUND', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter({ comments: () => notFoundResponse() });
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('c');
      await drain();
      assert.match(lastFrame(), new RegExp(OVERLAY_COMMENTS_NOT_FOUND), `404 → ${OVERLAY_COMMENTS_NOT_FOUND}\n${lastFrame()}`);
    } finally {
      unmount();
    }
  });

  it('c sin comentarios muestra OVERLAY_COMMENTS_EMPTY', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter({ comments: () => okResponse({ comments: [] }) });
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('c');
      await drain();
      assert.match(lastFrame(), new RegExp(OVERLAY_COMMENTS_EMPTY), `vacío → ${OVERLAY_COMMENTS_EMPTY}\n${lastFrame()}`);
    } finally {
      unmount();
    }
  });

  it('c con error 500 muestra OVERLAY_COMMENTS_ERROR', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter({ comments: () => serverErrorResponse() });
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('c');
      await drain();
      assert.match(lastFrame(), new RegExp(OVERLAY_COMMENTS_ERROR), `500 → ${OVERLAY_COMMENTS_ERROR}\n${lastFrame()}`);
    } finally {
      unmount();
    }
  });

  it('Esc cierra el overlay y vuelve a la tabla con el MISMO cursor (KL-1)', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter({ comments: () => okResponse({ comments: [{ body: 'hi' }] }) });
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('c');
      await drain();
      // En overlay NO debe verse la cabecera de columnas de la tabla.
      stdin.write('\x1b');
      await drain();
      const frame = lastFrame();
      // Vuelve a la tabla: el gutter sigue en KL-1 (cursor preservado, selectedTaskId intacto).
      assert.match(frame, /›.*KL-1/, `Esc debe restaurar la tabla con el cursor en KL-1\n${frame}`);
      assert.match(frame, /KL-2/, `Esc debe restaurar la tabla completa (KL-2 visible)\n${frame}`);
    } finally {
      unmount();
    }
  });
});

describe('TUI-16/SC#2/SC#3: overlay de logs (l) — grep substring, etiqueta honesta, no-match', () => {
  it('l abre el overlay de logs con la ETIQUETA HONESTA visible (D-04/SC#3)', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter({
      logs: () =>
        okResponse({
          logs: [
            { ts: '10:00', level: 'info', msg: 'KL-1 started build' },
            { ts: '10:01', level: 'info', msg: 'unrelated other session line' },
          ],
        }),
    });
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('l');
      await drain();
      const frame = lastFrame();
      assert.match(frame, new RegExp(OVERLAY_LOGS_LABEL.slice(0, 20)), `el overlay de logs debe llevar la etiqueta honesta\n${frame}`);
      assert.match(frame, /KL-1 started build/, `el overlay debe mostrar la línea de log que matchea KL-1\n${frame}`);
    } finally {
      unmount();
    }
  });

  it('l sin matches muestra OVERLAY_LOGS_EMPTY', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter({
      logs: () => okResponse({ logs: [{ ts: '10:00', level: 'info', msg: 'nothing relevant here' }] }),
    });
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('l');
      await drain();
      assert.match(lastFrame(), new RegExp(OVERLAY_LOGS_EMPTY), `no-match → ${OVERLAY_LOGS_EMPTY}\n${lastFrame()}`);
    } finally {
      unmount();
    }
  });

  it('l con error en /logs muestra OVERLAY_LOGS_ERROR', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter({ logs: () => serverErrorResponse() });
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('l');
      await drain();
      assert.match(lastFrame(), new RegExp(OVERLAY_LOGS_ERROR), `error /logs → ${OVERLAY_LOGS_ERROR}\n${lastFrame()}`);
    } finally {
      unmount();
    }
  });
});

describe('D-05: snapshot congelado — el poll sigue por debajo pero el overlay no salta', () => {
  it('un flushTick del poll con datos distintos NO cambia el contenido del overlay', async () => {
    const clock = makeFakeClock();
    let commentBody = 'first comment';
    const fetchFn = makeRouter({
      comments: () => okResponse({ comments: [{ body: commentBody }] }),
    });
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('c');
      await drain();
      assert.match(lastFrame(), /first comment/, `precondición: overlay muestra el comentario congelado\n${lastFrame()}`);

      // El poll sigue corriendo bajo el overlay; aunque cambien los datos, el snapshot no se re-escribe.
      commentBody = 'CHANGED under the reader';
      await clock.flushTick();
      await drain();
      const frame = lastFrame();
      assert.match(frame, /first comment/, `el overlay debe seguir mostrando el snapshot congelado\n${frame}`);
      assert.doesNotMatch(frame, /CHANGED under the reader/, `el snapshot NO debe re-escribirse por el poll (D-05)\n${frame}`);
    } finally {
      unmount();
    }
  });
});

describe('D-06/WR-01: scroll del overlay (↑/↓) y clamp del viewport', () => {
  // 20 comentarios (line-00..line-19) con OVERLAY_VIEWPORT=18 → max scrollOffset correcto = 2.
  // Con el clamp viejo (lines.length - 1 = 19) el spam de ↓ dejaría solo la última línea visible.
  function manyComments() {
    return Array.from({ length: 20 }, (_, i) => ({ body: `line-${String(i).padStart(2, '0')}` }));
  }

  it('↓ scrollea el viewport y el clamp deja la ÚLTIMA pantalla llena (no una sola línea)', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter({ comments: () => okResponse({ comments: manyComments() }) });
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('c');
      await drain();
      const initial = lastFrame();
      assert.match(initial, /line-00/, `al abrir (offset 0) la primera línea visible es line-00\n${initial}`);
      assert.doesNotMatch(initial, /line-19/, `al abrir, line-19 cae fuera del viewport de 18\n${initial}`);

      // Spam de ↓ (más allá del fondo): el clamp WR-01 detiene scrollOffset en lines.length - VIEWPORT.
      for (let i = 0; i < 10; i++) {
        stdin.write('\x1b[B');
        await drain();
      }
      const scrolled = lastFrame();
      assert.match(scrolled, /line-19/, `tras bajar al fondo, la última línea (line-19) es visible\n${scrolled}`);
      // CLAVE WR-01: con el viewport lleno, line-02 sigue visible (offset clampado a 2). Con el bug
      // viejo (offset hasta 19) solo se vería line-19 y este assert fallaría.
      assert.match(scrolled, /line-02/, `WR-01: el clamp deja el viewport LLENO — line-02 sigue visible\n${scrolled}`);
      assert.doesNotMatch(scrolled, /line-00/, `tras scrollear, line-00 ya salió del viewport\n${scrolled}`);
    } finally {
      unmount();
    }
  });

  it('↑ revierte el scroll y el clamp inferior se detiene en offset 0', async () => {
    const clock = makeFakeClock();
    const fetchFn = makeRouter({ comments: () => okResponse({ comments: manyComments() }) });
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('c');
      await drain();
      for (let i = 0; i < 5; i++) {
        stdin.write('\x1b[B');
        await drain();
      }
      assert.doesNotMatch(lastFrame(), /line-00/, `precondición: tras ↓ line-00 no es visible\n${lastFrame()}`);
      // Spam de ↑ más allá del tope: vuelve a offset 0 sin pasarse (clamp en 0).
      for (let i = 0; i < 10; i++) {
        stdin.write('\x1b[A');
        await drain();
      }
      const frame = lastFrame();
      assert.match(frame, /line-00/, `tras ↑ el viewport vuelve al inicio (line-00 visible)\n${frame}`);
      assert.doesNotMatch(frame, /line-19/, `de vuelta arriba, line-19 sale del viewport\n${frame}`);
    } finally {
      unmount();
    }
  });
});

describe('CR-01: handlers async de overlay no reabren contenido obsoleto', () => {
  it('dos `c` encolados con latencia → gana el ÚLTIMO pedido, el primero no sobrescribe', async () => {
    const clock = makeFakeClock();
    /** @type {Array<() => void>} */
    const resolvers = [];
    let callIdx = 0;
    const fetchFn = async (/** @type {string} */ url) => {
      const u = String(url);
      if (u.endsWith('/status')) return okResponse(STATUS_FIXTURE);
      if (u.includes('/comments/')) {
        const which = callIdx++;
        // Promise controlada manualmente: la resolvemos en orden inverso para forzar la race.
        return new Promise((resolve) => {
          resolvers[which] = () =>
            resolve(okResponse({ comments: [{ body: which === 0 ? 'FIRST payload' : 'SECOND payload' }] }));
        });
      }
      if (u.endsWith('/logs')) return okResponse({ logs: [] });
      return okResponse(STATUS_FIXTURE);
    };
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      // Dos `c` mientras mode sigue 'list' (ninguna request resolvió aún): handler1 reqId=1, handler2 reqId=2.
      stdin.write('c');
      await drain();
      stdin.write('c');
      await drain();
      // Resolvemos PRIMERO el segundo pedido (gana, reqId vigente), luego el primero (obsoleto → descartado).
      resolvers[1]();
      await drain();
      resolvers[0]();
      await drain();
      const frame = lastFrame();
      assert.match(frame, /SECOND payload/, `el overlay debe mostrar el último pedido\n${frame}`);
      assert.doesNotMatch(frame, /FIRST payload/, `CR-01: el handler obsoleto no debe sobrescribir el overlay\n${frame}`);
    } finally {
      unmount();
    }
  });
});

// ── Phase 44 (PLAN-01/PLAN-02): overlay de plan GSD (`p`) ─────────────────────
// El overlay de plan lee el filesystem REAL via readPlan (sync, never-throws). Para
// ejercitar el `p` open con contenido honesto se monta un árbol `.planning/phases/`
// temporal y se apunta la fila seleccionada (KL-1) a él via project_path. Los casos
// no-phase / no-plan no necesitan disco: se prueban con filas que no resuelven a una fase.

/**
 * Construye un STATUS_FIXTURE con la fila seleccionada (KL-1, task_id 'a') apuntando a
 * `projectPath` y opcionalmente con phase_id. La segunda fila (KL-2) es estática.
 */
function planStatus({ phase_id, project_path } = {}) {
  return {
    count: 2,
    sessions: [
      {
        task_id: 'a',
        task_ref: 'KL-1',
        workspace_ref: 'ws-a',
        status: 'running',
        alive: true,
        started_at: '2026-05-27T10:00:00Z',
        project_name: 'kodo',
        elapsed_min: 5,
        ...(phase_id != null ? { phase_id } : {}),
        ...(project_path != null ? { project_path } : {}),
        summary: '',
      },
      {
        task_id: 'b',
        task_ref: 'KL-2',
        workspace_ref: 'ws-b',
        status: 'running',
        alive: false,
        started_at: '2026-05-27T09:00:00Z',
        elapsed_min: 63,
        summary: '',
      },
    ],
  };
}

describe('PLAN-01/PLAN-02: overlay de plan (p) — abre, copy honesto por caso, Esc restaura cursor', () => {
  it('p abre el overlay leyendo el/los PLAN.md de la fase (status ok)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'kodo-plan-'));
    try {
      const phaseDir = join(tmp, '.planning', 'phases', '44-overlay');
      mkdirSync(phaseDir, { recursive: true });
      writeFileSync(join(phaseDir, '44-01-PLAN.md'), 'OBJECTIVE: build the plan overlay\n');
      const clock = makeFakeClock();
      const fetchFn = makeRouter({ status: planStatus({ phase_id: '44', project_path: tmp }) });
      const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
      try {
        await drain();
        stdin.write('p');
        await drain();
        const frame = lastFrame();
        assert.match(frame, /plan · KL-1/, `p debe abrir el overlay de plan de KL-1\n${frame}`);
        assert.match(frame, /build the plan overlay/, `el overlay debe mostrar el contenido del PLAN.md\n${frame}`);
      } finally {
        unmount();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('p sobre fila sin phase_id ni .planning resoluble → OVERLAY_PLAN_NO_PHASE (dim, honesto)', async () => {
    const clock = makeFakeClock();
    // Fila sin phase_id y sin project_path/worktree_path → readPlan colapsa a no-phase.
    const fetchFn = makeRouter({ status: planStatus({}) });
    const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
    try {
      await drain();
      stdin.write('p');
      await drain();
      assert.match(lastFrame(), new RegExp(OVERLAY_PLAN_NO_PHASE), `no-phase → ${OVERLAY_PLAN_NO_PHASE}\n${lastFrame()}`);
    } finally {
      unmount();
    }
  });

  it('p sobre fase resuelta pero SIN PLAN.md → OVERLAY_PLAN_NO_PLAN (DISTINTO de no-phase)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'kodo-plan-'));
    try {
      // Existe el dir de fase pero sin ningún *-PLAN.md dentro.
      const phaseDir = join(tmp, '.planning', 'phases', '44-overlay');
      mkdirSync(phaseDir, { recursive: true });
      writeFileSync(join(phaseDir, '44-CONTEXT.md'), 'just context\n');
      const clock = makeFakeClock();
      const fetchFn = makeRouter({ status: planStatus({ phase_id: '44', project_path: tmp }) });
      const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
      try {
        await drain();
        stdin.write('p');
        await drain();
        const frame = lastFrame();
        assert.match(frame, new RegExp(OVERLAY_PLAN_NO_PLAN), `no-plan → ${OVERLAY_PLAN_NO_PLAN}\n${frame}`);
        assert.doesNotMatch(frame, new RegExp(OVERLAY_PLAN_NO_PHASE), `no-plan debe ser DISTINTO de no-phase\n${frame}`);
      } finally {
        unmount();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });

  it('Esc cierra el overlay de plan y restaura la tabla con el MISMO cursor (KL-1)', async () => {
    const tmp = mkdtempSync(join(tmpdir(), 'kodo-plan-'));
    try {
      const phaseDir = join(tmp, '.planning', 'phases', '44-overlay');
      mkdirSync(phaseDir, { recursive: true });
      writeFileSync(join(phaseDir, '44-01-PLAN.md'), 'plan body\n');
      const clock = makeFakeClock();
      const fetchFn = makeRouter({ status: planStatus({ phase_id: '44', project_path: tmp }) });
      const { lastFrame, stdin, unmount } = render(createElement(App, injectProps(clock, fetchFn)));
      try {
        await drain();
        stdin.write('p');
        await drain();
        stdin.write('\x1b');
        await drain();
        const frame = lastFrame();
        assert.match(frame, /›.*KL-1/, `Esc debe restaurar la tabla con el cursor en KL-1\n${frame}`);
        assert.match(frame, /KL-2/, `Esc debe restaurar la tabla completa (KL-2 visible)\n${frame}`);
      } finally {
        unmount();
      }
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  });
});
