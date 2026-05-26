# Phase 34: Fundación — subcomando + ciclo de vida - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-26
**Phase:** 34-fundacion-subcomando-ciclo-de-vida
**Areas discussed:** Esqueleto mínimo, Refuse non-TTY, Superficie CLI, Bindings de salida

---

## Esqueleto mínimo

| Option | Description | Selected |
|--------|-------------|----------|
| Banner + footer hint | Título `kodo dashboard` + placeholder `starting…` + footer `q quit`; chrome estético desde el commit 1 | ✓ |
| Solo título | Una única línea de título, nada más | |
| Marco vacío | `<Box>` raíz vacío sin texto | |

**User's choice:** Banner + footer hint
**Notes:** El operador ve un marco con título arriba, `starting…` en el centro y `q quit` abajo. Header de contadores + cuerpo con datos los rellena Phase 36.

---

## Refuse non-TTY

| Option | Description | Selected |
|--------|-------------|----------|
| stderr, exit 1, accionable | Mensaje con causa + qué hacer, exit 1, código único | ✓ |
| stderr, exit 1, escueto | Mensaje corto `kodo dashboard requires a TTY.` | |
| Códigos diferenciados | Exit 1 piped vs exit 2 raw-mode | |

**User's choice:** stderr, exit 1, accionable
**Notes:** Mensaje canónico exacto (asertado por test): `kodo dashboard requires an interactive terminal (TTY). Run it directly in your terminal, not in a pipe or CI.`

---

## Superficie CLI

| Option | Description | Selected |
|--------|-------------|----------|
| Config-driven + --url | Lee `loadConfig().server.port`, único override `--url <baseUrl>` | ✓ |
| Estrictamente config-driven | Cero flags | |
| --port + --host separados | Flags granulares independientes | |

**User's choice:** Config-driven + --url
**Notes:** Description `Live TUI dashboard of active kodo sessions`, sin alias. Registro vía commander + lazy import como el resto de subcomandos.

---

## Bindings de salida

| Option | Description | Selected |
|--------|-------------|----------|
| q + Ctrl-C + SIGTERM | `q`→exit, Ctrl-C default ink, SIGTERM handler propio; `Esc` no sale en root | ✓ |
| q + Esc + Ctrl-C + SIGTERM | Igual pero `Esc` también sale en root | |
| Solo q + Ctrl-C | Sin handler explícito de SIGTERM | |

**User's choice:** q + Ctrl-C + SIGTERM
**Notes:** `Esc` se reserva deliberadamente para "volver" en overlays de Phase 38; fijarlo ahora evita cambiar binding después. SIGTERM con handler propio para cleanup idéntico (no confiar en default de Node).

---

## Claude's Discretion

- Estructura fina de archivos dentro de `src/cli/dashboard/`.
- Ubicación precisa del chequeo de TTY (en `runDashboard` antes de `render()`).
- Markup exacto del banner/footer respetando el mockup aprobado.

## Deferred Ideas

- Exit codes diferenciados por causa de non-TTY — descartado (over-engineering v1).
- Flags `--port`/`--host` separados — descartados a favor de `--url`.
- Alias del subcomando (`dash`, `ui`) — no en v1.
- Header con contadores + indicador "live" + datos reales — Phase 36 (TUI-11).
