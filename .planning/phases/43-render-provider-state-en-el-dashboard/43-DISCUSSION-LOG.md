# Phase 43: Render — provider_state en el dashboard - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-06-06
**Phase:** 43-render-provider-state-en-el-dashboard
**Areas discussed:** Forma de render, Estados ok/unsupported/fetch-failed, Semántica del filtro, Vocabulario mostrado

---

## Forma de render (PSTATE-05)

| Option | Description | Selected |
|--------|-------------|----------|
| Columna nueva dedicada | Columna propia entre status y age; separa los ejes inequívocamente; ensancha ~10-12 chars | ✓ |
| Badge en celda existente | Sufijo/badge en celda actual; compacto pero riesgo de fusión de ejes | |
| Lo decides tú | Planner elige según ancho real | |

**User's choice:** Columna nueva dedicada
**Notes:** Lectura más honesta del criterio 1 (no fusionar eje local vs provider).

### Sub-decisión: posición + cabecera

| Option | Description | Selected |
|--------|-------------|----------|
| Junto a status → 'task' | Adyacente a status, antes de age; contraste didáctico; cabecera corta | ✓ |
| Al final → 'provider' | Tras age, al borde derecho; cabecera explícita del origen | |
| Junto a status → 'provider' | Adyacente + cabecera explícita | |

**User's choice:** Junto a status → 'task'

---

## Estados ok/unsupported/fetch-failed (criterio 2)

| Option | Description | Selected |
|--------|-------------|----------|
| valor / dim '—' / dim '?' | ok=string crudo · unsupported=dim '—' · fetch-failed=dim '?' | ✓ |
| valor / vacío / dim '?' | unsupported=celda vacía | |
| Lo decides tú | Planner elige glyphs/dim | |

**User's choice:** valor / dim '—' / dim '?'
**Notes:** Glyphs distintos = distinguible sin color (NO_COLOR-safe); dim separa "sin dato" de valor real.

### Sub-decisión: color del valor ok

| Option | Description | Selected |
|--------|-------------|----------|
| Texto plano (sin color) | Solo dim marca los degradados; UI mínima; cero colisión con statusColor | ✓ |
| Acento sutil en accionables | in_review/blocked con color propio para que "salten" | |
| Lo decides tú | Planner decide | |

**User's choice:** Texto plano (sin color)

---

## Semántica del filtro (PSTATE-06)

| Option | Description | Selected |
|--------|-------------|----------|
| Prefijo dedicado 'ps:' | ps:review acota provider_state; s: sigue siendo solo local; ejes separados | ✓ |
| Extender 's:' (OR) | s:review matchea local OR provider; menos teclas pero mezcla ejes | |
| Lo decides tú | Planner elige | |

**User's choice:** Prefijo dedicado 'ps:'

### Sub-decisión: alcance de 'ps:'

| Option | Description | Selected |
|--------|-------------|----------|
| Solo el valor crudo | ps: matchea únicamente provider_state; filas null no casan; literal al criterio 3 | ✓ |
| Valor + reason | ps:failed encuentra fetch-failed, etc.; más útil para triaje | |
| Lo decides tú | Planner decide | |

**User's choice:** Solo el valor crudo
**Notes:** Match por String.includes substring (criterio 3) — distinto del s: exacto actual. Filtrar por reason queda deferred.

---

## Vocabulario mostrado (criterio 4)

| Option | Description | Selected |
|--------|-------------|----------|
| Verbatim + truncate | String tal cual + truncate-end de ink; cero acoplamiento al vocabulario | ✓ |
| Normalizar guiones | in_review → "in review"; legibilidad pero añade regla de formato | |
| Lo decides tú | Planner elige sin tabla hardcoded | |

**User's choice:** Verbatim + truncate
**Notes:** Cumple criterio 4 por construcción — un renombrado del provider se muestra solo, sin tocar código.

---

## Claude's Discretion

- Ancho exacto de la columna `task` (~12 sugerido, con truncate-end de red de seguridad).
- Glyph exacto de unsupported/fetch-failed (fijado `—`/`?` dim; ajustable si hay algo más legible bajo NO_COLOR).
- Si actualizar `countsLabel` del header con un contador de provider_state (probablemente NO en v1).
- Wiring exacto del parser `ps:` en parseFilter/applyFilter (espejo de r:/s:).

## Deferred Ideas

- Filtrar por reason-states degradados (`ps:failed`/`ps:unsupported`) — descartado (D-09), promover si hace falta.
- Contador de provider_state en el header — reconsiderar si piden resumen agregado.
- Acento de color en accionables (in_review/blocked) — reconsiderar si texto plano resulta insuficiente.
- Normalización/humanización del vocabulario — descartado (D-08 verbatim).
