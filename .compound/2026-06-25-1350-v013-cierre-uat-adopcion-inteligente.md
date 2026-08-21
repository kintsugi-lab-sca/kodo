---
fecha: 2026-06-25
proyecto: kodo
slug: v013-cierre-uat-adopcion-inteligente
---

## Resumen
Ejecutada la Fase 62 (ORCH-02, adopción inteligente desde el dashboard) por waves en worktrees aislados, y cerrado el milestone v0.13 "kodo bidireccional" (11 fases, tag pusheado).
La UAT humana en vivo destapó 2 bugs invisibles a los tests verdes (título a nivel proyecto y timeout intermitente), ambos reproducidos con coordenadas reales y corregidos con red de test.

## Reto
El derivador LLM "funcionaba" con suite 100% verde, pero en uso real fallaba de dos formas que ningún test cubría: el prompt pedía "PROJECT SCOPE" (título genérico) y `claude -p` malgastaba 3s esperando stdin que, sumados a la latencia API, rozaban el timeout de 25s → fail-open intermitente. Diagnosticar requirió extraer cwd+sessionId del surface real (`state.json` + `listAgentSurfaces`) y capturar el envelope crudo del subproceso — no era deducible desde el código ni los tests.

## Propuesta de skill
`diagnose-llm-subprocess`: dado un derivador/subproceso LLM disparado por el sistema, extrae las coordenadas reales del estado (cwd/sessionId/surface), reproduce la invocación con `execFile` real, captura el envelope crudo (is_error/timeout/stderr/duration) y mide la latencia contra el timeout configurado — convierte un "a veces falla en vivo" en un diagnóstico determinista sin tocar el flujo de producción. (No encontrada en find-skills; complementa a `verify`.)
