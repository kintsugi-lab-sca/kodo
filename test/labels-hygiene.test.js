// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SRC = join(REPO, 'src');
const LABELS_FILE = join(SRC, 'labels.js'); // legitimate sole source of the literal

/**
 * Strip block comments + line comments + JSDoc continuation lines.
 * Mirror canónico de test/dispatcher-isolation.test.js:30-36 (Phase 16 LOG-13)
 * y test/stop.test.js:62-67 (Phase 13 source-hygiene).
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

/** Recursively list all .js files under SRC, excluding the legitimate source file. */
function listJsFilesExcept(dir, excludePath) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      out.push(...listJsFilesExcept(full, excludePath));
    } else if (st.isFile() && full.endsWith('.js') && full !== excludePath) {
      out.push(full);
    }
  }
  return out;
}

describe('REPORT-05 — labels source hygiene (Phase 29 D-17)', () => {
  it('REPORT-05: no inline "kodo:gsd-child" literal outside src/labels.js (post-stripComments)', () => {
    const files = listJsFilesExcept(SRC, LABELS_FILE);
    const violations = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf-8');
      const stripped = stripComments(source);
      if (stripped.includes("'kodo:gsd-child'") || stripped.includes('"kodo:gsd-child"')) {
        violations.push(relative(REPO, file));
      }
    }
    assert.deepEqual(
      violations,
      [],
      `Inline 'kodo:gsd-child' literal found in: ${violations.join(', ')}.\n` +
        `Use KODO_LABEL_GSD_CHILD const + isGsdChild(labels) helper from src/labels.js.`,
    );
  });

  it('REPORT-05: src/labels.js (the legitimate source) DOES export KODO_LABEL_GSD_CHILD and isGsdChild', () => {
    const source = readFileSync(LABELS_FILE, 'utf-8');
    assert.match(source, /export\s+const\s+KODO_LABEL_GSD_CHILD\s*=\s*['"]kodo:gsd-child['"]/);
    assert.match(source, /export\s+function\s+isGsdChild\s*\(/);
  });
});
