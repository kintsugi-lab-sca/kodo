// @ts-check
//
// test/dashboard/app-progress-adopted.test.js — Phase 61 (PROG-04).
//
// Progreso vivo para sesiones ADOPTADAS (sin worktree de kodo), con ink-testing-library.
// Verifica las dos decisiones del lector:
//   - D-1 (gate dinámico): el progreso se muestra si hay un STATE.md GSD legible en el path
//     resuelto, SIN depender del flag `gsd` persistido (la sesión adoptada del test NO lleva gsd:true).
//   - D-2 (fallback de path): sesión ADOPTADA (sin `.claude/worktrees/<sid>`) → lee
//     `<project_path>/.planning/STATE.md`; sesión LANZADA (con worktree) → lee del worktree
//     (regresión: NO debe leer el project_path en ese caso).

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { render } from 'ink-testing-library';
import { createElement } from 'react';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import App from '../../src/cli/dashboard/App.js';

const tick = () => new Promise((r) => setTimeout(r, 80));
const SID = 'adba1111-0000-0000-0000-000000000001';

function makeFetch(sessions) {
  return async () => ({
    ok: true,
    status: 200,
    json: async () => ({ sessions, count: sessions.length, pending: [] }),
  });
}

function baseSession(projectPath, overrides = {}) {
  return {
    task_id: 'T-1',
    task_ref: 'ROMAN-192',
    workspace_ref: 'workspace:1',
    status: 'running',
    alive: true,
    session_id: SID,
    project_name: 'optiai',
    project_path: projectPath,
    summary: 'adopted',
    started_at: new Date().toISOString(),
    ...overrides,
  };
}

function writeState(planningDir, total, completed) {
  mkdirSync(planningDir, { recursive: true });
  writeFileSync(
    join(planningDir, 'STATE.md'),
    `---\nprogress:\n  total_phases: ${total}\n  completed_phases: ${completed}\n---\n`,
  );
}

describe('Phase 61 (PROG-04): progreso vivo de sesiones adoptadas', () => {
  /** @type {string} */ let tmp;
  before(() => {
    tmp = mkdtempSync(join(tmpdir(), 'kodo-p61-'));
  });
  after(() => {
    rmSync(tmp, { recursive: true, force: true });
  });

  it('ADOPTADA sin worktree y SIN flag gsd: muestra N/M desde project_path (D-1 + D-2)', async () => {
    const proj = join(tmp, 'adopted');
    writeState(join(proj, '.planning'), 7, 3); // STATE.md en project_path, NO en .claude/worktrees
    const session = baseSession(proj); // NOTA: sin gsd:true → prueba el gate dinámico (D-1)
    const { lastFrame, unmount } = render(
      createElement(App, { baseUrl: 'http://x', fetchFn: makeFetch([session]) }),
    );
    try {
      await tick();
      assert.match(
        lastFrame(),
        /3\/7/,
        `una sesión adoptada con STATE.md en project_path debe mostrar 3/7 sin flag gsd.\n${lastFrame()}`,
      );
    } finally {
      unmount();
    }
  });

  it('LANZADA con worktree: lee del worktree, NO del project_path (D-2 regresión)', async () => {
    const proj = join(tmp, 'launched');
    writeState(join(proj, '.planning'), 9, 1); // valor "trampa" en project_path
    writeState(join(proj, '.claude', 'worktrees', SID, '.planning'), 9, 5); // valor real del worktree
    const session = baseSession(proj, { task_ref: 'KL-99' });
    const { lastFrame, unmount } = render(
      createElement(App, { baseUrl: 'http://x', fetchFn: makeFetch([session]) }),
    );
    try {
      await tick();
      assert.match(lastFrame(), /5\/9/, `debe leer el worktree (5/9), no project_path.\n${lastFrame()}`);
      assert.doesNotMatch(lastFrame(), /1\/9/, 'NO debe leer el STATE.md de project_path cuando hay worktree');
    } finally {
      unmount();
    }
  });

  it('SIN STATE.md en ningún path: no muestra progreso (—)', async () => {
    const proj = join(tmp, 'nogsd');
    mkdirSync(proj, { recursive: true }); // sin .planning
    const session = baseSession(proj, { task_ref: 'KL-7' });
    const { lastFrame, unmount } = render(
      createElement(App, { baseUrl: 'http://x', fetchFn: makeFetch([session]) }),
    );
    try {
      await tick();
      assert.doesNotMatch(lastFrame(), /\d+\/\d+/, `sin STATE.md no debe haber N/M.\n${lastFrame()}`);
    } finally {
      unmount();
    }
  });
});
