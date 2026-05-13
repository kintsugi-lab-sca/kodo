---
phase: 20
depth: standard
status: issues_found
findings_total: 4
critical: 0
warning: 1
info: 3
date: 2026-05-12
files_reviewed: 3
files_reviewed_list:
  - src/hooks/session-start.js
  - test/session-start.test.js
  - test/gsd-context.test.js
---

# Phase 20: HOOK-01 Universal Anti-Push-Fantasma — Code Review

## Summary

La phase 20 hace exactamente lo que dice: append puro de un bloque markdown estático al final de `buildSessionContext` (ES) y un `lines.push(...)` post-if/else en `buildGsdContext` (EN común a las 3 ramas). Construcción quirúrgica, sin imports nuevos, sin tocar el despacho, sin tocar el orchestrator. Las invariantes principales (D-01 split idioma, D-03 append al final, D-04 common-block, D-05 orchestrator excluido) están bien implementadas y los tests las blindan razonablemente.

No hay BLOCKERS. Encontré un WARNING real: el test "no emojis" (D-02b) usa un rango Unicode incompleto que NO detectaría emojis legítimamente presentes en el resto del prompt ES (✅ U+2705, ⚠ U+26A0) si alguien los añadiera por copy/paste al bloque HOOK-01 — exactamente el caso que el assert pretende cubrir. Tres INFO menores sobre redundancia y JSDoc obsoleto.

## Findings

### WARNING: Regex de detección de emojis incompleto en assert D-02b

- **File:** `test/session-start.test.js:145`
- **Category:** test
- **Issue:** El assert que enforce D-02b ("bloque sin emojis") usa el rango `/[\u{1F300}-\u{1FAFF}]/u`. Ese rango cubre "Miscellaneous Symbols and Pictographs" + "Supplemental Symbols and Pictographs" + parte de Emoji, pero deja FUERA al menos los emojis que el propio prompt ES ya usa en la sección "Comentario final de resumen" (`buildSessionContext` líneas 52-55):
  - `✅` = U+2705 (Dingbats) — fuera del rango.
  - `⚠` = U+26A0 (Miscellaneous Symbols) — fuera del rango.
  - `🔍` = U+1F50D ∈ rango — sí lo detectaría.
  - `📁` = U+1F4C1 ∈ rango — sí lo detectaría.

  El comentario del test explica que se slicea desde el header HOOK-01 precisamente porque "el resto del prompt ES contiene emojis legítimos (✅/📁/⚠️/🔍)". Pero si un desarrollador futuro copia/pega ✅ o ⚠ AL bloque HOOK-01 (mismo patrón usado a 18 líneas de distancia en el mismo array `lines`), el regex no lo detecta y el test pasa silenciosamente — exactamente el fallo que D-02b quiere prevenir.

  Adicionalmente: el regex está escrito una sola vez (no en `gsd-context.test.js`), así que el bloque EN no tiene assert D-02b equivalente — el SUMMARY 20-02 lo justifica con "cubierto-by-source: el bloque EN no tiene emojis en src", lo cual es enforcement por inspección humana, no por test.

- **Recommendation:** Ampliar el rango a uno que cubra los emojis ya en uso por el propio prompt:
  ```javascript
  // Cubre Dingbats (U+2700-27BF), Misc Symbols (U+2600-26FF), VS-16 (U+FE0F)
  // y los pictogramas en U+1F300-1FAFF.
  const EMOJI_RE = /[\u{2600}-\u{27BF}\u{FE0F}\u{1F300}-\u{1FAFF}]/u;
  assert.ok(!EMOJI_RE.test(block), 'HOOK-01 block must not contain emojis (D-02b)');
  ```
  Y replicar el mismo assert en `test/gsd-context.test.js` contra el slice del bloque EN — el principio D-02b aplica a AMBOS bloques, no solo al ES. Como ahora el bloque EN se appendea via `lines.push(...)` post-if/else, un emoji ahí también pasaría desapercibido.

### INFO: JSDoc de `buildGsdContext` no menciona la sección HOOK-01

- **File:** `src/hooks/session-start.js:82-94`
- **Category:** maintainability
- **Issue:** El docblock dice "Replaces buildSessionContext entirely for GSD sessions (per D-03). Pure: no I/O, no globals — fully testable. Phase 9 extension (D-09, D-11): accepts opts.brief…". Tras Phase 20 el contrato semántico también incluye "always emits an '## No automatic push' final section". Para un lector que viene a este archivo desde fuera, el docblock omite una propiedad observable del output. Análogamente para `buildSessionContext` (L15-22) — no menciona "## Anti-push-fantasma".
- **Recommendation:** Añadir una línea en cada docblock:
  ```javascript
  // En buildSessionContext (L15-22):
  // Phase 20 (HOOK-01): the final section is always "## Anti-push-fantasma" (ES).
  // En buildGsdContext (L82-94):
  // Phase 20 (HOOK-01, D-04): the final section is always "## No automatic push"
  // (EN), common across all 3 GSD branches (quick / phase / bootstrap).
  ```
  No es necesario para correctness pero ayuda a quien lea el archivo aislado sin pasar por la phase docs.

### INFO: Test "D-04 common-block invariance" no cubre las 3 ramas con asserts independientes de header

- **File:** `test/gsd-context.test.js:160-170`
- **Category:** test
- **Issue:** El test usa `s.slice(s.lastIndexOf(HEADER))` y compara los tails de 3 ramas. Si por error futuro alguien moviera el `lines.push(...)` DENTRO de las 3 ramas (uno por rama) con bytes idénticos, este test seguiría pasando porque los 3 tails siguen siendo idénticos byte a byte — el invariante "common-block via single source post-if/else" (D-04) no quedaría blindado. El SUMMARY 20-02 afirma que "cualquier futura edición que rompa el invariante (ej. mover el lines.push dentro de una rama) hace fallar este test", pero eso solo es cierto si la edición introduce divergencia textual — duplicación bytes-idéntica pasaría el test.
- **Recommendation:** Añadir un source-hygiene test análogo a los Phase 9/13 existentes en `session-start.test.js:294-375`: grep el source (comments-stripped) y assertear que `'## No automatic push'` aparece EXACTAMENTE 1 vez. Esto garantiza la propiedad "single-source post-if/else" estructuralmente, no solo por observación de output. Patrón ya establecido en el repo:
  ```javascript
  it('D-04: "## No automatic push" appears exactly once in source (single-source post-if/else)', () => {
    const source = readFileSync(SOURCE_PATH, 'utf-8');
    const matches = source.match(/## No automatic push/g) || [];
    assert.equal(matches.length, 1, 'HOOK-01 EN block must be defined once, not duplicated per branch');
  });
  ```
  Análogo para `## Anti-push-fantasma` (== 1).

### INFO: Comentario "HOOK-02 satisfied-by-construction" duplicado en source

- **File:** `src/hooks/session-start.js:29-30, 166-168`
- **Category:** style
- **Issue:** Los dos sitios tienen comentarios trazables a Phase 20 (`Phase 20 HOOK-01 (no-GSD ES): ...preserva golden bytes anteriores (HOOK-02 satisfied-by-construction)` y `Phase 20 HOOK-01 (GSD EN): ...HOOK-02 satisfied-by-construction: append al FINAL preserva golden bytes`). 5 líneas de comentario en total para una decisión documentada exhaustivamente en CONTEXT.md/RESEARCH.md. Karpathy Regla 2 (simplicidad) sugiere que 1 línea referenciando la phase es suficiente; los detalles viven en la documentación.
- **Recommendation:** Considerar reducir a una línea ancla por sitio:
  ```javascript
  // Phase 20 HOOK-01: anti-push reminder, append-only (golden-bytes invariant).
  ```
  Decisión menor — los comentarios actuales son correctos y consistentes con el estilo del archivo. Solo INFO porque infringe ligeramente "cambios quirúrgicos / sin sobreingeniería de comentarios" pero no daña nada.

## Verification of Invariants

- **D-01 (split ES/EN):** ✓
  - `buildSessionContext` emite `## Anti-push-fantasma` (ES) — `src/hooks/session-start.js:70-78`.
  - `buildGsdContext` emite `## No automatic push` (EN) — `src/hooks/session-start.js:171-179`.
  - Cero crossover textual: el bloque ES no aparece en buildGsdContext y viceversa (verificado con grep).

- **D-02b (sin emojis, sin ANSI):** ✓ en source / parcial en tests
  - **Source:** los strings literal del bloque ES y EN no contienen emojis ni `\x1B`. Verificado por lectura directa.
  - **Tests:** solo el bloque ES tiene assert anti-emoji (`test/session-start.test.js:138-151`), y con regex incompleto (ver WARNING). El bloque EN no tiene assert equivalente.

- **D-04 (common-block):** ✓ estructural
  - Una sola `lines.push(...)` post-if/else en `src/hooks/session-start.js:169-180`. Las 3 ramas convergen.
  - Test runtime confirma tails bytes-idénticos (`test/gsd-context.test.js:160-170`).
  - Source-hygiene anti-duplicación no presente (ver INFO #3) — el invariante estructural está garantizado solo por observación, no por test estático.

- **D-05 (orchestrator excluido):** ✓
  - `git diff b4d1594^..a268f5b -- src/orchestrator/ .claude/skills/` → vacío. Confirmado.
  - `grep -rn "Anti-push\|automatic push" src/` retorna SOLO 3 hits, todos en `src/hooks/session-start.js`. Ningún hit en `src/orchestrator/` ni en `.claude/skills/kodo-orchestrate/`.

- **Test golden bytes Opción B (prefix invariant assertions):** ✓
  - `test/session-start.test.js:115-127` (no-GSD ES): `lastIndexOf(HEADER) > 0` + `tail.startsWith(HEADER)` + `prefix.endsWith('\n\n')`. Correcto.
  - `test/session-start.test.js:246-256` (quick EN): idem. Correcto.
  - `test/gsd-context.test.js:137-148` (phase EN): idem. Correcto.
  - `test/gsd-context.test.js:150-158` (bootstrap EN): idem. Correcto.
  - Runtime verifica que el prefix realmente termina en `\n\n` (verificado en sandbox: `"ga.\n\n"` y `"le.\n\n"`).

- **Karpathy rules:** ✓ con micro-observación
  - Regla 1 (piensa antes): asunciones declaradas en CONTEXT.md/RESEARCH.md (D-01..D-05).
  - Regla 2 (simplicidad): inline sin helper — correcta decisión (cada idioma 1 callsite). Comentarios en source ligeramente verbosos (ver INFO #4).
  - Regla 3 (cambios quirúrgicos): +28 LOC src, +153 LOC tests, 0 imports nuevos, 0 cambios al despacho. Estrictamente quirúrgico.
  - Regla 4 (objetivo): SCs mapeados 1:1 a tests; 581/582 pass.

## Recommendation

**run /gsd-code-review 20 --fix de 1 WARNING** (regex de emojis ampliado + replicar D-02b en bloque EN) **+ opcionalmente 3 INFO** (JSDoc, source-hygiene anti-duplicación, comentarios concisos).

Ninguno bloquea el merge — la implementación es correcta, los tests pasan (47/47 en los 2 archivos clave, 581 totales). El único bug-shaped issue es el regex de emojis incompleto, que es un *test gap* (no detecta lo que dice detectar), no un bug de runtime. Si se acepta como deuda aceptable, la phase puede cerrarse tal cual.

---

_Reviewed: 2026-05-12T18:30:00+02:00_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
