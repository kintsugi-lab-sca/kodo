---
fecha: 2026-06-25
proyecto: kodo
slug: phase62-derive-title-refocus
---

## Resumen
Se refocalizó la lógica de derivación de títulos en `enrich.js` desde "qué es el proyecto" hacia "qué estoy haciendo en esta sesión", priorizando session intent sobre project scope para GSD projects. Se completaron tests UAT validando el flujo derive-then-confirm y se confirmó que la suite ejecuta limpia.

## Reto
El sistema de derivación debe distinguir entre proyectos GSD (session-centric) y proyectos regulares (history-centric), manteniendo coherencia en cómo se extraen y priorizan los prompts iniciales del usuario cuando el LLM genera metadatos de adopción.

## Propuesta de skill
Automatizar la generación de test fixtures para GSD adoption flows (session intent + project background + derive pipeline) — actualmente se construyen manualmente; una herramienta que scaffold fixtures desde plain-text user prompts y git history aceleraría UAT de nuevas fases.
