---
fecha: 2026-07-28
proyecto: kodo
slug: phase85-cierre-uat-security
---

## Resumen
Cierre de la Phase 85: UAT 1/1 (el mantenedor eligió aceptar el alcance narrow de WR-01 y registrarlo), auditoría de seguridad 26/26 amenazas cerradas con `threats_open: 0`, y transición a fase completa — milestone v0.19 al 100 % (4/4 fases, 17/17 planes).
La auditoría destapó dos flags que nadie había mapeado a un threat ID (UF-01: el guard LOG-12 declara más cobertura de la que tiene; UF-02: la pureza de `format.js` no está congelada), ambos registrados con trigger antes de cerrar.

## Reto
`phase.complete` devolvió `is_last_phase: false` y avanzó `current_phase` a **999.1**, una entrada de *backlog* marcada «PROMOVIDO → v0.13, SHIPPED». El detector no distingue placeholders `999.x` de fases reales, así que dejó el STATE apuntando a una fase inexistente justo al cerrar el milestone. Se detectó porque el nombre («kodo bidireccional») no encajaba con nada pendiente; corregido a mano vía `frontmatter.set` + `state.update`, ya que `state.update` no alcanza campos del frontmatter (mismo límite que 85-05 documentó para §Deferred Items).

## Propuesta de skill
Una skill `gsd-roadmap-lint` que valide el ROADMAP antes de las transiciones: detectar entradas `999.x` y cualquier fase marcada PROMOVIDO/SHIPPED para excluirlas del cálculo de `next_phase`/`is_last_phase`, y avisar cuando el `current_phase` resultante apunte a algo que no es una fase ejecutable.
