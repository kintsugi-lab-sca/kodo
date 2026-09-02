// @ts-check
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPT_PATH = join(__dirname, '..', 'src', 'orchestrator', 'prompt.md');

describe('orchestrator prompt template', () => {
  const raw = readFileSync(PROMPT_PATH, 'utf-8');

  it('contains no literal "Plane" references in raw template', () => {
    // Match standalone "Plane" but not inside {{ }} placeholders
    const withoutPlaceholders = raw.replace(/\{\{[^}]+\}\}/g, '');
    assert.ok(
      !/\bPlane\b/.test(withoutPlaceholders),
      `prompt.md should not contain literal "Plane" — found in: ${withoutPlaceholders.match(/.*\bPlane\b.*/)?.[0]}`,
    );
  });

  it('contains {{provider}} placeholder', () => {
    assert.ok(raw.includes('{{provider}}'), 'should contain {{provider}}');
  });

  it('contains {{provider_name}} placeholder', () => {
    assert.ok(raw.includes('{{provider_name}}'), 'should contain {{provider_name}}');
  });

  it('contains {{mcp_tool}} placeholder', () => {
    assert.ok(raw.includes('{{mcp_tool}}'), 'should contain {{mcp_tool}}');
  });
});

describe('resolvePromptTemplate', () => {
  /** @type {typeof import('../src/orchestrator/launch.js').resolvePromptTemplate} */
  let resolvePromptTemplate;

  it('is exported from launch.js', async () => {
    const mod = await import('../src/orchestrator/launch.js');
    assert.ok(typeof mod.resolvePromptTemplate === 'function', 'resolvePromptTemplate must be exported');
    resolvePromptTemplate = mod.resolvePromptTemplate;
  });

  it('replaces all placeholders for provider "plane"', async () => {
    const { resolvePromptTemplate: fn } = await import('../src/orchestrator/launch.js');
    const raw = readFileSync(PROMPT_PATH, 'utf-8');
    const resolved = fn(raw, { provider: 'plane' });

    assert.ok(!resolved.includes('{{'), `should have no remaining {{ placeholders — found: ${resolved.match(/\{\{[^}]+\}\}/)?.[0]}`);
  });

  it('resolved prompt for provider "plane" contains "Plane"', async () => {
    const { resolvePromptTemplate: fn } = await import('../src/orchestrator/launch.js');
    const raw = readFileSync(PROMPT_PATH, 'utf-8');
    const resolved = fn(raw, { provider: 'plane' });

    assert.ok(resolved.includes('Plane'), 'resolved prompt for plane should contain "Plane"');
  });

  it('resolved prompt for provider "github" contains "Github"', async () => {
    const { resolvePromptTemplate: fn } = await import('../src/orchestrator/launch.js');
    const raw = readFileSync(PROMPT_PATH, 'utf-8');
    const resolved = fn(raw, { provider: 'github' });

    assert.ok(resolved.includes('Github'), 'resolved prompt for github should contain "Github"');
    assert.ok(!resolved.includes('Plane'), 'resolved prompt for github should NOT contain "Plane"');
  });
});

describe('REPORT-03 — Sub-issue reporting section gating', () => {
  const raw = readFileSync(PROMPT_PATH, 'utf-8');

  const BEGIN = '<!-- BEGIN reporting -->';
  const END = '<!-- END reporting -->';

  // KODO-71: el bloque se localiza por sus MARCADORES (contrato de gating), nunca por su
  // encabezado ni por su prosa. Todo lo que sigue se deriva del propio fichero, así que
  // reescribir la redacción de `prompt.md` no mueve ninguno de estos asertos.
  const beginIdx = raw.indexOf(BEGIN);
  const endIdx = raw.indexOf(END);
  const block = raw.slice(beginIdx, endIdx + END.length);
  const outside = raw.slice(0, beginIdx) + raw.slice(endIdx + END.length);

  it('SR1: raw prompt.md contains <!-- BEGIN reporting --> and <!-- END reporting --> markers exactly once each', () => {
    const beginMatches = raw.match(/<!-- BEGIN reporting -->/g) ?? [];
    const endMatches = raw.match(/<!-- END reporting -->/g) ?? [];
    assert.equal(beginMatches.length, 1, 'exactly one BEGIN marker expected');
    assert.equal(endMatches.length, 1, 'exactly one END marker expected');
  });

  it('SR2: el bloque de reporting va DESPUÉS del gate GSD (D-03 slot topológico)', () => {
    // KODO-71: el ancla es el COMANDO del gate, no el encabezado «## Sesiones GSD».
    // Lo que el slot garantiza es que el bloque opcional se añade detrás del contenido
    // base; el nombre de la sección que lo precede es prosa y puede cambiar.
    const gsdIdx = raw.indexOf('kodo gsd verify <session-id>');
    assert.ok(gsdIdx >= 0, 'sanity: el comando del gate GSD debe existir en el prompt');
    assert.ok(beginIdx >= 0, 'sanity: el marcador BEGIN debe existir');
    assert.ok(beginIdx > gsdIdx,
      `el bloque de reporting debe ir tras el gate GSD (gate en ${gsdIdx}, bloque en ${beginIdx})`);
  });

  it('SR3: el contrato del reporting vive DENTRO de los marcadores y sólo ahí', () => {
    // KODO-71: sustituye al aserto sobre el encabezado «## Sub-issue reporting». Lo que
    // hace apagable al bloque no es su título, sino que la label y los logs que sólo él
    // usa no se hayan filtrado al resto del prompt.
    assert.ok(block.includes('kodo:gsd-child'),
      'la label del dispatcher debe vivir dentro de los marcadores');
    assert.ok(block.includes('[kodo:reporting]'),
      'los logs del reporting deben vivir dentro de los marcadores');
    assert.equal(outside.includes('kodo:gsd-child'), false,
      'la label NO puede aparecer fuera del bloque: el gate no podría retirarla');
    assert.equal(outside.includes('[kodo:reporting]'), false,
      'los logs NO pueden aparecer fuera del bloque: el gate no podría retirarlos');
  });

  it('SR4: gate(true) devuelve el prompt intacto; gate(false) borra el bloque ENTERO y nada más', async () => {
    const { applyReportingGate } = await import('../src/orchestrator/launch.js');
    const kept = applyReportingGate(raw, true);
    const stripped = applyReportingGate(raw, false);

    assert.equal(kept, raw, 'flag=true no toca una coma del prompt');

    assert.ok(!stripped.includes(BEGIN) && !stripped.includes(END),
      'flag=false se lleva también los marcadores');

    // Ninguna línea del cuerpo sobrevive. Se derivan del fichero, así que el aserto sigue
    // siendo válido cuando la redacción del bloque cambie.
    for (const line of block.split('\n').map((l) => l.trim())) {
      if (!line || outside.includes(line)) continue;
      assert.ok(!stripped.includes(line), `línea del bloque superviviente al gate: ${line}`);
    }

    // Y lo de fuera queda intacto, byte a byte.
    assert.ok(stripped.startsWith(raw.slice(0, beginIdx).trimEnd()),
      'el prompt anterior al bloque sobrevive entero');
    assert.ok(stripped.endsWith(raw.slice(endIdx + END.length).trimEnd()),
      'el prompt posterior al bloque sobrevive entero');
  });

  it('SR5: el gate cerrado NO se lleva por delante el contrato preexistente', async () => {
    const { applyReportingGate } = await import('../src/orchestrator/launch.js');
    const stripped = applyReportingGate(raw, false);
    assert.ok(stripped.includes('kodo gsd verify <session-id>'),
      'el comando del gate GSD debe sobrevivir');
    assert.ok(stripped.includes('{{provider_name}}'),
      'los placeholders de sustitución deben sobrevivir');
  });

  it('SR6: PM7 invariant — block content (when flag=true) contains no English prompt phrases', () => {
    // Re-checking PM7 against the WHOLE file (which includes the new block).
    // PM7 in the existing describe checks `prompt`; this is the same scan.
    // Locks regression: if Plan 15-02 wording later drifts to "you must"
    // or "please", this test fails.
    for (const phrase of [/\byou must\b/i, /\bplease\b/i, /\bexecute your\b/i]) {
      assert.ok(!phrase.test(raw),
        `forbidden English phrase found in prompt.md (including reporting block): ${phrase}`);
    }
  });
});
