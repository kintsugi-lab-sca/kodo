---
phase: 34
slug: fundacion-subcomando-ciclo-de-vida
status: verified
threats_open: 0
asvs_level: 1
created: 2026-05-27
---

# Phase 34 — Security

> Per-phase security contract: threat register, accepted risks, and audit trail.

Superficie de seguridad de Phase 34 casi nula: sin auth, sin secrets, sin red, cuerpo placeholder estático. El registro fue autorizado en plan-time (ambos PLAN.md con `<threat_model>` parseable). No hay amenazas de severidad alta — el riesgo real es de robustez (refuse non-TTY + restauración de terminal), ambas mitigadas y verificadas.

---

## Trust Boundaries

| Boundary | Description | Data Crossing |
|----------|-------------|---------------|
| operador (TTY) → proceso `kodo dashboard` | Entrada confiable local: teclas del TTY (`q`, Ctrl-C) y el flag `--url`. En Phase 34 `--url` solo se almacena como baseUrl en memoria; NO alcanza red (HTTP llega en Phase 35). | keystrokes (no sensible), `--url` string (no sensible, in-memory) |
| stdin/stdout no-TTY (pipe/CI) → proceso | Entrada del entorno: cuando el stream NO es TTY, ink lanzaría `Raw mode is not supported`. El guard pre-render lo convierte en exit 1 limpio. | flags de capacidad del stream (`isTTY`) |
| señales del SO (SIGTERM/SIGINT) → ciclo de vida | SIGTERM sin handler dejaría la terminal en raw-mode. Handler explícito → `app.unmount()` restaura. SIGINT lo cubre el `exitOnCtrlC` default de ink. | señal del proceso |

---

## Threat Register

| Threat ID | Category | Component | Disposition | Mitigation | Status |
|-----------|----------|-----------|-------------|------------|--------|
| T-34-01 | Denial of Service | arranque de `runDashboard` en non-TTY (pipe/CI) | mitigate | Guard pre-render `if (!stdout.isTTY \|\| !stdin.isTTY) { process.stderr.write(NON_TTY_MSG+'\n'); process.exit(1); }` en `src/cli/dashboard/index.js:42-44`, ANTES de `render()` (L57). Verificado por `test/dashboard-non-tty.test.js` (1 pass). | closed |
| T-34-02 | Tampering | inyección de cadena en el flag `--url` | accept | `--url` solo se almacena como baseUrl en memoria (`index.js:49`); cero `fetch`/`http`/`request` en el módulo. Sin superficie de red ni shell en Phase 34. Validación/sanitización de `--url` se hereda a Phase 35 (cliente HTTP). | closed |
| T-34-03 | Denial of Service | terminal en raw-mode tras salida sucia (q/Ctrl-C/SIGTERM) | mitigate | `q`→`useApp().exit()` (`App.js:44`, NO `process.exit`); SIGTERM→handler explícito `process.once('SIGTERM', () => app.unmount())` + `removeListener` tras `waitUntilExit()` + `process.exitCode=0` (`index.js:59-73`); Ctrl-C→`exitOnCtrlC` default de ink. `useInput` gateado por `isRawModeSupported` (`App.js:46`). ink restaura cursor/echo/scrollback en unmount. Verificado por frame-diff test (`dashboard-render.test.js`) + UAT humano aprobado (`34-HUMAN-UAT.md`). | closed |

*Status: open · closed*
*Disposition: mitigate (implementation required) · accept (documented risk) · transfer (third-party)*

---

## Accepted Risks Log

| Risk ID | Threat Ref | Rationale | Accepted By | Date |
|---------|------------|-----------|-------------|------|
| AR-34-01 | T-34-02 | En Phase 34 `--url` no alcanza red ni shell — solo se almacena como baseUrl en memoria; no hay superficie explotable. La validación/sanitización de `--url` y de contenido de red se hereda a Phase 35 (cliente HTTP). | Alex Núñez (operador) | 2026-05-27 |

*Accepted risks do not resurface in future audit runs.*

---

## Security Audit Trail

| Audit Date | Threats Total | Closed | Open | Run By |
|------------|---------------|--------|------|--------|
| 2026-05-27 | 3 | 3 | 0 | gsd-secure-phase (short-circuit: registro plan-time, mitigaciones confirmadas en código + verificación de fase) |

**Nota cruzada (no es threat):** el code review `34-REVIEW.md` reportó WR-01 — `loadConfig().server.port` sin guardia en `index.js:49` puede lanzar `TypeError` con un config v1 migrado sin la clave `server`. Es un fallo de robustez post-guard (no una amenaza del threat model: requiere estado de config específico, sin componente de seguridad). Recomendado corregir antes de Phase 35, cuando `server.port` alimenta baseUrl HTTP real. Trackeado en `34-REVIEW.md`, no abre threat en este registro.

---

## Sign-Off

- [x] All threats have a disposition (mitigate / accept / transfer)
- [x] Accepted risks documented in Accepted Risks Log
- [x] `threats_open: 0` confirmed
- [x] `status: verified` set in frontmatter

**Approval:** verified 2026-05-27
