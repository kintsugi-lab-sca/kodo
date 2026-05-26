// @ts-check
//
// test/dashboard-non-tty.test.js — Phase 34 Wave 0 (TUI-02).
//
// Verifica que `kodo dashboard` rechaza un entorno NO-TTY (pipe/CI) con exit 1
// y el mensaje canónico D-04, en lugar de crashear con el "Raw mode is not
// supported" de ink. Análogo directo de test/version-smoke.test.js (mismo
// boilerplate de paths + spawnSync(bin/kodo)); a diferencia de aquel, aquí el
// stderr DEBE contener el mensaje (no estar vacío).
//
// Estado Wave 0: ROJO por diseño hasta que Plan 02 implemente el guard
// pre-render en `src/cli/dashboard/index.js` + registre el subcomando en
// `src/cli.js`. Hoy `kodo dashboard` no existe → el spawn no devuelve exit 1
// con este stderr exacto. La mordida llega cuando Plan 02 pone verde T-34-01.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const KODO_BIN = join(resolve(__dirname, '..'), 'bin', 'kodo');

// Mensaje canónico D-04 — string EXACTO que el guard pre-render emite por
// stderr. Implementado en dos líneas concatenadas para reflejar cómo Plan 02
// lo construirá (ver <interfaces> del PLAN.md y CONTEXT.md D-04).
const CANONICAL =
  'kodo dashboard requires an interactive terminal (TTY). ' +
  'Run it directly in your terminal, not in a pipe or CI.';

describe('TUI-02: kodo dashboard refuses non-TTY (D-04 / T-34-01)', () => {
  it('exits 1 with canonical stderr when stdout/stdin are not a TTY', () => {
    // Los tres pipes garantizan que ni stdin ni stdout ni stderr son TTY:
    // reproduce `kodo dashboard | cat` y el entorno de CI.
    const r = spawnSync(process.execPath, [KODO_BIN, 'dashboard'], {
      stdio: ['pipe', 'pipe', 'pipe'],
      encoding: 'utf-8',
      timeout: 10_000, // fail-fast si el bin cuelga (CI hygiene)
    });

    assert.equal(
      r.status,
      1,
      `expected exit 1, got ${r.status}\nstderr: ${r.stderr}\nstdout: ${r.stdout}`,
    );
    assert.match(
      r.stderr,
      /requires an interactive terminal \(TTY\)/,
      `stderr should warn about the TTY requirement\nstderr: ${r.stderr}`,
    );
    assert.equal(
      r.stderr.trim(),
      CANONICAL,
      `stderr should equal the canonical D-04 message exactly\n` +
        `expected: ${JSON.stringify(CANONICAL)}\n` +
        `actual:   ${JSON.stringify(r.stderr.trim())}`,
    );
  });
});
