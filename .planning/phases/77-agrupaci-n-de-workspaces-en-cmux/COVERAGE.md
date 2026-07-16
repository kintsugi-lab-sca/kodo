---
phase: 77
external_surface: "cmux workspace-group CLI (binario 0.64.19)"
decided_by: "CONTEXT.md D-13, GRP-04"
default_policy: "Full coverage by default — but GRP-04 pre-decide OPT-OUT de toda gestión de grupos"
---

# Phase 77 — API Coverage Matrix

**External surface:** el subcomando `cmux workspace-group` + los flags de grupo de `cmux new-workspace`.

kodo **consume** grupos que el operador crea a mano (GRP-04): kodo NO los crea, renombra, borra ni gestiona
membresía. Por eso la política por defecto («integrar toda la superficie») se invierte deliberadamente: solo
las dos capacidades read/attach se INTEGRAN; todo verbo de gestión es un OPT-OUT razonado, no un hueco.

> El detector determinista (`api-coverage.cjs`) devuelve `detected:false` para esta fase porque una CLI local
> no cae en su taxonomía de sustantivos (api/sdk/webhook/…) y «cero endpoints nuevos» es una negación. Esta
> matriz se produce por directiva explícita de la fase (el seal-time gate `check api-coverage.verify-pre` la valida).

## Capability Matrix

| # | Capability (cmux) | Row | Reason |
|---|-------------------|-----|--------|
| 1 | `workspace-group list [--json]` | **INTEGRATE** | Única fuente de la membresía y de la resolución nombre→ref; read-only. Consumida en fresco por lanzamiento (GRP-01/GRP-03). |
| 2 | `new-workspace --group <ref>` | **INTEGRATE** | El attach del workspace al grupo — el corazón de la fase (GRP-01). |
| 3 | `new-workspace --group-placement <top\|afterCurrent\|end>` | OPT-OUT | Discreción resuelta en RESEARCH: se usa el default (`top`) omitiendo el flag; `afterCurrent` exige `--group-reference` sin beneficio para kodo. |
| 4 | `new-workspace --group-reference <ws>` | OPT-OUT | Solo aplica con `--group-placement afterCurrent`; no se usa (ver fila 3). |
| 5 | `workspace-group create [--from]` | OPT-OUT | GRP-04: kodo no crea grupos (los crea el operador). Sin `--from` se traga el workspace caller (RESEARCH §State of the Art). |
| 6 | `workspace-group delete` | OPT-OUT | GRP-04: kodo no borra grupos. |
| 7 | `workspace-group rename` | OPT-OUT | GRP-04: kodo no renombra grupos (el renombrado de `SCP-CMRi`→`SCP` es acción de operador, no de kodo — Pitfall 1). |
| 8 | `workspace-group ungroup` | OPT-OUT | GRP-04: kodo no disuelve grupos. |
| 9 | `workspace-group add` | OPT-OUT | GRP-04-adyacente: mover un workspace preexistente a un grupo es gestión de membresía; las sesiones adoptadas quedan fuera (D-13). |
| 10 | `workspace-group remove` | OPT-OUT | GRP-04: kodo no quita miembros de grupos. |
| 11 | `workspace-group set-anchor` | OPT-OUT | GRP-04: kodo no gestiona anchors. |
| 12 | `workspace-group set-color` | OPT-OUT | Cosmético sobre cosmético (Deferred Ideas CONTEXT.md); candidata v0.18. |
| 13 | `workspace-group set-icon` | OPT-OUT | Cosmético sobre cosmético (Deferred Ideas). |
| 14 | `workspace-group collapse` / `expand` | OPT-OUT | Estado de UI del operador; kodo no lo controla. |
| 15 | `workspace-group pin` / `unpin` | OPT-OUT | Estado de UI del operador; kodo no lo controla. |
| 16 | `workspace-group move` | OPT-OUT | Reordenación de grupos; gestión, fuera de GRP-04. |
| 17 | `workspace-group focus` | OPT-OUT | Navegación/focus; fuera del launch de tareas. La política de focus de kodo es no robar foco (socket-policy). |

## Summary

- **INTEGRATE: 2** (fila 1 `list --json`, fila 2 `--group`).
- **OPT-OUT: 15** — todas razonadas por GRP-04 (kodo no gestiona grupos), discreción de placement, o cosmético diferido.
- **Sin huecos:** cada capacidad de la superficie tiene disposición explícita. Ningún verbo de gestión se deja «por decidir».
