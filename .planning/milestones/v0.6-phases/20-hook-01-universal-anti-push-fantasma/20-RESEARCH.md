# Phase 20: HOOK-01 Universal Anti-Push-Fantasma - Research

**Researched:** 2026-05-12
**Domain:** Inyección de contexto en hooks Claude Code (string builders puros) + golden-bytes regression testing
**Confidence:** HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **D-01 — Idioma split:** ES en `buildSessionContext` (no-GSD, humano-facing) / EN en `buildGsdContext` (3 ramas GSD, agente-facing). Phase 8 D-04 + Phase 12 QUICK-07 invariante. No reabrir.
- **D-02 — Rigor textual:** Statement + instrucción + ejemplos Bad/Good obligatorios en cada bloque. Statement = "kodo NO hace `git push` automático." / "kodo does NOT push automatically." Bytes finales a discreción del planner dentro de este contrato.
- **D-02b — Formato:** Markdown plano, sin emojis ni ANSI. 1 H2 header, 1 párrafo statement+instrucción, 1 sub-bloque de ejemplos. Total 6–10 líneas por idioma.
- **D-03 — Posición:** Header propio AL FINAL del array `lines` en cada builder (append puro). HOOK-02 satisfied by construction porque los bytes anteriores no cambian.
- **D-04 — Granularidad:** Bloque EN único común a las 3 ramas GSD (quick / phase / bootstrap) + bloque ES único en no-GSD. NO variantes por rama.
- **D-04b — Helper vs inline:** Preferencia inline en `src/hooks/session-start.js`; helper aislado `buildAntiPushReminder(lang)` SOLO si reduce duplicación significativa entre los 2 builders.
- **D-05 — Orchestrator EXCLUIDO:** `src/orchestrator/prompt.md`, `launchOrchestrator`, `buildContextSummary` (`src/orchestrator/launch.js:128–157`), y skill `kodo-orchestrate` NO se modifican. Análogo a Phase 18 D-06.

### Claude's Discretion
- Bytes exactos del fraseo ES y EN (dentro del contrato D-02).
- Helper vs inline (preferencia inline; helper si reduce duplicación).
- Estrategia de test golden bytes (snapshot files vs asserts inline) — referencias Phase 12 QUICK-07, Phase 14 D-07 format-isolation, Phase 16 LOG-13 dispatcher-isolation.
- Ejemplos concretos del par "Bad/Good" ES y EN.
- Decisión de extraer a `src/hooks/anti-push.js` o mantener inline.

### Deferred Ideas (OUT OF SCOPE)
- Enforcement runtime de `git push` verification (parsing transcript + `git rev-list @{u}..`) — defer a v0.7+.
- NDJSON event `hook.anti_push.injected` — defer indefinido (bloque estático, no state observable).
- Recordatorio en orchestrator `prompt.md` — D-05 lo excluye.
- Recordatorio en skill `kodo-orchestrate` — defer cohesivo con D-05; evaluar en Phase 21.
- Variantes por rama GSD (4 bloques distintos) — D-04 lo descartó.
- Localización dinámica (i18n) por config — defer indefinido.
- Snapshot infra estilo Jest en `test/__snapshots__/` — defer cosmético; consolidar si Phase 21+ acumula más golden bytes tests.
- Migración retroactiva de sesiones v0.5 vivas en `state.json` — el bloque se inyecta en próximo `session-start`, no se backfillea.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description (from REQUIREMENTS.md §HOOK-01 universal) | Research Support |
|----|-------------------------------------------------------|------------------|
| HOOK-01 | `buildSessionContext` añade sección "Anti-push-fantasma" a TODAS las sesiones (GSD + no-GSD). Texto: kodo NO hace push automático; el agente debe verificar `git push` real o redactar en condicional. Driver ROMAN-125/126. | §Proposed Block Text (ES + EN canonical); §Implementation Sketch (líneas exactas de inserción L66/L152). |
| HOOK-02 | Golden bytes preservados — tags `[GSD quick]`, `[GSD phase N]`, `[GSD bootstrap]` no cambian shape ni offset relativo; bloque HOOK-01 en posición determinista. | §Golden Bytes Verification Strategy (opción B recomendada: split-on-header + prefix invariant). |
| HOOK-03 | Test coverage para 3 modos × `buildSessionContext` (full / quick / no-GSD) — recordatorio aparece + resto del prompt no muta. | §Test Plan (matrix 4 fixtures × 3 assertions × 1 archivo extendido). |
</phase_requirements>

## Research Summary

Phase 20 es **append puro** sobre dos builders puros sin I/O (`buildSessionContext` L23-68 y `buildGsdContext` L83-155 en `src/hooks/session-start.js`). El trabajo es: (1) extender ambos arrays `lines` con un bloque markdown final, (2) añadir tests `node:test` extendiendo los 2 archivos existentes (`test/session-start.test.js` para no-GSD y QUICK-08, `test/gsd-context.test.js` para las 3 ramas GSD). [VERIFIED: src/hooks/session-start.js leído]

**El driver primario** (ROMAN-125/126) es semántico, no estructural: el agente parafrasea "deploy hecho" sin haber pusheado. La defensa elegida es **instrucción explícita con ejemplo Bad/Good** que bloquee la paráfrasis (D-02). El delta de bytes total es ~6-10 líneas por idioma × 2 idiomas ≈ 100-200 bytes por modo. [CITED: 20-CONTEXT.md L40-46]

**HOOK-02 (golden bytes)** se satisface *por construcción*: el bloque va al FINAL del array `lines`, después del último item existente. Los bytes 0..N-pre-header quedan idénticos. Las tags `[GSD quick]` / `[GSD phase N]` / `[GSD bootstrap]` se emiten en `src/orchestrator/launch.js:128-157` (`buildContextSummary`) que NO se modifica (D-05) — su invariancia es trivialmente preservada. [VERIFIED: src/hooks/session-start.js L67 + L154 — ambos builders terminan con `lines.join('\n')` tras un array literal]

**Primary recommendation:** **Inline** el bloque en cada builder (D-04b preferencia), NO extraer a helper aislado. Razón: 2 callsites con 2 bloques distintos (ES vs EN) = duplicación cero (cada builder tiene SU idioma). Un helper `buildAntiPushReminder(lang)` consumido en 2 sitios añade superficie de import + branching sin reducir bytes. Si en Phase 22+ se añade un 3er builder, reevaluar entonces.

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Construir prompt no-GSD ES | `src/hooks/session-start.js::buildSessionContext` (línea 23) | — | Pure builder, fuente canonical del prompt en sesiones sin label `kodo:gsd`. |
| Construir prompt GSD EN (3 ramas) | `src/hooks/session-start.js::buildGsdContext` (línea 83) | — | Pure builder, fuente canonical en sesiones GSD. Convergencia en `lines.join('\n')` L154 facilita append común (D-04). |
| Despacho no-GSD vs GSD | `src/hooks/session-start.js::main()` (líneas 184-186, ternario `session.gsd ?`) | — | NO se modifica — el ternario ya cubre los 4 modos. |
| Bloque "anti-push" (helper opcional) | INLINE en cada builder (preferido) | `src/hooks/anti-push.js::buildAntiPushReminder(lang)` (si planner lo justifica) | D-04b prefiere inline. Helper aislado solo si extracción reduce duplicación real (no aplica con 2 idiomas distintos). |
| Tests pure-builder coverage | `test/session-start.test.js` (no-GSD + QUICK-08 quick) y `test/gsd-context.test.js` (full+phase + bootstrap) | Nuevo archivo si planner crea helper aislado | Extender los 2 archivos existentes — fixtures `makeSession()` ya cubren los 4 modos. |
| Tags `[GSD quick]` / `[GSD phase N]` / `[GSD bootstrap]` | `src/orchestrator/launch.js::buildContextSummary` (líneas 128-157) | — | EXCLUIDO (D-05). NO se toca. La preservación de sus golden bytes es trivial. |

## Standard Stack

### Core (existente, sin nuevos packages)
| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `node:test` | Node 20+ builtin | Test runner | Convención existente — todos los `test/*.test.js` lo usan. [VERIFIED: .planning/codebase/TESTING.md L7-9, package.json L10] |
| `node:assert/strict` | Node 20+ builtin | Aserciones | Convención existente. [VERIFIED: test/session-start.test.js L2, test/gsd-context.test.js L2] |
| `node:fs.readFileSync` | Node 20+ builtin | Source-hygiene reads (si se añade test estático) | Patrón establecido en `test/format-isolation.test.js` y `test/dispatcher-isolation.test.js`. [VERIFIED] |

**No new dependencies.** Phase 20 es estrictamente código JavaScript puro + tests con stack existente.

### Alternatives Considered
| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| Inline asserts (`assert.match`) | `node:test` snapshot infra (experimental Node 22+) | Snapshot infra añade dependencia de Node 22+ y archivos `__snapshots__/`. Costo > beneficio para 2 bloques estáticos. Defer cosmético (Deferred Ideas). |
| 4 fixtures inline (`makeSession`) | Fixture compartido en `test/fixtures/sessions.js` | Helper compartido no existe (verificado: `ls test/fixtures/` solo tiene archivos `.json` de webhooks). Añadirlo es expansión de scope. Mantener inline en cada test file. [VERIFIED] |
| Test estático source-hygiene "ambos builders emiten el bloque" | Inline-only asserts en los tests funcionales | Si el planner extrae a helper, source-hygiene es ÚTIL (verifica wiring). Si inline, source-hygiene es REDUNDANTE con los asserts funcionales. Recomendación: solo añadir source-hygiene si se extrae helper. |

## Existing Test Infrastructure

### Archivos relevantes (existentes, a extender)

| Archivo | Cubre actualmente | Extensión Phase 20 |
|---------|-------------------|---------------------|
| `test/session-start.test.js` | `buildSessionContext` (no-GSD ES, 7 tests Test 1–6 + provider override + summary check) + QUICK-08 (quick mode buildGsdContext, 7 tests) + source invariants (Phase 9 anti-`gsdPhaseResolved`, Phase 13 anti-`.gsd_mode` direct access) | Añadir suite `describe('HOOK-01 — anti-push reminder, no-GSD ES')` + extender QUICK-08 con asserts del bloque EN en rama quick. |
| `test/gsd-context.test.js` | `buildGsdContext` rama full+phase (con `phase_id`) y rama bootstrap (sin `phase_id`) — 11 tests cubriendo header GSD Mode, comandos hyphen, idioma EN, brief ordering. | Añadir suite `describe('HOOK-01 — anti-push reminder, GSD EN')` con asserts para las 3 ramas (quick / phase / bootstrap). |

### Patrones a reusar verbatim

**1. Fixture builder pattern** (ya existente — D-02b CONVENTIONS.md):
```javascript
// test/session-start.test.js L15-29 — no-GSD fixture
function makeSession(overrides = {}) {
  return {
    workspace_ref: 'KL-42', session_id: 'sess-abc', task_id: 'uuid-123',
    task_ref: 'KL-42', provider: 'plane', project_id: 'proj-1',
    summary: 'Fix bug', status: 'running',
    started_at: '2026-04-10T00:00:00.000Z', project_path: '/tmp/kl-42',
    ...overrides,
  };
}

// test/gsd-context.test.js L10-25 — GSD fixture (idéntico + `gsd: true` default)
function makeSession(overrides = {}) {
  return { ...defaults, gsd: true, ...overrides };
}
```

Los 4 modos se construyen con sobrescrituras directas — no requieren nuevas fixtures:
- **no-GSD:** `makeSession()` sin `gsd` (default false en `test/session-start.test.js`).
- **GSD quick:** `makeSession({ gsd: true, gsd_mode: 'quick' })` — ya existente (L101 `test/session-start.test.js`).
- **GSD phase (full+match):** `makeSession({ phase_id: '08' })` — ya existente (L41 `test/gsd-context.test.js`).
- **GSD bootstrap:** `makeSession({ phase_id: undefined })` — ya existente (L55 `test/gsd-context.test.js`).

[VERIFIED: ambos archivos leídos en su totalidad]

**2. Source-hygiene pattern (comment-stripping + grep)** — relevante solo si Phase 20 extrae helper:
```javascript
// test/dispatcher-isolation.test.js L24-30 — strip both block + line comments + JSDoc continuations
function stripComments(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !line.trim().startsWith('//') && !line.trim().startsWith('*'))
    .join('\n');
}
```

Usado en `test/session-start.test.js:228-232` (Phase 9 `gsdPhaseResolved` anti-invocation) y `test/session-start.test.js:289-293` (Phase 13 `.gsd_mode` access). [VERIFIED]

**3. Asserts inline (no snapshot files)** — `assert.match(ctx, /pattern/)` y `assert.ok(!ctx.includes('forbidden'))`. Es el patrón uniforme de TODA la suite `session-start`/`gsd-context`. [VERIFIED: 11 tests en gsd-context.test.js + 13 tests en session-start.test.js]

### Lo que NO existe (no inventar)

- **`test/__snapshots__/`** — directorio no presente. Phase 20 NO lo crea (Deferred Ideas).
- **`test/fixtures/sessions.js`** — fixture compartido NO existe; `test/fixtures/` solo contiene `*.json` de Plane webhooks. NO crear.
- **Fixture explícito "no-GSD" en `test/session-start.test.js`** — el archivo ya prueba `buildSessionContext` con `makeSession()` (sin `gsd: true`) lo cual ES el modo no-GSD. Reutilizar.

[VERIFIED: ls test/fixtures/ — solo .json; ls test/helpers/ — logger-fixtures, logger-sink, startup-baseline]

## Golden Bytes Verification Strategy

### Recomendación: **Opción B — split-on-header + prefix invariant**

Tres opciones evaluadas:

| Opción | Descripción | Coste | Robustez | Recomendación |
|--------|-------------|-------|----------|---------------|
| A | Hash SHA256 de los primeros N bytes (constante hardcodeada) | Bajo (~5 LOC) | Frágil: cualquier cambio legítimo de prompt rompe el test — falsos positivos. | **No**. |
| **B** | **Split del output por el nuevo header `## Anti-push-fantasma` / `## No automatic push`, asserts que el prefix == output sin bloque.** | **Bajo (~10 LOC por modo)** | **Alta: tolera ediciones legítimas de prompt; falla solo si el bloque NO está al final (D-03 violation).** | **Sí — recomendada.** |
| C | Snapshot files completos en `test/__snapshots__/` | Alto (infra nueva + 4 archivos de fixture binarios) | Alta pero costosa de mantener: cada edición legítima requiere `--update-snapshots`. | No — defer cosmético. |

**Implementación opción B (canonical, ~10 LOC):**

```javascript
it('HOOK-02: bloque "Anti-push-fantasma" está al FINAL — prefix bytes intactos (no-GSD ES)', () => {
  const ctx = buildSessionContext(makeSession(), makeConfig());
  const HEADER = '## Anti-push-fantasma';
  const idx = ctx.lastIndexOf(HEADER);
  assert.ok(idx > 0, `header "${HEADER}" must be present`);
  // Asserts el header está al final (no antes del último \n significativo).
  const tail = ctx.slice(idx);
  assert.ok(tail.startsWith(HEADER), 'header must start the final block');
  // Asserts el prefix (todo antes del header) acaba en '\n\n' (D-03: append con blank line).
  const prefix = ctx.slice(0, idx);
  assert.ok(prefix.endsWith('\n\n'), 'prefix must end with blank line separator before HOOK-01 block');
});
```

Para HOOK-02 en `buildGsdContext`, el patrón es idéntico con header `## No automatic push` y se aplica a las 3 ramas (4 tests en total: no-GSD ES + GSD-quick EN + GSD-phase EN + GSD-bootstrap EN).

### Precedentes citados

- **Phase 12 QUICK-07** — golden bytes test sobre `[GSD quick]` / `[GSD phase N]` / `[GSD bootstrap]` en `buildContextSummary` (`src/orchestrator/launch.js`). Phase 20 NO toca ese módulo (D-05) — tags preservadas por construcción. [CITED: 20-CONTEXT.md L94]
- **Phase 14 D-07** — single-source-of-color en `test/format-isolation.test.js`. Patrón `extractImports + walkImports` para verificar grafos. Phase 20 lo reusaría SOLO si extrae helper. [VERIFIED: test/format-isolation.test.js L23-52]
- **Phase 16 LOG-13** — `test/dispatcher-isolation.test.js` con `stripComments` para distinguir runtime literals de comentarios documentales. Phase 20 lo reusaría si añade source-hygiene anti-inline (verificar que el bloque solo aparece UNA vez en source si se extrae helper). [VERIFIED: test/dispatcher-isolation.test.js L24-30]

### Por qué NO opción A (hash)

El prompt completo es prosa modificable por phases futuras (correcciones de español, cambios de fraseo). Un hash constante rompería en cada commit legítimo. Opción B solo se rompe si HOOK-01 deja de estar al final — exactamente la regresión que queremos detectar.

## Proposed Block Text (ES + EN, canonical, ready-to-copy)

### Bloque ES (no-GSD, `buildSessionContext`)

```markdown
## Anti-push-fantasma

kodo NO hace `git push` automático. Antes de afirmar deploy, publicación o cambios remotos, verifica con `git push` real, o redacta la afirmación en condicional ("una vez se haga push…").

Ejemplos:
- Bad: "Feature publicada en producción."
- Good: "Feature commiteada localmente, pendiente de `git push` al remoto."
- Bad: "Deploy hecho."
- Good: "Deploy quedará efectivo una vez se haga `git push origin main`."
```

**Conteo:** 7 líneas (1 header + 1 blank + 1 párrafo + 1 blank + 1 "Ejemplos:" + 4 bullets) = dentro del rango 6–10 D-02b. Total bytes ≈ 360.

### Bloque EN (GSD, `buildGsdContext` — 3 ramas)

```markdown
## No automatic push

kodo does NOT push automatically. Before claiming a deploy, release, or any remote change, verify with a real `git push`, or phrase the claim conditionally ("once pushed…").

Examples:
- Bad: "Feature deployed to production."
- Good: "Feature committed locally, pending `git push` to remote."
- Bad: "Deploy done."
- Good: "Deploy will be live once `git push origin main` runs."
```

**Conteo:** 7 líneas — paridad estructural con el bloque ES. Total bytes ≈ 350.

### Justificación del fraseo

- **Statement explícito al inicio** (D-02): "kodo NO hace `git push` automático." / "kodo does NOT push automatically." — frase única, sujeto activo, verbo en presente. Bloquea ambigüedad. [CITED: 20-CONTEXT.md L42]
- **Instrucción accionable** (D-02): "verifica con `git push` real, o redacta en condicional" — da dos caminos válidos (verificar o reformular), evita opción muerta. [CITED: 20-CONTEXT.md L43]
- **Ejemplos Bad/Good con 2 escenarios** (D-02): "publicada" + "deploy" — los dos verbos canónicos del incidente ROMAN-125/126. Cada uno con Bad (claim sin push) y Good (claim condicional con `git push` explícito). [CITED: 20-CONTEXT.md L44]
- **Sin emojis ni ANSI** (D-02b): Markdown plano. [CITED: 20-CONTEXT.md L46]
- **Backticks alrededor de `git push`** — convención de markdown del resto del prompt (verificado: L57 `\`/exit\``, L60 `\`buildSessionContext\``). Mantiene consistencia estilística.

### Notas del planner

- El planner puede ajustar fraseo dentro del contrato semántico de D-02 (statement + instrucción + ejemplos). Los bytes exactos no están locked, solo el contrato.
- **NO** usar ` 'feature deployed' ` con comillas simples internas — choca con el escape D-04 de `buildGsdContext` (replace `"` → `'`). Usar comillas dobles "outer". Verificado en L137 `test/session-start.test.js`: el código defang con `.replace(/"/g, "'")` afecta SOLO al título del task — no afecta al bloque anti-push porque el bloque es literal estático, no interpola `session.summary`. Seguro.

## Implementation Sketch

### Sitio #1: `buildSessionContext` (ES, no-GSD) — `src/hooks/session-start.js` L23-68

**Estado actual** (L66-67):
```javascript
    'Si no puedes terminar (falta info, hay blocker, requiere decisión humana): comenta el estado actual con detalle, **no muevas a revisión**, y cierra con `/exit`. La tarea quedará visible en el dashboard para que el humano intervenga.',
  ].join('\n');
}
```

**Cambio (append al final del array antes del `].join('\n')`):**
```javascript
    'Si no puedes terminar (falta info, hay blocker, requiere decisión humana): comenta el estado actual con detalle, **no muevas a revisión**, y cierra con `/exit`. La tarea quedará visible en el dashboard para que el humano intervenga.',
    '',
    '## Anti-push-fantasma',
    '',
    'kodo NO hace `git push` automático. Antes de afirmar deploy, publicación o cambios remotos, verifica con `git push` real, o redacta la afirmación en condicional ("una vez se haga push…").',
    '',
    'Ejemplos:',
    '- Bad: "Feature publicada en producción."',
    '- Good: "Feature commiteada localmente, pendiente de `git push` al remoto."',
    '- Bad: "Deploy hecho."',
    '- Good: "Deploy quedará efectivo una vez se haga `git push origin main`."',
  ].join('\n');
}
```

**Diff:** +11 líneas (incluyendo 2 blank lines separadoras). Inserción tras línea 66 actual.

### Sitio #2: `buildGsdContext` (EN, 3 ramas GSD) — `src/hooks/session-start.js` L83-155

**Estado actual** (L152-155):
```javascript
    );
  }

  return lines.join('\n');
}
```

**Cambio (append común DESPUÉS del if/else, ANTES del return — D-04 simplificación):**
```javascript
    );
  }

  // HOOK-01: anti-push reminder común a las 3 ramas GSD (quick / phase / bootstrap).
  // Append puro al FINAL preserva golden bytes de los bloques anteriores (HOOK-02).
  lines.push(
    '',
    '## No automatic push',
    '',
    'kodo does NOT push automatically. Before claiming a deploy, release, or any remote change, verify with a real `git push`, or phrase the claim conditionally ("once pushed…").',
    '',
    'Examples:',
    '- Bad: "Feature deployed to production."',
    '- Good: "Feature committed locally, pending `git push` to remote."',
    '- Bad: "Deploy done."',
    '- Good: "Deploy will be live once `git push origin main` runs."',
  );

  return lines.join('\n');
}
```

**Diff:** +13 líneas (incluyendo 2 líneas de comentario JSDoc-style + push() call de 11 items). La convergencia de las 3 ramas en el mismo `lines.push(...)` post-if/else satisface D-04 (1 bloque común para 3 ramas) con coste mínimo.

### Decisión helper vs inline: **inline confirmado**

| Métrica | Inline (recomendado) | Helper `buildAntiPushReminder(lang)` |
|---------|----------------------|--------------------------------------|
| LOC añadidas | +11 ES + +13 EN = 24 | +5 helper + 4 import/call = 9 (pero +20 cuerpo helper) ≈ 29 |
| Imports nuevos | 0 | 1 (`buildAntiPushReminder` desde otro archivo, o función local) |
| Source-hygiene tests | No requeridos (bloque inline = sin drift posible) | Sí requeridos (anti-inline grep + ambos builders consumen helper) |
| Reusabilidad futura | Si Phase 22+ añade un 3er builder → refactor entonces | Lista para reuso (overengineering hoy — YAGNI) |
| Cumplimiento D-04b | Preferencia explícita: "Inline preferido… helper aislado si reduce duplicación" | Reduce duplicación 0 (cada idioma es 1 callsite distinto) |

**Veredicto:** Inline. Cada bloque está en 1 callsite único; helper aislado introduce import/branch sin ahorrar bytes.

### Sitios NO modificados (asegurar)

- `src/hooks/session-start.js:184-186` (`main()` ternario despacho) — sin cambios.
- `src/orchestrator/launch.js:128-157` (`buildContextSummary`) — sin cambios (D-05).
- `src/orchestrator/prompt.md` — sin cambios (D-05).
- `.claude/skills/kodo-orchestrate/skill.md` — sin cambios (D-05).
- `src/labels.js` (`getSessionMode`) — sin cambios. El bloque es común a las 3 ramas GSD (D-04), no requiere discriminar `mode`.

## Test Plan

### Matrix HOOK-01/02/03 (fixtures × assertions × archivo)

| Fixture | HOOK-01 (presencia bloque) | HOOK-02 (golden bytes prefix) | HOOK-03 (otros invariantes preservados) | Archivo destino |
|---------|---------------------------|------------------------------|----------------------------------------|-----------------|
| no-GSD (`makeSession()` sin `gsd`) | `assert.match(ctx, /## Anti-push-fantasma/)` + `assert.match(ctx, /Bad:.*Feature publicada/)` | `lastIndexOf('## Anti-push-fantasma') > 0` + `prefix.endsWith('\n\n')` + tail starts with header | Resto de asserts existentes (`/KL-99/`, `/MCP de Plane/`, `/Refactor auth/`) siguen pasando — extender beforeEach NO necesario. | `test/session-start.test.js` (nueva suite `describe('HOOK-01 — anti-push reminder, no-GSD ES')`) |
| GSD quick (`makeSession({ gsd: true, gsd_mode: 'quick' })`) | `assert.match(ctx, /## No automatic push/)` + `assert.match(ctx, /Bad:.*Feature deployed/)` | Idem opción B con header `## No automatic push` | QUICK-08 asserts existentes (`/gsd-quick "TASK-X"/`, no `gsd-plan-phase`) siguen pasando — los nuevos asserts se añaden en orden tras los existentes. | `test/session-start.test.js` (extender suite `describe('QUICK-08 — quick mode buildGsdContext')`) |
| GSD phase (`makeSession({ phase_id: '08' })`) | `assert.match(ctx, /## No automatic push/)` | Idem opción B con header EN | Asserts existentes (`/gsd-plan-phase 08/`, etc.) siguen pasando. | `test/gsd-context.test.js` (extender suite existente o crear `describe('HOOK-01 — anti-push reminder, GSD EN')`) |
| GSD bootstrap (`makeSession({ phase_id: undefined })`) | `assert.match(ctx, /## No automatic push/)` | Idem opción B con header EN | Asserts existentes (`/gsd-new-project/`, brief ordering) siguen pasando. | `test/gsd-context.test.js` (idem) |

### Tests adicionales sugeridos (defensa en profundidad)

1. **Common-block invariance:** los 3 outputs GSD (quick / phase / bootstrap) contienen el MISMO bloque EN bytes-idénticos. Implementación:
   ```javascript
   it('HOOK-01: bloque EN es bytes-idéntico en las 3 ramas GSD (D-04)', () => {
     const HEADER = '## No automatic push';
     const ctxQuick = buildGsdContext(makeSession({ gsd_mode: 'quick' }));
     const ctxPhase = buildGsdContext(makeSession({ phase_id: '08' }));
     const ctxBoot = buildGsdContext(makeSession({ phase_id: undefined }));
     const tail = (s) => s.slice(s.lastIndexOf(HEADER));
     assert.equal(tail(ctxQuick), tail(ctxPhase));
     assert.equal(tail(ctxPhase), tail(ctxBoot));
   });
   ```

2. **Idempotencia (re-emisión bytes-idéntica)** — SC#3 del ROADMAP. Implementación:
   ```javascript
   it('HOOK-01: idempotente — re-emitir produce mismos bytes (SC#3)', () => {
     const session = makeSession({ gsd: true, phase_id: '08' });
     const a = buildGsdContext(session);
     const b = buildGsdContext(session);
     assert.equal(a, b);
     assert.equal(a.length, b.length);
   });
   ```
   Aplica también a `buildSessionContext`. Coste: 2 tests, 6 LOC totales.

3. **No emojis / no ANSI** (D-02b enforcement):
   ```javascript
   it('HOOK-01 D-02b: bloque sin emojis ni ANSI (no-GSD)', () => {
     const ctx = buildSessionContext(makeSession(), makeConfig());
     const block = ctx.slice(ctx.lastIndexOf('## Anti-push-fantasma'));
     assert.ok(!/[\u{1F300}-\u{1FAFF}]/u.test(block), 'block must not contain emojis');
     assert.ok(!/\[/.test(block), 'block must not contain ANSI escapes');
   });
   ```
   Nota: el bloque ES contiene ✅/📁/⚠️/🔍 en la sección "Comentario final de resumen" (L50-53 actual), pero ESO ES SECCIÓN PREVIA, no parte del bloque HOOK-01. El test slice solo desde el header HOOK-01 — los emojis previos no afectan.

### Source-hygiene (opcional, solo si helper se extrae)

Si el planner **NO** sigue la recomendación inline y crea `src/hooks/anti-push.js`, añadir:
```javascript
// test/anti-push-isolation.test.js (nuevo)
// Verifica que ambos builders consumen el helper, no inline:
// - grep `import { buildAntiPushReminder }` en session-start.js → presente
// - grep `'## Anti-push-fantasma'` en session-start.js (stripComments) → 0 ocurrencias (solo en helper)
// - grep `'## No automatic push'` en session-start.js (stripComments) → 0 ocurrencias
```
Patrón verbatim de `test/dispatcher-isolation.test.js` con `stripComments`. **Si se mantiene inline (recomendado), este test NO se crea.**

### Coverage delta

| Test file | Tests existentes | Tests Phase 20 añadidos | Tests totales tras Phase 20 |
|-----------|-----------------|------------------------|----------------------------|
| `test/session-start.test.js` | 13 (6 buildSessionContext + 7 QUICK-08 + 6 source invariants — total 19 si cuentas todos) | +4–6 (no-GSD: presencia, HOOK-02 prefix, idempotencia, no-emoji; QUICK-08: presencia EN, HOOK-02 prefix) | ~25 |
| `test/gsd-context.test.js` | 11 | +5–6 (phase: presencia + HOOK-02 + common-block; bootstrap: presencia + HOOK-02; idempotencia) | ~17 |

**Costo total:** ~10 tests nuevos, ~80–100 LOC de test. Tiempo de ejecución estimado: <50ms (builders puros, sin I/O). [VERIFIED: tests existentes en estos archivos son síncronos puros]

### Comando de validación

```bash
# Quick run (solo Phase 20):
node --test test/session-start.test.js test/gsd-context.test.js

# Full suite (gate de fase):
npm test
```

## Risks and Unknowns

### Riesgo R1: Consumer downstream que parsea estructuralmente el prompt
**Qué podría pasar:** Un consumidor lee `additionalContext` (vía hookSpecificOutput JSON L215-220) y hace parsing line-by-line, asumiendo que el último item es "Si no puedes terminar..." (L66).

**Búsqueda realizada:** `grep -rn 'buildSessionContext\|buildGsdContext' src/`. Resultados:
- `src/cli/gsd-inspect.js:181` — llama `buildGsdContext(syntheticSession, { brief })` SOLO para preview en bootstrap. Imprime el output literal, NO parsea estructuralmente. SEGURO.
- `src/session/manager.js:325` — solo comentario referenciando ambas funciones. NO consumidor real.
- `src/hooks/session-start.js:184-186` — el `main()` propio. SEGURO.

**Evidencia:** No hay consumer que asuma forma estructural del prompt. El append al final es seguro. [VERIFIED: grep ejecutado]

### Riesgo R2: gsd-inspect preview muestra el bloque
**Qué podría pasar:** `kodo gsd inspect` muestra el preview de `buildGsdContext` (línea 181 `gsd-inspect.js`) — tras Phase 20 mostrará el bloque anti-push también.

**Impacto:** Cero negativo — es exactamente el comportamiento esperado. El operador verá que el bloque va al agente.

**Acción:** Ninguna. Documentar en VERIFICATION/QA que el preview ahora incluye el bloque (cosmético).

### Riesgo R3: Tests pre-Phase 20 que asertan length total del prompt o última línea exacta
**Qué podría pasar:** Algún test asserta `ctx.endsWith(...)` o `ctx.split('\n').length === N` y romperá tras Phase 20.

**Búsqueda realizada:** `grep -nE "endsWith|length ===" test/session-start.test.js test/gsd-context.test.js`. Resultados: 0 matches. Los tests existentes usan SOLO `assert.match(regex)` y `assert.ok(!includes(...))` — todos compatibles con append al final. SEGURO. [VERIFIED]

### Riesgo R4: Bloque ES con emojis (✅/📁/⚠️/🔍) en sección previa contamina el assert de "no emojis"
**Qué podría pasar:** Si el test "no emojis" se aplica al output COMPLETO (no solo al slice del bloque HOOK-01), fallará porque L50-53 del prompt ES tiene emojis legítimos.

**Mitigación:** El test debe `slice(ctx.lastIndexOf(HEADER))` ANTES de verificar emojis. Documentado en §Test Plan #3.

### Unknown U1: ¿Hay sesiones legacy v0.5 que ya emiten algo "anti-push" similar?
**Búsqueda:** `grep -rni 'push.*automa\|no.*push\|anti-push' src/`. Resultados: 0 matches en src/. El término es nuevo en el codebase. SEGURO — no hay duplicación. [VERIFIED]

### Unknown U2: ¿El bloque anti-push debería mencionar `kodo session push` o algún CLI hipotético futuro?
**Respuesta:** No. Hoy `kodo` no tiene comando push. Phase 20 documenta la ausencia, no la presencia. Si v0.7+ añade `kodo push`, ESA phase revisa el bloque. CONFIRMED por D-02 (statement abstracto: "no automático", no menciona alternativas concretas más allá de `git push`).

## Validation Architecture

> `workflow.nyquist_validation: true` en `.planning/config.json` → sección incluida. [VERIFIED: cat .planning/config.json L11]

### Test Framework
| Property | Value |
|----------|-------|
| Framework | `node:test` (Node 20+ builtin) + `node:assert/strict` |
| Config file | None — Node.js defaults |
| Quick run command | `node --test test/session-start.test.js test/gsd-context.test.js` |
| Full suite command | `npm test` (= `node --test test/**/*.test.js` per `package.json:10`) |

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| HOOK-01 | `buildSessionContext` no-GSD contiene bloque "Anti-push-fantasma" ES con statement + ejemplos | unit | `node --test test/session-start.test.js` | ✅ existe — extender |
| HOOK-01 | `buildGsdContext` rama quick contiene bloque "No automatic push" EN | unit | `node --test test/session-start.test.js` (QUICK-08 suite) | ✅ existe — extender |
| HOOK-01 | `buildGsdContext` rama phase contiene bloque "No automatic push" EN | unit | `node --test test/gsd-context.test.js` | ✅ existe — extender |
| HOOK-01 | `buildGsdContext` rama bootstrap contiene bloque "No automatic push" EN | unit | `node --test test/gsd-context.test.js` | ✅ existe — extender |
| HOOK-02 | Header está al final; prefix bytes intactos (no-GSD) | unit | `node --test test/session-start.test.js` | ✅ existe — extender |
| HOOK-02 | Header está al final; prefix bytes intactos (3 ramas GSD) | unit | `node --test test/session-start.test.js` + `test/gsd-context.test.js` | ✅ existe — extender |
| HOOK-02 | Common-block bytes-idéntico en las 3 ramas GSD (D-04) | unit | `node --test test/gsd-context.test.js` | ✅ existe — extender |
| HOOK-03 | Idempotencia: re-emitir mismo input produce mismos bytes | unit | `node --test test/session-start.test.js` + `test/gsd-context.test.js` | ✅ existe — extender |
| HOOK-03 | Asserts pre-Phase-20 siguen pasando (`/KL-99/`, `/gsd-quick/`, etc.) | regression (existing) | `npm test` (suite completa) | ✅ tests existentes siguen pasando |

### Sampling Rate
- **Per task commit:** `node --test test/session-start.test.js test/gsd-context.test.js` (< 50ms estimado)
- **Per wave merge:** `npm test` (suite completa, ~50 test files)
- **Phase gate:** Full suite green antes de `/gsd-verify-work`

### Wave 0 Gaps
- *(none)* — `test/session-start.test.js` y `test/gsd-context.test.js` existen, las fixtures `makeSession` para los 4 modos ya están definidas, `node:test` runner está cableado, npm script `test` funciona. Phase 20 NO requiere bootstrap de infra de tests.

## Project Constraints (from CLAUDE.md)

> Repositorio `kodo` — `./CLAUDE.md` está vacío (placeholder). Constraints heredadas del global `~/.claude/CLAUDE.md`:

- **Idioma respuestas:** Español (este RESEARCH.md está en ES, los bloques EN dentro son código/texto literal a inyectar — correcto).
- **Reglas Karpathy:**
  - Regla 1 (piensa antes de codificar): este RESEARCH.md cumple — todas las asunciones declaradas en §Risks/Unknowns.
  - Regla 2 (simplicidad primero): recomendación inline confirma — no helper especulativo.
  - Regla 3 (cambios quirúrgicos): append al final = mínimo cambio posible. No tocar L29-65 ni L84-152 existentes.
  - Regla 4 (ejecución dirigida por objetivo): SCs explícitos en ROADMAP §Phase 20 (presencia por modo + golden bytes + idempotencia) → mapeados 1:1 a tests.

### CONVENTIONS específicas del repo (cumplir)

- `# frozen_string_literal: true` — N/A (es Ruby; kodo es Node.js).
- `@ts-check` en archivos `.js` — presente en `src/hooks/session-start.js:2`. Append no introduce types problemáticos (push de strings). [VERIFIED]
- Tests en `test/[feature].test.js` con `describe`/`it` + `node:assert/strict`. [VERIFIED — convención uniforme]
- No introducir dependencias externas — Phase 20 no las requiere.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | El planner aceptará el fraseo ES/EN propuesto sin cambios materiales (statement + 2 pares Bad/Good). | §Proposed Block Text | Bajo — D-02 da discreción explícita al planner; el fraseo es propuesta dentro del contrato semántico locked. |
| A2 | Ningún test pre-Phase-20 asume length total del prompt o última línea exacta. | §Risks R3 | Verificado con grep — 0 matches `endsWith` / `length ===` en los 2 archivos. Bajo. |
| A3 | El append común post-if/else en `buildGsdContext` es preferible al append en cada rama. | §Implementation Sketch | Bajo — D-04 explícitamente recomienda "el append común puede hacerse después del if/else" (20-CONTEXT.md L52). |
| A4 | `kodo gsd inspect` preview seguirá funcionando sin cambios. | §Risks R2 | Bajo — `buildGsdContext` mantiene firma (`session, opts`); el output simplemente añade líneas al final. |

**Si esta tabla parece pequeña:** la mayoría del trabajo de Phase 20 está locked por CONTEXT.md D-01..D-05 + canonical refs. Las asunciones residuales son cosméticas (fraseo) o están verificadas (grep en risks). Verdaderos `[ASSUMED]` que requerirían user confirmation: ninguno bloqueante.

## Open Questions

1. **¿Snapshot files o asserts inline?**
   - What we know: la suite actual usa 100% asserts inline (`assert.match`). Snapshot infra (`__snapshots__/`) NO existe.
   - What's unclear: ¿el planner quiere consolidar en snapshot infra para futuro Phase 21+ uso?
   - Recommendation: **inline** (Opción B en §Golden Bytes). Snapshot infra es deferred cosmético. Si Phase 21+ añade más golden bytes tests, reevaluar entonces.

2. **¿Helper `buildAntiPushReminder(lang)` aislado o inline?**
   - What we know: D-04b prefiere inline; helper si reduce duplicación.
   - What's unclear: el planner podría preferir helper por separación de concerns.
   - Recommendation: **inline** — duplicación real es cero (cada idioma 1 callsite). Helper añade superficie de import. Si Phase 22+ añade 3er builder, refactor entonces.

3. **¿Añadir test source-hygiene "anti-emoji" universal?**
   - What we know: D-02b prohíbe emojis en el bloque HOOK-01, pero el resto del prompt ES tiene emojis legítimos (L50-53).
   - What's unclear: el planner podría querer un test source-hygiene amplio "ningún literal con `\u{1F...}` añadido desde Phase 20" — pero eso necesita un snapshot del prompt pre-Phase 20.
   - Recommendation: test específico de slice del bloque HOOK-01 (Test 3 en §Test Plan defensa-en-profundidad). NO universal — overkill.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js | `node:test`, `node:assert/strict`, ESM imports | ✓ | Node 20+ (per `package.json` engines) | — |
| npm | `npm test` script | ✓ | bundled con Node | — |

**Sin dependencias externas nuevas.** Phase 20 es código JS puro + tests con stack existente. No requiere installs, no toca filesystem en runtime de los builders (puros).

## Security Domain

> `security_enforcement` no presente en `.planning/config.json` → tratar como enabled.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 20 no toca auth — solo strings de prompt. |
| V3 Session Management | no | Phase 20 no toca session state — `session` es input read-only a los builders. |
| V4 Access Control | no | Phase 20 no toca ACL. |
| V5 Input Validation | no | Los builders reciben `session` ya validado upstream (dispatcher); Phase 20 no añade nuevos input paths. El bloque anti-push es LITERAL estático, no interpola input. |
| V6 Cryptography | no | Phase 20 no toca crypto. |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Prompt injection vía `session.summary` | Tampering | Phase 12 D-04 ya defang con `.replace(/"/g, "'")` para `session.summary` dentro del comando `/gsd-quick`. Phase 20 NO interpola `session.summary` en el bloque anti-push — bloque es literal estático puro. **Seguro por construcción.** |
| Data exfiltration via prompt | Information Disclosure | Phase 20 no añade campos al prompt; añade prosa estática. No expone secrets ni paths. |
| Confused deputy (agent claims push without verification) | Spoofing | **Este es exactamente el threat que Phase 20 mitiga** — el bloque instruye al agente a verificar `git push` o reformular en condicional, bloqueando el patrón ROMAN-125/126 a nivel de prompt. Mitigación: prompt-level nudge (no enforcement runtime; eso queda deferred). |

**Veredicto Security:** Phase 20 es defensiva (añade un guard de prompt contra paráfrasis incorrecta del agente). NO introduce nuevas superficies de ataque. NO requiere SECURITY.md específico — el bloque es texto literal estático sin interpolación.

## Sources

### Primary (HIGH confidence)
- `src/hooks/session-start.js` L1-232 — VERIFIED leído completo. Builders puros, despacho ternario L184-186.
- `test/session-start.test.js` L1-299 — VERIFIED leído completo. Patrones `makeSession()`, `assert.match`, `stripComments`.
- `test/gsd-context.test.js` L1-100 — VERIFIED leído. Fixture GSD + tests por rama.
- `test/format-isolation.test.js` L1-181 — VERIFIED leído. Patrón `walkImports` (referencia, NO usado en Phase 20).
- `test/dispatcher-isolation.test.js` L1-65 — VERIFIED leído. Patrón `stripComments` (referencia, opcional en Phase 20).
- `.planning/phases/20-hook-01-universal-anti-push-fantasma/20-CONTEXT.md` L1-185 — CITED, decisiones locked D-01..D-05.
- `.planning/phases/20-hook-01-universal-anti-push-fantasma/20-DISCUSSION-LOG.md` L1-93 — CITED, alternativas descartadas.
- `.planning/REQUIREMENTS.md` L20-24 — CITED, requirements HOOK-01/02/03.
- `.planning/ROADMAP.md` L114-121 — CITED, 3 Success Criteria.
- `.planning/STATE.md` L63, L73 — CITED, open question cubierta + golden bytes invariante.
- `.planning/codebase/TESTING.md` L1-298 — VERIFIED leído. Patrón `node:test` + `node:assert/strict`.
- `.planning/config.json` — VERIFIED. `nyquist_validation: true`, sin `security_enforcement` override.
- `package.json` L10 — VERIFIED. `"test": "node --test test/**/*.test.js"`.

### Secondary (MEDIUM confidence)
- Convención CLAUDE.md global (idioma ES, reglas Karpathy) — aplicada a este RESEARCH.md y a las recomendaciones (simplicidad + cambios quirúrgicos).

### Tertiary (LOW confidence)
- *(none)* — toda la información crítica viene de fuentes verificadas en el codebase o en CONTEXT/ROADMAP/REQUIREMENTS locked.

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — `node:test` + `node:assert/strict` verificados en uso (50+ test files).
- Architecture: HIGH — builders puros leídos completos; sin I/O, sin globals, sin imports nuevos requeridos.
- Pitfalls: HIGH — risks R1–R4 verificados con grep; consumers downstream identificados (gsd-inspect solo imprime, no parsea).
- Golden bytes strategy: HIGH — opción B robustamente derivada de la naturaleza append-puro del cambio; alternativas A/C honestamente evaluadas.
- Proposed block text: MEDIUM — fraseo es propuesta dentro del contrato D-02 (locked); el planner tiene discreción de bytes exactos.

**Research date:** 2026-05-12
**Valid until:** 2026-06-11 (30 días — stack y patrones estables; sin dependencias externas que puedan moverse)

## RESEARCH COMPLETE
