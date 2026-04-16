// @ts-check
/**
 * LOG-10: determinismo de `resolveTranscriptPath(projectPath, sessionId)`.
 *
 * Contratos cubiertos:
 *  - Canonical ASCII path → `~/.claude/projects/-Users-...-<dir>/<session>.jsonl`.
 *    El resolver usa `encodeURIComponent(projectPath).replace(/%2F/g, '-')` —
 *    la convención de Claude Code para nombrar su directorio de transcripts.
 *  - Pitfall 3 (D-17): path con espacio mantiene `%20` porque `encodeURIComponent`
 *    escapa el espacio — no hyphen, limitación aceptada.
 *  - Idempotencia: dos llamadas con mismos args → mismo string.
 *
 * `../src/logger-events.js` no existe todavía — Plan 07-02 lo crea. Hasta entonces
 * este test falla con ERR_MODULE_NOT_FOUND (comportamiento Nyquist esperado).
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { homedir } from 'node:os';
import { join } from 'node:path';

describe('LOG-10: resolveTranscriptPath determinism', () => {
  it('canonical ASCII path produces hyphen-only dir name', async () => {
    const { resolveTranscriptPath } = await import('../src/logger-events.js');
    const out = resolveTranscriptPath('/Users/alex/dev/klab/kodo', 'sess-1');
    assert.equal(
      out,
      join(homedir(), '.claude', 'projects', '-Users-alex-dev-klab-kodo', 'sess-1.jsonl'),
    );
  });

  it('path with space keeps percent-encoding (Pitfall 3 documented limitation)', async () => {
    const { resolveTranscriptPath } = await import('../src/logger-events.js');
    const out = resolveTranscriptPath('/tmp/foo bar', 's');
    assert.match(out, /-tmp-foo%20bar\/s\.jsonl$/);
  });

  it('is idempotent', async () => {
    const { resolveTranscriptPath } = await import('../src/logger-events.js');
    const a = resolveTranscriptPath('/a/b/c', 'id');
    const b = resolveTranscriptPath('/a/b/c', 'id');
    assert.equal(a, b);
  });
});
