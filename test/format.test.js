import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  createFormatter,
  _resolveUseColor,
  visibleWidth,
  OK_SYMBOL,
  FAIL_SYMBOL,
} from '../src/cli/format.js';

// Picocolors emite color reset como `\x1b[39m` (default fg) y `dim` close como
// `\x1b[22m`, no `\x1b[0m`. Las assertions toleran ambos cierres usando regex
// donde el plan lo permite explícitamente (Task 3 §4 nota sobre relaxed match).
const RESET_RE = '(?:0|39)';

describe('_resolveUseColor precedence (D-02)', () => {
  it('case 1: TTY=true, defaults => true', () => {
    assert.equal(_resolveUseColor({ isTTY: true }, {}), true);
  });

  it('case 2: TTY=false, defaults => false', () => {
    assert.equal(_resolveUseColor({ isTTY: false }, {}), false);
  });

  it("case 3: TTY=true + NO_COLOR='1' => false (NO_COLOR wins)", () => {
    assert.equal(_resolveUseColor({ isTTY: true }, { NO_COLOR: '1' }), false);
  });

  it("case 4: TTY=false + FORCE_COLOR='1' => true (FORCE_COLOR overrides isTTY)", () => {
    assert.equal(_resolveUseColor({ isTTY: false }, { FORCE_COLOR: '1' }), true);
  });

  it("case 5: NO_COLOR='1' + FORCE_COLOR='1' => false (NO_COLOR > FORCE_COLOR)", () => {
    assert.equal(
      _resolveUseColor({ isTTY: true }, { NO_COLOR: '1', FORCE_COLOR: '1' }),
      false,
    );
  });

  it("case 6: TTY=true + FORCE_COLOR='0' => false (explicit disable)", () => {
    assert.equal(_resolveUseColor({ isTTY: true }, { FORCE_COLOR: '0' }), false);
  });

  it("case 7: TTY=true + NO_COLOR='' (empty string is set) => false", () => {
    assert.equal(_resolveUseColor({ isTTY: true }, { NO_COLOR: '' }), false);
  });

  it("case 8: TTY=false + FORCE_COLOR='' => true (any non-'0' value forces, IN-02 Phase 14)", () => {
    assert.equal(_resolveUseColor({ isTTY: false }, { FORCE_COLOR: '' }), true);
  });
});

describe('golden bytes when useColor=false (DX-06 contract)', () => {
  const fmt = createFormatter({ isTTY: false }, {});

  it('debug returns plain string', () => {
    assert.equal(fmt.debug('x'), 'x');
  });

  it('info returns plain string', () => {
    assert.equal(fmt.info('x'), 'x');
  });

  it('warn returns plain string', () => {
    assert.equal(fmt.warn('x'), 'x');
  });

  it('error returns plain string', () => {
    assert.equal(fmt.error('x'), 'x');
  });

  it('green returns plain string', () => {
    assert.equal(fmt.green('x'), 'x');
  });

  it('yellow returns plain string', () => {
    assert.equal(fmt.yellow('x'), 'x');
  });

  it('red returns plain string', () => {
    assert.equal(fmt.red('x'), 'x');
  });

  it('cyan returns plain string', () => {
    assert.equal(fmt.cyan('x'), 'x');
  });

  it('gray returns plain string', () => {
    assert.equal(fmt.gray('x'), 'x');
  });

  it('dim returns plain string', () => {
    assert.equal(fmt.dim('x'), 'x');
  });

  it('ok returns OK_SYMBOL + space + plain', () => {
    assert.equal(fmt.ok('done'), `${OK_SYMBOL} done`);
    assert.equal(fmt.ok('done'), '✓ done');
  });

  it('fail returns FAIL_SYMBOL + space + plain', () => {
    assert.equal(fmt.fail('boom'), `${FAIL_SYMBOL} boom`);
    assert.equal(fmt.fail('boom'), '✗ boom');
  });

  it('no ANSI byte ever leaks (DX-06 invariant)', () => {
    // Crucial: para `--json` determinismo (Phase 15).
    assert.equal(fmt.info('x').includes('\x1b'), false);
    assert.equal(fmt.error('x').includes('\x1b'), false);
    assert.equal(fmt.ok('done').includes('\x1b'), false);
    assert.equal(fmt.fail('boom').includes('\x1b'), false);
    assert.equal(fmt.dim('x').includes('\x1b'), false);
  });
});

describe('colored output when useColor=true (TTY)', () => {
  const fmt = createFormatter({ isTTY: true }, {});

  it('debug emits gray (code 90)', () => {
    assert.match(fmt.debug('x'), new RegExp(`^\\x1b\\[90mx\\x1b\\[${RESET_RE}m$`));
  });

  it('info emits cyan (code 36)', () => {
    assert.match(fmt.info('x'), new RegExp(`^\\x1b\\[36mx\\x1b\\[${RESET_RE}m$`));
  });

  it('warn emits yellow (code 33)', () => {
    assert.match(fmt.warn('x'), new RegExp(`^\\x1b\\[33mx\\x1b\\[${RESET_RE}m$`));
  });

  it('error emits red (code 31)', () => {
    assert.match(fmt.error('x'), new RegExp(`^\\x1b\\[31mx\\x1b\\[${RESET_RE}m$`));
  });

  it('ok emits OK_SYMBOL + space + green-wrapped', () => {
    assert.match(
      fmt.ok('done'),
      new RegExp(`^${OK_SYMBOL} \\x1b\\[32mdone\\x1b\\[${RESET_RE}m$`),
    );
  });

  it('fail emits FAIL_SYMBOL + space + red-wrapped', () => {
    assert.match(
      fmt.fail('boom'),
      new RegExp(`^${FAIL_SYMBOL} \\x1b\\[31mboom\\x1b\\[${RESET_RE}m$`),
    );
  });
});

describe('visibleWidth strips ANSI', () => {
  it('plain text width is its length', () => {
    assert.equal(visibleWidth('hi'), 2);
  });

  it('cyan-wrapped string ignores escapes', () => {
    assert.equal(visibleWidth('\x1b[36mhi\x1b[0m'), 2);
  });

  it('red-wrapped 3-char string ignores escapes', () => {
    assert.equal(visibleWidth('\x1b[31mERR\x1b[0m'), 3);
  });

  it('empty string is zero', () => {
    assert.equal(visibleWidth(''), 0);
  });
});

describe('visibleWidth CSI multi-param (IN-01 Phase 14)', () => {
  it('strip multi-param CSI \\x1b[33;1m', () => {
    assert.equal(visibleWidth('\x1b[33;1mbold yellow\x1b[0m'), 11);
  });

  it('strip 256-color CSI \\x1b[38;5;200m', () => {
    assert.equal(visibleWidth('\x1b[38;5;200mpurple\x1b[0m'), 6);
  });

  it('regression: plain string unchanged', () => {
    assert.equal(visibleWidth('plain'), 5);
  });

  it('regression: single-param CSI still strips', () => {
    assert.equal(visibleWidth('\x1b[33mhello\x1b[0m'), 5);
  });
});

describe('formatRow padding (D-09, D-10, D-11)', () => {
  // Usamos useColor=false para aislar el padding de los color escapes.
  const fmt = createFormatter({ isTTY: false }, {});

  it('right-pads cells to widths with default separator " · "', () => {
    // 'a' padded a width 3 = 'a  ', 'bb' padded a width 4 = 'bb  '
    // joined con ' · ' separator => 'a   · bb  '
    assert.equal(fmt.formatRow(['a', 'bb'], [3, 4]), 'a   · bb  ');
  });

  it('aligns ANSI-wrapped cell using visibleWidth (D-10)', () => {
    // visibleWidth('\x1b[36mIN\x1b[0m')=2, width=5 => 3 espacios de padding;
    // 'x' a width 1 sin padding adicional. Joined con ' · '.
    const expected = '\x1b[36mIN\x1b[0m' + '   ' + ' · ' + 'x';
    assert.equal(fmt.formatRow(['\x1b[36mIN\x1b[0m', 'x'], [5, 1]), expected);
  });

  it('honors custom separator', () => {
    assert.equal(
      fmt.formatRow(['a', 'b'], [1, 1], { separator: ' | ' }),
      'a | b',
    );
  });

  it('does not truncate when cell wider than width (D-10)', () => {
    assert.equal(fmt.formatRow(['toolong'], [3]), 'toolong');
  });

  it('handles cells with no width (passes through)', () => {
    // widths[0] undefined => return cell as-is, no padding.
    assert.equal(fmt.formatRow(['hi'], [], {}), 'hi');
  });
});

describe('formatTable auto-widths', () => {
  const fmt = createFormatter({ isTTY: false }, {});

  it('auto-computes per-column widths from max visibleWidth', () => {
    // col0 max=3 ('ccc'), col1 max=2 ('bb')
    // row0: 'a  ' + ' · ' + 'bb' = 'a   · bb'
    // row1: 'ccc' + ' · ' + 'd ' = 'ccc · d '
    assert.equal(
      fmt.formatTable([['a', 'bb'], ['ccc', 'd']]),
      'a   · bb\nccc · d ',
    );
  });

  it('returns empty string for empty input', () => {
    assert.equal(fmt.formatTable([]), '');
  });

  it('prepends header and computes widths including header row', () => {
    // header ['H1', 'H2'], rows [['a', 'b']]
    // col0 max=2 ('H1'), col1 max=2 ('H2')
    // header: 'H1' + ' · ' + 'H2' = 'H1 · H2'
    // row0: 'a ' + ' · ' + 'b ' = 'a  · b '
    assert.equal(
      fmt.formatTable([['a', 'b']], { header: ['H1', 'H2'] }),
      'H1 · H2\na  · b ',
    );
  });

  it('honors custom separator', () => {
    assert.equal(
      fmt.formatTable([['a', 'b']], { separator: ' | ' }),
      'a | b',
    );
  });
});
