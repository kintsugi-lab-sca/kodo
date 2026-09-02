---
fecha: 2026-09-02
proyecto: kodo
slug: reviewer-adversarial-opt-in
---

## Resumen
Implementado KODO-75: rol reviewer adversarial opt-in (`kodo:review`) con escritura restringida a `review/` por pathspec en `add`+`commit` tras gate `KODO_REVIEWER=1`, derivación determinista del estado sin LLM, y bucle con tope de rondas que escala al operador.
Suite completa en verde (4110/4111, 1 skip preexistente), commit local `0e14c8a8` sin push.

## Reto
El ancla de la aprobación no podía ser `HEAD`, y el fallo era circular: el reviewer *commitea* su `approval.md`, así que ese commit mueve HEAD y el `commit:` recién escrito quedaría stale un segundo después — ninguna rama estaría jamás aprobada. La solución fue anclar al último commit que toca algo *fuera* de `review/` (`reviewedHead`, vía el magic pathspec `:(exclude)review`), que además resuelve gratis el orden entre approval y recomendaciones sin mirar mtimes. Ningún test con mocks lo habría detectado: hizo falta un test contra git real. De camino apareció un segundo problema real: ramificar sobre mensajes de error de git es frágil porque **git está traducido** (el «pathspec did not match» de CI es «ruta especificada … no concordó» en esta máquina); los tres sitios pasaron a comprobaciones estructurales.

## Propuesta de skill
Una skill `git-locale-safe` que audite el repo buscando ramificaciones sobre texto de errores de git (`/already checked out/`, `/did not match/`, `/not a working tree/`) y proponga el equivalente estructural — `--porcelain`, `existsSync`, o exit code — porque el bug es invisible en CI en inglés y solo aparece en la máquina del operador.
