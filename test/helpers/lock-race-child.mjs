// test/helpers/lock-race-child.mjs
//
// Child harness for the real-process lock race tests (Phase 70 Plan 01,
// Criterion 1) and the state-writers concurrency test (Phase 70 Plan 02).
// Invoked by:
//   - test/state/state-lock-concurrency.test.js    (--kind state)
//   - test/gsd-lock-race.test.js                   (--kind gsd, --kind gsd-holder,
//                                                   --kind gsd-seam)
//   - test/state/state-writers-concurrency.test.js (--kind writer)
//   - test/daemon/polling-start-race.test.js       (--kind polling)
//   - test/dispatcher-dedup-crossproc.test.js      (--kind dispatch)
//   - test/state/handoff-concurrency.test.js       (--kind handoff)
//   - test/state/migration-concurrency.test.js     (--kind migrator, --kind writer)
//   - test/inbox-concurrency.test.js               (--kind capture, --kind mark)
//
// Contract: attempt the acquire EXACTLY ONCE, then print exactly `acquired`
// or `blocked` to stdout and exit 0. Never throw — on any error print
// `blocked`. When `--barrier <goFile>` is given, busy-wait (short poll) until
// the go-file exists before attempting, so the parent can release all children
// simultaneously and maximise real contention.
//
// `--kind writer` (Plan 02): each child dynamic-imports ../../src/session/state.js
// AFTER its HOME is set (the parent spawns it with an isolated HOME env so
// KODO_DIR resolves to the sandbox) and calls addSession('task-<idx>', {...}) for
// its assigned index. All writers race one isolated state.json; the parent then
// asserts zero lost writes. Writer mode prints `written` (or `failed`) and never
// throws. It ignores --lock/--repo and reads --idx.
//
// `--kind handoff` (Phase 74 Plan 05): each child dynamic-imports
// ../../src/hooks/session-end.js AFTER its HOME is set (parent spawns it with an
// isolated HOME env so KODO_DIR — and therefore ~/.kodo/plans — resolves to the
// sandbox) and calls writeHandoff({session, input, log}, {}) with EMPTY deps, so
// the real defaults (join(KODO_DIR, 'plans') + upsertTaskHandoff) are exercised.
// `--task <taskId>` selects the race: a DIFFERENT task per child races state.json
// (state.tasks, LIVE-04); the SAME task for every child races one plan file's
// read-modify-write (D-08, the lost update). Prints `written` (or `failed`) and
// never throws. Reads --idx (→ session_id `sess-<idx>`, which makes D-04's
// authorship detector see every child as a distinct session) and --task.
//
// `--kind capture` (Phase 83 Plan 03, CAPT-01/D-21.1): each child
// dynamic-imports ../../src/inbox/store.js AFTER its HOME is set (parent spawns
// it with an isolated HOME env so defaultInboxPaths() resolves inside the
// sandbox) and appendCaptures ONE line whose id is DETERMINISTIC — `cap<idx>` —
// so the parent can assert the identity of every surviving line without
// depending on the random id generator. The lock-timeout warn is silenced with
// an injected no-op `warnFn`: in this race the fail-open is an EXPECTED outcome
// (D-03), not an error. Prints `written` (or `failed`) and never throws. Reads
// --idx and the optional --sandbox.
//
// `--kind capture` + `--sandbox` (Phase 83 Plan 06, WR-03): with the flag the
// child ALSO appends ONE line to `<sandbox>/capture-branches.log` naming the
// BRANCH its append took — `coordinated` (it held the lock) or `failopen` (the
// lock-timeout fail-open of D-03). Same cross-process marker pattern the
// `polling` and `dispatch` kinds already use (append is atomic at this size).
// Why it exists: Plan 83-04 put the capture's lock budget back on the
// primitive's defaults, and the suite must be able to PROVE the fail-open lane
// is still being exercised instead of assuming it — with the recalibrated
// budget of 83-03 all 18 children went down the coordinated lane and the mixed
// scenario silently stopped covering the very code path that lost data. The
// marker is a SIDE CHANNEL: the stdout contract below is unchanged, so the six
// existing consumers of this harness are untouched, and a failure to write it
// can never change this child's verdict.
//
// `--kind mark` (Phase 83 Plan 03, CAPT-03 crit 3 / D-21.2 — the scenario that
// justifies D-01): dynamic-imports the same module and calls markCapture(--id,
// 'enrutada', {dest, _afterReadFn}). The injected `_afterReadFn` sleeps
// SYNCHRONOUSLY for `--hold` ms inside the lock, after the fresh read and
// before the rename — that is what deterministically WIDENS the read→rename
// window during which the `capture` siblings append. Marking does NOT fail open
// (contract 3): if the lock is busy the child reports `failed` and the parent
// does not mask it. Prints `written` (or `failed`) and never throws. Reads --id,
// --hold and the optional --dest.
//
// `--kind gsd-holder` (Phase 86 Plan 02, LOCK-05 a / D-12): el holder
// STALE PERO VIVO que esta fase necesita y que el repo no sabía sembrar. Escribe
// `<repo>/.planning/.kodo.lock` con el PID de ESTE proceso —vivo mientras dura la
// carrera— y `acquired_at` retrodatado 5 h sobre un `ttl_hours` de 4, que es
// exactamente el Case-3 de `acquireGsdLock` (`src/gsd/lock.js:161-171`). JAMÁS un
// PID muerto: ese sesgo (`DEAD_PID = 99999999` de `test/gsd-lock-guard.test.js`) es
// precisamente lo que mantiene invisible la carrera de SEGUNDO orden, porque un
// holder muerto no puede LIBERAR en plena sección crítica del stealer. Tras sembrar
// deja el marcador `holder-seeded` en `--sandbox`, espera la barrera `--release` y
// ejecuta `releaseGsdLock(repo, 'sess-live-holder')` — el `unlink` que abre el hueco
// donde aterriza el creador Case-1. Veredicto `written`/`failed`, NUNCA `acquired`:
// el holder no adquiere nada y el padre cuenta los `acquired` sobre TODOS los hijos.
// Never-throws.
//
// HANDSHAKES DE ARRANQUE Y CIERRE (Phase 87, KODO-24) — se activan pasando
// `--sandbox` a los kinds `gsd`, `gsd-seam` y `gsd-holder`, y no existen para
// ningún otro consumidor del harness:
//
//  - `ready-<pid>`: el hijo precarga `src/gsd/lock.js` y publica este marcador ANTES
//    de esperar su `--barrier`. Sin él, escribir un go-file NO significaba que el
//    hijo estuviera contendiendo: el coste real no es el `spawn` del padre sino el
//    arranque del proceso más el import ESM en frío, y bajo carga medida (20
//    procesos quemando CPU en 12 cores) un hijo llegaba a bootear 245 ms tarde, o
//    sea DESPUÉS de que el escenario hubiera cerrado. Entonces encontraba el lock
//    del ganador ya salido —PID muerto— y lo robaba con toda la razón, sumando un
//    segundo `acquired` al agregado sin que ningún invariante se hubiera roto.
//  - `settled-<pid>` (solo kind `gsd`): publicado en cuanto `acquireGsdLock` retorna
//    y ANTES del hold. Es la otra mitad: el padre no cierra el escenario mientras
//    alguien sigue contendiendo.
//  - `barrier-timeouts.log`: una línea por barrera VENCIDA. Antes, vencer y cumplirse
//    eran indistinguibles desde fuera —el hijo continuaba igual—, así que una
//    desincronización de la orquestación daba el MISMO rojo que un fallo del
//    invariante del lock, y los dos tienen arreglos opuestos.
//
// Los tres son CANALES LATERALES, molde del marcador de rama de `capture`: van en su
// propio try/catch y su fallo jamás cambia lo que el hijo imprime ni lo hace lanzar.
//
// `--kind gsd-seam` (Phase 86 Plan 02, LOCK-05 b): el stealer que se APARCA dentro
// de la sección crítica del steal. Llama a `acquireGsdLock` con el tercer parámetro
// de deps de 86-01 y le pasa por `_afterCriticalReadFn` un callback que escribe el
// marcador `stealer-parked` en `--sandbox` y espera la barrera `--resume`. BARRERA,
// no `sleepSync`: a diferencia del precedente del inbox, aquí el padre PUEDE
// observar en disco que el lock desapareció y reapareció, así que el interleaving es
// determinista POR CONSTRUCCIÓN y no por anchura de ventana. El techo de la espera
// (3000 ms) es un fallo ruidoso deliberadamente por debajo de
// `STEAL_GUARD_STALE_MS = 5_000`: mientras está aparcado RETIENE el steal-guard, y
// si el aparcamiento superase ese umbral un stealer extra lo rompería por edad y
// entrarían DOS a la sección crítica — el escenario pasaría a medir la carrera de
// PRIMER orden que la Phase 82 ya cerró. Veredicto `acquired`/`blocked`. Después del
// veredicto lógico y en su propio try/catch, apenda su `reason` a `steal-reasons.log`
// en `--sandbox` — canal LATERAL, molde del marcador de `capture`: su fallo nunca
// cambia lo que este hijo imprime ni lo hace lanzar. Es lo que permite al padre
// PROBAR que la rama del CAS se ejerció, en vez de suponerlo. Never-throws.
//
// argv:
//   --kind   state|gsd|gsd-holder|gsd-seam|writer|migrator|polling|dispatch|handoff|
//            capture|mark        (required)
//   --lock   <path>             (state: the lockfile path)
//   --repo   <path>             (gsd/gsd-holder/gsd-seam: the fake repo dir)
//   --idx    <n>                (writer/handoff/capture: this writer's index)
//   --task   <taskId>           (dispatch/handoff: the task_id to write —
//                                handoff defaults to `task-<idx>`)
//   --sandbox <dir>             (polling/dispatch: the isolated ~/.kodo sandbox
//                                root. capture, OPTIONAL: same root, used as the
//                                destination of the `capture-branches.log`
//                                branch marker — absent, no marker is written.
//                                gsd-holder: destino del marcador `holder-seeded`.
//                                gsd-seam: destino de `stealer-parked` y del
//                                marcador lateral `steal-reasons.log`.
//                                gsd, OPCIONAL: activa los handshakes de
//                                `ready-<pid>` / `settled-<pid>` y el marcador
//                                `barrier-timeouts.log` — ausente, ningún marcador
//                                se escribe y el kind se comporta como siempre)
//   --id     <captureId>        (mark: the short id of the capture to close)
//   --dest   <ref>              (mark, optional: the opaque trace pointer — kodo
//                                never validates nor interprets it, D-11)
//   --barrier <goFile>          (optional: wait until this file exists)
//   --hold   <ms>               (optional: after a successful acquire, stay
//                                alive holding the lock for <ms> before exit —
//                                models a holder's critical section so a
//                                slightly-later sibling sees a LIVE owner and
//                                is blocked, instead of stealing a dead-PID
//                                lock the winner abandoned by exiting.
//                                `--kind mark` reuses it as the width of the
//                                read→rename window, held inside the lock)
//   --hold-async <1>            (dispatch, opcional: mantiene el hold con un
//                                `setTimeout` en vez de `Atomics.wait`, dejando el
//                                event loop libre. Necesario para ejercer el
//                                heartbeat del dedup lock — KODO-48 — que no puede
//                                latir con el loop bloqueado. Opt-in: los consumidores
//                                previos no lo pasan y su timing no cambia)
//   --release <goFile>          (gsd-holder: barrera tras la cual el holder
//                                ejecuta `releaseGsdLock` y sale)
//   --resume <goFile>           (gsd-seam: barrera que saca al stealer del seam,
//                                de vuelta al tmp + CAS + rename)
//   --hold-until <goFile>       (gsd/state, opcional: en vez de dormir `--hold` ms,
//                                el GANADOR espera esta barrera antes de salir, así
//                                el padre decide cuándo termina el escenario sin
//                                calibrar ninguna duración. Extensión ADITIVA: tiene
//                                prioridad sobre `--hold` cuando ambos están
//                                presentes, y ningún consumidor existente la pasa)

import { existsSync, appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** El `session_id` que siembra el kind `gsd-holder`. Constante conocida para que su
 *  propio `releaseGsdLock` pueda casarla y para que el padre distinga en disco el
 *  lock del holder del de cualquier otro contendiente. */
const HOLDER_SESSION_ID = 'sess-live-holder';

/** Parse `--flag value` pairs from argv into a plain object. */
function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      out[a.slice(2)] = argv[i + 1];
      i++;
    }
  }
  return out;
}

/**
 * Sleep SYNCHRONOUSLY for `ms` — same primitive the barrier spin uses, so a
 * synchronous critical section can be widened without an async boundary.
 */
function sleepSync(ms) {
  const sab = new Int32Array(new SharedArrayBuffer(4));
  Atomics.wait(sab, 0, 0, ms);
}

/**
 * Busy-wait (bounded) until the barrier go-file appears.
 *
 * Devuelve `true` si la barrera LLEGÓ y `false` si venció el techo (Phase 87,
 * KODO-24). El valor de retorno es ADITIVO: los seis consumidores previos lo
 * ignoran y su comportamiento no cambia. Existe porque una barrera vencida se
 * comportaba EXACTAMENTE igual que una barrera cumplida —el hijo continuaba como
 * si la señal hubiera llegado—, de modo que un escenario que se desincronizaba
 * bajo carga degradaba a medir otra cosa en SILENCIO. Quien pasa un `--sandbox`
 * puede además dejar constancia con `noteBarrierTimeout`.
 */
function waitForBarrier(goFile, timeoutMs = 5000) {
  if (!goFile) return true;
  const deadline = Date.now() + timeoutMs;
  // Tight spin with a tiny Atomics sleep to avoid pegging the CPU while still
  // reacting within ~1ms of the go-file appearing.
  const sab = new Int32Array(new SharedArrayBuffer(4));
  while (!existsSync(goFile) && Date.now() < deadline) {
    Atomics.wait(sab, 0, 0, 1);
  }
  return existsSync(goFile);
}

/**
 * Marcador lateral de barrera VENCIDA (Phase 87, KODO-24). Molde literal del
 * marcador de rama del kind `capture`: canal lateral, en su propio try/catch, su
 * fallo jamás cambia el veredicto de este hijo ni lo hace lanzar. El padre lo lee
 * para poder distinguir «el invariante del lock se rompió» de «la orquestación se
 * desincronizó», que producen el mismo rojo y tienen arreglos opuestos.
 *
 * @param {string | undefined} sandbox
 * @param {string} name — qué barrera venció, p. ej. `barrier` o `release`
 */
function noteBarrierTimeout(sandbox, name) {
  if (!sandbox) return;
  try {
    appendFileSync(join(sandbox, 'barrier-timeouts.log'), `${name}:${process.pid}\n`);
  } catch {
    /* el marcador es diagnóstico, jamás un veredicto */
  }
}

/**
 * Handshake de PREPARADO (Phase 87, KODO-24). Precarga el módulo que el hijo va a
 * ejercitar y publica `<sandbox>/ready-<pid>` ANTES de esperar su barrera.
 *
 * Por qué existe: el padre spawnea a todos los hijos antes de la primera
 * liberación para dejar el `spawn` fuera de la ventana, pero el spawn no es el
 * coste real — lo es el ARRANQUE del proceso más el import ESM en frío. Medido
 * bajo carga (20 procesos quemando CPU en 12 cores), un hijo booteaba hasta 245 ms
 * después del primero: escribir su go-file NO significaba que estuviera
 * contendiendo, y llegaba cuando el escenario ya había cerrado. Con el marcador,
 * el padre espera ESTADO DE DISCO —«el hijo está arrancado y con el módulo
 * cargado»— en vez de suponerlo por haber escrito la barrera.
 *
 * El import es el mismo especificador que usa cada rama después, así que el
 * registro de módulos de ESM ya lo tiene resuelto y el `await import` posterior es
 * una consulta en memoria: el coste sale de la ventana medida. `src/gsd/lock.js`
 * no lee `HOME` ni `KODO_DIR` (opera sobre `--repo`), de modo que precargarlo no
 * viola la disciplina de import DINÁMICO POST-HOME del resto del fichero.
 *
 * @param {{ kind?: string, sandbox?: string }} args
 */
async function markReady(args) {
  if (!args.sandbox) return;
  if (args.kind !== 'gsd' && args.kind !== 'gsd-seam' && args.kind !== 'gsd-holder') return;
  try {
    await import('../../src/gsd/lock.js');
    writeFileSync(join(args.sandbox, `ready-${process.pid}`), String(process.pid));
  } catch {
    /* sin marcador el padre falla con su propio mensaje, que es la reacción correcta */
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // Handshake de PREPARADO antes de la barrera: precarga + `ready-<pid>`. No-op
  // salvo para los kinds gsd* con `--sandbox`, así que los consumidores previos
  // del harness no ven ningún cambio.
  await markReady(args);
  if (!waitForBarrier(args.barrier)) noteBarrierTimeout(args.sandbox, 'barrier');

  // Writer mode (Plan 02): dynamic-import state.js AFTER HOME is set by the
  // parent (env), then addSession for this writer's index. Never throws.
  if (args.kind === 'writer') {
    let written = false;
    try {
      const { addSession } = await import('../../src/session/state.js');
      const idx = args.idx;
      addSession('task-' + idx, {
        workspace_ref: 'workspace:' + idx,
        session_id: 's' + idx,
        task_id: 'task-' + idx,
        task_ref: 'KL-' + idx,
        provider: 'test',
        project_id: 'p1',
        summary: 'writer ' + idx,
        status: 'running',
        started_at: new Date().toISOString(),
        project_path: '/tmp/w' + idx,
      });
      written = true;
    } catch {
      written = false;
    }
    process.stdout.write(written ? 'written' : 'failed');
    process.exit(0);
  }

  // Migrator mode (KODO-37): LECTOR PURO. Dynamic-import state.js AFTER HOME is
  // set by the parent (env) y una sola llamada a `loadState()` — nada de
  // mutadores, nada de `withStateLock`. Es exactamente la ruta que el bug
  // exponía: sobre un state.json v2, `loadState` dispara la migración, y ésta
  // era la única escritura del fichero fuera del lock y fuera del tmp+rename, de
  // modo que un lector recién arrancado podía publicar su migración ENCIMA del
  // `saveState` de un escritor concurrente. Imprime `v<schema>:<nSesiones>` (o
  // `failed`) y nunca lanza. Ignora --lock/--repo.
  if (args.kind === 'migrator') {
    let verdict = 'failed';
    try {
      const { loadState } = await import('../../src/session/state.js');
      const state = loadState();
      verdict = 'v' + state.schema_version + ':' + Object.keys(state.sessions || {}).length;
    } catch {
      verdict = 'failed';
    }
    process.stdout.write(verdict);
    process.exit(0);
  }

  // Handoff mode (Phase 74 Plan 05, LIVE-04/D-08): dynamic-import session-end.js
  // AFTER HOME is set by the parent (env), then writeHandoff with EMPTY deps so the
  // real defaults resolve — plansDir → join(KODO_DIR, 'plans') and stateWriterFn →
  // upsertTaskHandoff, both inside the sandbox. The import MUST stay dynamic and
  // POST-HOME (RESEARCH §Pitfall 6): config.js:11 evaluates join(homedir(), '.kodo')
  // at module-load, so a static import would write to the operator's REAL ~/.kodo.
  // Never throws — any error collapses to `failed`.
  if (args.kind === 'handoff') {
    let written = false;
    try {
      const { writeHandoff } = await import('../../src/hooks/session-end.js');
      const idx = args.idx;
      const taskId = args.task || 'task-' + idx;
      const noop = () => {};
      writeHandoff(
        {
          session: {
            task_id: taskId,
            // Distinct session per child → D-04's scoped authorship detector finds no
            // block of its own session, so every child appends (that is the race).
            session_id: 'sess-' + idx,
            task_ref: 'KL-' + idx,
            summary: 'handoff racer ' + idx,
            status: 'running',
          },
          input: { reason: 'clear' },
          log: { info: noop, warn: noop, error: noop, debug: noop },
        },
        {},
      );
      written = true;
    } catch {
      written = false;
    }
    process.stdout.write(written ? 'written' : 'failed');
    process.exit(0);
  }

  // Inbox capture mode (Phase 83 Plan 03, CAPT-01/D-21.1): dynamic-import
  // store.js AFTER HOME is set by the parent (env), so defaultInboxPaths()
  // resolves `<sandbox>/.kodo/inbox.md`. The import MUST stay dynamic and
  // POST-HOME (RESEARCH §Pitfall 5): a static import would evaluate homedir()
  // at module-load and this child would append to the operator's REAL
  // ~/.kodo/inbox.md. The id is DETERMINISTIC (`cap<idx>`, inside the parser's
  // [0-9a-z]+ alphabet) so the parent asserts identity per line, not just count.
  // Never throws — any error collapses to `failed`.
  if (args.kind === 'capture') {
    let written = false;
    /** @type {'coordinated' | 'failopen' | null} */
    let branch = null;
    try {
      const { appendCapture, defaultInboxPaths, encodeLine, todayLocal } = await import(
        '../../src/inbox/store.js'
      );
      const idx = String(args.idx);
      const { inboxPath, lockPath } = defaultInboxPaths();
      const line = encodeLine({
        id: 'cap' + idx.padStart(3, '0'),
        text: 'captura concurrente ' + idx,
        tag: 'kodo-race',
        date: todayLocal(),
        origin: 'cli',
        open: true,
        estado: null,
        dest: null,
      });
      // warnFn silenced: the fail-open on lock-timeout (D-03) is an EXPECTED
      // outcome of this race, not an error. The parent asserts on the file.
      const res = appendCapture(line + '\n', { inboxPath, lockPath, warnFn: () => {} });
      written = res.ok === true;
      // `coordinated` distingue las dos ramas del append: true = escribió bajo el lock,
      // false = fail-open tras el lock-timeout (D-03). Un fallo de escritura NO deja marca:
      // el veredicto por stdout ya cubre ese caso.
      if (written) branch = res.coordinated === true ? 'coordinated' : 'failopen';
    } catch {
      written = false;
      branch = null;
    }
    // Marcador cross-proceso de rama (Plan 83-06, WR-03). Canal LATERAL: va después del
    // veredicto lógico, en su propio try/catch, y su fallo nunca cambia lo que este hijo
    // imprime ni lo hace lanzar.
    if (branch !== null && args.sandbox) {
      try {
        const { appendFileSync } = await import('node:fs');
        const { join } = await import('node:path');
        appendFileSync(join(args.sandbox, 'capture-branches.log'), branch + '\n');
      } catch {
        /* el marcador es diagnóstico, jamás un veredicto */
      }
    }
    process.stdout.write(written ? 'written' : 'failed');
    process.exit(0);
  }

  // Inbox mark mode (Phase 83 Plan 03, CAPT-03 crit 3 / D-21.2): same dynamic
  // POST-HOME import discipline. `_afterReadFn` is the injected seam from Plan
  // 01: it runs INSIDE the lock, after the fresh read and before the rename, so
  // sleeping there widens the read→rename window deterministically — no timing
  // hacks, no test code in production. The `capture` siblings append during that
  // window; the parent then asserts NONE of them was lost.
  // markCapture does NOT fail open (contract 3): a busy lock yields `failed`.
  if (args.kind === 'mark') {
    let written = false;
    try {
      const { defaultInboxPaths, markCapture } = await import('../../src/inbox/store.js');
      const { inboxPath, lockPath } = defaultInboxPaths();
      const holdMs = Number(args.hold || 300);
      const res = markCapture(args.id, 'enrutada', {
        dest: args.dest ?? null,
        inboxPath,
        lockPath,
        _afterReadFn: () => sleepSync(holdMs),
      });
      written = res.ok === true;
    } catch {
      written = false;
    }
    process.stdout.write(written ? 'written' : 'failed');
    process.exit(0);
  }

  // GSD live-holder mode (Phase 86 Plan 02, LOCK-05 a / D-12): siembra un lock
  // STALE PERO VIVO —TTL vencido con el PID de este proceso, que sigue corriendo— y
  // lo libera bajo barrera, en plena sección crítica del stealer aparcado. Ver el
  // párrafo del bloque de cabecera. El import se mantiene DINÁMICO aunque aquí la
  // fuga de HOME no aplique (`gsd/lock.js` opera sobre `--repo`): es la norma del
  // fichero y romperla invita a copiarla mal en el siguiente kind.
  // Never-throws — cualquier error colapsa a `failed`.
  if (args.kind === 'gsd-holder') {
    let written = false;
    try {
      const { mkdirSync, writeFileSync, realpathSync } = await import('node:fs');
      const { join } = await import('node:path');
      // realpathSync obligatorio: `lockPathFor` resuelve el projectPath y en macOS
      // `mkdtempSync` entrega rutas bajo un symlink (/tmp → /private/tmp, Pitfall 4).
      const planning = join(realpathSync(args.repo), '.planning');
      mkdirSync(planning, { recursive: true });
      writeFileSync(
        join(planning, '.kodo.lock'),
        JSON.stringify(
          {
            session_id: HOLDER_SESSION_ID,
            task_id: 'uuid-live-holder',
            task_ref: 'KL-live',
            pid: process.pid, // VIVO: sin esto el holder no podría LIBERAR de verdad
            acquired_at: new Date(Date.now() - 5 * 3600_000).toISOString(), // > ttl
            ttl_hours: 4,
          },
          null,
          2,
        ) + '\n', // misma serialización que `serializeLockContent`
      );
      writeFileSync(join(args.sandbox, 'holder-seeded'), String(process.pid));
      if (!waitForBarrier(args.release, 3000)) noteBarrierTimeout(args.sandbox, 'release');
      const { releaseGsdLock } = await import('../../src/gsd/lock.js');
      releaseGsdLock(args.repo, HOLDER_SESSION_ID);
      written = true;
    } catch {
      written = false;
    }
    process.stdout.write(written ? 'written' : 'failed');
    process.exit(0);
  }

  // GSD seam-stealer mode (Phase 86 Plan 02, LOCK-05 b): el stealer que se aparca
  // DENTRO de la sección crítica del steal usando el seam `_afterCriticalReadFn` de
  // 86-01, y espera una BARRERA en vez de dormir una anchura calibrada. Ver el
  // párrafo del bloque de cabecera. Never-throws.
  if (args.kind === 'gsd-seam') {
    let acquired = false;
    /** @type {string | null} */
    let reason = null;
    try {
      const { acquireGsdLock } = await import('../../src/gsd/lock.js');
      const { writeFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const result = /** @type {any} */ (
        acquireGsdLock(
          args.repo,
          {
            session_id: 'sess-' + process.pid,
            task_id: 'task-' + process.pid,
            task_ref: 'KL-' + process.pid,
          },
          {
            _afterCriticalReadFn: () => {
              // Marcador escrito DESDE DENTRO del seam: indicador estrictamente más
              // fuerte que la existencia del `.steal-guard`, que podría venir de un
              // intento anterior.
              writeFileSync(join(args.sandbox, 'stealer-parked'), String(process.pid));
              // Techo de fallo ruidoso, claramente por debajo de
              // STEAL_GUARD_STALE_MS: mientras esperamos RETENEMOS el steal-guard.
              if (!waitForBarrier(args.resume, 3000)) noteBarrierTimeout(args.sandbox, 'resume');
            },
          },
        )
      );
      acquired = result.acquired === true;
      reason = result.reason ?? 'no-reason';
    } catch {
      acquired = false;
      reason = null; // sin llamada no hay rama que registrar; el veredicto ya lo cubre
    }
    // Marcador cross-proceso del `reason` (LOCK-05 c). Canal LATERAL, molde literal
    // del marcador de rama del kind `capture`: va después del veredicto lógico, en su
    // propio try/catch, y su fallo nunca cambia lo que este hijo imprime ni lo hace
    // lanzar.
    if (reason !== null && args.sandbox) {
      try {
        const { appendFileSync } = await import('node:fs');
        const { join } = await import('node:path');
        appendFileSync(join(args.sandbox, 'steal-reasons.log'), reason + '\n');
      } catch {
        /* el marcador es diagnóstico, jamás un veredicto */
      }
    }
    process.stdout.write(acquired ? 'acquired' : 'blocked');
    process.exit(0);
  }

  // Polling-start mode (Plan 04, CONC-06/D-12): each child calls startDaemon
  // against an isolated HOME (the parent spawns it with HOME=sandbox so
  // ~/.kodo resolves inside the sandbox — the start-lock AND the PID file both
  // live there). The injected `_spawn` records ONE line per real spawn decision
  // to `spawns.log` and writes a live PID file (its own pid), so the winner's
  // bounded-wait resolves and a later loser's pre-flight sees the daemon alive.
  // Verdicts: `started` (the one winner), `already_starting` (blocked on the
  // start-lock) or `already_running` (acquired after the winner released).
  // The parent asserts on the AGGREGATE: exactly one spawn line, exactly one
  // `started` — never on which child wins.
  if (args.kind === 'polling') {
    let verdict = 'blocked';
    try {
      const { startDaemon } = await import('../../src/daemon/lifecycle.js');
      const { writePidFile } = await import('../../src/cli/polling-daemon.js');
      const { appendFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const spawnsLog = join(args.sandbox, 'spawns.log');
      const res = await startDaemon('kodo', ['daemon', 'run'], {
        _spawn: () => {
          // Real spawn decision → cross-process marker (append is atomic for small writes).
          appendFileSync(spawnsLog, `${process.pid}\n`);
          // Emulate the daemon writing a LIVE PID immediately. We use the shared
          // parent (the test runner, process.ppid) because it stays alive for the
          // whole race window — the child itself exits right after printing its
          // verdict, which would make its own pid go stale and let a later loser
          // re-spawn. With a live PID the loser's pre-flight sees `already_running`.
          writePidFile(
            { pid: process.ppid, started_at: new Date().toISOString(), kind: 'daemon' },
            'kodo',
          );
          return { unref() {} };
        },
        _waitMs: 2000,
      });
      if (res.alreadyStarting) verdict = 'already_starting';
      else if (res.alreadyRunning) verdict = 'already_running';
      else if (res.started) verdict = 'started';
      else verdict = 'timed_out';
    } catch {
      verdict = 'error';
    }
    process.stdout.write(verdict);
    process.exit(0);
  }

  // Dispatch-dedup mode (Plan 04, CONC-08/D-13): each child calls dispatchTrigger
  // for the SAME non-GSD task_id against an isolated HOME (KODO_DIR → sandbox), so
  // the per-task_id lock at `~/.kodo/locks/dispatch-<task_id>.lock` is shared. The
  // stubbed launchWorkItemFn appends ONE line per real launch to `launches.log` and
  // then HOLDS the lock (sleep --hold ms) so a concurrent loser's retries:0 attempt
  // lands during the hold → `already_active`. Verdicts: `launched` (one winner) vs
  // `already_active`. Parent asserts exactly one launch line — never which wins.
  if (args.kind === 'dispatch') {
    // dispatchTrigger logs progress to stdout via console.log; silence it so the
    // ONLY thing on this child's stdout is its verdict (the parent parses stdout).
    console.log = () => {};
    let verdict = 'error';
    try {
      const { dispatchTrigger } = await import('../../src/triggers/dispatcher.js');
      const { appendFileSync } = await import('node:fs');
      const { join } = await import('node:path');
      const launchLog = join(args.sandbox, 'launches.log');
      const holdMs = Number(args.hold || 500);
      const taskId = args.task;
      const fakeProvider = {
        getTask: async () => ({
          id: taskId,
          ref: 'KL-' + taskId,
          title: 'race task',
          description: '',
          labels: ['kodo'], // non-GSD: kodo label, no gsd flag
          projectId: 'p',
          projectName: 'P',
          groups: [],
          url: '',
          priority: 'medium',
        }),
      };
      const res = await dispatchTrigger(
        { taskRef: 'KL-' + taskId, action: 'state_change', provider: 'test', raw: {} },
        {},
        {
          getProviderFn: () => fakeProvider,
          launchWorkItemFn: async () => {
            // Record the real launch (cross-process marker), then hold the lock so
            // the concurrent sibling's single acquire attempt lands during the hold.
            appendFileSync(launchLog, `${process.pid}\n`);
            if (args['hold-async'] !== undefined) {
              // Hold ASÍNCRONO (KODO-48). El hold por defecto es `Atomics.wait`, que
              // bloquea el event loop: con él, el heartbeat del dedup lock jamás
              // podría latir y el escenario de «launch más largo que el TTL» mediría
              // otra cosa. Un launch real es IO async (provider + cmux), no un bucle
              // síncrono, así que esta es la forma fiel para ese caso. Opt-in para no
              // tocar el timing de los escenarios que ya existen.
              await new Promise((r) => setTimeout(r, holdMs));
            } else {
              const sab = new Int32Array(new SharedArrayBuffer(4));
              Atomics.wait(sab, 0, 0, holdMs);
            }
            return {
              workspace_ref: 'w', session_id: 's', task_id: taskId, task_ref: 'KL',
              provider: 'test', project_id: 'p', summary: 'race', status: 'running',
              started_at: new Date().toISOString(), project_path: '/tmp/x',
            };
          },
          listSessionsFn: () => [],
          listWorkspacesFn: async () => '',
          removeSessionFn: () => {},
          // Return null → no projectPath → skip worktree collision check; keeps the
          // path minimal (the dedup lock is what we exercise here).
          resolveProjectPathFn: () => null,
        },
      );
      verdict = res.action;
    } catch (e) {
      verdict = 'error:' + (e && e.message ? e.message : String(e));
    }
    process.stdout.write(verdict);
    process.exit(0);
  }

  let acquired = false;
  try {
    if (args.kind === 'state') {
      const { acquireLock } = await import('../../src/session/state-lock.js');
      const got = acquireLock(args.lock, { retries: 0 });
      acquired = !!(got && got.token);
    } else if (args.kind === 'gsd') {
      const { acquireGsdLock } = await import('../../src/gsd/lock.js');
      const result = acquireGsdLock(args.repo, {
        session_id: 'sess-' + process.pid,
        task_id: 'task-' + process.pid,
        task_ref: 'KL-' + process.pid,
      });
      acquired = result.acquired === true;
    }
  } catch {
    acquired = false;
  }

  // Handshake de ASENTADO (Phase 87, KODO-24), pareado con `ready-<pid>`: publica
  // `<sandbox>/settled-<pid>` en cuanto el intento de adquisición TERMINA y ANTES
  // del hold. Es lo que permite al padre no cerrar el escenario mientras alguien
  // sigue contendiendo: si el ganador se marcha con un contendiente aún dentro de
  // `acquireGsdLock`, ese contendiente encuentra un lock de PID muerto y lo roba
  // —legítimamente— añadiendo un segundo `acquired` al agregado. El marcador es
  // lateral: en su propio try/catch, jamás cambia el veredicto de este hijo.
  if (args.sandbox && args.kind === 'gsd') {
    try {
      writeFileSync(join(args.sandbox, `settled-${process.pid}`), acquired ? 'acquired' : 'blocked');
    } catch {
      /* el marcador es diagnóstico, jamás un veredicto */
    }
  }

  // Hold the lock (stay alive) for the winner so concurrent siblings observe a
  // LIVE owner and are blocked, rather than stealing a lock abandoned by exit.
  //
  // `--hold-until` (Phase 86 Plan 02) es la variante POR BARRERA del mismo hold: el
  // ganador espera a que el padre dé por cerrado el escenario en vez de dormir una
  // duración calibrada. Extensión ADITIVA — los kinds existentes y sus seis
  // consumidores siguen pasando `--hold`, con comportamiento idéntico.
  if (acquired && args['hold-until']) {
    if (!waitForBarrier(args['hold-until'], 3000)) {
      noteBarrierTimeout(args.sandbox, 'hold-until');
    }
  } else if (acquired && args.hold) {
    const sab = new Int32Array(new SharedArrayBuffer(4));
    Atomics.wait(sab, 0, 0, Number(args.hold));
  }

  process.stdout.write(acquired ? 'acquired' : 'blocked');
  process.exit(0);
}

main();
