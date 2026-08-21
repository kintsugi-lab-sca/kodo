---
fecha: 2026-07-17
proyecto: kodo
slug: phase75-next-dashboard-nudge
---

## Resumen
Pipeline completo discuss→plan→execute→verify de la Phase 75 (columna NEXT: en TUI, overlay markdown, nudge con contexto): 3 planes, suite 2253/0, UAT 3/3 verificado en TUI viva con seed mock vía writers de producción, threat-secure 10/10.
El «bug» reportado ({"error":"unauthorized"}) resultó ser el default-deny de v0.16 sobre el dashboard web sin ?token= — diagnosticado en 2 min con triage read-only antes de registrar gap.

## Reto
Verificar UAT humano de una TUI sin datos vivos: hubo que sembrar sesión+NEXT+plan mock con addSession/upsertTaskHandoff bajo lock, conducir la TUI real por cmux (send/send-key/read-screen), disparar runSessionEndHook con provider anulado por DI, y restaurar el estado byte-a-byte (incluida la entrada FIFO desalojada de history).

## Propuesta de skill
Skill «kodo-uat-seed»: siembra/limpia datos sintéticos de sesión+handoff con los writers de producción y conduce la TUI vía cmux para UAT reproducible — hoy es un guion ad-hoc de ~3 scripts .mjs que se reescribe cada vez.
