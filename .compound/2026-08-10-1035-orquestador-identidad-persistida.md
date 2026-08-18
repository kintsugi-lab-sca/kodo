---
fecha: 2026-08-10
proyecto: kodo
slug: orquestador-identidad-persistida
---

## Resumen
KODO-16: la identidad del orquestador era el título mutable de una tab de cmux, y arrancar el daemon desde esa tab la renombraba, así que `kodo check` lanzaba un duplicado sobre la misma cola.
Ahora se persiste en `state.json` (`.orchestrator`, con el UUID del workspace) y se revalida contra `cmux tree --all --json`, que es cross-window; commit `c03c927`, 2634 tests pass.

## Reto
Distinguir «el orquestador murió» de «no puedo comprobarlo». La revalidación solo relanza con evidencia positiva de muerte: si cmux no contesta, no lanza — al revés que el fail-open habitual del repo, porque un duplicado corrompe la cola y perder un pase no. Efecto secundario descubierto por accidente: `npm test` renombraba el workspace real desde el que se ejecuta, porque los tests que arrancan un server heredan `CMUX_WORKSPACE_ID`.

## Propuesta de skill
Un `cmux-identity` que resuelva y verifique workspaces por UUID vía `tree --all --json` en vez de por `workspace list` (window-scoped) y por título (mutable) — el mismo error está latente en `manager.js:526`, que también matchea `kodo-orchestrator` por texto.
