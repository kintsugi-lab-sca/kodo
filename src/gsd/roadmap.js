// @ts-check

/**
 * Parse a ROADMAP.md string into structured phases. Pure: no I/O.
 *
 * Accepts heading levels `##` and `###` (D-05). Headings `#` and `####` rejected.
 * Accepts integer and decimal phase numbers (D-08): `Phase 9`, `Phase 72.1`.
 * Ranges like `Phase 1-5` are ignored (do not match the regex).
 *
 * NOTE: CONTEXT.md §D-05 writes the regex as `##{2,3}` which actually matches
 * 3-4 hashes (one literal `#` + 2-3 more). The correct pattern to capture
 * exactly `##` and `###` is `#{2,3}` (two-to-three hashes total). This module
 * uses the corrected form — see pattern-mapper refinement #1 in 09-PATTERNS.md.
 *
 * @param {string} md - Raw ROADMAP.md content.
 * @returns {{ phases: Array<{ n: string, title: string, heading: string, line: number }> }}
 */
export function parseRoadmap(md) {
  const result = { phases: [] };
  if (typeof md !== 'string' || md.length === 0) return result;

  const lines = md.split('\n');
  // `#{2,3}` = exactly 2 or 3 hashes. `\d+(?:\.\d+)?` = integer or decimal.
  // Separator alternatives after the number:
  //   - `:\s*`    → colon (optionally followed by whitespace)
  //   - `\s+[-–—]\s+` → dash padded by whitespace on BOTH sides (e.g. ` - `).
  //     M12 (Phase 72): the separator accepts ASCII hyphen `-`, en-dash `–`
  //     (U+2013) and em-dash `—` (U+2014), so `## Phase 6 — Foundation` matches.
  // The dash-with-spaces rule is what rejects ranges like `Phase 1-5:` —
  // there is no whitespace between `1` and `-`, so `\s+[-–—]\s+` fails and the
  // colon branch also fails (first char after `1` is `-`, not `:`).
  // Line anchored (`^...$`); `(.+)$` = non-empty title.
  const re = /^(#{2,3})\s+Phase\s+(\d+(?:\.\d+)?)(?::\s*|\s+[-–—]\s+)(.+)$/;

  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(re);
    if (!m) continue;
    result.phases.push({
      n: m[2],
      title: m[3].trim(),
      heading: lines[i],
      line: i + 1,
    });
  }
  return result;
}

/**
 * Normalize a title for strict 1:1 matching (D-07).
 * Rules: trim + collapse whitespace runs + lowercase. Nothing else.
 * Keeps punctuation (`:`, `.`, `,`) and backticks (`` ` ``) intact to keep
 * matching strict — two titles that differ only in punctuation are NOT equal.
 *
 * @param {string} s
 * @returns {string}
 */
export function normalizeTitle(s) {
  return String(s).trim().replace(/\s+/g, ' ').toLowerCase();
}
