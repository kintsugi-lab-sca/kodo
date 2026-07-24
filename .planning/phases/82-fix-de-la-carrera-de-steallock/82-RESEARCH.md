# Phase 82: Fix de la carrera de `stealLock` - Research

**Researched:** 2026-07-24
**Domain:** Concurrencia de filesystem — exclusión mutua entre procesos con primitivas `node:fs` (`O_EXCL`, `rename(2)`), sin dependencias externas
**Confidence:** HIGH

## Summary

La causa raíz está **confirmada y reproducida** en `.planning/debug/gsd-lock-race-cr01.md`: `stealLock` (`src/gsd/lock.js:283-351`) hace `renameSync(lockPath → aside)` para robar el lock, lo que deja `lockPath` **momentáneamente ausente**. En esa ventana un `acquireGsdLock` fresco (Caso 1, `:117`) o un segundo stealer pueden ganar un `O_EXCL`-create sobre el path vacío. Con N≥2 procesos robando el MISMO lock muerto, dos ventanas de move-aside solapadas dejan que **dos creadores `O_EXCL` independientes ganen ambos** → dos `{acquired:true}`. La ABA guard actual no cierra esto porque solo protege al propio stealer de pisar un lock que ÉL movió; no protege `lockPath` de un tercero que lo crea mientras está vacío por el move-aside de OTRO. El CAS **no es linealizable** entre stealers concurrentes.

El fix decidido (D-02, LOCKED) elimina la ventana **por construcción**: `lockPath` **jamás queda ausente** durante un steal. Se sustituye move-aside→create por **reemplazo in-place atómico** — escribir el lock nuevo en un `tmp` de nombre único y `renameSync(tmp → lockPath)`, que en POSIX sustituye el destino de forma atómica sin estado intermedio vacío. La exclusión entre stealers concurrentes la da un **steal-guard `O_EXCL`** (fichero hermano del lock): solo el poseedor del guard ejecuta el re-check ABA + el rename, dentro del guard. Como `lockPath` nunca queda vacío, los `acquireGsdLock` Caso-1 frescos siempre reciben `EEXIST`; como el rename es atómico y la sección crítica está serializada por el guard, exactamente un stealer gana.

**Primary recommendation:** Reescribir `stealLock` con un **steal-guard `O_EXCL` breakable** que serialice un cuerpo crítico de `re-read → confirmar stale → writeFileSync(tmp) → renameSync(tmp→lockPath)`. La propiedad del lock la confiere ÚNICAMENTE el `renameSync` in-place (nunca un move-aside); la propiedad del guard la confiere ÚNICAMENTE su `O_EXCL`-create. Esta separación es lo que hace el fix provably-correct y no probabilístico.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Exclusión mutua del lock GSD | Filesystem / Storage (`node:fs`) | — | La atomicidad la garantiza `rename(2)` del kernel; ningún tier de aplicación puede sustituirla |
| Serialización de stealers concurrentes | Filesystem / Storage (`O_EXCL` guard) | — | `O_EXCL`-create es la única primitiva atómica de exclusión disponible en `node:fs` |
| Detección de staleness (PID/TTL) | Backend lógica (`isPidAlive`/`isStaleLock`) | — | Ya existe y se reutiliza tal cual (D-08); no cambia |
| Contrato de resultado (`AcquireResult`) | Backend lógica (`acquireGsdLock`) | — | Público, intacto (D-08); el fix queda contenido en `stealLock` + helpers privados |

## Standard Stack

### Core
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:fs` (built-in) | Node v22.22.3 | `writeFileSync({flag:'wx'})`, `renameSync`, `unlinkSync`, `readFileSync` | `rename(2)`/`O_EXCL` son las primitivas POSIX canónicas de escritura atómica y exclusión — cero deps (invariante cross-milestone) [VERIFIED: codebase grep — ya en uso en lock.js/state-lock.js/session-end.js] |
| `node:crypto` (built-in) | Node v22.22.3 | `randomUUID()` para nombres de tmp/aside únicos por escritor | Evita colisión de nombres de tmp entre escritores concurrentes (patrón WR-02) [VERIFIED: codebase grep] |

### Supporting
Ninguna. **Cero deps npm nuevas** (D — invariante). Todo el fix es `node:fs` + `node:crypto`.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| steal-guard `O_EXCL` + rename in-place (D-02) | Lock por directorio (`mkdirSync` atómico) | Descartada (D-03b): cambia el artefacto de lock (fichero JSON → directorio), blast radius en `readLock`, `releaseGsdLock`, `doctor.decideLock` y tests golden. Desproporcionado |
| rename in-place (nunca-ausente por construcción) | Verificación post-adquisición (re-read + confirmar ownership) | Descartada (D-03a): el propio diagnóstico la marca "reduce pero no elimina (TOCTOU residual)". No cumple LOCK-01 por construcción |
| steal-guard `O_EXCL` | Inode-CAS (`renameat2`/`RENAME_EXCHANGE` condicional por `ino`) | No disponible en `node:fs` built-in — Node no expone `renameat2`. Justifica el guard sobre el CAS-por-inodo del diagnóstico (dirección 1) [VERIFIED: Node fs API no expone renameat2] |

**Installation:** N/A — sin instalación, todo built-in.

**Version verification:** No aplica (no packages). Runtime confirmado: `node --version` → `v22.22.3` [VERIFIED: Bash].

## Package Legitimacy Audit

> **N/A** — esta fase no instala ningún paquete externo. Cero deps npm nuevas (invariante cross-milestone confirmado en CONTEXT.md D). Todo el trabajo usa `node:fs` y `node:crypto` (built-ins). No hay superficie de slopsquatting.

## Architecture Patterns

### System Architecture Diagram

```
                          acquireGsdLock(projectPath, sessionInfo)
                                        │
                        ┌───────────────┴───────────────┐
                        │  Case 1: O_EXCL create lockPath │
                        │  writeFileSync(wx)              │
                        └───────────────┬─────────────────┘
                          éxito ────────┤──────── EEXIST
                     {acquired:true}    │   (lockPath ya existe)
                                        ▼
                              readFileSync(lockPath)
                                        │
                    ┌───────────────────┼───────────────────┐
              corrupt / PID dead / TTL exp            PID vivo + TTL ok
                        │                                     │
                        ▼                               {acquired:false, holder}
              ═══════ stealLock(lockPath, sessionInfo, reason) ═══════
                        │
                        ▼
             ┌──── acquireStealGuard(guardPath) ──── O_EXCL create ────┐
             │            guardPath = `${lockPath}.steal-guard`         │
             │                                                          │
   EEXIST → guard ocupado                              éxito → soy el poseedor
             │                                                          │
   ┌─────────┴──────────┐                              ┌────────────────┴───────────────┐
   │ leer guard:        │                              │  CUERPO CRÍTICO (serializado):  │
   │  PID muerto O       │                             │  1. re-read lockPath            │
   │  edad > umbral (s)? │                             │     · vivo+fresh → reject        │
   │   sí → BREAK guard  │                             │     · stale-presente → paso 2    │
   │      (rename-aside  │                             │     · ausente → O_EXCL create     │
   │       once + O_EXCL │                             │  2. writeFileSync(tmp único)     │
   │       re-create)    │                             │  3. renameSync(tmp → lockPath)   │
   │   no → re-contend   │                             │     [ATÓMICO, sin ventana vacía] │
   │     (bounded)       │                             │  finally: unlink(guard) besteff  │
   └─────────┬──────────┘                              └────────────────┬───────────────┘
             │                                                          │
    re-read lockPath fresco                                     {acquired:true}
    · vivo → {acquired:false, holder}
    · stale → re-contend (MAX_STEAL_ATTEMPTS)
```

### Recommended Project Structure
```
src/gsd/lock.js          # ÚNICO fichero de producción tocado
  ├── acquireGsdLock()   # sin cambios (D-08) — sigue llamando a stealLock
  ├── stealLock()        # REESCRITO: guard O_EXCL + rename in-place
  ├── isStaleLock()      # sin cambios — reutilizado en re-check y break del guard
  ├── isPidAlive()       # sin cambios — reutilizado para staleness del guard (D-05)
  └── [helpers privados NUEVOS]  # acquireStealGuard / releaseStealGuard / breakStaleGuard
test/gsd-lock-race.test.js       # BYTE-IDÉNTICO (D-07) — el invariante ejecutable
test/gsd-lock-guard.test.js      # NUEVO (sugerido): unit tests dirigidos del guard
```

### Pattern 1: Reemplazo in-place atómico (nunca-ausente por construcción)
**What:** Escribir el contenido nuevo en un `tmp` de nombre único y `renameSync(tmp → lockPath)`. POSIX `rename(2)` sustituye el destino atómicamente: un observador concurrente ve el inodo viejo O el nuevo, **nunca la ausencia**.
**When to use:** Siempre que `lockPath` esté presente (stale) y queramos reemplazarlo sin abrir ventana.
**Example:**
```javascript
// Source: patrón ya en producción en src/hooks/session-end.js:374-381 (fix WR-02)
const tmp = `${lockPath}.tmp.${process.pid}.${randomUUID()}`;
try {
  writeFileSync(tmp, serializeLockContent(sessionInfo));
  renameSync(tmp, lockPath);   // atómico: lockPath nunca queda vacío
} catch (err) {
  try { unlinkSync(tmp); } catch { /* best-effort */ }
  throw err;
}
return { acquired: true };
```
[VERIFIED: codebase — mismo patrón en session-end.js:374, saveState WR-02] · [CITED: nodejs.org fs.renameSync = wrapper POSIX rename(2), atómico en el mismo filesystem]

### Pattern 2: Steal-guard `O_EXCL` breakable (serializa el cuerpo crítico)
**What:** Un fichero hermano `${lockPath}.steal-guard` creado con `{flag:'wx'}`. Solo un stealer lo crea; ese ejecuta el re-check + rename. La propiedad del guard la confiere ÚNICAMENTE el `O_EXCL`-create exitoso — nunca un move-aside. Contenido mínimo: `{pid, ts}`.
**When to use:** Envolviendo todo el cuerpo crítico del steal. Los perdedores del guard re-evalúan contra el estado fresco (D-06).
**Example:**
```javascript
// Guard content mínimo (D-05): pid para isPidAlive, ts para umbral de edad.
function acquireStealGuard(guardPath) {
  const mine = JSON.stringify({ pid: process.pid, ts: Date.now() });
  try {
    writeFileSync(guardPath, mine, { flag: 'wx' });   // O_EXCL: solo uno gana
    return true;
  } catch (e) {
    if (e.code !== 'EEXIST') throw e;
    return false;   // guard ocupado → el caller decide break vs re-contend
  }
}
```
[VERIFIED: mismo patrón O_EXCL en state-lock.js:78 y lock.js:207]

### Pattern 3: Rotura segura del guard huérfano (D-05)
**What:** Un guard cuyo poseedor murió (`isPidAlive` false) **o** cuya edad supera un umbral corto (segundos) es basura y debe romperse. Criterio de seguridad crítico: **NUNCA romper un guard cuyo poseedor está vivo Y dentro del umbral** — podría estar a mitad del rename, y romperlo dejaría a dos stealers renombrando sobre `lockPath` (reintroduce la doble adquisición).
**When to use:** Al perder el `O_EXCL`-create del guard, leer el guard y decidir.
**Example:**
```javascript
// La rotura NO confiere propiedad: solo LIMPIA el guard stale para que
// alguien pueda O_EXCL-crear uno fresco. La propiedad sigue siendo del O_EXCL.
function guardIsStale(guard, thresholdMs) {
  if (!guard) return true;                               // corrupt/partial → stale
  if (!isPidAlive(guard.pid)) return true;               // poseedor muerto → seguro romper
  return Date.now() - guard.ts > thresholdMs;            // demasiado viejo → stuck/basura
}
// Rotura: rename-aside-once del guard (una sola vez por inodo) + unlink besteff.
// Un guardPath brevemente vacío es INOCUO: la propiedad del guard la da el
// O_EXCL-create posterior, no la rotura → a lo sumo un stealer re-crea el guard.
```
**Rationale de por qué la ventana vacía del GUARD es inocua (a diferencia del LOCK):** la exclusión del LOCK depende del `O_EXCL` del guard, que es una op atómica sin ventana. La ventana breve del `guardPath` solo afecta a la contención por el guard, resuelta de nuevo por `O_EXCL`. Ningún camino confiere propiedad del guard sin un `O_EXCL` exitoso. La recursión termina. [ASSUMED — razonamiento de diseño; el planner/implementador debe validar con los unit tests de D-07]

### Anti-Patterns to Avoid
- **Move-aside del lock (`renameSync(lockPath → aside)`):** ES la causa raíz. Cualquier reintroducción vuelve a abrir la ventana briefly-empty. El fix la elimina del todo.
- **Romper el guard con `unlinkSync` incondicional tras un read "stale":** TOCTOU — entre el read y el unlink el guard pudo ser reemplazado por uno fresco vivo; unlinkarlo dejaría a su poseedor y a ti renombrando a la vez. Romper solo con criterio PID-muerto o edad>umbral holgado.
- **Umbral de edad del guard demasiado corto (sub-ms):** si es menor que el peor caso de la sección crítica, se rompen guards vivos. La sección crítica es ~1ms; usar segundos (D-05) da margen enorme.
- **`writeFileAtomic` de config.js (tmp de nombre FIJO `path+'.tmp'`):** dos escritores concurrentes comparten el tmp y se pisan bytes (exactamente lo que WR-02 corrigió). Usar SIEMPRE tmp con `randomUUID()`.
- **Debilitar el assert `exactly one` / `.skip` / retries / subir timeouts en `test/gsd-lock-race.test.js`:** PROHIBIDO (DEBT-04, TOP THREAT T-81-03-02). El harness queda byte-idéntico (D-07).
- **Añadir exports para testear helpers privados:** viola D-08 (exports del módulo intactos). Testear el guard vía API pública + seeding de ficheros (ver Validation Architecture).

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Escritura atómica sin estado intermedio | Copia byte-a-byte + flag manual | `writeFileSync(tmp) + renameSync(tmp, dest)` | `rename(2)` es la primitiva atómica del kernel; cualquier reimplementación tiene ventana |
| Exclusión mutua entre procesos | Flock manual / spinlock por polling de contenido | `writeFileSync(..., {flag:'wx'})` (`O_EXCL`) | `O_EXCL` es atómico en el kernel; un check-then-create en userland tiene TOCTOU |
| Detección de proceso vivo | Parseo de `ps` / `/proc` | `isPidAlive` existente (`process.kill(pid,0)`) | Ya probada, POSIX-portable, reutilizable para staleness del guard (D-05) |
| Detección de staleness (PID+TTL) | Lógica nueva de expiración | `isStaleLock` existente (`lock.js:251`) | Espeja el gating de `acquireGsdLock` y `doctor.decideLock`; reutilizar evita drift |
| Nombre de tmp único por escritor | Contador / timestamp | `randomUUID()` (patrón WR-02) | timestamp/pid colisionan bajo carga; UUID no |

**Key insight:** El fix correcto NO inventa una primitiva de concurrencia nueva — **compone** dos primitivas atómicas del kernel ya usadas en el repo (`O_EXCL`-create para exclusión, `rename(2)` para reemplazo sin ventana) de modo que la propiedad del lock y la del guard se confieran cada una por una única op atómica. Todo "arreglo" que reduzca la probabilidad en vez de eliminar la ventana por construcción incumple D-01 y es el TOP THREAT.

## Runtime State Inventory

> Fase de refactor/fix sobre `stealLock`. El artefacto de lock y el nuevo guard son ficheros de filesystem **efímeros** (creados y liberados en runtime), no estado persistente a migrar.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | `.planning/.kodo.lock` es un fichero de lock efímero por-repo; se crea al adquirir y se borra al liberar. **NO** es dato persistente ni tiene esquema versionado. El formato JSON del lock **no cambia** (D-08). | Ninguna — formato intacto |
| Live service config | Ninguna — no hay servicio externo, UI ni DB que almacene este string. Verificado por grep: los únicos lectores de `LOCK_FILE` son `doctor.js` y `lock.js`. | Ninguna |
| OS-registered state | Ninguna — no hay tareas OS, pm2, launchd ni systemd que referencien el lock. | Ninguna |
| Secrets/env vars | Ninguna — el lock no contiene secretos; no hay env vars con su nombre. | Ninguna |
| Build artifacts | Ninguna — cambio de código puro en `src/gsd/lock.js`; sin recompilación (JS puro). | Ninguna |

**Nuevo artefacto introducido:** `${lockPath}.steal-guard` (fichero de guard efímero, hermano del lock, mismo directorio `.planning/`). Es best-effort-cleanup (unlink en camino feliz y de error) + breakable (D-05), así que un guard huérfano no persiste como basura funcional. **Consideración menor:** `doctor.decideLock` solo mira `LOCK_FILE` (`.kodo.lock`), no verá el guard como lock — inocuo. Recomendación: confirmar que el guard hereda el mismo tratamiento de `.gitignore` que `.kodo.lock` (ninguno de los dos debe commitearse; hoy `.kodo.lock` no aparece en `.gitignore` pero es artefacto runtime liberado — el planner debe verificar que ni lock ni guard queden trackeados).

## Common Pitfalls

### Pitfall 1: Romper un guard vivo a mitad de rename → doble adquisición reintroducida
**What goes wrong:** Un breaker rompe un guard cuyo poseedor está vivo y a mitad de `renameSync(tmp→lockPath)`; el breaker crea guard fresco y también renombra → dos renames sobre `lockPath` → dos `{acquired:true}`.
**Why it happens:** Umbral de edad demasiado corto, o romper por "read stale" sin re-verificar atomicidad.
**How to avoid:** Romper SOLO si PID muerto (`isPidAlive` false → no puede estar renombrando) **o** edad > umbral holgado (segundos ≫ 1ms de sección crítica). La rotura no confiere propiedad; solo el `O_EXCL`-create posterior.
**Warning signs:** El unit test "crash simulado no deja el lock inconsistente" falla intermitentemente; el harness CR-01 vuelve a mostrar 2 `acquired`.

### Pitfall 2: `lockPath` ausente dentro del guard → rename clobbea un creador fresco
**What goes wrong:** El holder original liberó el lock entre la decisión de robar y el re-check dentro del guard. `lockPath` está ausente; un `acquireGsdLock` Caso-1 fresco lo `O_EXCL`-crea; nuestro `renameSync(tmp→lockPath)` lo sobrescribe → doble adquisición.
**Why it happens:** Asumir que `lockPath` siempre está presente-stale dentro del guard.
**How to avoid:** El re-check dentro del guard tiene tres ramas: (a) vivo+fresh → `{acquired:false, holder}`; (b) stale-presente → `renameSync(tmp→lockPath)` (seguro, nadie más puede cambiarlo con el guard tomado y el path no-vacío); (c) **ausente → `writeFileSync(lockPath, {flag:'wx'})`** (O_EXCL, respeta al creador fresco; en EEXIST re-leer y decidir).
**Warning signs:** Fallo bajo el escenario "holder libera durante el steal" — raro; añadir un unit test dirigido.

### Pitfall 3: tmp/aside en filesystem distinto al lock → rename cross-device EXDEV
**What goes wrong:** `renameSync` falla con `EXDEV` si `tmp` y `lockPath` están en filesystems distintos.
**Why it happens:** Construir el tmp en `os.tmpdir()` en vez de junto al lock.
**How to avoid:** El tmp/guard/aside SIEMPRE en el mismo directorio que `lockPath` (`${lockPath}.tmp.…`, `${lockPath}.steal-guard`). Mismo dir `.planning/` → mismo filesystem → rename atómico garantizado.
**Warning signs:** `EXDEV` en CI con `/tmp` montado aparte. El patrón `${lockPath}.…` lo evita por construcción.

### Pitfall 4: Windows — `renameSync` sobre destino existente
**What goes wrong:** En Windows, `rename(2)` no reemplaza atómicamente un destino existente igual que POSIX (históricamente `EPERM`/`EEXIST`).
**Why it happens:** El reemplazo in-place asume semántica POSIX.
**How to avoid:** kodo es una herramienta de dev orientada a POSIX (macOS/Linux); el harness corre en Darwin. El código actual ya usa `renameSync` con postura POSIX. **Documentar** como limitación conocida, no bloqueante para esta fase.
**Warning signs:** N/A en el entorno objetivo (Darwin 25.5.0 / Node v22.22.3). Flag para un futuro soporte Windows.

## Code Examples

### Esqueleto de `stealLock` reescrito (referencia de diseño, no prescripción literal)
```javascript
// Source: composición de patrones ya en producción (session-end.js:374 rename atómico,
// state-lock.js:78 O_EXCL, lock.js:251 isStaleLock). Detalle de helpers = discreción (D).
function stealLock(lockPath, sessionInfo, reason) {
  console.error(`[kodo:lock] Lock stolen: ${reason}`);
  mkdirSync(dirname(lockPath), { recursive: true });
  const guardPath = `${lockPath}.steal-guard`;

  for (let attempt = 0; attempt < MAX_STEAL_ATTEMPTS; attempt++) {
    if (!acquireStealGuard(guardPath)) {           // O_EXCL create
      // Perdedor del guard (D-06): ¿guard roto? intentar romper; si no, re-evaluar lock.
      if (tryBreakStaleGuard(guardPath)) continue; // guard huérfano roto → re-contender
      const holder = readLockContent(lockPath);
      if (holder && !isStaleLock(holder)) return { acquired: false, holder };
      sleepShort();                                 // backoff acotado
      continue;
    }
    try {
      // ── CUERPO CRÍTICO, serializado por el guard ──
      const current = readLockContent(lockPath);
      if (current && !isStaleLock(current)) return { acquired: false, holder: current };

      const tmp = `${lockPath}.tmp.${process.pid}.${randomUUID()}`;
      try {
        writeFileSync(tmp, serializeLockContent(sessionInfo));
        if (current) {
          renameSync(tmp, lockPath);                // stale-presente → reemplazo atómico
        } else {
          // lockPath ausente → respetar a un creador fresco vía O_EXCL
          try { renameSync(tmp, lockPath); }        // (o writeFileSync wx tras leer tmp)
          catch (e) { /* manejar EEXIST → re-leer holder */ }
        }
      } catch (err) { try { unlinkSync(tmp); } catch {} throw err; }
      return { acquired: true };
    } finally {
      try { unlinkSync(guardPath); } catch { /* best-effort */ }
    }
  }
  // Presupuesto agotado (patológico): rechazar contra el holder actual (nunca reabrir ventana).
  const holder = readLockContent(lockPath);
  if (holder) return { acquired: false, holder };
  // último recurso acotado — sin move-aside
}
```
> **Nota para el planner:** la rama `lockPath ausente` necesita cuidado (Pitfall 2). La opción más limpia es: si `current` es null, usar `writeFileSync(lockPath, ..., {flag:'wx'})` directo (no rename) para respetar a un creador fresco; en `EEXIST`, re-leer y decidir. El detalle exacto es discreción del implementador (D) siempre que cumpla D-01 (nunca-ausente por construcción, salvo que el propio path ya estuviera ausente por liberación legítima) y D-08 (contrato intacto).

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| move-aside (`rename lockPath→aside`) + `O_EXCL`-create + ABA guard | rename in-place (`rename tmp→lockPath`) serializado por steal-guard `O_EXCL` | Esta fase (82) | Cierra la ventana briefly-empty por construcción (D-01); CAS linealizable entre stealers |

**Deprecated/outdated (a eliminar en esta fase):**
- El docblock de `stealLock` (`lock.js:258-282`) que describe el CAS move-aside → **reescribir** (D-11); dejarlo sería doc-drift (HYG-08/DEBT-02).
- La ABA guard actual (`lock.js:302-315`) — su necesidad desaparece con el rename in-place; el re-check dentro del guard la sustituye.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | La ventana breve del `guardPath` (durante una rotura de guard) es inocua porque la propiedad del guard la confiere solo el `O_EXCL`-create posterior | Pattern 3 | Si el diseño del break confiere propiedad implícitamente (p. ej. "yo rompí → yo poseo"), se reintroduce la doble adquisición un nivel abajo. **Mitigación:** unit tests D-07 del guard deben cubrir "dos breakers del mismo guard huérfano → exactamente uno acaba poseyendo" |
| A2 | Un umbral de edad del guard "de segundos" es holgadamente mayor que el peor caso de la sección crítica (~1ms: read+write+rename) | D-05 / Pitfall 1 | Si bajo carga extrema la sección crítica tarda >umbral, se rompen guards vivos. **Mitigación:** el implementador fija el umbral (discreción D) con margen ≥1000× sobre el coste medido; PID-muerto es el criterio primario y siempre seguro |
| A3 | `renameSync(tmp, lockPath)` no expone jamás `lockPath` ausente a un observador concurrente en el mismo filesystem (POSIX `rename(2)` atómico) | Pattern 1 | Es garantía POSIX estándar; riesgo solo en Windows/cross-device (Pitfalls 3-4), fuera del entorno objetivo |

## Open Questions

1. **¿Testear el guard vía API pública o exponerlo?**
   - What we know: D-08 prohíbe cambiar exports; D-07 pide unit tests dirigidos del guard (huérfano PID-muerto se rompe; fresco PID-vivo bloquea; crash no deja inconsistencia).
   - What's unclear: cómo ejercitar helpers privados sin exportarlos.
   - Recommendation: testear vía `acquireGsdLock` público + **seeding de ficheros en disco** (crear un guard con pid/ts concretos y un lock stale en un sandbox tmpdir, invocar `acquireGsdLock`, aserir el resultado y el estado final en disco). No requiere exports nuevos → cumple D-08.

2. **N del loop de estrés de verificación (D-07 / discreción D).**
   - What we know: el repro original medía ~48% de fallos con loops del fichero + suite en paralelo; D-07 pide ≥30 iteraciones, 0 fallos, ideal bajo carga.
   - Recommendation: ≥50 iteraciones del fichero bajo `node --test` con la suite corriendo en paralelo (replica las condiciones del diagnóstico: 13/50 y 19/40). Documentar el comando y el conteo exacto en VERIFICATION.md.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | Todo el módulo | ✓ | v22.22.3 | — |
| `node:fs` / `node:crypto` | Fix completo | ✓ | built-in | — |
| filesystem POSIX (rename atómico) | Reemplazo in-place | ✓ | Darwin 25.5.0 (APFS) | — (Windows fuera de alcance, Pitfall 4) |

**Missing dependencies with no fallback:** Ninguna.
**Missing dependencies with fallback:** Ninguna.

## Validation Architecture

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (built-in) + `node:assert/strict` |
| Config file | none — glob en `package.json` |
| Quick run command | `node --test test/gsd-lock-race.test.js` |
| Full suite command | `node --test $(find test -name '*.test.js' -type f)` (≈2364 tests) |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LOCK-01 | N≥2 stealers del mismo lock muerto → exactamente uno adquiere | integration (procesos reales) | `node --test test/gsd-lock-race.test.js` (casos CR-01 N=2/N=5, byte-idénticos) | ✅ (D-07 byte-idéntico) |
| LOCK-01 | guard huérfano PID-muerto se rompe; guard fresco PID-vivo bloquea/re-contiende; crash mid-steal no deja lock inconsistente | unit (in-process, seeding de ficheros) | `node --test test/gsd-lock-guard.test.js` | ❌ Wave 0 (fichero nuevo) |
| LOCK-02 | verde determinista sin enmascarar; assert `exactly one` intacto | stress loop | loop ≥50× de `test/gsd-lock-race.test.js` bajo carga paralela, 0 fallos | ✅ (harness existente) |
| LOCK-02 | suite completa sigue verde (sin regresión en consumidores) | full suite | `node --test $(find test -name '*.test.js' -type f)` | ✅ |
| LOCK-03 | cierre documental (STATE.md + debug session movida a resolved/) | manual/doc | revisión de artefactos | N/A (doc) |

### Sampling Rate
- **Per task commit:** `node --test test/gsd-lock-race.test.js test/gsd-lock.test.js test/gsd-lock-guard.test.js`
- **Per wave merge:** loop de estrés ≥50× de `gsd-lock-race.test.js` bajo carga + `node --test test/gsd/` (doctor, consumidores)
- **Phase gate:** suite completa verde antes de `/gsd-verify-work`

### Wave 0 Gaps
- [ ] `test/gsd-lock-guard.test.js` — unit tests dirigidos del guard (cubre LOCK-01 a nivel primitiva vía API pública + seeding). Casos: (a) guard huérfano de PID muerto → steal procede; (b) guard fresco de PID vivo → se re-contiende/bloquea sin doble adquisición; (c) crash simulado (guard dejado + lock stale) → estado final consistente (un solo lock, un solo winner).
- [ ] Script/comando de estrés reproducible para VERIFICATION.md (loop ≥50× bajo carga paralela) — documentar, no necesariamente commitear.

*Nota: `test/gsd-lock-race.test.js` y `test/helpers/lock-race-child.mjs` NO se tocan (D-07 byte-idéntico).*

## Security Domain

> `security_enforcement` ausente en config → tratado como enabled. Fase de concurrencia de filesystem: la mayoría de categorías ASVS de entrada/cripto/sesión no aplican (sin entrada de usuario no confiable, sin cripto, sin sesión web). La superficie relevante es **disponibilidad/integridad** del lock.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — (el "session_id" del lock es un id de sesión GSD interno, no auth) |
| V4 Access Control | no | — |
| V5 Input Validation | no | El contenido del lock/guard es generado internamente, no entrada externa |
| V6 Cryptography | no | `randomUUID` se usa para unicidad de nombres, no como secreto |

### Known Threat Patterns for `node:fs` concurrency

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Doble adquisición del lock (dos agentes GSD sobre un repo → corrupción de estado) | Tampering | Reemplazo in-place atómico + guard `O_EXCL` (el fix de esta fase; TOP THREAT T-81-03-01) |
| "Arreglo" que debilita el CAS y enmascara la carrera | Tampering (integridad de la garantía) | Assert `exactly one` intacto + harness byte-idéntico + verde determinista bajo estrés (T-81-03-02) |
| Guard huérfano que bloquea steals para siempre (poseedor crashea dentro del guard) | Denial of Service | Guard **breakable** por PID-muerto o edad>umbral corto (D-05); cleanup best-effort |
| tmp/guard huérfano acumulándose como basura | Denial of Service (menor) | Nombres únicos por escritor + unlink best-effort en camino feliz y de error |

## Sources

### Primary (HIGH confidence)
- `.planning/debug/gsd-lock-race-cr01.md` — causa raíz confirmada y reproducida (traza de dos `O_EXCL`-create ganadores, insensibilidad al hold, interleaving mínimo).
- `src/gsd/lock.js` (leído completo) — `stealLock`, `acquireGsdLock`, `isStaleLock`, `isPidAlive`, `writeLockFile`.
- `src/session/state-lock.js` (leído completo) — patrón O_EXCL + move-aside + ABA existente (mismo diseño, fuera de alcance esta fase; **observación:** comparte el patrón move-aside, latente-similar, pero gated por TTL+retries+corrupt-no-stealable; NO es objetivo de la fase, boundary lo excluye).
- `src/hooks/session-end.js:320-391` — patrón tmp+rename atómico de referencia (fix WR-02) que D-02 aplica al lock.
- `test/gsd-lock-race.test.js` + `test/helpers/lock-race-child.mjs` (leídos completos) — el harness CR-01, byte-idéntico (D-07).
- `.planning/REQUIREMENTS.md`, `.planning/STATE.md` — LOCK-01/02/03, fila Deferred a cerrar (D-10).

### Secondary (MEDIUM confidence)
- [nodejs.org fs docs — `fs.renameSync` wrapper de POSIX `rename(2)`] — atomicidad del reemplazo en el mismo filesystem, sobrescritura silenciosa del destino, restricción same-filesystem (WebSearch verificado contra doc oficial).

### Tertiary (LOW confidence)
- Ninguna crítica. Los razonamientos de diseño del guard (A1) están tagueados `[ASSUMED]` y deben validarse con los unit tests de D-07.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — cero deps, primitivas built-in ya en uso verificadas por grep.
- Architecture (fix D-02): HIGH — causa raíz reproducida; el mecanismo compone dos primitivas atómicas POSIX estándar; los puntos finos (rotura del guard, rama lockPath-ausente) están explícitamente flagueados como assumptions a validar con tests.
- Pitfalls: HIGH — derivados directamente del interleaving del diagnóstico y de garantías POSIX.

**Research date:** 2026-07-24
**Valid until:** 2026-08-23 (30 días — dominio estable; POSIX/Node fs no cambia)

---

## Project Constraints (from CONTEXT.md — LOCKED)

Copiados de `82-CONTEXT.md`. El planner DEBE honrarlos verbatim.

### Locked Decisions
- **R-81-01 (mantenedor):** fix real, no aceptación del riesgo.
- **DEBT-04:** el test `gsd-lock-race` NO se greenea enmascarando — ni `.skip`, ni retries, ni timeouts subidos, ni debilitar el assert `exactly one`. Debilitar el CAS es el TOP THREAT (T-81-03-02).
- **Cero deps npm nuevas** — solo `node:fs`/`node:crypto`.
- **D-01 (estructural):** `lockPath` jamás queda ausente durante un steal; la ventana se elimina por construcción, no por reducción probabilística.
- **D-02 (mecanismo):** reemplazo in-place atómico (tmp + `renameSync`→`lockPath`) + steal-guard `O_EXCL` que serializa re-check ABA + rename.
- **D-05:** steal-guard breakable (PID muerto o edad>umbral de segundos); contenido mínimo pid+ts; cleanup best-effort.
- **D-06:** perdedores del guard re-evalúan el estado fresco; presupuesto acotado (`MAX_STEAL_ATTEMPTS`); nunca espera indefinida.
- **D-07:** harness `test/gsd-lock-race.test.js` byte-idéntico; añadir unit tests dirigidos del guard; evidencia de verde determinista (loop de estrés ≥30, ideal bajo carga).
- **D-08 (contrato):** `AcquireResult`, formato JSON del lock, exports del módulo y semántica Cases 1-5 sin cambios; consumidores (`doctor.decideLock`, dispatch, release) intactos. Cambio contenido en `stealLock` + helpers privados nuevos.
- **D-09:** mover `.planning/debug/gsd-lock-race-cr01.md` → `.planning/debug/resolved/` con Outcome actualizado (fecha, mecanismo, commit).
- **D-10:** marcar cerrada la fila «Carrera real confirmada en `stealLock`» de STATE.md §Deferred Items.
- **D-11:** reescribir el docblock de `stealLock` (`lock.js:258-282`) — hoy describe el CAS move-aside que el fix elimina.

### Claude's Discretion
- Nombre exacto del fichero guard (p. ej. `.kodo.lock.steal-guard`), umbral concreto de edad (orden de segundos), presupuesto de re-contención (reutilizar/ajustar `MAX_STEAL_ATTEMPTS`), estructura interna de los helpers privados, y N del loop de estrés.

### Deferred Ideas (OUT OF SCOPE)
- El segundo mecanismo del harness (`raceGsdChildren` hold-expiry por spawn-jitter, benigno, 1/40) — NO objetivo; si reaparece como flaky residual, issue de harness aparte, jamás debilitando el assert.
- Rediseño mayor del modelo de locking (p. ej. migrar a lock por directorio) — fuera de alcance.
- `src/session/state-lock.js` — el lock del inbox (Phase 83 usa `withFileLock`, NUNCA este módulo). Fuera del boundary aunque comparta el patrón move-aside.

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LOCK-01 | N≥2 stealers del mismo lock muerto → exactamente uno adquiere; ventana move-aside→`O_EXCL` cerrada | Mecanismo D-02 (rename in-place + guard `O_EXCL`) documentado en Pattern 1-3; interleaving del diagnóstico explicado; blast radius verificado (solo `stealLock` + helpers) |
| LOCK-02 | test `gsd-lock-race` verde determinista sin enmascarar; suite completa verde | Validation Architecture: harness byte-idéntico (D-07), stress loop ≥50× bajo carga, full suite gate; consumidores (`doctor.decideLock`) confirmados intactos |
| LOCK-03 | R-81-01 + debug session cerradas con resolución documentada | Cierre documental mapeado (D-09 mover a `resolved/` — dir confirmado existente; D-10 fila STATE.md; D-11 docblock) |
