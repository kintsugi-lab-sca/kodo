// @ts-check
//
// Phase 79-01 (SDR-02 / SDR-04, D-14 — GUARD source-hygiene LOAD-BEARING).
//
// Es la evidencia MECÁNICA (no revisión humana) de dos invariantes de toda la
// Phase 79:
//
//   SDR-02: la gestión de workspace-group vive SOLO en el allowlist NO-destructivo
//   (create/add/set-anchor/ungroup). El verbo destructivo `delete` —"Delete a group
//   AND close every workspace inside it" (cmux 0.64.20 --help)— NI SE CABLEA (LOCKED),
//   igual que `remove`/`rename`. Este guard escanea todo src/ y FALLA si alguien lo
//   enchufa (tokens argv adyacentes o un export de gestión con ese verbo).
//
//   SDR-04: el launch path (manager.js:400-440, newWorkspaceWithGroupFallback,
//   buildNewWorkspaceArgs) queda byte-idéntico — los nuevos exports de client.js son
//   ADITIVOS (D-15). Aquí afirmamos la FORMA del launch path; el criterio real son los
//   golden GRP-01..03 de test/manager.test.js + test/session/group-resolve.test.js,
//   que se corren SIN modificación (ver <verify> del plan).
//
// DISEÑO (anti falso-positivo Y anti falso-negativo, espejo hygiene-api-key.test.js):
//   - Se busca el VERBO destructivo cableado en un argv de `workspace-group`, NO la
//     mención legítima en un comentario o docstring — por eso todo se escanea
//     comment-stripped. `ungroup` (no destructivo, preserva miembros) es LEGÍTIMO.
//   - El bloque "detector no es trivial" ejercita fixtures sintéticos: uno CON el
//     cableado prohibido (debe marcar ≥1) y uno limpio (no marca), probando que el
//     guard no pasa trivialmente.

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join, relative } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const SRC = join(REPO, 'src');

/**
 * Elimina comentarios de bloque + de línea + continuaciones JSDoc, para que las
 * MENCIONES del verbo destructivo en comentarios/docstrings no cuenten como cableado.
 * Mirror canónico de test/hygiene-api-key.test.js:50-56.
 */
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}

/** Lista recursiva de todos los .js bajo `dir` (espejo hygiene-api-key.test.js:59-68). */
function listJsFiles(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) out.push(...listJsFiles(full));
    else if (st.isFile() && full.endsWith('.js')) out.push(full);
  }
  return out;
}

// ── El verbo destructivo del grupo + la familia LOCKED (fuera del código) ───────────
// `delete` cierra todos los workspaces del grupo (el destructivo real); `remove`/`rename`
// también quedan fuera del allowlist. El allowlist permitido es create/add/set-anchor/
// ungroup — NINGUNO de estos aparece abajo, así que la fuente limpia reporta 0.
const DESTRUCTIVE = String.raw`(?:delete|remove|rename)`;

// (a) Adyacencia argv: los literales string `'workspace-group'` y el verbo destructivo
//     como elementos de array contiguos — p.ej. `run(['workspace-group', 'delete', ref])`.
//     Anclado a 'workspace-group' para NO marcar el legítimo `['workspace', 'rename', ...]`
//     (client.js:89, que renombra un workspace, no un grupo).
const ADJACENCY = String.raw`['"]workspace-group['"]\s*,\s*['"]` + DESTRUCTIVE + String.raw`['"]`;

// (b) Export de gestión que combina el verbo destructivo con "group" en el identificador,
//     p.ej. `export async function deleteWorkspaceGroup(...)` o `removeFromWorkspaceGroup`.
const EXPORT_MGMT = String.raw`export\s+(?:async\s+)?(?:function\s+)?\w*` + DESTRUCTIVE + String.raw`\w*group\w*`;

const PATTERNS = {
  'workspace-group + verbo destructivo (argv adyacente)': ADJACENCY,
  'export de gestión con verbo destructivo': EXPORT_MGMT,
};

/**
 * Escanea texto (ya sin comentarios) buscando el cableado del verbo destructivo.
 * @returns {{kind: string, line: number, snippet: string}[]}
 */
function scanDestructiveGroupWiring(text) {
  const violations = [];
  for (const [kind, pattern] of Object.entries(PATTERNS)) {
    const re = new RegExp(pattern, 'gi');
    let m;
    while ((m = re.exec(text)) !== null) {
      const line = text.slice(0, m.index).split('\n').length;
      violations.push({ kind, line, snippet: m[0].slice(0, 80).replace(/\n/g, ' ') });
      if (m.index === re.lastIndex) re.lastIndex++;
    }
  }
  return violations;
}

describe('SDR-02 — guard source-hygiene: el verbo destructivo de workspace-group NI SE CABLEA (D-14)', () => {
  it('ningún src/**/*.js cablea `workspace-group delete/remove/rename` (argv ni export)', () => {
    const files = listJsFiles(SRC);
    const violations = [];
    for (const file of files) {
      const stripped = stripComments(readFileSync(file, 'utf-8'));
      for (const v of scanDestructiveGroupWiring(stripped)) {
        violations.push(`${relative(REPO, file)}:${v.line} [${v.kind}] → ${v.snippet}`);
      }
    }
    assert.deepEqual(
      violations,
      [],
      'Verbo destructivo de workspace-group cableado:\n  ' + violations.join('\n  ') +
        '\nEl allowlist doctor es EXCLUSIVAMENTE create/add/set-anchor/ungroup (LOCKED). ' +
        '`delete` cierra todos los workspaces del grupo — usa `ungroup` (preserva miembros).',
    );
  });
});

describe('SDR-02 — el detector NO es trivial (prueba positiva y negativa, espejo hygiene-api-key:174-198)', () => {
  it('marca un fixture CON el cableado prohibido (argv adyacente + export de gestión)', () => {
    const leaky = [
      `run(['workspace-group', 'delete', group]);`,
      `export async function deleteWorkspaceGroup({ group }) { return run(['workspace-group', 'delete', group]); }`,
    ].join('\n');
    const kinds = new Set(scanDestructiveGroupWiring(leaky).map((v) => v.kind));
    assert.ok(kinds.has('workspace-group + verbo destructivo (argv adyacente)'), 'debe marcar el argv adyacente');
    assert.ok(kinds.has('export de gestión con verbo destructivo'), 'debe marcar el export de gestión');
  });

  it('NO marca el allowlist limpio (create/add/set-anchor/ungroup) ni el `workspace rename` legítimo', () => {
    const clean = [
      `run(['workspace-group', 'create', '--name', name, '--from', from.join(',')]);`,
      `run(['workspace-group', 'add', '--group', group, '--workspace', workspace]);`,
      `run(['workspace-group', 'set-anchor', '--group', group, '--workspace', workspace]);`,
      `export async function ungroupWorkspaceGroup({ group }) { return run(['workspace-group', 'ungroup', group]); }`,
      `run(['workspace', 'rename', opts.workspace, '--title', opts.title]);`, // renombra un WORKSPACE, no un grupo
    ].join('\n');
    assert.deepEqual(
      scanDestructiveGroupWiring(clean),
      [],
      'falso positivo: marcó el allowlist no-destructivo o el rename de workspace',
    );
  });
});

describe('SDR-04 — el launch path queda byte-idéntico: los nuevos exports son ADITIVOS (D-15)', () => {
  const managerSrc = readFileSync(join(SRC, 'session', 'manager.js'), 'utf-8');
  const clientSrc = readFileSync(join(SRC, 'cmux', 'client.js'), 'utf-8');

  it('la llamada del launch path a newWorkspaceWithGroupFallback conserva su forma', () => {
    // El bloque manager.js:436-440 no cambió: newWorkspace vía host._legacy, opts base
    // y groupRef como 3er argumento (fail-open englobante GRP-01/03).
    assert.match(managerSrc, /newWorkspaceWithGroupFallback\(/, 'falta la llamada del launch path');
    assert.match(managerSrc, /host\._legacy\.newWorkspace,/, 'el launch path debe seguir usando host._legacy.newWorkspace');
    assert.match(managerSrc, /\{ name: workspaceName, cwd: projectPath \},/, 'los opts base del launch path cambiaron de forma');
    assert.match(managerSrc, /groupRef,\s*\n\s*\);/, 'groupRef debe seguir siendo el 3er argumento del fallback');
  });

  it('newWorkspaceWithGroupFallback conserva sus dos capas fail-open (GRP-03)', () => {
    assert.match(managerSrc, /if \(!group\) return newWorkspaceFn\(baseOpts\);/, 'capa 0 (sin grupo) alterada');
    assert.match(managerSrc, /return await newWorkspaceFn\(\{ \.\.\.baseOpts, group \}\);/, 'capa 1 (con --group) alterada');
    assert.match(managerSrc, /return newWorkspaceFn\(baseOpts\); \/\/ capa 2/, 'capa 2 (reintento sin grupo) alterada');
  });

  it('el orden de flags de buildNewWorkspaceArgs es byte-idéntico: --name → --cwd → --command → --group', () => {
    assert.match(
      clientSrc,
      /const args = \['new-workspace', '--name', opts\.name\];\s*\n\s*if \(opts\.cwd\) args\.push\('--cwd', opts\.cwd\);\s*\n\s*if \(opts\.command\) args\.push\('--command', opts\.command\);\s*\n\s*if \(opts\.group\) args\.push\('--group', opts\.group\);/,
      'el orden/forma del argv de buildNewWorkspaceArgs cambió (rompería los golden del argv)',
    );
  });
});
