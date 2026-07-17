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

| capability | decision | reason |
|---|---|---|
| `workspace-group list [--json]` | INTEGRATE | Única fuente de la membresía y de la resolución nombre→ref; read-only. Consumida en fresco por lanzamiento (GRP-01/GRP-03). |
| `new-workspace --group <ref>` | INTEGRATE | El attach del workspace al grupo — el corazón de la fase (GRP-01). |
| `new-workspace --group-placement <top / afterCurrent / end>` | OPT-OUT | Discreción resuelta en RESEARCH: se usa el default (`top`) omitiendo el flag; `afterCurrent` exige `--group-reference` sin beneficio para kodo. |
| `new-workspace --group-reference <ws>` | OPT-OUT | Solo aplica con `--group-placement afterCurrent`; no se usa (ver fila anterior). |
| `workspace-group create [--from]` | OPT-OUT | GRP-04: kodo no crea grupos (los crea el operador). Sin `--from` se traga el workspace caller (RESEARCH §State of the Art). |
| `workspace-group delete` | OPT-OUT | GRP-04: kodo no borra grupos. |
| `workspace-group rename` | OPT-OUT | GRP-04: kodo no renombra grupos (el renombrado de `SCP-CMRi`→`SCP` es acción de operador, no de kodo — Pitfall 1). |
| `workspace-group ungroup` | OPT-OUT | GRP-04: kodo no disuelve grupos. |
| `workspace-group add` | OPT-OUT | GRP-04-adyacente: mover un workspace preexistente a un grupo es gestión de membresía; las sesiones adoptadas quedan fuera (D-13). |
| `workspace-group remove` | OPT-OUT | GRP-04: kodo no quita miembros de grupos. |
| `workspace-group set-anchor` | OPT-OUT | GRP-04: kodo no gestiona anchors. |
| `workspace-group set-color` | OPT-OUT | Cosmético sobre cosmético (Deferred Ideas CONTEXT.md); candidata v0.18. |
| `workspace-group set-icon` | OPT-OUT | Cosmético sobre cosmético (Deferred Ideas). |
| `workspace-group collapse` / `expand` | OPT-OUT | Estado de UI del operador; kodo no lo controla. |
| `workspace-group pin` / `unpin` | OPT-OUT | Estado de UI del operador; kodo no lo controla. |
| `workspace-group move` | OPT-OUT | Reordenación de grupos; gestión, fuera de GRP-04. |
| `workspace-group focus` | OPT-OUT | Navegación/focus; fuera del launch de tareas. La política de focus de kodo es no robar foco (socket-policy). |

## Summary

- **INTEGRATE: 2** (fila 1 `list --json`, fila 2 `--group`).
- **OPT-OUT: 15** — todas razonadas por GRP-04 (kodo no gestiona grupos), discreción de placement, o cosmético diferido.
- **Sin huecos:** cada capacidad de la superficie tiene disposición explícita. Ningún verbo de gestión se deja «por decidir».
