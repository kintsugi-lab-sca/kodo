---
phase: 72
slug: higiene-dx-y-verdad-documental
status: secured
# threats_open = count of OPEN threats at or above workflow.security_block_on severity (the blocking gate)
threats_open: 0
asvs_level: 1
created: 2026-07-14
---

# Phase 72 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| Config en disco → runtime | `~/.kodo/config.json` (editable por el operador y por `--set`) se parsea y merge-a en `loadConfig` | Claves de config, potencial prototype pollution |
| Contenido externo → terminal del operador | Comentarios/títulos de Plane llegan al render Ink del dashboard | Texto no confiable con posibles secuencias ESC/OSC |
| Sesión Claude → repo git del operador | El stop hook del orquestador auto-commitea learnings | Working tree / index del operador |
| `.env` con secretos → filesystem | `writeFileAtomic` / migración escriben ficheros con `*_secret` | PLANE_WEBHOOK_SECRET, KODO_API_TOKEN |

---

## Threat Register

| Threat ID | Category | Component | Severity | Disposition | Mitigation | Status |
|-----------|----------|-----------|----------|-------------|------------|--------|
| T-72-01 | Tampering/Repudiation | `handleOrchestratorStop` auto-commit | high | mitigate | Gate `KODO_ORCHESTRATOR=1` cubre add+commit + pathspec `-- .claude/skills/kodo-orchestrate/` en ambos pasos (`stop.js:253,283`; verificado por verifier + UAT 2026-07-14) | closed |
| T-72-02 | Tampering | env var como marcador de rol | low | accept | No es secreto; sin var → skip (fail-safe). Propagación confirmada empíricamente en UAT (72-UAT.md test 1: passed) | closed |
| T-72-03 | DoS | efectos cmux en SessionEnd | low | mitigate | Cada efecto en try/catch individual; test de secuencia `['backstop','setColor','notify']` verde | closed |
| T-72-04 | Tampering | `setNestedValue` (M3) | high | mitigate | Rechazo `__proto__`/`constructor`/`prototype` en `config-args.js` Y en `deepMerge` (fix WR-01, `config.js:210`); repro de pollution en test | closed |
| T-72-05 | Info Disclosure | `writeFileAtomic` con secreto (M5) | high | mitigate | chmod 0600 pre-rename con `*_secret`; extendido al `.bak` de migración (fix WR-04) | closed |
| T-72-06 | DoS | `loadConfig` con config parcial (B7) | medium | mitigate | deep-merge + warn-and-fallback vía `config-validate.js`; gate de setup evalúa config CRUDO (`loadRawConfig`, fix CR-01) | closed |
| T-72-07 | Tampering | parsing `--set`/`.env` (M14/B5) | low | mitigate | `indexOf+slice` preserva `=`/`:` internos; strip conservador de comillas emparejadas; tests en config-hardening | closed |
| T-72-08 | Tampering | `isNameConflict409` (B12c) | low | mitigate | Predicado estrechado a `already exists`; test de 409 no relacionado re-lanza LOUD | closed |
| T-72-09 | DoS | throttle epoch-vs-delta (B12b) | low | mitigate | Plan de mitigación era «detectar formato **o diferir con nota** (D-02)» — diferido con nota en 72-03-SUMMARY §Deferred Items (formato del header de Plane self-hosted no confirmable). Riesgo residual low, bajo el umbral de bloqueo | closed |
| T-72-10 | Tampering | match substring en install (B9) | low | mitigate | Match por ruta canónica `/src/hooks/<name>.js`; test de hook ajeno con "kodo" en la ruta | closed |
| T-72-11 | DoS | factory github sin config (B12d) | low | mitigate | Guard + mensaje canónico en `registry.js`; test verde | closed |
| T-72-12 | Tampering | proyección de comentarios (M4/HYG-07) | high | mitigate | `stripControlChars` (CSI + C0/C1 + `\x7f`, sin `\r`; fix WR-02) en los 3 callsites de la proyección incl. `task_ref`/`summary` (fix WR-03) — neutraliza OSC-52 | closed |
| T-72-13 | Info Disclosure | fallback `JSON.stringify` de shapes raras | low | mitigate | El fallback pasa por el mismo strip; test cubre la rama | closed |
| T-72-14 | Repudiation (documental) | README claims de cierre | low | mitigate | Pasada DELTA verificada claim-a-claim + checkpoint humano aprobado (72-05) | closed |
| T-72-SC | Tampering | npm/pip/cargo installs | low | accept | La fase no instala paquetes (cero deps npm nuevas — verificado: package.json intacto) | closed |

*Status: open · closed · open — below high threshold (non-blocking)*
*Severity: critical > high > medium > low — only open threats at or above workflow.security_block_on count toward threats_open*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-72-01 | T-72-02 | La env var `KODO_ORCHESTRATOR` no es un secreto: marca rol, no autoriza nada por sí sola; el modo de fallo es skip (cero commits). Confirmada en UAT | operador (UAT pass) | 2026-07-14 |
| AR-72-02 | T-72-SC | Invariante cross-milestone: la fase no añade dependencias npm — sin superficie de cadena de suministro | plan 72 (threat model) | 2026-07-13 |
| AR-72-03 | T-72-09 | B12b diferido con nota (D-02): heurístico epoch-vs-delta sin confirmar el contrato del servidor introduciría esperas basura reales por un problema teórico. Severidad low, bajo el umbral de bloqueo | operador (D-02 CONTEXT) | 2026-07-13 |

---

## Security Audit 2026-07-14

| Metric | Count |
|--------|-------|
| Threats found | 15 (14 únicos + T-72-SC compartido entre planes) |
| Closed | 15 |
| Open | 0 |

Registro autorado en plan-time (`register_authored_at_plan_time: true`, los 5 planes llevan `<threat_model>` ASVS L1). Clasificación con evidencia a HEAD post code-review-fix: verifier independiente (72-VERIFICATION.md, 5/5 must-haves), fixes CR-01/WR-01..05/WR-07 re-verificados con repros, y UAT humano (72-UAT.md, 1/1 passed). Short-circuit L1 aplicado (threats_open: 0): sin auditor profundo — L1 grep-depth suficiente por regla del workflow.
