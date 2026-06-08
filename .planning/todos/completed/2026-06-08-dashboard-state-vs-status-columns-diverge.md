---
created: 2026-06-08T10:00:28.904Z
title: Columnas state vs status del dashboard divergen (status legacy stale)
area: ui
severity: major
milestone: v0.10
source: dogfooding tras 43-HUMAN-UAT (relacionado WARNING-02 / D-09)
files:
  - src/cli/dashboard/format.js:218-227 (rowCells)
  - src/cli/dashboard/format.js:101-121 (statusColor / statusLabel)
  - src/cli/dashboard/format.js:132-149 (STATE_BADGES / stateBadge)
  - src/cli/dashboard/SessionTable.js:48 (COLS — state:16, status:18)
  - src/server.js (displayStatus legacy — WARNING-02/D-09)
---

## Problem

El dashboard ink muestra DOS columnas de "estado" contiguas que se contradicen:

- **`state`** (`session.state`, vía `stateBadge`) — el lifecycle CANÓNICO v3 escrito por
  `reconcileTick` (v0.9 Phase 38/39.1). Valores: running · idle · needs-input · dead.
- **`status`** (`session.status`, vía `statusLabel`) — el campo LEGACY v2 auto-reportado,
  que NO se reconcilia → se queda obsoleto. Valores: running · review · error · done · idle.

Divergencias observadas en dogfooding:
- ROMAN-170: `state=idle` (canónico, contado en "4 idle" del header) vs `status=running`
  (stale — quedó en running y nadie lo bajó). Se pinta verde "running" engañoso.
- KL-ok-1: `state=needs-input` (canónico, "1 needs-input") vs `status=idle` (stale).

El contador del header usa `state` (canónico), así que la columna `status` está
literalmente contradiciendo al resto de la UI. Es deuda pre-existente de v0.9
(WARNING-02 / D-09: "el server recomputa idle con heurística divergente del estado v3"),
hecha más visible por Phase 43 al colocar tres columnas de estado juntas. NO la introdujo
Phase 43.

No son 100% redundantes en teoría (`status` puede llevar review/error/done que `state` no
tiene), pero en la práctica `status` está stale para los casos vivos y por eso miente.

## Solution

Decidir el destino de la columna `status` (3 opciones):
- **(A) Quitarla** — `state` v3 es la verdad; lo legacy sobra. La más simple y honesta si
  no se usan review/error/done en la práctica. (Cambio quirúrgico: dropear la celda
  `status` de rowCells/COLS/SessionTable + ajustar tests de tabla.)
- **(B) Reconciliar** `session.status` para que no se quede obsoleto (más trabajo;
  toca el writer en el server/reconcileTick).
- **(C) Redefinir** `status` para mostrar SOLO lo complementario (review/error/done) y
  quedar en blanco si no aporta, evitando el choque idle/running.

Recomendación de partida: (A), confirmando antes que review/error/done no se usan como
señal en el flujo real. Mantener byte-determinismo `--json` y la paleta LOCKED (D-08).

## RESOLVED 2026-06-08 (commit 91df2b8) — opción C (Outcome)

status redefinido como OUTCOME auto-reportado del agente: solo error/done/review;
en blanco para lifecycle (running/idle/needs-input/dead), que son del eje `state`.
`statusLabel` -> `outcomeCell` (format.js). Elimina la contradicción state/status.
Consecuencia aceptada: la marca textual `(zombie)` sale de la celda status (el
zombie sigue en el contador del header; un proceso muerto real se ve como `state=dead`
vía reconcile). Suite 1204 pass.
