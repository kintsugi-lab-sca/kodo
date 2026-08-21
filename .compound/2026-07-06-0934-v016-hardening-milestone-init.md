---
fecha: 2026-07-06
proyecto: kodo
slug: v016-hardening-milestone-init
---

## Resumen
Milestone v0.16 «Hardening» inicializado vía /gsd-new-milestone desde la propuesta de remediación de la auditoría adversarial: PROJECT.md/STATE.md actualizados, 27 requirements (NET/CONC/DELIV/HYG) y roadmap de 4 fases (69–72, 1 fase por ola/causa raíz) con 27/27 cobertura.
Tres decisiones de producto quedaron selladas: bind default 127.0.0.1 + doc multi-nodo (el webhook SÍ llega de otro nodo), backstop mecánico de "In Review" aceptado (la instrucción al LLM pasa a optimización), y borrar `up --url` + health loop en vez de cablearlos.

## Reto
Convertir ~40 hallazgos de auditoría en requirements atómicos sin perder trazabilidad exigió mantener el mapeo hallazgo→REQ-ID (A1→NET-01, etc.) en cada línea de REQUIREMENTS.md; el riesgo residual es que los batches (HYG-05/06) agrupan hallazgos menores cuya verificación individual habrá que desplegar al planificar la Phase 72.

## Propuesta de skill
Una skill "audit-to-milestone" que tome un informe de auditoría con IDs de hallazgos y genere el borrador de REQUIREMENTS.md con REQ-IDs trazados y agrupación por causa raíz — hoy ese mapeo se hace a mano dentro de /gsd-new-milestone.
