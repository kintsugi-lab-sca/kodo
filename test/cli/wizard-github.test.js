// @ts-check
//
// test/cli/wizard-github.test.js — Wave 0 scaffold (Plan 26-01).
//
// Cubre CFG-01: wizard branch `provider: github` (D-01..D-06) via DI scripted-readline.
//
// Pattern: scripted-readline DI sin monkeypatch global (RESEARCH §Example 1).
// `configureGithubProvider({ ask, execGitRemote, providerConfig })` exportado desde
// `src/cli/polling.js` muta `providerConfig` in-place — los tests verifican el shape final.
//
// Casos:
//   1. happy path: auto-detect + confirm + save
//   2. rejects invalid repo (no slash) → re-prompts (Pitfall #9 NO recursión)
//   3. manual entry succeeds after rejecting auto-detect
//   4. rejects auto-detected repo, add manual one
//   5. token NEVER persisted to providerConfig (T-26-01 / D-02 security)
//   6. detectOriginRepo fail-open when execGitRemote throws (Pitfall #6)
//
// Plan 26-01 / Task 1 — RED state esperado hasta Task 2 GREEN.
//

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { configureGithubProvider } from '../../src/cli/polling.js';

/**
 * Construye un `ask` scriptado: cada llamada consume la siguiente respuesta.
 * NOTA: NO hace trim() — el wizard branch debe trimear donde corresponda,
 * mirror del helper real declarado en `src/cli.js:351`
 * (`const ask = (q) => new Promise((resolve) => rl.question(q, resolve));`).
 *
 * @param {string[]} answers
 * @returns {(q: string) => Promise<string>}
 */
function scriptedAsk(answers) {
  let i = 0;
  return (_q) => Promise.resolve(answers[i++] ?? '');
}

describe('configureGithubProvider (wizard branch DI)', () => {
  it('happy path: auto-detect + confirm + save', async () => {
    const ask = scriptedAsk([
      '',          // env var: Enter accepts default GITHUB_TOKEN
      's',         // confirm auto-detected klab/kodo
      '',          // Enter terminates manual add loop
    ]);
    const execGitRemote = () => 'git@github.com:klab/kodo.git\n';
    /** @type {Record<string, any>} */
    const providerConfig = {};

    await configureGithubProvider({ ask, execGitRemote, providerConfig });

    assert.equal(providerConfig.api_key_env, 'GITHUB_TOKEN');
    assert.deepEqual(providerConfig.repos, [{ owner: 'klab', repo: 'kodo' }]);
    assert.equal(providerConfig.poll_interval, 60);
    assert.equal(providerConfig.mcp_hint, 'GitHub MCP server');
    assert.deepEqual(providerConfig.states, { review: 'closed' });
  });

  it('rejects invalid repo (no slash) → re-prompts (Pitfall #9 NO recursión)', async () => {
    const ask = scriptedAsk([
      '',              // env var default
      'n',             // reject auto-detect
      'invalidrepo',   // missing slash → retry (continue, NO recursión)
      'owner/repo',    // valid
      '',              // terminate
    ]);
    const execGitRemote = () => 'git@github.com:klab/kodo.git\n';
    /** @type {Record<string, any>} */
    const providerConfig = {};

    await configureGithubProvider({ ask, execGitRemote, providerConfig });

    assert.deepEqual(providerConfig.repos, [{ owner: 'owner', repo: 'repo' }]);
  });

  it('manual entry succeeds after rejecting auto-detect', async () => {
    const ask = scriptedAsk([
      '',
      'n',           // reject auto-detected
      'foo/bar',     // manual entry
      '',            // terminate
    ]);
    const execGitRemote = () => 'https://github.com/klab/kodo\n';
    /** @type {Record<string, any>} */
    const providerConfig = {};

    await configureGithubProvider({ ask, execGitRemote, providerConfig });

    assert.deepEqual(providerConfig.repos, [{ owner: 'foo', repo: 'bar' }]);
  });

  it('rejects auto-detected repo, then adds manual one', async () => {
    const ask = scriptedAsk([
      '',           // env var default
      'n',          // reject auto-detect
      'klab/other', // add manual repo (NOT the detected one)
      '',           // terminate
    ]);
    const execGitRemote = () => 'git@github.com:klab/kodo.git\n';
    /** @type {Record<string, any>} */
    const providerConfig = {};

    await configureGithubProvider({ ask, execGitRemote, providerConfig });

    assert.deepEqual(providerConfig.repos, [{ owner: 'klab', repo: 'other' }]);
    // Detected klab/kodo NOT added because user rejected.
    assert.equal(providerConfig.repos.some(/** @type {any} */ (r) => r.owner === 'klab' && r.repo === 'kodo'), false);
  });

  it('token never persisted to providerConfig (security T-26-01 / D-02)', async () => {
    // Hostile-paste scenario: usuario pega el VALUE del token en el prompt del env var name.
    // El wizard debe persistir el string tal cual (como api_key_env nombre) PERO el test
    // verifica que (a) no aparece como CLAVE en providerConfig, y (b) tokens reales
    // sembrados en process.env NUNCA se filtran al serialized config.
    const PLANTED = 'ghp_ABCDEF0123456789ABCDEF0123456789ABCD';
    const prevToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = PLANTED;
    try {
      const ask = scriptedAsk([
        '',         // env var default GITHUB_TOKEN
        '',         // skip auto-detect (empty exec)
      ]);
      const execGitRemote = () => '';
      /** @type {Record<string, any>} */
      const providerConfig = {};

      await configureGithubProvider({ ask, execGitRemote, providerConfig });

      const serialized = JSON.stringify(providerConfig);
      // VALUE planted en process.env nunca llega al provider config
      assert.equal(serialized.includes(PLANTED), false, 'token VALUE leaked');
      assert.equal(/ghp_|github_pat_/.test(serialized), false, 'token-shaped string leaked');
      // El NAME de la env var sí se persiste (eso es correcto)
      assert.equal(providerConfig.api_key_env, 'GITHUB_TOKEN');
      // PERO no debe haber una key llamada literalmente `GITHUB_TOKEN` con el value
      assert.equal('GITHUB_TOKEN' in providerConfig, false);
    } finally {
      if (prevToken === undefined) delete process.env.GITHUB_TOKEN;
      else process.env.GITHUB_TOKEN = prevToken;
    }
  });

  it('detectOriginRepo fail-open: wizard completes when execGitRemote throws (Pitfall #6)', async () => {
    const ask = scriptedAsk([
      '',           // env var default
      'owner/repo', // manual entry (no auto-detect prompt because detect returned null)
      '',           // terminate
    ]);
    const execGitRemote = () => { throw new Error('not a git repo'); };
    /** @type {Record<string, any>} */
    const providerConfig = {};

    // Must NOT throw — fail-open behaviour
    await configureGithubProvider({ ask, execGitRemote, providerConfig });
    assert.deepEqual(providerConfig.repos, [{ owner: 'owner', repo: 'repo' }]);
  });
});
