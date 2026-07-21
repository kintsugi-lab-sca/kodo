// @ts-check
//
// src/cli/doctor.js — Action handler de `kodo doctor` (KODO-10).
//
// La mitad CLI del módulo puro `src/config-doctor.js`. Cruza `config.json` ↔ `projects.json`
// y (opt-in `--states`) verifica que cada proyecto dispatch-enabled tiene los estados
// trigger/review/done — el par de desalineaciones que hizo invisible el fallo del proyecto SCP.
//
//   - Sin flags (default): cruce PURO/offline. Render humano agrupado por severidad + exit code.
//   - `--states`: además consulta los estados de cada proyecto configurado por RED (never-throws
//     por proyecto: un fallo de red se reporta como problema de estados, no tira el comando).
//   - `--json` (espejo de gsd-doctor): payload byte-determinista (idéntico TTY/no-TTY).
//
// Exit code: `1` si hay CUALQUIER finding de alineación o problema de estados; `0` si limpio.
//
// Color isolation: cero ANSI inline — todo color sale del formatter inyectado. NO llama a
// `ensureConfig()`: doctor DIAGNOSTICA la config, no exige que esté completa (mismo precedente
// que `gsd doctor` / `skill sync`, que corren sin gate de provider).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { scanConfigAlignment, checkStates } from '../config-doctor.js';
import { checkHookRegistration } from '../hooks/install.js';
import { loadRawConfig, loadProjects } from '../config.js';
import { createFormatter } from './format.js';

/**
 * @typedef {{ json?: boolean, states?: boolean }} RunDoctorOpts
 * @typedef {{
 *   loadRawConfigFn?: () => any,
 *   loadProjectsFn?: () => Record<string, any>,
 *   listStatesFn?: (projectId: string) => Promise<string[]>,
 *   readSettingsFn?: () => any,
 *   writeFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 * }} RunDoctorDeps
 */

/**
 * Lee `~/.claude/settings.json` — never-throws: si es ilegible/ausente/malformado
 * devuelve `null` (el doctor no puede afirmar deriva sobre lo que no pudo leer →
 * degrada a WARN, nunca a un false-positive de exit 1). Default real, solo se invoca
 * sin `readSettingsFn` inyectado (mismo precedente que `defaultListStatesFactory`).
 * @returns {any}
 */
function defaultReadSettings() {
  try {
    return JSON.parse(readFileSync(join(homedir(), '.claude', 'settings.json'), 'utf-8'));
  } catch {
    return null;
  }
}

/**
 * @param {RunDoctorOpts} opts
 * @param {RunDoctorDeps} [deps]
 * @returns {Promise<number>} exit code: 1 si hay desalineación / estados ausentes, 0 si limpio.
 */
export async function runDoctor(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();

  const config = (deps.loadRawConfigFn || loadRawConfig)();
  const projects = (deps.loadProjectsFn || loadProjects)();
  const providerName = config?.provider || 'plane';

  // 1. Cruce PURO (siempre).
  const alignment = scanConfigAlignment({ config, projects, provider: providerName });

  // 2. Estados (opt-in --states). never-throws por proyecto.
  let states = null;
  if (opts.states) {
    states = await runStatesCheck({ config, provider: providerName, listStatesFn: deps.listStatesFn });
  }

  // 3. Deriva instalación↔settings de hooks (SIEMPRE activa — la invisibilidad fue la
  //    causa raíz de G-74-4; un flag opt-in que nadie pasa no previene nada). Lectura
  //    never-throws → objeto o null; el checker es puro y never-throws incluso con null.
  const settings = (deps.readSettingsFn || defaultReadSettings)();
  const settingsReadable = settings != null;
  const hooks = checkHookRegistration(settings);
  // settings ilegible NO cuenta como deriva (no se puede afirmar sobre lo no leído):
  // solo un hook AUSENTE con settings LEGIBLE fuerza el exit 1.
  const hasHookDrift = settingsReadable && hooks.missing.length > 0;

  const hasStateProblems = !!states && states.problems.length > 0;
  const exitCode = alignment.hasIssues || hasStateProblems || hasHookDrift ? 1 : 0;

  // 4. Render.
  if (opts.json) {
    const payload = {
      ...alignment,
      ...(states ? { states } : {}),
      hooks: { readable: settingsReadable, registered: hooks.registered, missing: hooks.missing },
    };
    write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    renderHuman({ alignment, states, hooks, settingsReadable, provider: providerName, write, fmt });
  }

  return exitCode;
}

/**
 * Consulta los estados de cada proyecto dispatch-enabled y verifica trigger/review/done.
 * never-throws por proyecto: un fallo de red se registra como `error` en el problema.
 *
 * @param {{ config: any, provider: string, listStatesFn?: (projectId: string) => Promise<string[]> }} params
 * @returns {Promise<{ checked: number, problems: Array<{ projectId: string, identifier: string|null, missing?: Array<{ role: string, name: string }>, error?: string }> }>}
 */
async function runStatesCheck({ config, provider, listStatesFn }) {
  const requiredStates = config?.providers?.[provider]?.states || {};
  const list = config?.providers?.[provider]?.projects;
  const projects = Array.isArray(list) ? list : [];
  const listStates = listStatesFn || (await defaultListStatesFactory(config, provider));

  /** @type {Array<{ projectId: string, identifier: string|null, missing?: Array<{ role: string, name: string }>, error?: string }>} */
  const problems = [];
  let checked = 0;
  for (const p of projects) {
    const projectId = typeof p === 'string' ? p : p?.id;
    const identifier = typeof p === 'string' ? null : (p?.identifier ?? null);
    if (!projectId) continue;
    checked++;
    try {
      const stateObjs = await listStates(projectId);
      const availableStateNames = (Array.isArray(stateObjs) ? stateObjs : []).map((s) =>
        typeof s === 'string' ? s : s?.name,
      ).filter(Boolean);
      const { missing } = checkStates({ requiredStates, availableStateNames });
      if (missing.length > 0) problems.push({ projectId, identifier, missing });
    } catch (e) {
      problems.push({ projectId, identifier, error: String(/** @type {any} */ (e)?.message ?? e) });
    }
  }
  return { checked, problems };
}

/**
 * Render humano: cruce de alineación agrupado + (opcional) estados. Espejo del estilo de
 * gsd-doctor.js (categorías + verdict final).
 *
 * @param {{
 *   alignment: ReturnType<typeof scanConfigAlignment>,
 *   states: { checked: number, problems: Array<any> }|null,
 *   hooks: ReturnType<typeof checkHookRegistration>,
 *   settingsReadable: boolean,
 *   provider: string,
 *   write: (s: string) => void,
 *   fmt: import('./format.js').Formatter,
 * }} params
 */
function renderHuman({ alignment, states, hooks, settingsReadable, provider, write, fmt }) {
  write(`kodo doctor — alineación config.json ↔ projects.json (provider: ${provider})\n\n`);

  if (alignment.findings.length === 0) {
    write(`${fmt.ok('clean')} — config y projects.json están alineados\n`);
  } else {
    for (const f of alignment.findings) {
      const tag = f.severity === 'error' ? fmt.red('ERROR') : fmt.yellow('WARN ');
      const who = f.projectId || (f.projectIds ? f.projectIds.join(', ') : (f.path || ''));
      write(`${tag} ${fmt.dim(f.code)} — ${who}\n      ${f.detail}\n`);
    }
    const errors = alignment.findings.filter((f) => f.severity === 'error').length;
    const warns = alignment.findings.length - errors;
    write(`\n${fmt.yellow('desalineación')} — ${errors} error(es), ${warns} aviso(s)\n`);
  }

  if (states) {
    write(`\n─── estados (--states) ───\n`);
    if (states.problems.length === 0) {
      write(`${fmt.ok('clean')} — los ${states.checked} proyecto(s) configurados tienen trigger/review/done\n`);
    } else {
      for (const p of states.problems) {
        const who = p.identifier ? `${p.identifier} (${p.projectId})` : p.projectId;
        if (p.error) {
          write(`${fmt.red('ERROR')} ${who} — no se pudo consultar estados: ${p.error}\n`);
        } else {
          const list = (p.missing || []).map((m) => `${m.role}="${m.name}"`).join(', ');
          write(`${fmt.yellow('WARN ')} ${who} — estados ausentes: ${list}\n`);
        }
      }
    }
  }

  // ── Sección hooks (deriva instalación↔settings, G-74-4) ──
  const hasHookDrift = settingsReadable && hooks.missing.length > 0;
  write(`\n─── hooks (~/.claude/settings.json) ───\n`);
  if (!settingsReadable) {
    write(`${fmt.yellow('WARN ')} no se pudo leer ~/.claude/settings.json — no se puede verificar el registro de hooks\n`);
  } else if (hooks.missing.length === 0) {
    write(`${fmt.ok('clean')} — los 3 hooks kodo (SessionStart/Stop/SessionEnd) están registrados\n`);
  } else {
    for (const m of hooks.missing) {
      write(`${fmt.red('ERROR')} hook ${m.event} (${m.file}) NO registrado en settings.json\n`);
    }
    write(`      ${fmt.dim('remedio:')} ejecuta "kodo install" para registrarlos (instalador idempotente, no clobbering).\n`);
  }

  const alignmentOrStateIssues = alignment.hasIssues || (states && states.problems.length > 0);
  if (!alignmentOrStateIssues && !hasHookDrift) {
    write(`\n${fmt.ok('sin problemas')}\n`);
  } else if (alignmentOrStateIssues) {
    write(`\n${fmt.dim('sugerencia:')} añade los proyectos faltantes a ~/.kodo/config.json o mapéalos con "kodo config".\n`);
  }
}

// ── Default real del listStates (lazy — solo bajo --states sin DI) ────────────

/**
 * Fábrica del listStates real (solo se invoca bajo --states SIN listStatesFn inyectado).
 * Construye un PlaneClient directo (mismo patrón que el listModulesFn del dashboard) —
 * listStates NO está en el contrato TaskProvider, vive en PlaneClient.
 *
 * @param {any} config
 * @param {string} provider
 * @returns {Promise<(projectId: string) => Promise<string[]>>}
 */
async function defaultListStatesFactory(config, provider) {
  if (provider !== 'plane') {
    // Otros providers no exponen estados por-proyecto de este modo → no-op vacío.
    return async () => [];
  }
  const planeCfg = config?.providers?.plane || {};
  const { PlaneClient } = await import('../providers/plane/client.js');
  const client = new PlaneClient({
    baseUrl: planeCfg.base_url,
    apiKey: process.env[planeCfg.api_key_env],
    workspaceSlug: planeCfg.workspace_slug,
  });
  return (projectId) => client.listStates(projectId);
}
