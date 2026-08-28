// @ts-check
//
// src/cli/dashboard/queue-count.js — KODO-26 (superficie de la cola de integración en el TUI).
//
// Leaf PURO, SÍNCRONO y NEVER-THROWS del conteo de entradas PENDIENTES de la cola
// (`integration_queue` en `~/.kodo/state.json`). Molde LITERAL de sus dos hermanos:
// `tasks.js` (de dónde sale el dato: state.json, con DI de HOME) e `inbox-count.js` (qué se
// hace con él: un número que el header colapsa a nada cuando es 0).
//
// PROHIBIDO importar `loadState` / `src/config.js`, por las MISMAS dos razones que documenta
// `tasks.js:9-13`: `loadState` llama a `migrateStateIfNeeded()`, que ESCRIBE en disco en cada
// tick de poll, y `config.js` evalúa `homedir()` en el cuerpo del módulo, lo que contamina los
// tests que fijan su HOME después del import. El reader del dashboard es lectura pura.
//
// PROHIBIDO importar `src/integration/queue.js`: sería la opción obvia (cero duplicación del
// filtro), pero arrastraría `state.js` entero —y con él `config.js` y el lock— a un módulo que
// solo tiene que contar elementos de un array. Misma prohibición y mismo motivo que la de
// `inbox-count.js` sobre `inbox/store.js` (D-17 de la Phase 84).
//
// Color-isolation (invariante D-12 Phase 34): este módulo NO importa `picocolors` ni
// `src/cli/format.js`. Nada de él llega al frame salvo un `number`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// KODO-43: `src/paths.js` es HOJA de solo builtins, sin I/O ni side-effects, y `kodoDir` es una
// FUNCIÓN (lazy) — importarlo no reintroduce la evaluación eager de `homedir()` que este fichero
// prohíbe arriba. Ver la cabecera de paths.js.
import { kodoDir as resolveKodoDir } from '../../paths.js';

/**
 * Cuenta las entradas PENDIENTES de la cola de integración — las ramas que siguen esperando un
 * ff/merge/PR. Las resueltas (`done`/`dropped`) NO cuentan: ya fueron atendidas, y siguen en
 * state.json solo como traza.
 *
 * **Never-throws de cuerpo entero:** fichero ausente, ilegible, JSON corrupto, clave ausente o
 * de un tipo inesperado → **0**. Nunca un throw, nunca un banner. Una cola que no se puede leer
 * es indistinguible de una cola vacía A EFECTOS DE PRESIÓN DE INTEGRACIÓN, y el dashboard no es
 * el sitio para diagnosticar el filesystem.
 *
 * **Solo lectura.** Compite con los escritores de state.json (que publican por temp+rename
 * atómico) sin coordinarse: una lectura observa el fichero anterior o el posterior, jamás uno a
 * medias. El conteo es eventualmente consistente y nunca incorrecto por corrupción.
 *
 * **Cadencia:** se invoca en el cuerpo del render de `App.js`, igual que `readOpenCaptureCount`
 * — piggyback sobre el tick de `usePoll`, cero timers nuevos.
 *
 * @param {{ readFileFn?: (p: string) => string, kodoDir?: string, homedirFn?: () => string }} [deps]
 *   Aíslan el HOME real en tests SIN tocar `process.env` (molde `tasks.js:39-41`).
 * @returns {number} entradas pendientes, o 0 ante cualquier fallo.
 */
export function readPendingIntegrationCount(deps = {}) {
  const readFileFn = deps.readFileFn || ((p) => readFileSync(p, 'utf-8'));
  try {
    // PEREZOSO: `homedir()` se evalúa AQUÍ, jamás en el cuerpo del módulo. Dentro del try
    // porque la propia resolución del path puede lanzar (un `kodoDir` no-string haría estallar
    // a `join`), y un throw aquí tumba el árbol de ink entero.
    const kodoDir = deps.kodoDir || resolveKodoDir(deps.homedirFn);
    const state = JSON.parse(readFileFn(join(kodoDir, 'state.json')));
    const queue = state && Array.isArray(state.integration_queue) ? state.integration_queue : [];
    let n = 0;
    for (const e of queue) if (e && e.status === 'pending') n++;
    return n;
  } catch {
    return 0;
  }
}
