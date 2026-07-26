---
phase: 84
slug: superficies-de-captura-skill-sync-conteo-ambient
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-07-26
---

# Phase 84 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Fuente: `84-RESEARCH.md` §Validation Architecture (mediciones ejecutadas en sesión).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` + `node:assert/strict` (built-in, Node ≥ 20) |
| **Config file** | none — defaults de Node, convención del repo |
| **Quick run command** | `node --test test/skill-sync.test.js test/kodo-capture-skill.test.js test/dashboard-inbox-count.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~22 s la suite completa (baseline medido: 2 556 tests · 2 555 pass · 1 skip · 0 fail · 21,6 s); < 3 s el carril rápido |

---

## Sampling Rate

- **After every task commit:** el fichero de test de la superficie tocada (< 3 s)
- **After every plan wave:** los tres ficheros de la fase + `test/format-isolation.test.js` + `test/inbox-format-golden.test.js`
- **Before `/gsd-verify-work`:** `npm test` completo verde — **regresión cero es el listón** (baseline 0 fail)
- **Max feedback latency:** 3 s (carril rápido) · 22 s (suite completa)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| TBD | 01 | 0 | CAPT-05 | — | `makeFixture()` siembra ambas skills antes de tocar el handler | integración | `node --test test/skill-sync.test.js` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | CAPT-05 | — | El registro distribuye ambas skills | integración | `node --test test/skill-sync.test.js` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | CAPT-05 | — | Resiliencia D-03: una skill rota no impide la otra | unit (DI `syncFn`) | `node --test test/skill-sync.test.js` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | CAPT-05 | — | Exit agregado 0/1; gate 2 y su **stderr byte-idéntico** intactos (D-02) | integración | `node --test test/skill-sync.test.js` | ✅ existe | ⬜ pending |
| TBD | 01 | 1 | CAPT-05 | — | `--json` aditivo con orden de claves fijo (D-04) | integración | `node --test test/skill-sync.test.js` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | CAPT-05 | — | Render human: una línea por skill (D-05) | integración | `node --test test/skill-sync.test.js` | ❌ W0 | ⬜ pending |
| TBD | 01 | 1 | CAPT-05 | — | Gate tolerante a `SKILL.md` / `skill.md` (D-07) | unit | `node --test test/skill-sync.test.js` | ❌ W0 | ⬜ pending |
| TBD | 02 | 1 | CAPT-02 | — | **Exactamente una** invocación en el `SKILL.md` (corolario D-14) | unit estático | `node --test test/kodo-capture-skill.test.js` | ❌ W0 | ⬜ pending |
| TBD | 02 | 1 | CAPT-02 | — | `deepEqual(argvExtraído, ARGV_CANONICO)` (D-11) | unit estático | `node --test test/kodo-capture-skill.test.js` | ❌ W0 | ⬜ pending |
| TBD | 02 | 1 | CAPT-02 | — | Byte-identidad vs golden de Phase 83, reloj e ID inyectados (D-14) | unit in-process | `node --test test/kodo-capture-skill.test.js` | ❌ W0 | ⬜ pending |
| TBD | 02 | 1 | CAPT-02 | — | El argv sobrevive al commander real con texto de guion inicial (`--` load-bearing) | integración `spawnSync` | `node --test test/kodo-capture-skill.test.js` | ❌ W0 | ⬜ pending |
| TBD | 02 | 1 | CAPT-02 | — | El `SKILL.md` no contiene ninguna escritura a `inbox.md` (D-10) | source-hygiene sobre el `.md` | `node --test test/kodo-capture-skill.test.js` | ❌ W0 | ⬜ pending |
| TBD | 03 | 0 | CAPT-07 | — | **Anti-drift leaf ↔ `listCaptures`** sobre fixture adversarial (D-18) | unit | `node --test test/dashboard-inbox-count.test.js` | ❌ **W0** | ⬜ pending |
| TBD | 03 | 0 | CAPT-07 | — | Anti-drift sobre el fixture de 1 500 capturas (D-18) | unit | `node --test test/dashboard-inbox-count.test.js` | ❌ **W0** | ⬜ pending |
| TBD | 03 | 1 | CAPT-07 | — | Never-throws: ausente / EACCES / directorio / binario → 0 (D-20) | unit | `node --test test/dashboard-inbox-count.test.js` | ❌ W0 | ⬜ pending |
| TBD | 03 | 1 | CAPT-07 | — | Resolución perezosa del HOME (D-19) | unit (`kodoDir` inyectado) | `node --test test/dashboard-inbox-count.test.js` | ❌ W0 | ⬜ pending |
| TBD | 03 | 1 | CAPT-07 | — | El header pinta el conteo si > 0 y lo **omite** en 0 (D-22, D-23) | render ink | `node --test test/dashboard-inbox-count.test.js` | ❌ W0 | ⬜ pending |
| TBD | 03 | 1 | CAPT-07 | — | El leaf no importa picocolors ni el store | source-hygiene | `node --test test/format-isolation.test.js` | ✅ automático | ⬜ pending |
| TBD | — | 1 | — | — | Cero deps npm nuevas | source-hygiene | `node --test test/inbox-cli.test.js` | ✅ existe | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*
*Los Task ID se rellenan al escribir los PLAN.md — el mapa fija el comportamiento y su comando, no la numeración.*

---

## Wave 0 Requirements

- [ ] **`test/dashboard-inbox-count.test.js` — el test anti-drift de D-18.** ⚠ **Va PRIMERO, antes del leaf.** Es el test que dicta cuál regex es admisible (`RESEARCH.md` §Pitfall 6): escribir el leaf antes es escribir la regex equivocada. Fixture adversarial con hand-edits que no parsean + el fixture de 1 500 capturas de `83-05`.
- [ ] `test/skill-sync.test.js` — actualizar `makeFixture()` para sembrar **ambas** skills (§Pitfall 1: 6 asserts existentes se ponen rojos al generalizar el bucle; el inventario nominal con línea está en el research). Va antes de tocar `src/cli/skill-sync.js`.
- [ ] `test/kodo-capture-skill.test.js` — fichero nuevo del golden de D-14. Se escribe **junto** al `SKILL.md`, no después: es el que define el marcador del bloque cercado del que extrae el argv.
- [ ] Instalación de framework: **ninguna** — `node:test` es built-in (invariante de cero deps).
- [ ] Fixtures compartidos: **ninguno** — el repo no usa helpers cross-test; cada fichero siembra los suyos (convención verificada en `test/skill-sync.test.js:39`, `test/inbox-cli.test.js:66`).
- [ ] **Disciplina obligatoria de HOME en todo test nuevo:** ningún test puede tocar el `~/.kodo/` real. El research documenta el incidente (una sonda sin sandbox escribió en el inbox real del operador y hubo que retirarla a mano) — todo test que ejercite captura o conteo inyecta su `HOME`/`kodoDir` **antes de invocar**, nunca en el cuerpo del módulo.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Claude Code carga de verdad `/kodo-capture` tras `kodo skill sync` y la invocación produce la línea esperada | CAPT-02 | Requiere una sesión LLM real: un `SKILL.md` es un prompt, y ningún test automatizado puede probar que el modelo lo invoca. Los tests cubren el contrato (argv + byte-identidad), no la carga | 1. `kodo skill sync` · 2. abrir sesión Claude Code en un repo cualquiera · 3. `/kodo-capture "prueba UAT 84"` · 4. `kodo inbox` muestra la línea con `origen: skill` y el tag del proyecto correcto |
| El conteo ambient aparece en la cabecera del TUI y desaparece al vaciar el inbox | CAPT-07 | El render ink se testea, pero la lectura ambient real (¿se ve?, ¿estorba?) es juicio del operador | 1. `kodo capture "x"` ×3 · 2. `kodo dashboard` → el conteo aparece junto al indicador de conexión · 3. `kodo inbox discard <id>` ×3 · 4. el conteo desaparece (no muestra `0`) |
| `skill.md` en minúsculas bajo un filesystem case-sensitive (Linux) | CAPT-05 | No verificable en macOS (filesystem case-insensitive) — la tolerancia de D-07 es defensiva por construcción | Si algún día se ejecuta en Linux: `kodo skill sync` debe sincronizar `kodo-orchestrate` sin fallar el gate |

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references
- [ ] No watch-mode flags
- [ ] Feedback latency < 22s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
