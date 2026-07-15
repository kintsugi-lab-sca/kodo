---
phase: 72-higiene-dx-y-verdad-documental
reviewed: 2026-07-13T13:09:12Z
depth: standard
files_reviewed: 28
files_reviewed_list:
  - src/cli.js
  - src/cli/config-args.js
  - src/cli/dashboard/App.js
  - src/cli/format.js
  - src/config.js
  - src/gsd/roadmap.js
  - src/gsd/verification.js
  - src/gsd/verify.js
  - src/hooks/install.js
  - src/hooks/session-end.js
  - src/hooks/stop.js
  - src/labels.js
  - src/orchestrator/launch.js
  - src/providers/plane/client.js
  - src/providers/registry.js
  - src/session/health.js
  - test/cli/health-wait.test.js
  - test/config-hardening.test.js
  - test/dashboard-format.test.js
  - test/gsd-roadmap.test.js
  - test/gsd-verification.test.js
  - test/hooks/install.test.js
  - test/hooks/session-end.test.js
  - test/hooks/stop-idempotency.test.js
  - test/labels.test.js
  - test/plane-provider.test.js
  - test/registry.test.js
  - test/skill-auto-commit.test.js
findings:
  critical: 1
  warning: 7
  info: 6
  total: 14
status: issues_found
---

# Phase 72: Code Review Report

**Reviewed:** 2026-07-13T13:09:12Z
**Depth:** standard
**Files Reviewed:** 28
**Status:** issues_found

## Summary

Revisión adversarial del diff de la Fase 72 (`41ba955..HEAD`): gate KODO_ORCHESTRATOR en el auto-commit (HYG-01), migración de efectos Stop→SessionEnd (HYG-04), borrado de features muertas (HYG-02/03), endurecimiento de config M3/M5/M14/B5/B7, batch de BAJAS B1–B12 y strip `\x1b` en el dashboard (M4/HYG-07).

La mayoría de fixes implementan correctamente la dirección del audit: el gate HYG-01 con pathspec restringido es correcto y bien testeado (verificado que `git commit -- <pathspec>` no arrastra staged ajeno); B1/B3/B4/B8/B9/B12a/B12c/B12d/M12/M14/M3 son fixes limpios con tests que fallan pre-fix. Los 246 tests de los ficheros tocados pasan.

Sin embargo, el fix B7 (deep-merge de `loadConfig` sobre `DEFAULT_CONFIG`) introduce **una regresión verificada por repro**: mata el gate estructural de `needsSetup` y rellena silenciosamente `base_url`/`workspace_slug` con el host personal hardcodeado. Además, el nuevo `deepMerge` reabre el mismo vector de prototype-injection que M3 cierra en la ruta hermana, y el saneo M4 del dashboard cubre menos de lo que su documentación afirma (C1 sin strip, títulos de tareas sin sanear).

## Critical Issues

### CR-01: B7 (deep-merge de loadConfig) mata el gate estructural de `needsSetup` y rellena credenciales de destino con el host hardcodeado

**File:** `src/config.js:249-267` (mergeAndValidateConfig) y `src/config.js:390-392` (needsSetup, gate 3)
**Issue:** `loadConfig()` ahora devuelve SIEMPRE el resultado de `deepMerge(structuredClone(DEFAULT_CONFIG), parsed)`. Consecuencia: `providers.plane.base_url` y `workspace_slug` NUNCA pueden ser `undefined` tras un load — el gate (3) de `needsSetup` (`if (name === 'plane' && (!p?.base_url || !p?.workspace_slug)) return true`) es ahora código muerto para claves ausentes (solo dispara con string vacío explícito).

Repro verificado en esta revisión: con un `config.json` existente `{"provider":"plane","providers":{"plane":{"api_key_env":"PLANE_API_KEY"}}}` y la API key en el entorno:
- **Pre-B7:** `needsSetup() === true` → wizard/modo setup.
- **Post-B7:** `needsSetup() === false` y `loadConfig().providers.plane.base_url === 'https://tasks.kintsugi-lab.com'`.

Es decir, un operador con config incompleta salta el setup y kodo envía su `PLANE_API_KEY` (header `x-api-key` de PlaneClient) al host por defecto hardcodeado del autor sin ningún aviso. Es una regresión de comportamiento (feature de first-run rota) con arista de seguridad (credencial dirigida a un host no elegido por el operador).

**Fix:** No mergear los defaults identity-bearing de `providers.plane` (`base_url`, `workspace_slug`, `api_key_env`) en `mergeAndValidateConfig`, o excluir esas rutas del deep-merge:
```js
// Opción quirúrgica: preservar la ausencia de claves estructurales del provider
const merged = deepMerge(structuredClone(DEFAULT_CONFIG), parsed || {});
for (const key of ['base_url', 'workspace_slug']) {
  if (parsed?.providers?.plane?.[key] === undefined && CONFIG_EXISTED) {
    delete merged.providers.plane[key]; // needsSetup vuelve a poder detectar la ausencia
  }
}
```
Alternativa más simple: que `needsSetup` lea el JSON crudo del disco (no `loadConfig()`) para el gate (3) — igual que ya hace el gate (1) con `existsSync` directo (el mismo Pitfall 12 que documenta el propio helper).

## Warnings

### WR-01: `deepMerge` reintroduce el vector `__proto__` que M3 cierra en la ruta hermana

**File:** `src/config.js:210-223`
**Issue:** M3 (T-72-04) endureció `setNestedValue` contra `__proto__`/`constructor`/`prototype`, pero el nuevo `deepMerge` de B7 itera `Object.entries(source)` y asigna `out[k] = v` sin filtrar. `JSON.parse` crea `__proto__` como own-property, así que un `config.json` con `{"__proto__":{"polluted":true}}` hace que la asignación dispare el setter y REEMPLACE el prototipo del objeto merged. Repro verificado en esta revisión: `mergeAndValidateConfig(JSON.parse('{"__proto__":{"polluted":true}}')).polluted === true`. No contamina `Object.prototype` global, pero el config devuelto hereda claves arbitrarias del fichero (spoofing de flags leídos con optional chaining, p.ej. `config.workflow?.report_to_provider`). Hardening inconsistente dentro de la misma fase.
**Fix:** Filtrar las mismas claves prohibidas de M3 en el walk:
```js
import { FORBIDDEN_KEYS } from './cli/config-args.js'; // o duplicar el Set local
for (const [k, v] of Object.entries(source)) {
  if (FORBIDDEN_KEYS.has(k)) continue;
  ...
}
```
(O construir `out` con `Object.create(null)` / `Object.defineProperty`.)

### WR-02: `stripControlChars` no elimina los controles C1 que su documentación (y los tests) afirman cubrir; preserva `\r`

**File:** `src/cli/format.js:76-83`
**Issue:** El docstring dice «Elimina TODO byte de control C0/C1» y los tests repiten la afirmación, pero la clase `[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]` solo cubre C0+DEL. Los controles C1 (`–`) sobreviven — incluyendo U+009B (CSI de un solo byte) y U+009D (OSC), que algunos terminales interpretan como secuencias de escape sin necesidad de ESC. Además `\r` (`\x0d`) se preserva deliberadamente, lo que permite a un comentario reescribir visualmente el inicio de su propia línea (spoofing). La defensa contra inyección de terminal desde contenido externo queda incompleta respecto a su contrato declarado.
**Fix:**
```js
.replace(/[\x00-\x08\x0b-\x1f\x7f-\x9f]/g, '');
// C0 (incl. \r y \x0c) + DEL + C1; sigue preservando \t (\x09) y \n (\x0a)
```
Y actualizar el docstring/tests para que afirmen exactamente lo que hace el regex.

### WR-03: M4 solo sanea los comentarios — los títulos de tarea del provider llegan al render sin strip (y el comentario del código afirma lo contrario)

**File:** `src/cli/dashboard/App.js:1697-1704`; `src/session/manager.js:46`; `src/cli/dashboard/plan.js:105`
**Issue:** El comentario del fix dice que los comentarios de Plane son «su ÚNICO punto de entrada al render» del contenido externo. Falso: `session.summary = task.title` (manager.js:46) proviene del mismo provider externo y se renderiza sin `stripControlChars` en las filas del dashboard, en el overlay de plan (`plan.js:105`, `task.title: row?.summary`) y en `cmux.notify` (session-end.js:188, `body: session.summary`). Un título de work item con OSC-52/CSI tiene exactamente el mismo vector STRIDE Tampering que un comentario. El fix M4 cubre la mitad del boundary que declara cerrar.
**Fix:** Pasar `session.summary` (y `task_ref` si el formato del provider no lo restringe) por `stripControlChars` en su punto de proyección al render, o mejor: sanear en el ingreso (manager.js al persistir `summary`). Corregir el comentario «ÚNICO punto de entrada».

### WR-04: M5 se puede saltar por la ruta del backup de migración — `config.json.bak` con `webhook_secret` queda world-readable

**File:** `src/config.js:188` (migrateConfigIfNeeded)
**Issue:** M5 garantiza 0600 cuando el JSON serializado contiene una clave `*_secret`, con la justificación «si los lleva NO puede quedar world-readable ni un instante». Pero `migrateConfigIfNeeded` escribe el config v1 completo a `CONFIG_PATH + '.bak'` con `writeFileSync` directo (permisos por umask, típicamente 0644). Un config legacy con `plane.webhook_secret` (clave que el registry consume: registry.js:34) deja el secreto en claro en un `.bak` world-readable — precisamente lo que M5 dice impedir. El commit de la migración a v2 además pasa por `writeFileAtomic` y SÍ se protege, lo que hace la asimetría evidente.
**Fix:** Reusar la misma detección en el backup:
```js
const bakData = JSON.stringify(rawConfig, null, 2) + '\n';
writeFileAtomic(CONFIG_PATH + '.bak', bakData); // hereda la lógica *_secret → 0600
```

### WR-05: `loadConfig` → `saveConfig` ahora materializa TODOS los defaults en disco (pinning de defaults)

**File:** `src/cli.js:42-57` (config --set), `src/config.js:270-286`
**Issue:** Antes de B7, `kodo config --set` (y el editor de config del dashboard) hacía round-trip del config del usuario tal cual estaba en disco. Ahora `loadConfig()` devuelve el merge completo con `DEFAULT_CONFIG`, y `saveConfig(config)` lo persiste ENTERO: un solo `--set claude.default_model=sonnet` congela en `~/.kodo/config.json` todos los defaults actuales (`cmux.binary`, `claude.binary`, puertos, colores, y el bloque `providers.plane` completo — incluso para un usuario github-only). Dos consecuencias: (a) los cambios futuros de `DEFAULT_CONFIG` en releases de kodo dejan de aplicar a ese usuario (los valores quedan pinneados como si fueran elecciones explícitas, indistinguibles), y (b) amplifica CR-01 (el host hardcodeado pasa de default en memoria a valor persistido del usuario).
**Fix:** Separar el config «de disco» del config «efectivo»: que `--set`/editor lean el JSON crudo (o un `loadRawConfig()`), apliquen el cambio y guarden solo eso; `loadConfig()` efectivo sigue mergeando en memoria.

### WR-06: HYG-04 — el nudge/color/notify dependen ahora de un SessionEnd limpio que el flujo normal puede no producir nunca

**File:** `src/hooks/stop.js:155-160`, `src/hooks/session-end.js:167-204`
**Issue:** Es la dirección elegida por el audit (D-08), pero la consecuencia operativa merece verificación explícita: los tres efectos (color review, notify «cerrada», nudge `kodo gsd verify` al orquestador) solo disparan en `SessionEnd`, que Claude Code emite en cierres limpios (`/exit`, clear, logout…). Una sesión de agente que termina su tarea queda VIVA esperando input — Stop dispara (marca `idle`) pero ya no notifica ni nudgea; y si el workspace se cierra matando el proceso (kill de pane/cmux), SessionEnd puede no llegar a ejecutarse. No hay en `src/` ningún mecanismo que cierre sesiones automáticamente (`/exit` no se envía desde ningún módulo), así que el loop orquestador-verify pierde su trigger push y pasa a depender de que un humano cierre limpiamente la sesión. Nota positiva verificada: el orden efectos-DESPUÉS-de-removeSession es correcto porque `findSession` escanea `state.history`, así que el `kodo gsd verify <session-id>` del nudge sigue funcionando post-archivo.
**Fix:** Confirmar en UAT que el flujo real (daemon/reconcile/humano) compensa la pérdida del nudge per-turn; si no, añadir un fallback (p.ej. nudge desde el daemon cuando una sesión pasa a `idle` con `gsd:true`), o documentar el nuevo contrato operativo en el runbook.

### WR-07: Test del gate HYG-01 depende de que `KODO_ORCHESTRATOR` esté ausente del entorno heredado — flaky exactamente en la sesión orquestadora

**File:** `test/hooks/stop-idempotency.test.js:299-345`
**Issue:** El test «sin KODO_ORCHESTRATOR → skip» no limpia la env var ANTES del primer test (el `afterEach` la borra solo después de cada test). Si la suite se ejecuta desde un entorno con `KODO_ORCHESTRATOR=1` heredado — precisamente la sesión orquestadora que esta misma fase crea vía launch.js, o cualquier hijo suyo que corra `npm test` en el repo kodo — el primer test entra al auto-commit y falla. `skill-auto-commit.test.js` sí lo maneja bien (`delete env.KODO_ORCHESTRATOR` en el env del child); este describe in-process no.
**Fix:**
```js
beforeEach(() => {
  delete process.env.KODO_ORCHESTRATOR; // ambiente heredado no debe abrir el gate
  writeFileSync(/* ... */);
});
```

## Info

### IN-01: `mergeAndValidateConfig` valida pero no aplica el valor saneado (`res.value`)

**File:** `src/config.js:251-265`
**Issue:** Cuando `validateField` devuelve `ok:true`, el valor saneado (`res.value`: trimmed, coaccionado a número) se descarta y el merged conserva el crudo. Un `--set claude.max_parallel=5` deja el string `"5"` en runtime para siempre (los validadores lo aceptan vía `String(raw)`), y un `" opus "` con espacios pasaría validación pero llegaría literal a `claude --model`.
**Fix:** `if (res.ok && res.value !== current) setByPath(merged, field.path, res.value);`

### IN-02: `kodo config --set` acepta y persiste valores inválidos con mensaje de éxito

**File:** `src/cli.js:42-57`
**Issue:** `--set claude.max_parallel=abc` imprime `Set claude.max_parallel = abc` y guarda; el valor nunca surte efecto (B7 lo warn-fallbackea en cada load). Validar en escritura (reusar `validateField`, como hace el editor del dashboard con D-05) sería coherente y menos confuso.
**Fix:** Ejecutar `getEditableFields`/`validateField` sobre la key antes de `saveConfig` y rechazar con el mensaje del validador.

### IN-03: warn NDJSON de B7 se emite en CADA `loadConfig()` — ruido/corrupción potencial del TUI

**File:** `src/config.js:227-231, 259-262`
**Issue:** `loadConfig` se llama en constructores (PlaneClient), factories del registry, hooks y rutas del dashboard. Con un valor inválido persistido, el warn a stderr se repite en cada load; dentro del dashboard Ink, escrituras crudas a stderr pueden pisar el render.
**Fix:** Deduplicar por proceso (Set de paths ya warneados) o degradar a un único warn por path.

### IN-04: `isKodoHookCommand` matchea por segmento genérico `/src/hooks/<name>.js` — puede confundir hooks ajenos con el mismo layout

**File:** `src/hooks/install.js:15-26`
**Issue:** B9 mejora el substring `'kodo'`, pero `stop.js`/`session-end.js` bajo `src/hooks/` es un layout plausible para cualquier otra herramienta (`node /home/user/other-tool/src/hooks/stop.js` sería desinstalado por `uninstallHooks`). El comentario justifica no exigir la ruta completa, pero un ancla mínima al directorio raíz de kodo (o al menos `kodo` como componente de path) reduciría el falso positivo sin perder robustez global/local.
**Fix:** Matchear `/kodo/src/hooks/<name>.js` o comparar contra `resolve(import.meta.dirname, ...)` con fallback documentado.

### IN-05: Test M5 «sin *_secret → NO 0600» asume umask permisiva

**File:** `test/config-hardening.test.js` (describe M5, segundo test)
**Issue:** `assert.notEqual(mode & 0o777, 0o600)` falla en máquinas con `umask 077` (donde el write por defecto YA produce 0600). Falso rojo bajo entornos endurecidos.
**Fix:** Asertar sobre lo que importa: que NO se llamó `chmodSync` explícito, o setear umask conocida en el test (`process.umask(0o022)` con restore).

### IN-06: Comentarios inexactos en session-end.js y compatibilidad de shell del prefijo de entorno

**File:** `src/hooks/session-end.js:61-62`; `src/orchestrator/launch.js:256`
**Issue:** (a) El comentario «cmux inyectable (default lazy al import estático)» es contradictorio — el import de `../cmux/client.js` es estático/eager, no lazy. (b) El prefijo `KODO_ORCHESTRATOR=1 claude ...` enviado como texto al shell del workspace asume sintaxis POSIX (`VAR=val cmd`); en `fish` < 3.1 es error de sintaxis y el orquestador no arrancaría (fish ≥ 3.1 lo soporta). Documentar el supuesto o usar `env KODO_ORCHESTRATOR=1 claude ...`, que es portable a todos los shells.
**Fix:** `'env', 'KODO_ORCHESTRATOR=1', 'claude', ...` y corregir el comentario del DI.

---

_Reviewed: 2026-07-13T13:09:12Z_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
