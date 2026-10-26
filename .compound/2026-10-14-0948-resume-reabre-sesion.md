---
fecha: 2026-10-14
proyecto: kodo
slug: resume-reabre-sesion
---

## Resumen
KODO-100: un `claude --resume` de una sesión ya cerrada vuelve a `state.sessions` desde SessionStart (match por session_id exacto) y deja el evento `session-resumed` en la bandeja.
Suite verde (4687), auditado y Plane en In review. El PR queda sin abrir por falta de permiso para publicar.

## Reto
La reapertura tenía que sobrevivir al reconcile, cuyo pgrep por `session-id` no casa `--resume`. Se resolvió con la forma del rescate (`process_dead_since: null`). La auditoría detectó además que no hay que resellar `base_commit` al reabrir.

## Propuesta de skill
`kodo-pr`: empujar la rama al remoto correcto (`kintsugi`, no `origin`) y abrir el PR en `kintsugi-lab-sca/kodo` con el cuerpo sacado del comentario final de Plane.
