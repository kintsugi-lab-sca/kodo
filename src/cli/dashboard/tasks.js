// @ts-check
//
// src/cli/dashboard/tasks.js — Phase 75 Plan 01 Task 1 (LIVE-05; D-01/D-02).
//
// Reader LEAF, SÍNCRONO y NEVER-THROWS del bloque `tasks` de `~/.kodo/state.json`.
// Molde LITERAL de `readLightPlan` (plan.js:65-78): never-throws + DI de HOME
// (`kodoDir`/`homedirFn`/`readFileFn`). Importa SOLO builtins (node:fs/node:path/node:os).
//
// PROHIBIDO importar `loadState`/`src/config.js`: `loadState` llama a
// `migrateStateIfNeeded()` que ESCRIBE en disco (`.bak`) en CADA tick de poll
// (RESEARCH Pitfall 1). El reader del dashboard es lectura pura — nunca muta state.json,
// nunca arrastra el grafo de migración. El dato viaja en state.json que la TUI ya lee:
// cero endpoint nuevo en src/server.js (invariante «cero endpoints nuevos desde v0.10», SC1).
//
// Tolerancia a escritores concurrentes: los escritores de state.json usan temp+rename
// atómico, así que una lectura nunca ve un fichero a medias; una lectura fallida o parcial
// en un tick colapsa never-throws a {} (celdas vacías) y el siguiente tick se recupera.
//
// Color-isolation (invariante D-12 Phase 34): este módulo NO importa `picocolors` ni
// `src/cli/format.js`.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

/**
 * Lee el bloque `tasks` de `~/.kodo/state.json`. Síncrono, never-throws.
 *
 * Todo fallo (ENOENT / JSON corrupto / sin clave `tasks` / `tasks` null o no-objeto)
 * colapsa a `{}` — celdas vacías, cero ruido, TUI never-throws (SC5). El guard es
 * idéntico al de state.js:61 (`state.tasks || {}` reforzado a objeto no-null).
 *
 * @param {{ readFileFn?: (p: string) => string, kodoDir?: string, homedirFn?: () => string }} [deps]
 *   `readFileFn`/`kodoDir`/`homedirFn` aíslan el HOME real en tests (D-08); sin ellos,
 *   default `readFileSync` + `join(homedir(), '.kodo')` (misma convención que plan.js:69).
 * @returns {Record<string, { plan_path: string, next: string|null, updated_at: string }>}
 *   El objeto `tasks` de state.json, o `{}` si ausente/ilegible/malformado.
 */
export function readTasks(deps = {}) {
  const readFileFn = deps.readFileFn || ((p) => readFileSync(p, 'utf-8'));
  const kodoDir = deps.kodoDir || join((deps.homedirFn || homedir)(), '.kodo');
  try {
    const state = JSON.parse(readFileFn(join(kodoDir, 'state.json')));
    return state && typeof state.tasks === 'object' && state.tasks !== null ? state.tasks : {};
  } catch {
    return {}; // ENOENT / JSON corrupto / cualquier otro fallo → {} (never-throws)
  }
}
