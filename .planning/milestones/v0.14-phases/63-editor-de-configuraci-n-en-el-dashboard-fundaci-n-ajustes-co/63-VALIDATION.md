---
phase: 63
slug: editor-de-configuraci-n-en-el-dashboard-fundaci-n-ajustes-co
status: draft
nyquist_compliant: false
wave_0_complete: false
created: 2026-06-29
---

# Phase 63 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Derivada de `63-RESEARCH.md` §Validation Architecture.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (builtin, Node 22.x) + `ink-testing-library@4.0.0` |
| **Config file** | none — `npm test` = `node --test $(find test -name '*.test.js' -type f)` |
| **Quick run command** | `node --test test/config-validate.test.js` (o el fichero tocado) |
| **Full suite command** | `npm test` |
| **Estimated runtime** | ~15–30 segundos (suite completa) |

---

## Sampling Rate

- **After every task commit:** Run `node --test test/<fichero-tocado>.test.js`
- **After every plan wave:** Run `npm test`
- **Before `/gsd-verify-work`:** Full suite must be green
- **Max feedback latency:** ~30 segundos

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 63-XX-XX | TBD | 0 | CFG-05 | — | Valor inválido (int no-positivo, modelo fuera de set, color desconocido, string vacío) rechazado, never-throws | unit | `node --test test/config-validate.test.js` | ❌ W0 | ⬜ pending |
| 63-XX-XX | TBD | 0 | PERSIST-05 | — | Fallo de escritura → `config.json` previo intacto (atomic temp+rename) | unit | `node --test test/config-atomic.test.js` | ❌ W0 | ⬜ pending |
| 63-XX-XX | TBD | 0 | PERSIST-01 | — | `saveConfig` preserva formato `JSON.stringify(...,2)+'\n'` y migración de schema | unit | `node --test test/config-atomic.test.js` | ❌ W0 | ⬜ pending |
| 63-XX-XX | TBD | 1 | UX-01, UX-02 | — | `e` abre overlay; text-input con cursor / backspace / ←→ | integration | `node --test test/dashboard-config.test.js` | ❌ W0 | ⬜ pending |
| 63-XX-XX | TBD | 1 | UX-03 | — | `Esc` cierra preservando `selectedTaskId` (selección de sesión) | integration | `node --test test/dashboard-config.test.js` | ❌ W0 | ⬜ pending |
| 63-XX-XX | TBD | 1 | CFG-05 (UI) | — | Valor inválido → footer rojo, NO escribe, sigue en edición | integration | `node --test test/dashboard-config.test.js` | ❌ W0 | ⬜ pending |
| 63-XX-XX | TBD | 1 | PERSIST-03 | — | Tras guardar → footer de aviso de reinicio | integration | `node --test test/dashboard-config.test.js` | ❌ W0 | ⬜ pending |
| 63-XX-XX | TBD | 1 | UX-04 | — | Escritura fallida → footer rojo, panel ink montado, no crash | integration | `node --test test/dashboard-config.test.js` | ❌ W0 | ⬜ pending |

*Task IDs se concretan en PLAN.md. Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky*

---

## Wave 0 Requirements

- [ ] `test/config-validate.test.js` — cubre CFG-05: tabla válido/inválido por campo, incl. límites (0, negativos, no-numérico, color desconocido, modelo fuera de set, string vacío/espacios).
- [ ] `test/config-atomic.test.js` — cubre PERSIST-01/05: formato byte-exacto preservado; simular fallo de write → original intacto; `.tmp` en el mismo dir. **El helper atómico DEBE recibir el `path` como parámetro (DI puro)** para evitar el pitfall de aislamiento (ver nota).
- [ ] `test/dashboard-config.test.js` — cubre UX-01..04 / CFG-05-UI / PERSIST-03 (molde: `test/dashboard-overlay.test.js` — render + `stdin.write` + `lastFrame`).
- [ ] Framework ya presente: `node:test` + `ink-testing-library` — sin instalación.

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| Aviso de reinicio efectivo (que reiniciar server/daemon aplique el cambio) | PERSIST-03 | El reinicio real del daemon está fuera del árbol ink; el test integration solo asierta el footer | UAT: editar un valor, guardar, reiniciar `kodo server`, confirmar que el valor nuevo se aplica |
| Render visual del cursor (`<Text inverse>`) bajo terminal real | UX-02 | `ink-testing-library` asierta contenido, no el rendering ANSI del inverse | UAT: abrir el editor en terminal real, confirmar cursor visible y edición a mitad de string |

---

## Nota de aislamiento de tests (memoria del proyecto, verificada)

`src/config.js` resuelve `KODO_DIR`/`CONFIG_PATH` **al import** (líneas 6-8) vía `homedir()`. Tests que redirigen `process.env.HOME` DESPUÉS del import NO ven el cambio (path ya cacheado). Para `config-atomic.test.js`: hacer que el helper atómico **reciba el `path` como argumento** (DI puro, preferido) → testeable sin tocar `HOME`. Alternativa: `import()` dinámico tras setear `HOME`.

---

## Validation Sign-Off

- [ ] All tasks have `<automated>` verify or Wave 0 dependencies
- [ ] Sampling continuity: no 3 consecutive tasks without automated verify
- [ ] Wave 0 covers all MISSING references (config-validate, config-atomic, dashboard-config)
- [ ] No watch-mode flags
- [ ] Feedback latency < 30s
- [ ] `nyquist_compliant: true` set in frontmatter

**Approval:** pending
