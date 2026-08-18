---
fecha: 2026-08-09
proyecto: kodo
slug: sidebar-doctor-create-grupo
---

## Resumen
El sidebar doctor vuelve a crear los grupos que faltan (`workspace-group create --from`), tras acotar G-79-1 a lo que realmente rompía: el `set-anchor` sobre una sesión viva.
Commit `7c49095` en el worktree de KODO-14, suite 2590 pass / 0 fail y la tarea en "In review" pendiente de verificación en vivo.

## Reto
La guardrail vivía como prosa en un comentario ("no crear grupos") y esa formulación de más congeló la feature durante un milestone entero; el arreglo de fondo fue convertirla en guard mecánico — `set-anchor` entra en la familia LOCKED del source-hygiene y su passthrough desaparece de `client.js` — más que la rama de `create` en sí.

## Propuesta de skill
Una skill "guardrail-audit": dada la etiqueta de una guardrail (p. ej. G-79-1), localizar su enunciado en comentarios/docs/tests, contrastarlo con lo que el código impide de verdad y señalar dónde la política es más ancha que la evidencia que la motivó.
