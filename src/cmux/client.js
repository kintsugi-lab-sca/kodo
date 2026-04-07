// @ts-check
import { execFile } from 'node:child_process';
import { loadConfig } from '../config.js';

function getCmuxBinary() {
  return loadConfig().cmux.binary;
}

/**
 * @param {string[]} args
 * @returns {Promise<string>}
 */
function run(args) {
  return new Promise((resolve, reject) => {
    execFile(getCmuxBinary(), args, { timeout: 15_000 }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(`cmux ${args[0]} failed: ${stderr || err.message}`));
        return;
      }
      resolve(stdout.trim());
    });
  });
}

/**
 * @param {{ name: string, cwd?: string, command?: string }} opts
 * @returns {Promise<string>} workspace reference (e.g. "workspace:3")
 */
export async function newWorkspace(opts) {
  const args = ['new-workspace', '--name', opts.name];
  if (opts.cwd) args.push('--cwd', opts.cwd);
  if (opts.command) args.push('--command', opts.command);
  const output = await run(args);
  // cmux returns "OK workspace:N" — extract the ref
  const match = output.match(/(workspace:\d+)/);
  return match ? match[1] : output;
}

/**
 * @param {{ workspace: string, text: string }} opts
 */
export async function send(opts) {
  return run(['send', '--workspace', opts.workspace, opts.text]);
}

/**
 * @param {{ workspace: string, lines?: number }} opts
 * @returns {Promise<string>}
 */
export async function readScreen(opts) {
  const args = ['read-screen', '--workspace', opts.workspace];
  if (opts.lines) args.push('--lines', String(opts.lines));
  return run(args);
}

/**
 * @param {{ workspace: string, color: string }} opts
 */
export async function setColor(opts) {
  return run(['workspace-action', '--action', 'set-color', '--workspace', opts.workspace, '--color', opts.color]);
}

/**
 * @returns {Promise<string>}
 */
export async function listWorkspaces() {
  return run(['list-workspaces']);
}

/**
 * @param {{ title: string, body?: string, workspace?: string }} opts
 */
export async function notify(opts) {
  const args = ['notify', '--title', opts.title];
  if (opts.body) args.push('--body', opts.body);
  if (opts.workspace) args.push('--workspace', opts.workspace);
  return run(args);
}
