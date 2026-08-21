---
fecha: 2026-07-03
proyecto: kodo
slug: phase68-setup-mode-webhook-gap
---

## Resumen
Planificada y ejecutada la fase 68 (dashboard setup mode / first-run, SETUP-01/02/05) end-to-end vía `/gsd-plan-phase --auto`: 3 planes, UAT humano aprobado, gsd-verifier PASSED 13/13, suite 1788/0 — cierra el milestone v0.15.
El research destapó que el daemon muere por el **webhook secret** (no la API key), contradiciendo la premisa LOCKED de D-08 ("el 2º `kodo up` arranca normal"); se resolvió con decisión de producto (D-12: webhook fuera del guiado + UAT con `KODO_DEV=1`).

## Reto
El modo `--auto` habría planificado la ruta feliz sobre una premisa falsa: verificar a mano el hallazgo crítico del research (server.js:464 lanza `KODO_SETUP_REQUIRED` por `KODO_WEBHOOK_SECRET_PLANE`, no por la API key) y pausar el pipeline para una decisión humana fue lo que evitó un plan roto. El GATE MANUAL (UAT máquina limpia) además NO era auto-aprobable pese a `--auto`.

## Propuesta de skill
`research-assumption-guard`: tras el gsd-phase-researcher, escanear el RESEARCH.md por Open Questions de prioridad ALTA que contradigan decisiones LOCKED del CONTEXT.md y forzar un checkpoint (verificar-en-código + preguntar) antes de dejar que el planner corra bajo `--auto`. Convierte el patrón manual de esta sesión en un gate reutilizable.
