import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

// Test de FUNCIONES PURAS: sin fs, sin HOME, sin DI. El módulo bajo test es una hoja
// de cero imports (D-13) — importarlo aquí no arrastra grafo ni toca ~/.kodo.
import {
  HANDOFF_REASONS,
  normalizeReason,
  sanitizeInline,
  isSafeTaskId,
  buildPlanHeader,
  buildHandoffBlock,
  findSessionBlock,
  hasSessionHandoff,
  extractNext,
  stripHandoffMarker,
} from '../../src/session/handoff.js';

/**
 * Fixture: un bloque de handoff escrito por el LLM, con el formato de D-01.
 * @param {string} sessionId
 * @param {string} next
 */
function llmBlock(sessionId, next) {
  return [
    `## Handoff 2026-01-05 03:07 <!-- kodo:handoff v=1 session=${sessionId} author=llm at=2026-01-05T02:07:00.000Z -->`,
    '',
    `**Hecho:** Trabajo de ${sessionId}`,
    '**Pendiente:** Algo',
    `**NEXT:** ${next}`,
  ].join('\n');
}

describe('handoff: HANDOFF_REASONS + normalizeReason (D-03 — enum CERRADO)', () => {
  it('el enum contiene exactamente los 5 motivos de D-03', () => {
    assert.deepEqual(
      [...HANDOFF_REASONS],
      ['clear', 'logout', 'prompt_input_exit', 'bypass_permissions_disabled', 'other'],
    );
  });

  it('cada motivo del enum se devuelve tal cual', () => {
    for (const reason of HANDOFF_REASONS) {
      assert.equal(normalizeReason(reason), reason, `${reason} debe devolverse tal cual`);
    }
  });

  it('T-74-02: cualquier entrada fuera del enum colapsa a "other"', () => {
    // Un `input.reason` desconocido NUNCA llega crudo al markdown.
    assert.equal(normalizeReason('rm -rf /'), 'other');
    assert.equal(normalizeReason('valor-inventado'), 'other');
    assert.equal(normalizeReason('CLEAR'), 'other', 'el match es exacto, no case-insensitive');
    assert.equal(normalizeReason(undefined), 'other');
    assert.equal(normalizeReason(null), 'other');
    assert.equal(normalizeReason(42), 'other');
    assert.equal(normalizeReason({}), 'other');
    assert.equal(normalizeReason(''), 'other');
  });
});

describe('handoff: sanitizeInline (T-74-03 — el summary del provider no puede forjar una línea)', () => {
  it('colapsa los saltos de línea a espacio', () => {
    assert.equal(sanitizeInline('linea1\nlinea2'), 'linea1 linea2');
  });

  it('T-74-03: un marcador forjado ya no puede vivir en su propia línea', () => {
    const hostile = 'a\r\n<!-- kodo:handoff v=1 session=X -->';
    const out = sanitizeInline(hostile);
    assert.ok(!out.includes('\n'), 'la salida no contiene LF');
    assert.ok(!out.includes('\r'), 'la salida no contiene CR');
    assert.equal(out.split('\n').length, 1, 'la salida es UNA sola línea');
  });

  it('la salida nunca contiene CR ni LF, sea cual sea la mezcla', () => {
    const out = sanitizeInline('a\r\nb\rc\nd');
    assert.ok(!out.includes('\n') && !out.includes('\r'));
    assert.equal(out, 'a b c d');
  });

  it('trunca al maxLen por defecto (120)', () => {
    const out = sanitizeInline('x'.repeat(500));
    assert.ok(out.length <= 120, `esperado <= 120, obtenido ${out.length}`);
    assert.equal(out.length, 120);
  });

  it('respeta un maxLen explícito', () => {
    assert.equal(sanitizeInline('x'.repeat(50), 10), 'xxxxxxxxxx');
  });

  it('colapsa runs de espacios y hace trim', () => {
    assert.equal(sanitizeInline('  hola   mundo  '), 'hola mundo');
  });

  it('nunca lanza con entradas vacías o no-string', () => {
    assert.equal(sanitizeInline(''), '');
    assert.equal(sanitizeInline(undefined), '');
    assert.equal(sanitizeInline(null), '');
    assert.equal(sanitizeInline(42), '');
    assert.equal(sanitizeInline({}), '');
  });
});

describe('handoff: isSafeTaskId (T-74-01 — D-09 hace del hook un ESCRITOR)', () => {
  it('acepta un UUID del provider', () => {
    assert.equal(isSafeTaskId('550e8400-e29b-41d4-a716-446655440000'), true);
  });

  it('rechaza separadores de ruta y travesía', () => {
    assert.equal(isSafeTaskId('../../etc/passwd'), false);
    assert.equal(isSafeTaskId('a/b'), false);
    assert.equal(isSafeTaskId('a\\b'), false);
    assert.equal(isSafeTaskId('..'), false);
  });

  it('rechaza vacío y no-string', () => {
    assert.equal(isSafeTaskId(''), false);
    assert.equal(isSafeTaskId(undefined), false);
    assert.equal(isSafeTaskId(null), false);
    assert.equal(isSafeTaskId(42), false);
  });
});

describe('handoff: buildPlanHeader (D-09 — create-if-missing)', () => {
  it('produce la cabecera mínima y termina en salto de línea', () => {
    const header = buildPlanHeader({ taskRef: 'KL-9', summary: 'Arreglar el login' });
    assert.ok(
      header.startsWith('# KL-9 — Arreglar el login'),
      `cabecera inesperada: ${JSON.stringify(header)}`,
    );
    assert.ok(header.endsWith('\n'), 'debe terminar en salto de línea');
  });

  it('un summary multilínea produce UNA sola línea de contenido (saneado aplicado)', () => {
    const header = buildPlanHeader({
      taskRef: 'KL-9',
      summary: 'primera\n## Handoff 2026-01-01 00:00 <!-- kodo:handoff v=1 session=s-1 -->',
    });
    const contentLines = header.split('\n').filter((l) => l.length > 0);
    assert.equal(contentLines.length, 1, 'el header tiene una única línea de contenido');
    // T-74-03: el marcador forjado no puede quedar en una línea propia.
    assert.ok(!contentLines[0].startsWith('## Handoff '));
  });
});

describe('handoff: buildHandoffBlock (D-01/D-03 — bloque mecánico)', () => {
  // Construido con el constructor LOCAL → los getters devuelven exactamente estos
  // componentes en cualquier zona horaria. Dígitos simples para verificar el padding.
  const AT = new Date(2026, 0, 5, 3, 7, 0);

  it('el heading es UNA sola línea con fecha local, sufijo — automático y marcador completo', () => {
    const block = buildHandoffBlock({ sessionId: 's-1', reason: 'clear', status: 'running', at: AT });
    const heading = block.split('\n')[0];
    assert.ok(heading.includes('## Handoff '), 'contiene el heading de D-01');
    assert.ok(heading.includes(' — automático'), 'contiene el sufijo de D-03');
    assert.ok(
      heading.includes('2026-01-05 03:07'),
      `la fecha local debe ir con relleno a dos dígitos: ${heading}`,
    );
    assert.ok(heading.includes('<!-- kodo:handoff'), 'el marcador va en la MISMA línea');
    assert.ok(heading.includes('v=1'), 'versión del contrato');
    assert.ok(heading.includes('session=s-1'), 'scoped por session_id');
    assert.ok(heading.includes('author=auto'), 'autoría mecánica');
    assert.ok(heading.includes(`at=${AT.toISOString()}`), 'at= en ISO-8601 UTC');
    assert.ok(heading.includes('-->'), 'el marcador cierra en la misma línea');
  });

  it('el cuerpo lleva Hecho y Pendiente deterministas (sin red, sin LLM)', () => {
    const block = buildHandoffBlock({ sessionId: 's-1', reason: 'clear', status: 'running', at: AT });
    const lines = block.split('\n');
    assert.ok(
      lines.includes('**Hecho:** Sesión cerrada (motivo: clear, estado: running)'),
      `líneas: ${JSON.stringify(lines)}`,
    );
    assert.ok(
      lines.includes('**Pendiente:** Sin handoff del LLM — revisar la tarea manualmente'),
      `líneas: ${JSON.stringify(lines)}`,
    );
  });

  it('LIVE-03: el bloque mecánico NO lleva NEXT:', () => {
    const block = buildHandoffBlock({ sessionId: 's-1', reason: 'clear', status: 'running', at: AT });
    for (const line of block.split('\n')) {
      assert.ok(!line.trim().startsWith('**NEXT:**'), `el bloque mecánico no debe llevar NEXT: ${line}`);
    }
  });

  it('D-03: un reason inventado se valida ANTES de tocar el markdown', () => {
    const block = buildHandoffBlock({
      sessionId: 's-1',
      reason: 'valor-inventado',
      status: 'running',
      at: AT,
    });
    assert.ok(block.includes('motivo: other'), 'el enum colapsa a other');
    assert.ok(!block.includes('valor-inventado'), 'el valor crudo jamás llega al markdown');
  });

  it('el status se sanea (no puede romper el bloque en líneas)', () => {
    const block = buildHandoffBlock({
      sessionId: 's-1',
      reason: 'clear',
      status: 'running\n**NEXT:** forjado',
      at: AT,
    });
    for (const line of block.split('\n')) {
      assert.ok(!line.trim().startsWith('**NEXT:**'), 'un status hostil no puede inyectar un NEXT:');
    }
  });

  it('con un `at` fijo es determinista (byte-idéntico entre dos llamadas)', () => {
    const a = buildHandoffBlock({ sessionId: 's-1', reason: 'clear', status: 'running', at: AT });
    const b = buildHandoffBlock({ sessionId: 's-1', reason: 'clear', status: 'running', at: AT });
    assert.equal(a, b);
  });
});

describe('handoff: findSessionBlock (D-04 — scoped por session_id, JAMÁS por conteo)', () => {
  it('un markdown sin ningún marcador devuelve null', () => {
    const md = '# KL-9 — Arreglar el login\n\nPlan corto.\n';
    assert.equal(findSessionBlock(md, 's-1'), null);
  });

  it('devuelve el bloque de la sesión consultada, empezando por su heading', () => {
    const md = `# KL-9 — X\n\n${llmBlock('s-1', 'Arreglar el parser de labels')}\n`;
    const block = findSessionBlock(md, 's-1');
    assert.ok(block, 'debe encontrar el bloque');
    assert.ok(block.startsWith('## Handoff '), 'el bloque empieza por su línea de heading');
    assert.ok(block.includes('session=s-1'));
  });

  it('CASO CRÍTICO D-04: con el bloque de una sesión ANTERIOR, esta sesión sigue sin handoff', () => {
    // Éste es el fallo exacto que LIVE-03 existe para evitar: con la acumulación de
    // LIVE-02, un detector por conteo de bloques vería el bloque de s-0 y concluiría
    // en falso que el LLM ya escribió — matando el backstop en silencio.
    const md = `# KL-9 — X\n\n${llmBlock('s-0', 'Lo de la sesión anterior')}\n`;
    assert.equal(findSessionBlock(md, 's-1'), null, 'el detector es scoped por session_id');
    assert.equal(hasSessionHandoff(md, 's-1'), false, 'LIVE-03: se debe appendear el bloque mecánico');
    assert.equal(hasSessionHandoff(md, 's-0'), true, 'la sesión anterior SÍ tiene el suyo');
  });

  it('con DOS bloques devuelve solo el consultado, sin ninguna línea del otro', () => {
    const md = `# KL-9 — X\n\n${llmBlock('s-0', 'Lo viejo')}\n\n${llmBlock('s-1', 'Lo nuevo')}\n`;
    const block = findSessionBlock(md, 's-1');
    assert.ok(block, 'debe encontrar el bloque de s-1');
    assert.ok(block.includes('session=s-1'));
    assert.ok(!block.includes('session=s-0'), 'no incluye el heading del bloque anterior');
    assert.ok(!block.includes('Lo viejo'), 'no incluye ninguna línea del bloque anterior');
    assert.ok(!block.includes('Trabajo de s-0'));
  });

  it('el token se compara por igualdad EXACTA: session=s-1-extra no matchea s-1', () => {
    const md = `# KL-9 — X\n\n${llmBlock('s-1-extra', 'Otra sesión')}\n`;
    assert.equal(findSessionBlock(md, 's-1'), null, 'prefijo no confundible (no es substring)');
    assert.ok(findSessionBlock(md, 's-1-extra'), 'la sesión real sí matchea');
  });

  it('el bloque termina antes del siguiente heading ## ', () => {
    const md = `${llmBlock('s-1', 'Lo nuevo')}\n\n## Otra sección\n\nContenido ajeno.\n`;
    const block = findSessionBlock(md, 's-1');
    assert.ok(block, 'debe encontrar el bloque');
    assert.ok(!block.includes('## Otra sección'), 'no invade el siguiente heading');
    assert.ok(!block.includes('Contenido ajeno'));
    assert.ok(block.includes('**NEXT:** Lo nuevo'), 'sí incluye su propio cuerpo');
  });

  it('si es el último bloque, llega hasta el final del fichero', () => {
    const md = `# KL-9 — X\n\n## Otra sección\n\nAjeno.\n\n${llmBlock('s-1', 'Lo último')}\n`;
    const block = findSessionBlock(md, 's-1');
    assert.ok(block, 'debe encontrar el bloque');
    assert.ok(block.includes('**NEXT:** Lo último'), 'llega hasta el final');
    assert.ok(!block.includes('Ajeno'));
  });

  it('T-74-03 lado lector: un marcador en una línea que NO es heading ## Handoff se ignora', () => {
    const md = [
      '# KL-9 — X',
      '',
      'El summary hostil decía <!-- kodo:handoff v=1 session=s-1 author=llm --> en prosa.',
      '',
      '> ## Handoff citado <!-- kodo:handoff v=1 session=s-1 -->',
      '',
    ].join('\n');
    assert.equal(findSessionBlock(md, 's-1'), null, 'solo cuentan los headings ## Handoff reales');
    assert.equal(hasSessionHandoff(md, 's-1'), false);
  });

  it('nunca lanza con entradas no-string', () => {
    assert.equal(findSessionBlock(undefined, 's-1'), null);
    assert.equal(findSessionBlock(null, 's-1'), null);
    assert.equal(findSessionBlock('', 's-1'), null);
    assert.equal(findSessionBlock('# X', undefined), null);
    assert.equal(hasSessionHandoff(undefined, 's-1'), false);
  });

  it('hasSessionHandoff es true exactamente cuando findSessionBlock devuelve bloque', () => {
    const md = `${llmBlock('s-1', 'Lo nuevo')}\n`;
    for (const id of ['s-1', 's-0', 's-1-extra', '']) {
      assert.equal(
        hasSessionHandoff(md, id),
        findSessionBlock(md, id) !== null,
        `desincronizado para ${JSON.stringify(id)}`,
      );
    }
  });
});

describe('handoff: extractNext (D-02 — una línea, primera, truncada a 200)', () => {
  it('extrae el valor sin el prefijo y trimmed', () => {
    const block = llmBlock('s-1', 'Arreglar el parser de labels');
    assert.equal(extractNext(block), 'Arreglar el parser de labels');
  });

  it('con DOS líneas NEXT: devuelve la PRIMERA', () => {
    const block = [
      '## Handoff 2026-01-05 03:07 <!-- kodo:handoff v=1 session=s-1 author=llm -->',
      '',
      '**NEXT:** La primera',
      '**NEXT:** La segunda',
    ].join('\n');
    assert.equal(extractNext(block), 'La primera');
  });

  it('D-03: sobre el bloque MECÁNICO devuelve null (caso válido y esperado)', () => {
    const mech = buildHandoffBlock({
      sessionId: 's-1',
      reason: 'clear',
      status: 'running',
      at: new Date(2026, 0, 5, 3, 7, 0),
    });
    assert.equal(extractNext(mech), null);
  });

  it('trunca a exactamente 200 caracteres', () => {
    const block = llmBlock('s-1', 'a'.repeat(500));
    const next = extractNext(block);
    assert.equal(next.length, 200, 'una línea desbocada del LLM no debe engordar state.json');
  });

  it('un NEXT: vacío devuelve null', () => {
    const block = '## Handoff 2026-01-05 03:07 <!-- kodo:handoff v=1 session=s-1 -->\n\n**NEXT:**   ';
    assert.equal(extractNext(block), null);
  });

  it('nunca lanza con entradas vacías o no-string', () => {
    assert.equal(extractNext(null), null);
    assert.equal(extractNext(undefined), null);
    assert.equal(extractNext(''), null);
    assert.equal(extractNext(42), null);
  });

  it('ROUND-TRIP: extractNext(findSessionBlock(md, "s-1")) devuelve el NEXT de s-1, no el de s-0', () => {
    const md = `# KL-9 — X\n\n${llmBlock('s-0', 'Lo viejo')}\n\n${llmBlock('s-1', 'Lo nuevo')}\n`;
    assert.equal(extractNext(findSessionBlock(md, 's-1')), 'Lo nuevo');
    assert.equal(extractNext(findSessionBlock(md, 's-0')), 'Lo viejo');
  });

  it('ROUND-TRIP del contrato completo: lo que escribe la 74 lo parsea la 75', () => {
    // buildHandoffBlock (writer) → findSessionBlock (parser): el contrato cierra.
    const at = new Date(2026, 0, 5, 3, 7, 0);
    const md = `# KL-9 — X\n\n${buildHandoffBlock({ sessionId: 's-9', reason: 'logout', status: 'running', at })}`;
    assert.equal(hasSessionHandoff(md, 's-9'), true, 'el parser reconoce lo que el writer produjo');
    assert.equal(hasSessionHandoff(md, 's-8'), false);
    assert.equal(extractNext(findSessionBlock(md, 's-9')), null, 'el bloque mecánico no lleva NEXT:');
  });
});

describe('handoff: stripHandoffMarker (D-06 — dueño único del contrato, marcador invisible en la 75)', () => {
  it('elimina el marcador de un heading de handoff y hace trimEnd', () => {
    const line =
      '## Handoff 2026-07-17 <!-- kodo:handoff v=1 session=abc author=auto at=2026-07-17T10:00:00.000Z -->';
    assert.equal(stripHandoffMarker(line), '## Handoff 2026-07-17');
  });

  it('una línea SIN marcador queda intacta (idéntica)', () => {
    const line = '## Un heading normal sin marcador';
    assert.equal(stripHandoffMarker(line), line);
  });

  it('un marcador SIN cerrar (open sin close) queda intacto (conservador)', () => {
    const line = '## Handoff 2026-07-17 <!-- kodo:handoff v=1 session=abc author=auto';
    assert.equal(stripHandoffMarker(line), line);
  });

  it('never-throws: entrada no-string → cadena vacía', () => {
    assert.equal(stripHandoffMarker(null), '');
    assert.equal(stripHandoffMarker(undefined), '');
    assert.equal(stripHandoffMarker(42), '');
    assert.equal(stripHandoffMarker({}), '');
  });

  it('el contrato del writer cierra con el strip: buildHandoffBlock → stripHandoffMarker deja el heading limpio', () => {
    // ROUND-TRIP: lo que la 74 escribe con marcador, la 75 lo pinta sin él (D-06).
    const at = new Date(2026, 0, 5, 3, 7, 0);
    const block = buildHandoffBlock({ sessionId: 's-9', reason: 'logout', status: 'running', at });
    const heading = block.split('\n')[0];
    const stripped = stripHandoffMarker(heading);
    assert.ok(!stripped.includes('<!-- kodo:handoff'), 'el marcador desaparece del heading');
    assert.ok(stripped.startsWith('## Handoff '), 'el texto legible del heading se preserva');
    assert.ok(stripped.endsWith('automático'), 'trimEnd deja el heading sin espacio colgante');
  });
});
