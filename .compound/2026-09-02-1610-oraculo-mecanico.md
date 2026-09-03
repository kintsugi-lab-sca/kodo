---
fecha: 2026-09-02
proyecto: kodo
slug: oraculo-mecanico
---

## Resumen
KODO-69: el oráculo mecánico convierte la señal autodeclarada de una sesión («la suite está verde») en evidencia que kodo ejecuta y persiste en la cola de integración, con cuatro estados por check y veredicto anclado al commit.
Tres módulos nuevos, gate opt-in `--require-oracle` y diff-scope con alcance declarado en el plan; suite verde (4311 tests) y smoke E2E con git y `sh` reales.

## Reto
El dogfooding encontró en minutos un fallo que ningún test unitario habría buscado: `parseScopeBlock` tomaba el último marcador de APERTURA, así que el propio handoff —que MENCIONABA `<!-- kodo:scope v=1 -->` en prosa— anulaba en silencio la declaración de alcance de arriba. Escribir la primera declaración real con el formato recién inventado fue lo que lo destapó; el arreglo (último bloque COMPLETO) es trivial, encontrarlo sin usar la feature no lo era.

## Propuesta de skill
Una skill `dogfood-format` que, cuando una tarea introduce un formato de marcador que kodo parsea de contenido de un LLM (`kodo:handoff`, `kodo:scope`), obligue a escribir una instancia REAL en el artefacto real y a reparsearla antes de dar la tarea por hecha — el paso que aquí destapó el bug. No existe candidata en `find-skills`: `ce-proof` valida afirmaciones, no formatos de parsing sobre su propio artefacto.
