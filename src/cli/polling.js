// @ts-check
//
// src/cli/polling.js — Phase 26 Plan 26-01 first drop.
//
// Exports (Plan 26-01 — wizard + parser helpers ONLY):
//   - parseGitHubRemote(url) — pure regex parser para 3 URL formats github (SSH, HTTPS, HTTPS.git)
//   - detectOriginRepo(exec?) — auto-detect del git remote origin, fail-open ante errores
//   - configureGithubProvider({ ask, execGitRemote?, providerConfig }) — wizard branch DI-zable
//
// Los handlers CLI del daemon (`runPollingStartCli`, `runPollingStopCli`,
// `runPollingStatusCli`) van en Plan 26-02. Este archivo es el primer drop.
//
// Color isolation (D-20 / Pattern A invariante v0.5): NO importar `picocolors` aquí.
// Si se requiere output coloreado, el caller usa `createFormatter` desde `./format.js`.
// Este módulo es pure logic + DI — no escribe a stdout directamente.
//

import { execSync } from 'node:child_process';

/**
 * Parsea una URL de remote git de GitHub a `{owner, repo}`.
 *
 * Soporta los 3 formatos comunes:
 *   1. `git@github.com:owner/repo.git`     (SSH)
 *   2. `https://github.com/owner/repo`     (HTTPS sin .git)
 *   3. `https://github.com/owner/repo.git` (HTTPS con .git)
 *
 * Retorna `null` para hostnames no-github (gitlab, enterprise.github.com), URLs vacías,
 * o cualquier string que no matchee. El caller decide UX (skip auto-detect → manual prompt).
 *
 * Regex anchored en `github.com[:/]` para mitigar T-26-INJ (URLs maliciosas):
 *   - `[^/]+` para owner — no permite `/` dentro del owner.
 *   - `[^/.\s]+?` para repo — lazy, no permite `/`, `.`, ni whitespace.
 *   - `(?:\.git)?` opcional — strip si presente.
 *   - `(?:\/|\s|$)` lookahead — debe terminar al final, en whitespace, o en otro `/`.
 *
 * @param {string} url
 * @returns {{ owner: string, repo: string } | null}
 */
export function parseGitHubRemote(url) {
  const match = url.match(/github\.com[:/]([^/]+)\/([^/.\s]+?)(?:\.git)?(?:\/|\s|$)/);
  if (!match) return null;
  return { owner: match[1], repo: match[2] };
}

/**
 * Intenta auto-detectar el repo desde `git remote get-url origin` en el cwd actual.
 *
 * Retorna `null` si:
 *   - cwd no es un repo git, o
 *   - no hay remote `origin`, o
 *   - git no está instalado, o
 *   - el remote no es github.com (gitlab, enterprise, etc.)
 *
 * Pitfall #6 — fail-open: cualquier throw de `execSync` se traga y devuelve `null`.
 * El caller cae al manual prompt sin crash.
 *
 * Seguridad (T-26-SHELL): `execSync` se invoca con una string literal SIN args
 * controlados por el operador — no hay shell interpolation. `stdio: ['ignore','pipe','ignore']`
 * silencia stderr para evitar leaks accidentales.
 *
 * @param {() => string} [exec] — injectable para tests
 * @returns {{ owner: string, repo: string } | null}
 */
export function detectOriginRepo(exec) {
  const e = exec || (() => execSync('git remote get-url origin',
    { stdio: ['ignore', 'pipe', 'ignore'] }).toString());
  try {
    return parseGitHubRemote(e().trim());
  } catch {
    return null;
  }
}

/**
 * Wizard branch `provider: github` (D-01..D-06) — DI-zable para tests.
 *
 * Muta `providerConfig` in-place con el shape D-06 verbatim:
 *   {
 *     api_key_env: string,            // nombre de env var, default 'GITHUB_TOKEN'
 *     repos: Array<{owner, repo}>,    // ≥0 repos
 *     poll_interval: number,          // default 60
 *     mcp_hint: string,               // default 'GitHub MCP server'
 *     states: { review: string },     // default { review: 'closed' }
 *   }
 *
 * Pasos (mirror D-02..D-05):
 *   1. Pregunta nombre de env var (NO el value — T-26-01 security invariant).
 *   2. Auto-detect repo origin via `detectOriginRepo`; ofrece añadirlo.
 *   3. Loop manual add: parse `owner/repo`; valida exactamente un `/` no vacío.
 *      Input inválido → `continue` el while (NO recursión — Pitfall #9 / Pattern H).
 *   4. Aplica defaults D-06 si las claves no están presentes.
 *
 * Este helper NO escribe a stdout — el caller (rama github en `src/cli.js`) hace
 * el resumen final via `createFormatter` (D-20 LOCKED color isolation).
 *
 * @param {{
 *   ask: (q: string) => Promise<string>,
 *   execGitRemote?: () => string,
 *   providerConfig: Record<string, any>,
 * }} deps
 * @returns {Promise<void>}
 */
export async function configureGithubProvider({ ask, execGitRemote, providerConfig }) {
  // D-02: API key env var name. NO escribimos el VALUE del token (T-26-01).
  const defaultEnv = providerConfig.api_key_env || 'GITHUB_TOKEN';
  const envNameRaw = await ask(`  Variable de entorno para API key [${defaultEnv}]: `);
  const envName = envNameRaw.trim();
  providerConfig.api_key_env = envName || defaultEnv;

  providerConfig.repos = providerConfig.repos || [];

  // D-03: auto-detect origin
  const detected = detectOriginRepo(execGitRemote);
  if (detected) {
    const yesRaw = await ask(`  Detectado: ${detected.owner}/${detected.repo} — ¿añadir? [S/n]: `);
    const yes = yesRaw.trim().toLowerCase();
    if (yes === '' || yes === 's') {
      providerConfig.repos.push(detected);
    }
  }

  // D-04: manual add loop con validación "exactamente un /"
  // NO recursión (Pitfall #9): continue ante input inválido, break en Enter vacío.
  while (true) {
    const inputRaw = await ask('  Repo (owner/repo, Enter para terminar): ');
    const input = inputRaw.trim();
    if (input === '') break;
    const parts = input.split('/');
    if (parts.length !== 2 || !parts[0] || !parts[1]) {
      continue;
    }
    providerConfig.repos.push({ owner: parts[0], repo: parts[1] });
  }

  // D-06 shape defaults (poll_interval/mcp_hint/states inyectados ahora)
  providerConfig.poll_interval = providerConfig.poll_interval || 60;
  providerConfig.mcp_hint = providerConfig.mcp_hint || 'GitHub MCP server';
  providerConfig.states = providerConfig.states || { review: 'closed' };
}
