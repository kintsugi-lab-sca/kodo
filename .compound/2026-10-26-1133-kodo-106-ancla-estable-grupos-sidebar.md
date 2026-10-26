---
fecha: 2026-10-26
proyecto: kodo
slug: kodo-106-ancla-estable-grupos-sidebar
---

## Resumen
Los grupos de proyecto del sidebar se crean ahora con `create --name <PROJ> --cwd <repo>` (sin `--from`) + `add` de las sesiones, con guard post-creación y categoría `session_anchor` que reancla en `--fix`.
Verificado contra cmux 0.65.2 real (launch y doctor) y con fakes 0.64.20/0.65.2/adopt-cwd; suite 4736/0, PR #22 abierto sin mergear.

## Reto
La premisa de KODO-14 («`create --from` nunca reutiliza el ancla») estaba fijada en código, tests y guard de hygiene, y cmux la rompió sin aviso en un minor. El reanclaje con `new-workspace` acumulaba workspaces si `set-anchor` fallaba en bucle; se cerró reutilizando un miembro no-sesión.

## Propuesta de skill
`cmux-contract-probe`: tras cada actualización de cmux, prueba con grupos desechables las premisas de las que depende kodo (`create --from/--cwd`, `set-anchor`, cierre del ancla) y avisa si alguna cambió.
