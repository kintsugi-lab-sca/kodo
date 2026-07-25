---
phase: 83
slug: inbox-foundation-captura-triage
# status lifecycle: draft (seeded by plan-phase) → validated (set by validate-phase §6)
# audit-milestone §5.5 distinguishes NOT-VALIDATED (draft) from PARTIAL (validated + nyquist_compliant: false) (#2117)
status: draft
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-25
updated: 2026-07-25
---

# Phase 83 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (built-in, Node v22.22.3) + `node:assert/strict` |
| **Config file** | none — `package.json` scripts |
| **Quick run command** | `node --test test/inbox-store.test.js test/inbox-format-golden.test.js` |
| **Full suite command** | `npm test` |
| **Estimated runtime** | carril unit del inbox < 2 s · carril CLI (procesos reales) ~15 s · carril de concurrencia ~30 s (5 iteraciones de la carrera) · suite completa ~2 min (175+ ficheros) |

**Instalación de framework:** ninguna. `node:test` es built-in y `npm test` ya está cableado. Invariante cero deps npm.

---

## Sampling Rate

- **After every task commit:** `node --test test/inbox-store.test.js test/inbox-format-golden.test.js` (sub-segundo)
- **After every plan wave:** `npm test`
- **Before `/gsd-verify-work`:** suite completa en verde **incluyendo** `test/inbox-concurrency.test.js`, más tres ejecuciones seguidas de ese fichero (precedente Phase 82: una carrera que pasa una sola vez no prueba nada)
- **Max feedback latency:** 2 s (carril unit tras cada commit de tarea)

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 83-01-01 | 01 | 1 | CAPT-01, CAPT-06 | T-83-01 / T-83-04 | Un texto de usuario que imita la cola estructurada no falsifica tag/fecha/origen; un tag u origen que contiene el separador queda normalizado y la línea sigue parseando | unit + golden | `node --test test/inbox-format-golden.test.js` | ❌ W0 | ⬜ pending |
| 83-01-02 | 01 | 1 | CAPT-01, CAPT-03 | T-83-05 / T-83-06 | Los tests no escriben en el `~/.kodo` real (DI de paths, cero `HOME`); la regex no muestra backtracking catastrófico sobre una línea patológica | unit | `node --test test/inbox-store.test.js test/inbox-format-golden.test.js` | ❌ W0 | ⬜ pending |
| 83-01-03 | 01 | 1 | CAPT-03, CAPT-06 | T-83-02 / T-83-03 / T-83-07 / T-83-08 | El marcado publica con tmp de nombre único + rename (nunca un tmp de nombre fijo compartido), preserva byte a byte toda línea ajena, no deja residuo temporal y no hace fail-open | unit | `node --test test/inbox-store.test.js test/inbox-format-golden.test.js` | ❌ W0 | ⬜ pending |
| 83-02-01 | 02 | 2 | CAPT-01 | T-83-14 | Texto vacío tras saneo sale 2 sin escribir; texto sobre la cota se recorta antes de codificar | unit (DI) + integration CLI | `node --test test/inbox-cli.test.js` | ❌ W0 | ⬜ pending |
| 83-02-02 | 02 | 2 | CAPT-03, CAPT-06 | T-83-09 / T-83-10 / T-83-11 / T-83-13 | El render neutraliza secuencias de control provenientes del fichero human-editable; el `<id>` nunca compone un path; el `--dest` es opaco y no se resuelve | unit (DI) + integration CLI | `node --test test/inbox-cli.test.js` | ❌ W0 | ⬜ pending |
| 83-02-03 | 02 | 2 | CAPT-01, CAPT-03, CAPT-04 | T-83-12 / T-83-SC | Ningún módulo del inbox importa el módulo de procesos hijo de Node (seam sin acoplamiento); `dependencies` de `package.json` sigue en 4 claves | integration CLI + source-hygiene | `node --test test/inbox-cli.test.js` | ❌ W0 | ⬜ pending |
| 83-03-01 | 03 | 2 | CAPT-01 | T-83-15 | Los hijos importan el store **dinámicamente y después** de que el padre fije `HOME`: la suite nunca contamina el inbox real | integration (harness) | `npm test` | ❌ W0 | ⬜ pending |
| 83-03-02 | 03 | 2 | CAPT-01, CAPT-03 | T-83-16 / T-83-17 / T-83-19 | Una captura concurrente durante el RMW del marcado no se pierde; la aserción es sobre el agregado y no puede relajarse para greenear | integration multi-proceso | `node --test test/inbox-concurrency.test.js` | ❌ W0 | ⬜ pending |
| 83-03-03 | 03 | 2 | CAPT-04 | T-83-18 | La documentación afirma la delegación y no invita a automatizar el enrutado desde kodo | source-hygiene (doc grep) + regresión | `node --test test/inbox-cli.test.js test/inbox-store.test.js` | ❌ W0 | ⬜ pending |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

### Cobertura cruzada ya existente (no requiere Wave 0)

| Comportamiento | Requisito | Comando | Estado |
|----------------|-----------|---------|--------|
| Ningún módulo nuevo de `src/` importa el paquete de color directamente | Color isolation (Phase 14 D-07) | `node --test test/format-isolation.test.js` | ✅ existe (walker transitivo sobre `src/`) |

---

## Wave 0 Requirements

- [ ] `test/inbox-store.test.js` — unit del codec, parser (15 vectores + 2 forgeries), `listCaptures`, `appendCapture` y `markCapture`, todo con DI de paths y sin tocar `HOME` — cubre CAPT-01, CAPT-03, CAPT-06 (creado en 83-01)
- [ ] `test/inbox-format-golden.test.js` — golden byte-exacto de las cinco formas de línea con id y clock inyectados (D-22, contrato inter-fase con Phase 84) — cubre CAPT-01, CAPT-06 (creado en 83-01)
- [ ] `test/inbox-cli.test.js` — integración por `spawnSync` de `bin/kodo` con `HOME` sandbox: exit codes 0/1/2, `--json` byte-determinista, gate source-hygiene del seam y gate de cero deps — cubre CAPT-01, CAPT-03, CAPT-04 (creado en 83-02)
- [ ] `test/inbox-concurrency.test.js` — los dos escenarios de D-21 con procesos reales y barrier, con repetición del escenario mixto — cubre CAPT-01, CAPT-03 (creado en 83-03)
- [ ] `test/helpers/lock-race-child.mjs` — **ampliar** con dos kinds nuevos (captura y marcado) con import dinámico posterior a `HOME`, y actualizar la cabecera de consumidores (modificado en 83-03)
- [ ] Instalación de framework: **N/A** — `node:test` es built-in y `npm test` ya está cableado

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Legibilidad y utilidad real del listado coloreado en un terminal interactivo (anchos de columna, contraste, densidad) | CAPT-03 | El render con color depende del terminal del operador; la suite corre sin TTY y la verificación automatizada solo puede assertar la ausencia de ANSI en `--json` y la presencia de las columnas | `kodo capture "idea de prueba"` desde dos proyectos distintos, luego `kodo inbox` y `kodo inbox --all` en un terminal real; comprobar que el identificador corto se lee de un vistazo y es copiable |
| Round-trip completo del seam con el skill de enrutado real | CAPT-04 | El enrutado lo hace un skill de Claude Code sin contrato de retorno máquina-legible; kodo no participa por diseño (D-09) | `kodo inbox` → ejecutar el skill de enrutado sobre una captura → `kodo inbox route <id> --dest <ref>` → comprobar con `kodo inbox --all` que la línea conserva el trace pointer |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies — las 9 tareas tienen `<automated>`; las 5 referencias MISSING están declaradas en Wave 0
- [x] Sampling continuity: no 3 consecutive tasks without automated verify — ninguna tarea carece de comando automatizado
- [x] Wave 0 covers all MISSING references — 4 ficheros de test nuevos + 1 harness ampliado
- [x] No watch-mode flags — todos los comandos son `node --test` / `npm test` de una sola pasada
- [x] Feedback latency < 2 s en el carril unit tras cada commit de tarea
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** contrato de validación completo a nivel de plan. `wave_0_complete` pasa a `true` cuando los 5 artefactos de Wave 0 existan y estén en verde; `status` pasa a `validated` en `/gsd-validate-phase`.
