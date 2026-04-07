// @ts-check
import { loadConfig } from '../config.js';

/**
 * @param {'running'|'done'|'error'|'review'} status
 * @returns {string}
 */
export function colorForStatus(status) {
  const config = loadConfig();
  return config.cmux.colors[status] || 'Amber';
}
