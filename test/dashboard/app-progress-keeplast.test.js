// @ts-check
//
// test/dashboard/app-progress-keeplast.test.js — F5 (DEBT-02 escenario 2).
//
// Reproduce el keep-last-good del progreso vivo (Phase 50 PROG-03 / D-09) A NIVEL
// DE COMPONENTE con ink-testing-library — lo que los unit tests de la lógica pura
// (deriveAnyProgress / el enrich aislado) NO cubren: el lifecycle React del lastGood
// (useRef) a través de re-renders.
//
// Escenario (DEBT-02 esc.2): una sesión gsd:true con STATE.md poblado muestra `N/M`;
// al volverse el STATE.md ilegible/corrupto (fallo TRANSITORIO → readGsdProgress
// 'error', NO ENOENT), la columna DEBE mantener el último `N/M` conocido (keep-last-good),
// no caer a '—'/'?'. El bug F5 (hallado en HUMAN-UAT 2026-06-23) era que la columna
// desaparecía. Usamos contenido corrupto (sin frontmatter → 'error') en vez de chmod
// para no depender de permisos (root puede leer 000).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import App from '../../src/cli/dashboard/App.js';

const tick = () => new Promise((r) => setTimeout(r, 80));
const SID = 'f5f5f5f5-0000-0000-0000-000000000001';

function makeFetch(sessions) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ sessions, count: sessions.length, pending: [] }),
  });
}

function gsdSession(projectPath) {
  return {
    task_id: 'T-1',
    task_ref: 'ROMAN-175',
    workspace_ref: 'workspace:1',
    status: 'running',
    alive: true,
    gsd: true, // gate del enrich (App.js: row.gsd !== true → no-progress)
    session_id: SID, // computeRealWorktreePath(project_path, session_id)
    project_name: 'optiai',
    project_path: projectPath,
    summary: 'test',
    started_at: new Date().toISOString(),
  };
}

describe('F5: keep-last-good del progreso vivo (DEBT-02 esc.2)', () => {
  /** @type {string} */ let tmp;
  /** @type {string} */ let statePath;

  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'kodo-f5-'));
    const planning = join(tmp, '.claude', 'worktrees', SID, '.planning');
    mkdirSync(planning, { recursive: true });
    statePath = join(planning, 'STATE.md');
    writeFileSync(statePath, '---\nprogress:\n  total_phases: 7\n  completed_phases: 3\n---\n');
  });

  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('mantiene N/M ante un fallo transitorio de lectura (no cae la columna)', async () => {
    const fetchFn = makeFetch([gsdSession(tmp)]);
    const el = () => createElement(App, { baseUrl: 'http://x', fetchFn });
    const { lastFrame, rerender, unmount } = render(el());
    try {
      await tick(); // primer poll + enrich → STATE.md legible → 3/7
      assert.match(
        lastFrame(),
        /3\/7/,
        `precondición: con STATE.md legible la columna prog debe mostrar 3/7.\nframe:\n${lastFrame()}`,
      );

      // Fallo TRANSITORIO: STATE.md corrupto (sin frontmatter) → readGsdProgress 'error'.
      writeFileSync(statePath, 'contenido corrupto sin frontmatter\n');
      rerender(el()); // re-render del MISMO instance → enrich re-lee → keep-last-good
      await tick();

      assert.match(
        lastFrame(),
        /3\/7/,
        `F5: keep-last-good debe MANTENER 3/7 ante un fallo transitorio; en su lugar la columna cayó.\nframe:\n${lastFrame()}`,
      );
    } finally {
      unmount();
    }
  });
});
