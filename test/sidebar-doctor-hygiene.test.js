// @ts-check
//
// Phase 79-01 (SDR-02 / SDR-04, D-14 — GUARD source-hygiene LOAD-BEARING).
//
// Es la evidencia MECÁNICA (no revisión humana) de dos invariantes de toda la
// Phase 79:
//
//   SDR-02: la gestión de workspace-group vive SOLO en el allowlist NO-destructivo
//   (create/add/set-anchor/ungroup). El verbo destructivo `delete` —"Delete a group AND
//   close every workspace inside it" (cmux 0.64.20 --help)— NI SE CABLEA (LOCKED), igual
//   que `remove`/`rename`. Este guard escanea todo src/ y FALLA si alguien enchufa uno de
//   los verbos LOCKED (tokens argv adyacentes o un export de gestión con ese verbo).
//
//   G-79-1 (anclar un grupo en una sesión le roba su fila sidebar: el header del grupo
//   ES la fila del anchor). KODO-14 lo cerró prohibiendo `set-anchor` y confiando en que
//   `create --from` levantara su propio ancla — cierto en cmux 0.64.20, FALSO en 0.65.2,
//   donde `--from` reutiliza el primer ref como ancla. KODO-106 invierte la defensa:
//   `create` va sin `--from` y `set-anchor` vuelve, CONFINADO al passthrough de
//   client.js y al doctor (que solo ancla en un workspace estable que acaba de crear —
//   eso lo prueban los tests de comportamiento de test/cmux/).
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

// ── `set-anchor` CONFINADO (KODO-106) ───────────────────────────────────────────────
// Cualquier mención en código (argv `set-anchor` o el identificador del passthrough /
// un export de anchor+group) solo puede vivir en estos ficheros:
//   - src/cmux/client.js        → el passthrough (argv).
//   - src/host/cmux.js          → el reexport por host._legacy (walker SC#5).
//   - src/cmux/sidebar-doctor.js → el ÚNICO que lo invoca (reanchorOnStableWorkspace).
//   - src/session/manager.js    → solo como clave de deps hacia convergeProject.
const ANCHOR_WIRING = String.raw`['"]set-anchor['"]|\w*(?:set\w*anchor|anchor\w*group|group\w*anchor)\w*`;
const ANCHOR_ALLOWED = new Set([
  'src/cmux/client.js',
  'src/host/cmux.js',
  'src/cmux/sidebar-doctor.js',
  'src/session/manager.js',
]);

/** @returns {string[]} los matches de cableado de anchor en un texto sin comentarios */
function scanAnchorWiring(text) {
  return text.match(new RegExp(ANCHOR_WIRING, 'gi')) || [];
}

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
      'Verbo prohibido de workspace-group cableado:\n  ' + violations.join('\n  ') +
        '\nEl allowlist doctor es EXCLUSIVAMENTE create/add/ungroup (LOCKED). ' +
        '`delete` cierra todos los workspaces del grupo — usa `ungroup` (preserva miembros).',
    );
  });

  it('KODO-106: `set-anchor` solo se cablea en client.js / host/cmux.js / sidebar-doctor.js / manager.js', () => {
    const offenders = [];
    for (const file of listJsFiles(SRC)) {
      const rel = relative(REPO, file);
      if (ANCHOR_ALLOWED.has(rel)) continue;
      const hits = scanAnchorWiring(stripComments(readFileSync(file, 'utf-8')));
      if (hits.length) offenders.push(`${rel} → ${hits.join(', ')}`);
    }
    assert.deepEqual(
      offenders,
      [],
      '`set-anchor` cableado fuera de su confinamiento:\n  ' + offenders.join('\n  ') +
        '\nAnclar un grupo en una sesión le roba su fila sidebar (G-79-1). El único que ' +
        'reancla es el doctor, y siempre hacia un workspace estable que acaba de crear.',
    );
  });

  it('KODO-106: en sidebar-doctor.js `setWorkspaceGroupAnchor` se invoca UNA vez, con un miembro no-sesión o el ref que devuelve `newWorkspace`', () => {
    const src = stripComments(readFileSync(join(SRC, 'cmux', 'sidebar-doctor.js'), 'utf-8'));
    const calls = src.match(/d\.setWorkspaceGroupAnchor\(/g) || [];
    assert.equal(calls.length, 1, 'un único punto de reanclaje (reanchorOnStableWorkspace)');
    assert.match(
      src,
      /const stable = reuse \|\| await d\.newWorkspace\(\{ name, cwd, group \}\);[\s\S]{0,200}d\.setWorkspaceGroupAnchor\(\{ group, workspace: stable \}\)/,
      'el ancla nueva debe ser el workspace estable recién creado dentro del grupo',
    );
  });

  it('KODO-106: `create` jamás vuelve a llevar `--from` (cmux 0.65.2 lo adopta como ancla)', () => {
    const src = stripComments(readFileSync(join(SRC, 'cmux', 'client.js'), 'utf-8'));
    assert.ok(!/['"]--from['"]/.test(src), 'client.js no debe emitir `--from` en workspace-group create');
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

  it('KODO-106: el detector de anchor marca el argv `set-anchor` y los identificadores de anchor+group', () => {
    const leaky = [
      `run(['workspace-group', 'set-anchor', '--group', group, '--workspace', workspace]);`,
      `export async function setGroupAnchor({ group, workspace }) { return run(args); }`,
      `await host._legacy.setWorkspaceGroupAnchor(o);`,
    ].join('\n');
    const hits = scanAnchorWiring(leaky).map((h) => h.toLowerCase());
    assert.ok(hits.includes(`'set-anchor'`), 'debe marcar el argv `set-anchor`');
    assert.ok(hits.includes('setgroupanchor'), 'debe marcar el export setGroupAnchor');
    assert.ok(hits.includes('setworkspacegroupanchor'), 'debe marcar el passthrough setWorkspaceGroupAnchor');
    assert.deepEqual(scanAnchorWiring(`const anchor = el.closest('a'); /anchor/.test(url);`), [], 'falso positivo: `anchor` suelto');
  });

  it('NO marca el allowlist limpio (create/add/set-anchor/ungroup) ni el `workspace rename` legítimo', () => {
    const clean = [
      `run(['workspace-group', 'create', '--name', name, '--cwd', cwd]);`,
      `run(['workspace-group', 'set-anchor', '--group', group, '--workspace', workspace]);`,
      `run(['workspace-group', 'add', '--group', group, '--workspace', workspace]);`,
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
    // KODO-31: los opts base siguen siendo `name` + `cwd: projectPath`; el spread
    // `...spawnOpts` es ADITIVO y resuelve a `{}` para cmux y orca, así que el objeto que
    // reciben esos dos hosts es exactamente el de antes. Lo que este assert protege —
    // que el cwd sea el del PROYECTO y no el del worktree (D-04) — queda intacto.
    assert.match(managerSrc, /\{ name: workspaceName, cwd: projectPath, \.\.\.spawnOpts \},/, 'los opts base del launch path cambiaron de forma');
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
