// @ts-check
//
// test/dashboard-altscreen.test.js — Phase 36 polish (hot-patch).
//
// Guard estructural: asegura que `runDashboard` enciende el alternate screen
// buffer (`\x1b[?1049h`) ANTES de render y lo apaga (`\x1b[?1049l`) al salir.
// Sin esto, cada redraw a un ancho distinto deja el frame previo en el
// scrollback como artefacto (cabeceras `kodo dashboard` apiladas, bordes
// fragmentados — UAT real del usuario tras Phase 36).
//
// LOAD-BEARING: este test cierra el agujero de cobertura de la UAT visual.
// Un refactor que retire las secuencias devolvería el bug sin que ningún test
// de comportamiento existente lo detecte (los tests de render usan ink-testing-
// library, que no ejercita la lógica de `runDashboard` ni el stdout real).
// Patrón: source-assertion (igual que test/format-isolation.test.js para
// color-isolation y test/dispatcher-isolation.test.js para event taxonomy).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const INDEX_PATH = resolve(HERE, '..', 'src', 'cli', 'dashboard', 'index.js');

test('runDashboard enables alternate screen buffer before render (Phase 36 hot-patch)', () => {
  const src = readFileSync(INDEX_PATH, 'utf8');
  // Buscamos la secuencia literal con escape de barra invertida para no
  // tropezar con encodings exóticos: `\x1b[?1049h` (alt-screen on).
  assert.ok(
    src.includes('\\x1b[?1049h'),
    'src/cli/dashboard/index.js must write the alt-screen-ON sequence (\\x1b[?1049h) before render() — without it, terminal resize leaves stacked frames in scrollback (UAT regression)',
  );
});

test('runDashboard disables alternate screen buffer on exit (always, even on crash)', () => {
  const src = readFileSync(INDEX_PATH, 'utf8');
  assert.ok(
    src.includes('\\x1b[?1049l'),
    'src/cli/dashboard/index.js must write the alt-screen-OFF sequence (\\x1b[?1049l) on exit — required to restore the original scrollback',
  );
  // Y debe estar dentro de un bloque `finally` para cubrir crashes/SIGTERM/Ctrl-C.
  // Regex tolerante a whitespace pero estricta sobre la cláusula.
  assert.match(
    src,
    /finally\s*\{[\s\S]*?\\x1b\[\?1049l/,
    'the alt-screen-OFF sequence MUST live inside a finally block so it fires on any exit path (q / Ctrl-C / SIGTERM / crash)',
  );
});

test('alt-screen sequences run AFTER the non-TTY guard (no ANSI to pipes/CI)', () => {
  const src = readFileSync(INDEX_PATH, 'utf8');
  // El guard non-TTY escribe NON_TTY_MSG y hace process.exit(1) antes de cualquier
  // ANSI. Anclamos a la llamada REAL `stdout.write('\x1b[?1049h')` (no a las
  // menciones en los comentarios de cabecera) buscando el patrón completo de la
  // sentencia. El guard se ancla a `process.exit(1)`.
  const guardIdx = src.indexOf('process.exit(1)');
  const altOnCallIdx = src.indexOf("stdout.write('\\x1b[?1049h')");
  assert.ok(guardIdx >= 0, 'non-TTY guard (process.exit(1)) must be present');
  assert.ok(
    altOnCallIdx >= 0,
    "the runtime call `stdout.write('\\x1b[?1049h')` must be present (not just doc comments)",
  );
  assert.ok(
    altOnCallIdx > guardIdx,
    'alt-screen-on call must come AFTER the non-TTY guard so pipes/CI never receive ANSI sequences',
  );
});
