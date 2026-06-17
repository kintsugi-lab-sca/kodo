// @ts-check
//
// src/cli/dashboard/select.js — Phase 36 Plan 01 (TUI-08/09/11/12; D-04/D-05/D-06/D-14/D-16).
//
// Capa de derive PURA (React-free, ink-free) del cursor/orden/contadores/filtro de la tabla
// viva. Es la base que el render (Plan 02) y la navegación/filtro consumen. Las DOS invariantes
// load-bearing de la fase viven aquí como funciones puras testeables sin host React:
//   - TUI-08: la selección se rastrea por `task_id` (NO por índice) y sobrevive al rebuild del
//     array de /status en cada poll (src/server.js reconstruye `sessions` con .map cada tick —
//     un índice carecería de sentido entre polls, esa es la clase ROMAN-132 trasladada a la UI).
//   - TUI-12: al aplicar/limpiar el filtro el cursor sigue a la misma sesión si permanece visible.
//
// Decisiones implementadas:
//   - D-04: sortSessions ordena una COPIA DESC por started_at, con tiebreak lexicográfico por
//     task_id, de modo que dos timestamps iguales NUNCA intercambien posición entre polls.
//   - D-05/D-06/D-16: resolveSelection busca por identidad; si la fila desaparece, clampa al
//     mismo índice posicional previo en [0, len-1]; lista vacía → { index:-1, taskId:null }.
//   - D-14 / Security V5 (T-36-01): parseFilter separa r:/s: del texto global; applyFilter hace
//     AND vía String.includes — jamás compila un patrón regex desde la query tecleada por el
//     operador (anti-ReDoS / anti-inyección).
//   - D-11: countByStatus cuenta el zombie (running && !alive) APARTE de running.
//
// Phase 39 (TUI-16): `grepLogs` se suma a la capa de derive — filtro puro substring OR de
// task_ref/workspace_ref sobre el buffer compartido de /logs (anti-ReDoS, T-39-02). Vive aquí
// (derive) y NO en format.js (presentación): es un filtro, no un cell projector.
//
// Color-isolation (invariante D-12 Phase 34): este módulo NO importa `picocolors` ni
// `src/cli/format.js`. test/format-isolation.test.js lo verifica vía walker automático.

/**
 * @typedef {import('./format.js').EnrichedSession} EnrichedSession
 */

/**
 * Ordena una COPIA de la lista DESC por `started_at` (newest primero), con desempate
 * lexicográfico por `task_id` (D-04, UI-SPEC sort=DESC). Nunca muta la entrada — el resultado
 * de usePoll no debe alterarse. El tiebreak explícito hace el orden determinista aunque el
 * server emita el array en un orden distinto cada poll (no se confía solo en la estabilidad
 * del sort de V8).
 *
 * @param {Array<Partial<EnrichedSession>>} rows
 * @returns {Array<Partial<EnrichedSession>>} copia ordenada.
 */
export function sortSessions(rows) {
  // started_at → epoch ms FINITO. El `?? 0` solo cubre null/undefined; un string no parseable
  // (sesión legacy / dato corrupto) daría NaN, y un comparador que retorna NaN deja el orden
  // INDEFINIDO (NaN !== x es siempre true → cae a `tb - ta = NaN`), anulando el tiebreak por
  // task_id de D-04 y reintroduciendo flicker entre polls (WR-01). Normalizamos a 0 (epoch /
  // más antiguo) para que el desempate determinista por task_id siga mandando.
  const ts = (/** @type {Partial<EnrichedSession>} */ r) => {
    const t = new Date(r.started_at ?? 0).getTime();
    return Number.isFinite(t) ? t : 0;
  };
  return [...rows].sort((a, b) => {
    const ta = ts(a);
    const tb = ts(b);
    if (ta !== tb) return tb - ta; // DESC: newest primero
    const ka = a.task_id ?? '';
    const kb = b.task_id ?? '';
    return ka < kb ? -1 : ka > kb ? 1 : 0; // tiebreak determinista
  });
}

/**
 * Resuelve la selección visible por IDENTIDAD (D-05/D-06/D-16). Sobre la lista ya
 * ordenada+filtrada:
 *   - lista vacía → { index:-1, taskId:null } (nunca un id colgante).
 *   - `selectedTaskId` presente → { index, taskId: selectedTaskId } (sigue a la sesión aunque
 *     el orden cambie — TUI-08).
 *   - `selectedTaskId` ausente (la fila desapareció) → clampa `prevIndex` a [0, len-1] y devuelve
 *     el `task_id` de esa posición (vecino más cercano, D-06). Jamás un id ausente.
 *
 * @param {Array<Partial<EnrichedSession>>} rows — ya ordenada+filtrada.
 * @param {string|null} selectedTaskId
 * @param {number} [prevIndex=0] — último índice visible conocido (fallback de clamp).
 * @returns {{ index: number, taskId: string|null }}
 */
export function resolveSelection(rows, selectedTaskId, prevIndex = 0) {
  if (rows.length === 0) return { index: -1, taskId: null };
  const idx = rows.findIndex((r) => r.task_id === selectedTaskId);
  if (idx !== -1) return { index: idx, taskId: selectedTaskId };
  const clamped = Math.max(0, Math.min(prevIndex, rows.length - 1));
  return { index: clamped, taskId: rows[clamped].task_id ?? null };
}

/**
 * Parsea una query de filtro (D-14). Separa los prefijos `r:` (repo) y `s:` (status) del texto
 * global; los valores de prefijo y el texto se bajan a minúsculas (match case-insensitive).
 *   'r:kodo s:running build' → { repo:'kodo', status:'running', text:'build' }
 *   ''                       → { repo:null, status:null, text:'' }
 *
 * Phase 38 D-06: `s:active` es un alias OR que expande a `status: ['running',
 * 'idle', 'needs-input']` (excluye `dead`/`closed`). Los demás `s:<x>` siguen
 * siendo string escalar (retrocompat Phase 36). `status` es por tanto
 * `string | string[] | null` — applyFilter acepta ambas formas (Opción A del
 * plan: menor diff, retro-compatible con los filtros legacy escalares).
 *
 * Phase 43 D-06: prefijo DEDICADO `ps:` para `provider_state` (eje SEPARADO del
 * `s:` local — NO se extiende `s:` con OR). `provider_state` es `string|null`; el
 * valor se baja a minúsculas y se matchea por SUBSTRING en applyFilter (D-07).
 *   'ps:review' → { provider_state:'review', repo:null, status:null, text:'' }
 * ORDEN crítico: el check `startsWith('ps:')` va ANTES que `s:`. Aunque
 * `'ps:review'.startsWith('s:')` ya es false (empieza por 'p'), el orden explícito
 * blinda el parsing y documenta que `ps:` es un eje distinto, no un sufijo de `s:`.
 *
 * @param {string} query
 * @returns {{ repo: string|null, status: string|string[]|null, provider_state: string|null, text: string }}
 */
export function parseFilter(query) {
  /** @type {{ repo: string|null, status: string|string[]|null, provider_state: string|null, text: string }} */
  const out = { repo: null, status: null, provider_state: null, text: '' };
  const words = (query ?? '').trim().split(/\s+/).filter(Boolean);
  /** @type {string[]} */
  const rest = [];
  for (const w of words) {
    // Prefijo case-insensitive: 'r:'/'R:', 'ps:'/'PS:' y 's:'/'S:' se reconocen igual; el VALOR
    // se baja a minúsculas para el match case-insensitive (D-14 / D-06 Phase 43).
    const lower = w.toLowerCase();
    if (lower.startsWith('r:')) out.repo = w.slice(2).toLowerCase();
    // `ps:` ANTES que `s:` (D-06 Phase 43): eje dedicado de provider_state, valor crudo lowercased.
    else if (lower.startsWith('ps:')) out.provider_state = w.slice(3).toLowerCase();
    else if (lower.startsWith('s:')) {
      const val = w.slice(2).toLowerCase();
      // Alias OR `s:active` (D-06): sesiones vivas (running/idle/needs-input),
      // excluye dead/closed.
      out.status = val === 'active' ? ['running', 'idle', 'needs-input'] : val;
    } else rest.push(w);
  }
  out.text = rest.join(' ').toLowerCase();
  return out;
}

/**
 * Filtra las filas haciendo AND de los criterios activos (D-14). El match es por SUBSTRING vía
 * `String.includes` — jamás compila un patrón regex (anti-ReDoS / anti-inyección, Security V5 / T-36-01).
 *   - repo: deriveRepo(r) (lowercased) incluye parsed.repo.
 *   - status: r.status (lowercased) === parsed.status (match exacto).
 *   - text: substring global sobre task_ref/repo/phase_id/gsd_mode/summary (lowercased).
 *
 * Phase 38 D-06: el match de `status` se hace contra `r.state` (lifecycle v3)
 * con fallback a `r.status` (legacy v2 sin migrar). `parsed.status` puede ser
 * un array (alias `s:active`) → match OR; o un escalar → match exacto.
 *
 * Phase 43 D-07/D-09: ASIMETRÍA DELIBERADA — `s:` es match EXACTO del estado local
 * v3 (`st === parsed.status`); `ps:` es match por SUBSTRING del `provider_state`
 * crudo (`ps.includes(parsed.provider_state)`). Son ejes DISTINTOS con semánticas
 * distintas (criterio 3 PSTATE-06) — NO "alinear" ambos. El match `ps:` usa
 * `String.includes`, JAMÁS `RegExp` (anti-ReDoS, T-36-01 / T-43-04). Una fila con
 * `provider_state === null` (unsupported/fetch-failed) colapsa a `''.includes(term)`
 * === false → NUNCA casa (D-09); el reason degradado queda fuera del alcance del filtro.
 *
 * @param {Array<Partial<EnrichedSession>>} rows
 * @param {{ repo: string|null, status: string|string[]|null, provider_state: string|null, text: string }} parsed
 * @param {(s: Partial<EnrichedSession>) => string} deriveRepo — DI puro (de format.js).
 * @returns {Array<Partial<EnrichedSession>>}
 */
export function applyFilter(rows, parsed, deriveRepo) {
  return rows.filter((r) => {
    if (parsed.repo && !deriveRepo(r).toLowerCase().includes(parsed.repo)) return false;
    if (parsed.status) {
      // Match contra el estado v3 (`state`) con fallback al legacy (`status`).
      const st = (r.state ?? r.status ?? '').toLowerCase();
      const ok = Array.isArray(parsed.status)
        ? parsed.status.includes(st)   // alias OR (s:active)
        : st === parsed.status;        // escalar (s:idle, s:running, …)
      if (!ok) return false;
    }
    if (parsed.provider_state) {
      // Eje DEDICADO (D-06): match por SUBSTRING del provider_state crudo, anti-ReDoS (D-07).
      // null/ausente → '' → nunca casa con un término no vacío (D-09 — degradadas fuera de alcance).
      const ps = (r.provider_state ?? '').toLowerCase();
      if (!ps.includes(parsed.provider_state)) return false;
    }
    if (parsed.text) {
      const hay = `${r.task_ref ?? ''} ${deriveRepo(r)} ${r.phase_id ?? ''} ${r.gsd_mode ?? ''} ${r.summary ?? ''}`.toLowerCase();
      if (!hay.includes(parsed.text)) return false;
    }
    return true;
  });
}

/**
 * Cuenta sesiones por estado para el header (D-11). El zombie (`running` && `alive === false`)
 * se cuenta APARTE de running — el operador lo ve en el resumen, no solo en la fila.
 *
 * Phase 38 D-06: cuenta por el estado v3 (`state`) con fallback al legacy (`status`).
 * Añade idle/needs-input/dead al contador (zombie sigue derivándose de running+!alive,
 * que en v3 corresponde a un running cuyo proceso murió — se mantiene la heurística).
 *
 * @param {Array<Partial<EnrichedSession>>} rows
 * @returns {{ running: number, review: number, done: number, error: number, zombie: number, idle: number, 'needs-input': number, dead: number }}
 */
export function countByStatus(rows) {
  const c = { running: 0, review: 0, done: 0, error: 0, zombie: 0, idle: 0, 'needs-input': 0, dead: 0 };
  for (const r of rows) {
    const st = r.state ?? r.status ?? '';
    if (st === 'running' && r.alive === false) c.zombie++;
    else if (Object.prototype.hasOwnProperty.call(c, st)) c[/** @type {string} */ (st)]++;
  }
  return c;
}

/**
 * Flag ESTRUCTURAL de presencia GSD (TUI-18, D-08): ¿hay ALGUNA fila con `phase_id`? Pura,
 * React-free, sin regex ni color (espejo de countByStatus). El guard `!= null` distingue
 * null/undefined (ausentes → no-GSD) de `0`/'' (presentes → GSD), de modo que un `phase_id`
 * falsy-pero-real cuenta como GSD.
 *
 * CRÍTICO (D-08 / Pitfall 4): el consumidor (App.js) la computa sobre el set SIN filtrar
 * (`sorted`), NO sobre `filtered`. La columna `phase/mode` es ESTRUCTURAL — está presente
 * siempre que ALGUNA sesión activa sea GSD — y no debe parpadear cuando el operador teclea una
 * query `/` que vacía temporalmente las filas GSD del subconjunto visible.
 *
 * @param {Array<Partial<EnrichedSession>>} rows — el set SIN filtrar (sorted/sessions).
 * @returns {boolean} true si alguna fila tiene `phase_id != null`.
 */
export function deriveAnyGsd(rows) {
  return rows.some((r) => r.phase_id != null);
}

/**
 * Flag ESTRUCTURAL de presencia de progreso vivo (PROG-03, D-06): ¿hay ALGUNA fila con una
 * LECTURA REAL de progreso (`progress.status === 'ok'`)? Pura, React-free, sin regex ni color.
 *
 * WR-03: el enrich de App.js asigna un objeto `progress` NO-null a TODAS las filas — las no-GSD
 * y las no usables reciben `{ status: 'no-progress' }`, los fallos sin last-good `{ status:
 * 'error' }`. Un predicado `progress != null` por tanto SIEMPRE devolvía true y la columna `prog`
 * nunca se ocultaba, contradiciendo el diseño de columna condicional de Phase 50. Discriminamos
 * por `status`: solo un `'ok'` (lectura real con N/M) cuenta como progreso a mostrar;
 * `'no-progress'` (placeholder '—') y `'error'` (placeholder '?') NO activan la columna.
 *
 * CRÍTICO (D-06 / Pitfall 5 == Pitfall 4 de Phase 44): el consumidor (App.js) la computa sobre
 * el set SIN filtrar (`enriched`), NO sobre `filtered`. La columna `prog` es ESTRUCTURAL — está
 * presente siempre que ALGUNA sesión activa reporte progreso real — y no debe parpadear cuando el
 * operador teclea una query `/` que vacía temporalmente las filas con progreso del subconjunto
 * visible (espejo exacto de deriveAnyGsd, App.js:331).
 *
 * @param {Array<Partial<EnrichedSession> & { progress?: { status?: string } | null }>} rows — set SIN filtrar.
 * @returns {boolean} true si alguna fila tiene `progress.status === 'ok'`.
 */
export function deriveAnyProgress(rows) {
  return rows.some((r) => r.progress?.status === 'ok');
}

/**
 * Filtra el buffer COMPARTIDO de `GET /logs` por substring OR de `task_ref` / `workspace_ref`
 * contra `entry.msg` (TUI-16, D-03). El buffer es un ring newest-first sin `session_id` por
 * línea (src/server.js:21-29), por lo que el grep es best-effort: NO parsea un session_id que
 * el buffer no garantiza (D-03 — eso dejaría el overlay vacío durante actividad real). El header
 * del overlay etiqueta el buffer como compartido / best-effort (D-04, lo implementa el Plan 02).
 *
 * Disciplina anti-ReDoS (T-39-02, espejo de applyFilter / parseFilter): el match es por
 * `String.includes` (lowercased) — JAMÁS se compila una expresión regular desde un ref
 * tecleado/derivado. Un ref con chars regex-especiales (p.ej. `KL-1.*`) se matchea LITERAL
 * como substring.
 *
 * Reglas:
 *   - needles vacíos (sin task_ref ni workspace_ref, o ambos string vacío) → `[]` (no inunda el
 *     overlay con el buffer entero — D-03).
 *   - sin matches → `[]`.
 *   - preserva el orden de entrada de `logs` (no reordena; el buffer ya viene newest-first).
 *   - never-throws sobre entradas degradadas (msg ausente → se trata como '').
 *
 * @param {Array<{ ts?: string, level?: string, msg?: string }>} logs — buffer crudo de /logs.
 * @param {{ task_ref?: string, workspace_ref?: string }} session — refs de la sesión seleccionada.
 * @returns {Array<{ ts?: string, level?: string, msg?: string }>} subconjunto que casa (orden preservado).
 */
export function grepLogs(logs, session) {
  const needles = [session.task_ref, session.workspace_ref]
    .filter(Boolean)
    .map((s) => /** @type {string} */ (s).toLowerCase());
  if (needles.length === 0) return [];
  return logs.filter((e) => {
    const hay = (e.msg ?? '').toLowerCase();
    return needles.some((n) => hay.includes(n));
  });
}

/**
 * Mapea el resultado de `dismissSession` (D-10) a un discriminante PURO `{kind, color}` que
 * el root del dashboard (Phase 42) traduce al literal DISMISS_* copy. Phase 42 Plan 02
 * (DISMISS-03, D-09).
 *
 * Se extrae aquí (capa de derive pura) — y NO inline en el componente root — para ser
 * unit-testeable sin host React (RESEARCH Open Question 2) y para que el matiz del footer se
 * DERIVE del `actions[]`, no de un color lookup (D-09). NO importa las constantes de copy del
 * root (anti import circular, color-isolation intacta: `color` aquí es solo un nombre de ink
 * string, cero picocolors).
 *
 * Precedencia (UI-SPEC §Result-to-footer mapping, D-09):
 *   - `!res.ok`                          → `{kind:'error', color:'red', reason}` (incl. 'alive', 'HTTP 500').
 *   - `actions` contiene `result:'error'`→ `{kind:'warn',  color:'yellow'}` (un sub-fallo GANA sobre dirty).
 *   - `actions` contiene `'moved-dirty'` → `{kind:'dirty', color:'yellow'}` (worktree preservado).
 *   - resto                              → `{kind:'ok',    color:'green'}`.
 *
 * @param {{ ok: true, data: { removed?: string, actions?: Array<{ type?: string, result?: string }> } }
 *   | { ok: false, error: string }} res — discriminante never-throws de dismissSession.
 * @param {string} taskRef — task_ref legible para el copy (el root lo inyecta en la literal). No
 *   afecta el discriminante; se acepta por simetría con la firma documentada.
 * @returns {{ kind: 'ok'|'dirty'|'warn'|'error', color: string, reason?: string }}
 */
// eslint-disable-next-line no-unused-vars
export function mapDismissResult(res, taskRef) {
  if (!res.ok) return { kind: 'error', color: 'red', reason: res.error };
  const actions = Array.isArray(res.data?.actions) ? res.data.actions : [];
  // error > dirty: un sub-fallo fail-open es señal MÁS fuerte que un .dirty preservado.
  if (actions.some((a) => a.result === 'error')) return { kind: 'warn', color: 'yellow' };
  if (actions.some((a) => a.result === 'moved-dirty')) return { kind: 'dirty', color: 'yellow' };
  return { kind: 'ok', color: 'green' };
}

// ── Phase 56 Plan 01 (DETECT-02): derives del flujo adopt ─────────────────────────────────
//
// Dos funciones puras React-free (mismo invariante color-isolation del módulo): el
// set-difference de surfaces adoptables y el reverse-lookup cwd→projectId. Ambas alimentan el
// handler `a` de App.js (Plan 02); viven aquí (derive) y NO en format.js (presentación).

/**
 * @typedef {{ workspaceRef: string, cwd: string, sessionId: string, kind: string }} AgentSurface
 */

/**
 * Set-difference de surfaces ADOPTABLES (D-02). Sobre el array de surfaces descubierto por
 * `host.listAgentSurfaces()` (Phase 55) y el snapshot vivo de `/status` (que porta
 * `session_id` por el `...s` pass-through, server.js:447), devuelve las surfaces que:
 *   - tienen `kind === 'claude'` (Pitfall 5: listAgentSurfaces NO pre-filtra por kind — es
 *     responsabilidad explícita del consumer, DETECT-02), Y
 *   - tienen un `sessionId` truthy (sin identidad no son adoptables), Y
 *   - cuyo `sessionId` NO está entre los `session_id` ya trackeados.
 *
 * El diff se keyea por `sessionId`, NUNCA por `workspaceRef` (cmux recicla `workspace:N` —
 * defensa Phase 43 / D-06 Phase 55: un workspaceRef reciclado enmascararía una sesión nueva).
 * NO se hace un read nuevo de `state.json`: se reusa el dato ya polleado (D-02). Never-throws:
 * inputs null/undefined → `[]`.
 *
 * @param {Array<AgentSurface>|null|undefined} surfaces — surfaces descubiertas (puede ser null).
 * @param {Array<{ session_id?: string|null }>|null|undefined} statusSessions — filas del snapshot
 *   `/status` (cada una porta `session_id`).
 * @returns {Array<AgentSurface>} las adoptables (subconjunto de `surfaces`).
 */
export function computeAdoptable(surfaces, statusSessions) {
  const tracked = new Set((statusSessions ?? []).map((s) => s.session_id).filter(Boolean));
  return (surfaces ?? []).filter(
    (s) => s.kind === 'claude' && s.sessionId && !tracked.has(s.sessionId),
  );
}

/**
 * Reverse-lookup `cwd → projectId` (D-05). `kodo adopt` exige `--project <id>`, pero el
 * descubrimiento NO devuelve proyecto. Invierte el mapa `projectId → path` de `loadProjects()`
 * (VERIFICADO `Record<string,string>`, config.js:142-151) resolviendo el proyecto cuyo path es
 * el ANCESTRO MÁS CERCANO de `cwd` (semántica ancestro, no match exacto: el operador abre
 * claude habitualmente en un subdirectorio del proyecto).
 *
 * Algoritmo (puro, sin I/O — NO `realpathSync`):
 *   - normaliza trailing-slash en ambos lados (`norm`),
 *   - filtra los proyectos cuyo path normalizado es igual a `cwd` o es prefijo separator-safe
 *     (`cwd === path` || `cwd.startsWith(path + '/')`) — el `+ '/'` evita que
 *     `/home/op/kodo-sibling` matchee `/home/op/kodo`,
 *   - sin matches → `{ error: 'none' }`,
 *   - ordena por longitud de path DESC (el ancestro más específico gana); si los DOS primeros
 *     tienen la MISMA longitud → `{ error: 'ambiguous' }` (config no determinista),
 *   - si no → `{ projectId }` del match más largo.
 *
 * El fallo (none/ambiguous) es el ÚNICO punto que puede impedir el shell de `kodo adopt`; el
 * caller lo mapea a un footer never-throws hacia el escape-hatch del CLI (D-05).
 *
 * @param {string} cwd — cwd de la surface elegida.
 * @param {Record<string, string>} projects — mapa `projectId → path` (de `loadProjects()`).
 * @returns {{ projectId: string } | { error: 'none' | 'ambiguous' }}
 */
export function resolveProjectId(cwd, projects) {
  const norm = (/** @type {string} */ p) => p.replace(/\/+$/, ''); // strip trailing slash(es)
  const c = norm(cwd);
  const matches = Object.entries(projects ?? {}).filter(([, path]) => {
    const p = norm(path);
    return c === p || c.startsWith(p + '/'); // exacto o descendiente (separator-boundary safe)
  });
  if (matches.length === 0) return { error: 'none' };
  // Desempate: ancestro más largo (más específico). Dos paths de igual longitud que mapean a
  // projectIds distintos → ambiguo (config no determinista).
  matches.sort((a, b) => norm(b[1]).length - norm(a[1]).length);
  if (matches.length > 1 && norm(matches[0][1]).length === norm(matches[1][1]).length) {
    return { error: 'ambiguous' };
  }
  return { projectId: matches[0][0] };
}
