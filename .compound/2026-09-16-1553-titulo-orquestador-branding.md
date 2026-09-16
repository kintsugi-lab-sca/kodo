---
fecha: 2026-09-16
proyecto: kodo
slug: titulo-orquestador-branding
---

## Resumen
KODO-91: el «心動 kodo service» del orquestador era el branding del daemon con el guard ciego (`workspace_id: null`), no el OSC de Claude Code (un título custom de cmux no lo sigue).
`kodo check` rellena ahora el UUID y renombra la tab del orquestador vivo solo con evidencia de identidad; 5 tests nuevos con el shim de cmux y la suite completa en verde.

## Reto
Sigue sin explicarse por qué `launchOrchestrator` registra `workspace_id: null` al lanzar: si el daemon se reinicia desde un pane del orquestador antes del primer check motivado, el título no se repara.

## Propuesta de skill
Una skill `cmux-title-forensics` que, dado un workspace con título inesperado, cruce `workspace list --json` (has_custom_title), los títulos de las surfaces en `tree --all --json` y el `CMUX_SURFACE_ID` de los procesos kodo (`ps -Eww`) para separar OSC, branding y rename manual.
