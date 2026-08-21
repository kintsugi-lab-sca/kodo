---
fecha: 2026-08-20
proyecto: kodo
slug: orquestador-merges-cola-integracion
---

## Resumen
Ronda orquestadora 18–20 ago: mergeadas a main KODO-13/17/18/20/21/22/24 (KODO-18 con 4 conflictos resueltos como unión con KODO-21/22), causa raíz de worktrees obsoletos eliminada (`worktree.baseRef: fresh` → ref huérfana origin/main) y guard de branding sobre sesiones vivas.
Creadas KODO-26 (cola de integración con registro NDJSON auditable) y SCP-20 (revisión H1–H11 del esquema de 5 niveles); suite final 2871/0.

## Reto
Los nudges y decisiones de merge del orquestador son efímeros: sin la cola de KODO-26, «qué necesita cada rama» solo vive en la memoria del operador y en observaciones LLM no auditables.

## Propuesta de skill
Ninguna nueva: el flujo pedido ya está capturado como tarea de producto (KODO-26, `kodo integrate`); cuando exista, actualizar la skill kodo-orchestrate para consumir la cola en vez del repaso manual por sesión.
