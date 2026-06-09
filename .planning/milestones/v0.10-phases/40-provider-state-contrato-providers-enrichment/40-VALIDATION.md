---
phase: 40
slug: provider-state-contrato-providers-enrichment
status: approved
nyquist_compliant: true
wave_0_complete: true
created: 2026-06-04
---

# Phase 40 — Validation Strategy

> Per-phase validation contract for feedback sampling during execution.
> Reconstructed retroactively from PLAN/SUMMARY/VERIFICATION artifacts (State B).

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | `node:test` (native) + `node:assert/strict` |
| **Config file** | none — native runner, no external config |
| **Quick run command** | `node --test test/server/provider-state.test.js` |
| **Full suite command** | `npm test` (`node --test $(find test -name '*.test.js' -type f)`) |
| **Estimated runtime** | ~0.14s (phase tests) · full suite ~seconds |

---

## Sampling Rate

- **After every task commit:** Run the task's `<automated>` command (per-file `node --test`)
- **After every plan wave:** Run `npm test`
- **Before `/gsd:verify-work`:** Full suite must be green
- **Max feedback latency:** < 1 second (phase tests); full suite a few seconds

---

## Per-Task Verification Map

| Task ID | Plan | Wave | Requirement | Threat Ref | Secure Behavior | Test Type | Automated Command | File Exists | Status |
|---------|------|------|-------------|------------|-----------------|-----------|-------------------|-------------|--------|
| 40-01-01 | 01 | 1 | PSTATE-01 | T-40-01 / T-40-02 | Plane `getTaskState` mapea via `String.includes` (anti-ReDoS), nunca regex sobre input del provider; devuelve solo el vocabulario de 5 literales | unit | `node --test test/plane-provider.test.js` | ✅ | ✅ green |
| 40-01-02 | 01 | 1 | PSTATE-02 | T-40-01 / T-40-02 | GitHub `getTaskState` deriva estado por convención de labels con `String.includes`, una sola llamada de issue (sin API extra) | unit | `node --test test/providers/github/provider.test.js` | ✅ | ✅ green |
| 40-01-03 | 01 | 1 | PSTATE-03 | T-40-02 | Contract matrix con assert capability-gated (`typeof !== 'function' → return`) dentro del loop PROVIDERS; determinismo 8×2=16 intacto; `TASK_PROVIDER_METHODS` frozen en 9 | unit | `node --test test/providers/contract.test.js` | ✅ | ✅ green |
| 40-02-01 | 02 | 2 | PSTATE-04 | T-40-04 | `provider.state.fetch.failed` registrado con helper de whitelist explícita (sin `...fields`), `logger.error`, cero imports nuevos (LOG-12) | unit | `node --test test/logger-events.test.js` | ✅ | ✅ green |
| 40-02-02 | 02 | 2 | PSTATE-04 | T-40-05 / T-40-06 / T-40-07 | Resolver DI: capability gate (unsupported), cache task_id ≤N en TTL, in-flight dedup, fail-open (`fetch-failed` + evento observable), estructuralmente incapaz de escribir state.json | unit | `node --test test/server/provider-state.test.js` | ✅ | ✅ green |
| 40-02-03 | 02 | 2 | PSTATE-04 | T-40-07 | Cableado en `GET /status`: `Promise.allSettled` spread-additive, 200 siempre, resolver construido una sola vez | smoke + manual | `node -e "import('./src/server.js')..."` + grep gates | ✅ (módulo) | ⚠️ manual-only |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky / manual-only*

---

## Wave 0 Requirements

Existing infrastructure (`node:test` nativo) covers all phase requirements. No framework install, no shared fixture file, and no test stubs were needed — los tests viven junto a cada módulo con mocks/spies inyectados (DI).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Test Instructions |
|----------|-------------|------------|-------------------|
| El cableado HTTP de `GET /status` enriquece cada fila con `provider_state`/`provider_state_reason` vía `Promise.allSettled` (spread-additive) y responde 200 aunque todas las filas sean `fetch-failed`/`unsupported`. | PSTATE-04 | El handler `/status` no tiene harness de test de integración: arrancarlo requiere red + provider real. Decisión arquitectónica deliberada del plan (40-02 objective): extraer la lógica de riesgo (cache/dedup/fail-open) a `src/server/provider-state.js` — **completamente cubierta por tests unitarios** — y dejar `server.js` como wiring fino verificado por carga de módulo + grep gates. | 1) Arrancar `kodo serve` con un provider configurado. 2) `curl localhost:<port>/status` con ≥1 sesión activa → cada fila lleva `provider_state` ∈ {in_progress,in_review,blocked,done,unknown,null} y `provider_state_reason` ∈ {null,unsupported,fetch-failed}. 3) Forzar un fallo de `getTaskState` (provider down) → la respuesta sigue siendo 200, la fila trae `provider_state_reason:'fetch-failed'` y aparece un evento `provider.state.fetch.failed` en el NDJSON. |

---

## Validation Sign-Off

- [x] All tasks have `<automated>` verify or Wave 0 dependencies (40-02-03 wiring = manual-only por diseño)
- [x] Sampling continuity: no 3 consecutive tasks without automated verify
- [x] Wave 0 covers all MISSING references (ninguna — infraestructura nativa suficiente)
- [x] No watch-mode flags
- [x] Feedback latency < 1s
- [x] `nyquist_compliant: true` set in frontmatter

**Approval:** approved 2026-06-04

---

## Reconstruction Audit 2026-06-04

| Metric | Count |
|--------|-------|
| Requirements audited | 4 (PSTATE-01..04) |
| COVERED (automated unit) | 4 |
| PARTIAL | 0 |
| MISSING | 0 |
| Manual-only (by design) | 1 (GET /status HTTP wiring) |
| Phase tests run | 99 pass / 0 fail |

**Nota Nyquist:** La lógica de riesgo de la fase (mapeo anti-ReDoS, cache/dedup/fail-open, evento observable, invariante read-only) está cubierta por tests unitarios deterministas con mocks/spies y `now` inyectable. El único hueco residual (cableado HTTP de `/status`) se acepta como verificación manual por la decisión arquitectónica documentada en 40-02 — no es un gap de la lógica núcleo. Fase declarada **nyquist-compliant**.
