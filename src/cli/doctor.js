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
import { scanConfigAlignment, checkStates, checkProjectIdentifiers } from '../config-doctor.js';
import { checkHookRegistration } from '../hooks/install.js';
import { loadRawConfig, loadProjects } from '../config.js';
import { createFormatter } from './format.js';

/**
 * @typedef {{ json?: boolean, states?: boolean, identifiers?: boolean, operator?: boolean }} RunDoctorOpts
 * @typedef {{
 *   loadRawConfigFn?: () => any,
 *   loadProjectsFn?: () => Record<string, any>,
 *   listStatesFn?: (projectId: string) => Promise<string[]>,
 *   listProjectsFn?: () => Promise<Array<any>>,
 *   refreshOperatorFn?: () => Promise<{id: string, display_name?: string}|null>,
 *   readSettingsFn?: () => any,
 *   bbDoctorFn?: () => Promise<any>,
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

  // 2b. Identifiers cacheados ↔ provider (opt-in --identifiers, KODO-13). Una sola llamada
  //     de red para todo el workspace; never-throws (un fallo se reporta como `error`).
  let identifiers = null;
  if (opts.identifiers) {
    identifiers = await runIdentifiersCheck({ config, provider: providerName, listProjectsFn: deps.listProjectsFn });
  }

  // 2c. Identidad del operador (opt-in --operator, KODO-58). Re-pregunta al provider
  //     quién es el dueño de la API key y REESCRIBE la caché de `providers.<p>.operator`.
  //     Opt-in y no siempre-activo por la misma razón que los dos checks de arriba: toca
  //     la red, y el doctor es offline por defecto. never-throws → `null` si falla.
  let operator = null;
  if (opts.operator) {
    operator = await runOperatorCheck({ provider: providerName, refreshOperatorFn: deps.refreshOperatorFn });
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

  // 3b. Host BB (KODO-31). Corre SOLO cuando el host activo es `bb`, y entonces SIEMPRE —
  //     no tras un flag opt-in. Mismo razonamiento que la deriva de hooks de arriba: un
  //     opt-in que nadie pasa no previene nada, y con `host: 'bb'` un servidor caído o un
  //     provider `claude-code` no disponible dejan a kodo lanzando threads que mueren al
  //     arrancar — un fallo invisible desde el resto del sistema. No rompe el default
  //     offline del doctor: la llamada es a loopback (127.0.0.1), no a la API del provider.
  //     never-throws → `null` si el check no aplica o si el cliente no carga.
  const bb = await runBbCheck({ host: config?.host, bbDoctorFn: deps.bbDoctorFn });
  const hasBbProblems = !!bb && (!bb.serverUp || bb.providerAvailable === false);

  const hasStateProblems = !!states && states.problems.length > 0;
  const hasIdentifierProblems = !!identifiers && identifiers.problems.length > 0;
  // KODO-58: pedir `--operator` y no poder resolver la identidad SÍ es un problema — es
  // el mismo criterio que un `--states` que no puede consultar un proyecto. Sin el flag
  // no influye en nada (el check ni siquiera corre).
  const hasOperatorProblem = !!opts.operator && !operator;
  const exitCode =
    alignment.hasIssues || hasStateProblems || hasIdentifierProblems || hasHookDrift || hasBbProblems || hasOperatorProblem
      ? 1
      : 0;

  // 4. Render.
  if (opts.json) {
    const payload = {
      ...alignment,
      ...(states ? { states } : {}),
      ...(identifiers ? { identifiers } : {}),
      hooks: { readable: settingsReadable, registered: hooks.registered, missing: hooks.missing },
      ...(bb ? { bb } : {}),
      ...(operator ? { operator } : {}),
    };
    write(JSON.stringify(payload, null, 2) + '\n');
  } else {
    renderHuman({ alignment, states, identifiers, hooks, settingsReadable, provider: providerName, write, fmt });
    renderBb({ bb, write, fmt });
    renderOperator({ operator, enabled: !!opts.operator, write, fmt });
  }

  return exitCode;
}

/**
 * Diagnostica el runtime del host BB (KODO-31). never-throws.
 *
 * `null` cuando el host activo NO es `bb`: no se diagnostica lo que no se usa, y así el
 * doctor de un operador de cmux no cambia ni un byte.
 *
 * El cliente se importa LAZY y el import va dentro del try: en una instalación sin el
 * carril bb cableado, un fallo de resolución debe degradar a «sin check», no tumbar el
 * doctor entero.
 *
 * @param {{ host?: string, bbDoctorFn?: () => Promise<any> }} params
 * @returns {Promise<{ serverUrl: string, serverUp: boolean, providerAvailable: boolean|null, detail?: string }|null>}
 */
async function runBbCheck({ host, bbDoctorFn }) {
  if (host !== 'bb') return null;
  try {
    const doctorFn = bbDoctorFn || (await import('../bb/client.js')).doctor;
    return await doctorFn();
  } catch {
    return null;
  }
}

/**
 * Render humano del bloque BB. No-op cuando el check no aplica (host ≠ bb), lo que
 * mantiene la salida del doctor idéntica para cmux y orca.
 *
 * @param {{ bb: any, write: (s: string) => void, fmt: any }} params
 */
function renderBb({ bb, write, fmt }) {
  if (!bb) return;
  write(`\n─── host bb (${bb.serverUrl}) ───\n`);
  if (!bb.serverUp) {
    write(`${fmt.error('caído')} — el servidor de BB no responde${bb.detail ? `: ${bb.detail}` : ''}\n`);
    write(`${fmt.dim('  arráncalo con `npx bb-app@latest` o ajusta `bb.server_url` en ~/.kodo/config.json')}\n`);
    return;
  }
  if (bb.providerAvailable === true) {
    write(`${fmt.ok('clean')} — servidor en pie y provider claude-code disponible\n`);
  } else if (bb.providerAvailable === false) {
    write(`${fmt.error('provider ausente')} — BB responde pero claude-code no está disponible\n`);
    write(`${fmt.dim('  BB necesita el binario `claude` en la máquina donde corre el thread')}\n`);
  } else {
    write(`${fmt.yellow('parcial')} — servidor en pie; no se pudo consultar el provider${bb.detail ? `: ${bb.detail}` : ''}\n`);
  }
}

/**
 * Refresca la identidad del operador contra el provider y reescribe su caché en
 * `~/.kodo/config.json` (KODO-58). never-throws → `null` si no se pudo resolver.
 *
 * `null` cubre DOS casos distintos a propósito, y los dos significan lo mismo para el
 * operador: el filtro por asignado queda inerte. O el provider no expone identidad
 * (`refreshOperator` no implementado — hoy, GitHub), o la llamada falló.
 *
 * El trabajo real lo hace `provider.refreshOperator()`, que es quien sabe pedir y
 * persistir; aquí solo se resuelve el provider y se envuelve en el contrato never-throws
 * del doctor. `refreshOperatorFn` es DI para tests (mismo patrón que `listStatesFn`).
 *
 * @param {{ provider: string, refreshOperatorFn?: () => Promise<any> }} params
 * @returns {Promise<{id: string, display_name?: string}|null>}
 */
async function runOperatorCheck({ provider, refreshOperatorFn }) {
  try {
    if (refreshOperatorFn) return (await refreshOperatorFn()) || null;
    const { initRegistry, getProvider } = await import('../providers/registry.js');
    await initRegistry();
    const p = getProvider(provider);
    if (typeof (/** @type {any} */ (p).refreshOperator) !== 'function') return null;
    return (await /** @type {any} */ (p).refreshOperator()) || null;
  } catch {
    return null;
  }
}

/**
 * Render humano del bloque de operador. No-op sin `--operator`, así que la salida por
 * defecto del doctor no cambia ni un byte.
 *
 * @param {{ operator: any, enabled: boolean, write: (s: string) => void, fmt: any }} params
 */
function renderOperator({ operator, enabled, write, fmt }) {
  if (!enabled) return;
  write(`\n─── operador (multi-operador, KODO-58) ───\n`);
  if (operator?.id) {
    write(
      `${fmt.ok('clean')} — este daemon firma como ${operator.display_name || operator.id} (${operator.id}); solo lanzará tareas asignadas a esa cuenta\n`,
    );
    return;
  }
  write(`${fmt.error('sin identidad')} — no se pudo resolver el dueño de la API key\n`);
  write(
    `${fmt.dim('  el filtro por asignado queda INACTIVO: este daemon lanzará cualquier tarea elegible, incluidas las de otros operadores')}\n`,
  );
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
 * Cruza los identifiers cacheados en config con los que devuelve el provider (KODO-13).
 * UNA sola llamada de red para todo el workspace; never-throws: un fallo se devuelve como
 * `error` en el resultado (mismo criterio que runStatesCheck), nunca tumba el comando.
 *
 * @param {{ config: any, provider: string, listProjectsFn?: () => Promise<Array<any>> }} params
 * @returns {Promise<{ checked: number, problems: Array<any>, skipped?: boolean }>}
 */
async function runIdentifiersCheck({ config, provider, listProjectsFn }) {
  const configProjects = config?.providers?.[provider]?.projects;
  const listProjects = listProjectsFn || (await defaultListProjectsFactory(config, provider));
  if (!listProjects) return { checked: 0, problems: [], skipped: true };

  let remoteProjects;
  try {
    remoteProjects = await listProjects();
  } catch (e) {
    // Provider inalcanzable: se reporta como problema (mismo criterio que runStatesCheck,
    // que registra el fallo de red por proyecto) — no se puede afirmar alineación sin datos.
    return {
      checked: 0,
      problems: [{ code: 'provider_unreachable', error: String(/** @type {any} */ (e)?.message ?? e) }],
    };
  }
  return checkProjectIdentifiers({ configProjects, remoteProjects });
}

/**
 * Render humano: cruce de alineación agrupado + (opcional) estados/identifiers. Espejo del
 * estilo de gsd-doctor.js (categorías + verdict final).
 *
 * @param {{
 *   alignment: ReturnType<typeof scanConfigAlignment>,
 *   states: { checked: number, problems: Array<any> }|null,
 *   identifiers: { checked: number, problems: Array<any>, skipped?: boolean }|null,
 *   hooks: ReturnType<typeof checkHookRegistration>,
 *   settingsReadable: boolean,
 *   provider: string,
 *   write: (s: string) => void,
 *   fmt: import('./format.js').Formatter,
 * }} params
 */
function renderHuman({ alignment, states, identifiers, hooks, settingsReadable, provider, write, fmt }) {
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

  // ── Sección identifiers (--identifiers, KODO-13) ──
  if (identifiers) {
    write(`\n─── identifiers (--identifiers) ───\n`);
    if (identifiers.skipped) {
      write(`${fmt.dim('n/a')} — el check de identifiers solo aplica al provider plane\n`);
    } else if (identifiers.problems.length === 0) {
      write(`${fmt.ok('clean')} — los ${identifiers.checked} proyecto(s) configurados usan el identifier real del provider\n`);
    } else {
      for (const p of identifiers.problems) {
        if (p.code === 'provider_unreachable') {
          write(`${fmt.red('ERROR')} no se pudo listar los proyectos del provider: ${p.error}\n`);
        } else if (p.code === 'unknown_remote_project') {
          write(`${fmt.yellow('WARN ')} ${p.projectId} — configurado${p.cached ? ` como ${p.cached}` : ''} pero el provider no lo conoce (borrado, id inválido o sin permisos)\n`);
        } else {
          write(`${fmt.red('ERROR')} ${p.projectId} — identifier obsoleto: config dice "${p.cached}", ${provider} dice "${p.actual}"\n`);
          write(`      ${fmt.dim('efecto:')} los refs quedan desalineados con el provider ("${p.cached}-N" no existe allí).\n`);
          write(`      ${fmt.dim('remedio:')} reconfigura el proyecto con "kodo config" para persistir "${p.actual}"${p.actualName ? ` / "${p.actualName}"` : ''}.\n`);
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

  const alignmentOrStateIssues =
    alignment.hasIssues ||
    (states && states.problems.length > 0) ||
    (identifiers && identifiers.problems.length > 0);
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

/**
 * Fábrica del listProjects real (solo bajo --identifiers SIN listProjectsFn inyectado).
 * Mismo patrón que defaultListStatesFactory: PlaneClient directo, una sola llamada al
 * listado de proyectos del workspace.
 *
 * @param {any} config
 * @param {string} provider
 * @returns {Promise<(() => Promise<Array<any>>)|null>} `null` si el check no aplica al provider.
 */
async function defaultListProjectsFactory(config, provider) {
  // `null` = check no aplicable. Devolver un listado VACÍO en su lugar sería peor que no
  // comprobar: todo proyecto configurado saldría como `unknown_remote_project`.
  if (provider !== 'plane') return null;

  const planeCfg = config?.providers?.plane || {};
  const { PlaneClient } = await import('../providers/plane/client.js');
  const client = new PlaneClient({
    baseUrl: planeCfg.base_url,
    apiKey: process.env[planeCfg.api_key_env],
    workspaceSlug: planeCfg.workspace_slug,
  });
  return () => client.listProjects();
}
