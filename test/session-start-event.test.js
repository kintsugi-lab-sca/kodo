// @ts-check
//
// test/session-start-event.test.js — Phase 17 UAT-02 SC#2 coverage.
//
// Convierte el UAT humano #2 de Phase 7 (07-HUMAN-UAT.md) en integration test:
// dispara una emisión REAL de `session.start` desde el hook
// `src/hooks/session-start.js` con stdin canónico, y assertea contra el
// CONTRATO del helper `EVENTS.SESSION_START` + `sessionStart()` (no contra un
// fixture estático). Cambiar el contrato del helper rompe el test (D-09 + SC#2).
//
// D-decisions del CONTEXT.md aplicables (Phase 17, Plan 02):
//   - D-01: spawn `src/hooks/session-start.js` directamente (NO via bin/kodo) —
//           ese es el entry point que Claude Code invoca en producción.
//   - D-02: HOME override via env del child + mkdtempSync 'kodo-uat-session-start-'
//           + cleanup en after(). Import dinámico de `state.js` DESPUÉS de fijar
//           HOME (CR-02 pattern, replica de stop-state-transition.test.js:108-114).
//   - D-08: state.json sintético + stdin con session_id. Pre-poblar via
//           `addSession(taskId, session)` desde el test runner. Spawn child con
//           `stdin: 'pipe'` y escribir JSON `{session_id, transcript_path}`.
//   - D-09: imports estáticos `EVENTS.SESSION_START` (no depende de HOME).
//           Asserts contra contrato del helper, no contra fixture estático.
//   - D-10: fail-loud externo compensa el outer try/catch silent del hook
//           (src/hooks/session-start.js:223-225):
//             - file ausente → assert.fail con mensaje específico
//             - JSON malformed → assert.fail con la línea cruda
//             - event !== EVENTS.SESSION_START → assert.fail con record entero
//   - D-11: sesión sintética con `gsd: false` (no-GSD). session.start es
//           invariante al modo según líneas 184-186 del hook — basta una variante.
//
// Diferencia respecto a test/stop-state-transition.test.js:
// - Ese test usa DI directa con `runStopHook(input, deps)` y un memSink logger.
// - Este test ejerce el path FULL del hook como subprocess (D-01) — el binario
//   que Claude Code invoca en producción — y lee el NDJSON real escrito por el
//   sink. El logger NO se mockea: queremos verificar que el wiring
//   stdin → readStdin → findSession → createLogger → sessionStart escribe el
//   archivo correcto con el contenido correcto.

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

// D-09: import estático del contrato del helper. EVENTS.SESSION_START es una
// constante pura del módulo logger-events.js (solo importa node:os + node:path,
// no toca HOME ni I/O al evaluarse), así que importarlo eager es seguro.
import { EVENTS } from '../src/logger-events.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(__dirname, '..');
const HOOK_PATH = join(REPO, 'src', 'hooks', 'session-start.js');

// Resuelta dinámicamente DESPUÉS de fijar HOME (CR-02 pattern). state.js evalúa
// `KODO_DIR = join(homedir(), '.kodo')` al module load time vía config.js — si
// se importa con HOME=real, escribe al state.json del usuario.
let addSession;

describe('UAT-02 SC#2: session.start emite 6 campos canónicos D-10', () => {
  let tmpHome;
  let origHome;

  before(async () => {
    origHome = process.env.HOME;
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-uat-session-start-'));
    process.env.HOME = tmpHome;

    // El logger del hook hace `mkdirSync(logDir, { recursive: true })` antes de
    // escribir, pero pre-creamos `~/.kodo/logs/` para que un crash silencioso
    // del logger no se confunda con un fallo de bootstrap del directorio.
    // Además, addSession() escribe a `~/.kodo/state.json`; si el dir no existe
    // saveState() peta y el test fallaría en setup en vez de en el assert real.
    mkdirSync(join(tmpHome, '.kodo', 'logs'), { recursive: true });

    // CR-02 pattern: dynamic import DESPUÉS de fijar HOME. Tras este import el
    // módulo cacheado tiene KODO_DIR = `${tmpHome}/.kodo`. El subprocess que
    // spawneamos NO comparte el module cache (es un proceso aparte), pero sí
    // recibe HOME=tmpHome via env, por lo que su propia evaluación del módulo
    // resuelve al mismo path.
    const stateMod = await import('../src/session/state.js');
    addSession = stateMod.addSession;
  });

  after(() => {
    if (origHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = origHome;
    }
    if (tmpHome) {
      rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it('emits session.start as first NDJSON line with 6 canonical D-10 keys (D-08..D-11, fail-loud per D-10)', async () => {
    // D-11: sesión sintética no-GSD. `gsd: false` aísla UAT-02 del builder
    // GSD/quick context — el hook ramifica a buildSessionContext() (no-GSD) en
    // vez de buildGsdContext(). session.start se emite en AMBAS ramas porque
    // está fuera del switch de modo (líneas 188-208 del hook), así que la
    // emisión es invariante al modo.
    const session = {
      session_id: 'uat02-' + process.pid + '-' + Date.now(),
      task_id: 'kodo-uat02-task-' + process.pid,
      task_ref: 'KL-uat02',
      gsd: false,                           // D-11: aísla del builder GSD/quick
      status: 'running',
      provider: 'plane',
      project_id: 'p-uat02',
      project_path: tmpHome,                // child cwd = tmpHome → findSession matchea via cwd fallback
      workspace_ref: 'workspace:uat02',
      started_at: new Date().toISOString(),
      summary: 'UAT-02 integration session.start',
    };
    // D-08: state.json sintético — el hook llama findSession({sessionId, cwd})
    // que primero matchea por session_id exacto (preferred path).
    addSession(session.task_id, session);

    // D-01: spawn del hook como subprocess. process.execPath es el `node`
    // ejecutable del runner; HOOK_PATH es el script que Claude Code dispara.
    const child = spawn(process.execPath, [HOOK_PATH], {
      cwd: tmpHome,
      env: { ...process.env, HOME: tmpHome },  // D-02: child resuelve KODO_DIR=${tmpHome}/.kodo
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // D-08: stdin JSON. El hook hace JSON.parse(readStdin()) con timeout 3s.
    // Cerramos stdin con .end() inmediatamente tras escribir, así readStdin()
    // resuelve via 'end' event en <50ms (vs el timeout de 3000ms).
    const fakeTranscriptPath = '/tmp/fake-transcript-' + session.session_id + '.jsonl';
    const stdinPayload = JSON.stringify({
      session_id: session.session_id,
      transcript_path: fakeTranscriptPath,
      cwd: tmpHome,
    });
    child.stdin.write(stdinPayload);
    child.stdin.end();

    // Capturar stdout/stderr para diagnostics (no se assertea contenido per se,
    // pero se incluye en mensajes de fail-loud para debugging).
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (b) => { stdout += b.toString('utf8'); });
    child.stderr.on('data', (b) => { stderr += b.toString('utf8'); });

    const exitInfo = await new Promise((resolveP, rejectP) => {
      const t = setTimeout(
        () => rejectP(new Error('hook timeout 5s. stderr=' + stderr)),
        5000,
      );
      child.on('exit', (code, signal) => {
        clearTimeout(t);
        resolveP({ code, signal });
      });
    });

    // El hook tiene outer try/catch que traga errores → exit 0 incluso si crashea.
    // El verdadero gate es leer el NDJSON file (D-10 fail-loud below).
    assert.equal(
      exitInfo.code,
      0,
      'hook should exit 0 (silent on failure pattern). stderr=' + stderr,
    );

    // D-10 fail-loud: leer el NDJSON post-exit. El logger del hook escribe a
    // `${HOME}/.kodo/logs/<session_id>.ndjson` (src/logger.js:257-259).
    const ndjsonPath = join(tmpHome, '.kodo', 'logs', session.session_id + '.ndjson');
    if (!existsSync(ndjsonPath)) {
      assert.fail(
        'D-10 fail-loud: hook did not emit session.start NDJSON file at '
          + ndjsonPath
          + '. The outer try/catch (src/hooks/session-start.js:223-225) likely swallowed an error. '
          + 'stderr=' + stderr + ' stdout=' + stdout,
      );
    }

    const raw = readFileSync(ndjsonPath, 'utf-8').split('\n').filter(Boolean);
    assert.ok(raw.length >= 1, 'D-10 fail-loud: NDJSON file empty');

    let record;
    try {
      record = JSON.parse(raw[0]);
    } catch (e) {
      assert.fail(
        'D-10 fail-loud: first line malformed: ' + raw[0] + ' err=' + e.message,
      );
    }

    // D-09: assert contra contrato del helper EVENTS.SESSION_START.
    // Cambiar el valor de EVENTS.SESSION_START en src/logger-events.js rompe
    // este assert — exactamente lo que SC#2 pide.
    assert.equal(
      record.event,
      EVENTS.SESSION_START,
      'D-09: first event must equal EVENTS.SESSION_START. Got: ' + JSON.stringify(record),
    );

    // D-10: las 6 campos canónicos del contrato sessionStart() en
    // src/logger-events.js:80-92. Tipos y valores deben matchear lo que el hook
    // pasa al helper en src/hooks/session-start.js:198-205.
    assert.equal(record.session_id, session.session_id, 'session_id matches stdin input');
    assert.equal(record.task_id, session.task_id, 'task_id from session');
    assert.equal(record.provider, session.provider, 'provider from session');
    assert.equal(record.project_path, session.project_path, 'project_path from session');
    assert.equal(record.transcript_path, fakeTranscriptPath, 'transcript_path from stdin');
    assert.equal(typeof record.started_at, 'string', 'started_at is a string');
    assert.match(
      record.started_at,
      /^\d{4}-\d{2}-\d{2}T/,
      'started_at ISO-8601 format (YYYY-MM-DDT...)',
    );

    // D-09 sanity check: las 6 keys exactas presentes (defensa contra ausencia
    // silenciosa por crash a media-emisión o por refactor del helper que
    // elimine un campo).
    const requiredKeys = [
      'session_id',
      'task_id',
      'provider',
      'project_path',
      'transcript_path',
      'started_at',
    ];
    for (const k of requiredKeys) {
      assert.ok(
        k in record,
        'D-09: required key "' + k + '" missing from session.start record. record=' + JSON.stringify(record),
      );
    }
  });
});
