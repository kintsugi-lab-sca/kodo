// test/host/cmux-stderr-capture.test.js
// Phase 66 Plan 06 (gap-closure) — el stderr del binario cmux NUNCA debe filtrarse
// al stdout/stderr del daemon del kodo.
//
// Root cause (verificado): el wrapper `makeRun` de src/host/cmux.js invoca el binario
// cmux vía execFileSync SIN especificar `stdio`. Node documenta que execFileSync
// HEREDA stderr al padre por defecto. Bajo `brew services`/launchd (headless, sin
// sesión GUI de cmux) la CLI de cmux imprime "Failed to write to socket (Broken pipe,
// errno 32)" a SU stderr cada tick del reconcile loop; al heredarse, ese chatter se
// escribía directo al kodo.log del daemon (~1/seg). El wrapper ya es fail-open
// (never-throws, T-55-01), pero el stderr del child ya se había escrito al fd heredado.
//
// El fix: makeRun pasa `stdio: ['ignore', 'pipe', 'pipe']` para CAPTURAR el stderr del
// child (queda en err.stderr, que el fail-open traga) en lugar de heredarlo.
//
// Mirror de los patrones de DI de test/host/*.test.js: el execFileSync es inyectable
// vía opts.execSync (createCmuxHost).
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createCmuxHost } from '../../src/host/cmux.js';

/** Extrae el modo del fd stderr de las options de execFileSync (stdio[2] o string global). */
function stderrMode(options) {
  const s = options?.stdio;
  if (Array.isArray(s)) return s[2];
  return s; // string aplica a los 3 fds; undefined = default de execFileSync
}

/**
 * Fake execSync que REPRODUCE fielmente el default documentado de execFileSync: si
 * `stdio` NO captura stderr explícitamente (undefined default o 'inherit'), el stderr
 * del child se HEREDA → lo escribimos a process.stderr para simular el leak real.
 * Si stderr está capturado ('pipe'/'ignore'), queda en err.stderr y NO se escribe.
 * Siempre lanza (exit ≠ 0) con `.stderr` = el chatter de cmux, como haría execFileSync.
 */
function makeFakeExecSyncInheritsByDefault(cmuxStderr) {
  return (_binary, _args, options) => {
    const mode = stderrMode(options);
    const captured = mode === 'pipe' || mode === 'ignore';
    if (!captured) {
      // Simula el inherit-por-defecto de execFileSync: el stderr del child va al padre.
      process.stderr.write(cmuxStderr);
    }
    const err = new Error('Command failed');
    err.status = 1;
    err.stderr = cmuxStderr;
    throw err;
  };
}

describe('Phase 66-06: el stderr del binario cmux nunca se hereda al daemon', () => {
  test('makeRun invoca execFileSync con stderr CAPTURADO (stdio pipe), no heredado', async () => {
    const calls = [];
    const fakeExecSync = (_binary, args, options) => {
      calls.push({ args, options });
      const argv = (args || []).join(' ');
      if (argv.includes('workspace list')) return JSON.stringify({ workspaces: [] });
      if (argv.includes('notification.list')) return JSON.stringify({ notifications: [] });
      return '{}';
    };
    const host = createCmuxHost({ execSync: fakeExecSync, binary: '/fake/cmux' });
    await host.listWorkspaces();

    assert.ok(calls.length >= 2, 'listWorkspaces invoca el binario cmux al menos 2 veces');
    for (const c of calls) {
      const mode = stderrMode(c.options);
      assert.equal(
        mode,
        'pipe',
        `stderr debe capturarse ('pipe'), no heredarse (recibido: ${JSON.stringify(mode)})`,
      );
    }
  });

  test('cmux falla con "Broken pipe" → fail-open ([]) y stderr JAMÁS llega al daemon', async () => {
    const cmuxStderr = 'Error: Failed to write to socket (Broken pipe, errno 32)\n';
    const seen = [];
    const origWrite = process.stderr.write.bind(process.stderr);
    // Espía sobre process.stderr.write: registra lo escrito y lo traga en el test.
    process.stderr.write = (chunk) => {
      seen.push(String(chunk));
      return true;
    };
    let res;
    try {
      const host = createCmuxHost({
        execSync: makeFakeExecSyncInheritsByDefault(cmuxStderr),
        binary: '/fake/cmux',
      });
      await assert.doesNotReject(async () => {
        res = await host.listWorkspaces();
      });
    } finally {
      process.stderr.write = origWrite;
    }

    assert.deepEqual(res, [], 'fail-open: sin workspaces cuando el binario cmux falla');
    assert.ok(
      !seen.some((s) => s.includes('Failed to write to socket')),
      'el stderr del child cmux NUNCA debe escribirse al stderr del daemon (leak fixed)',
    );
  });
});
