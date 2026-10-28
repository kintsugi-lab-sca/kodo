// @ts-check
//
// src/cli/send-back.js — Action handler de `kodo send-back <ref> --text <feedback>` (KODO-109).
//
// Thin handler sobre `sendBackTask` (src/session/send-back.js): resuelve provider y config, llama
// al núcleo y renderiza. Es también el camino del dashboard (tecla `b`), que lo shellea igual que
// `kodo inbox promote` para no meter el provider en el grafo del TUI.
//
// Exit codes (espejo de `kodo comment`):
//   0 = ok
//   1 = INVALID_INPUT | NOT_IN_REVIEW | NO_TRIGGER_STATE (error del operador, NO retryable)
//   2 = FETCH_FAILED | COMMENT_FAILED | PERSIST_FAILED | MOVE_FAILED (transient, retryable)

import { createFormatter } from './format.js';

const OPERATOR_ERRORS = new Set(['INVALID_INPUT', 'NOT_IN_REVIEW', 'NO_TRIGGER_STATE']);

/**
 * @param {{ ref: string, text: string, json?: boolean }} opts
 * @param {{
 *   getProviderFn?: () => any,
 *   loadConfigFn?: () => any,
 *   setSendBackFn?: (taskId: string, sendBack: { text: string, at: string } | null) => { ok: boolean },
 *   writeFn?: (s: string) => void,
 *   errFn?: (s: string) => void,
 *   formatterFn?: () => import('./format.js').Formatter,
 * }} [deps]
 * @returns {Promise<number>} exit code.
 */
export async function runSendBackCli(opts, deps = {}) {
  const write = deps.writeFn || ((s) => process.stdout.write(s));
  const err = deps.errFn || ((s) => process.stderr.write(s));
  const fmt = (deps.formatterFn || (() => createFormatter(process.stdout)))();

  const loadConfigFn = deps.loadConfigFn || (await import('../config.js')).loadConfig;
  const config = loadConfigFn();
  let provider;
  if (deps.getProviderFn) {
    provider = deps.getProviderFn();
  } else {
    const { initRegistry, getProvider } = await import('../providers/registry.js');
    await initRegistry();
    provider = getProvider(config.provider);
  }
  const setSendBackFn = deps.setSendBackFn || (await import('../session/state.js')).setTaskSendBack;

  const { sendBackTask } = await import('../session/send-back.js');
  const r = await sendBackTask({ ref: opts.ref, text: opts.text }, { provider, config, setSendBackFn });

  if (!r.ok) {
    const transient = !OPERATOR_ERRORS.has(r.code);
    err(`${transient ? fmt.yellow(r.code) : fmt.red(r.code)}${transient ? ' (transient)' : ''}: ${r.detail}\n`);
    return transient ? 2 : 1;
  }

  if (opts.json) {
    write(JSON.stringify({ ok: true, ...r.value }, null, 2) + '\n');
  } else {
    write(`${fmt.ok('Sent back')}\n`);
    write(`  ref:   ${fmt.green(r.value.ref)}\n`);
    write(`  state: ${r.value.state}\n`);
  }
  return 0;
}
