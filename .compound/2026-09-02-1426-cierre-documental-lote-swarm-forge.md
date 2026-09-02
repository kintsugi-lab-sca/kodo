---
fecha: 2026-09-02
proyecto: kodo
slug: cierre-documental-lote-swarm-forge
---

## Resumen
KODO-79: cerrado el lote swarm-forge (KODO-71..75) en el README — documentada la sección que faltaba (KODO-72, aviso de presión de la cola de integración), enunciada la regla de asserts de KODO-71 y corregidas dos afirmaciones que el código integrado no sostiene.
Commit local `dc0acbd8` sin push; suite en 4201 pass / 0 fail / 1 skip preexistente y las 8 anclas internas del README resuelven.

## Reto
El supuesto de partida de la tarea era falso: KODO-71, 73 y 75 ya habían documentado lo suyo dentro de sus propios PRs, así que el trabajo no era escribir cuatro secciones sino auditar tres y escribir una. Y el hallazgo sólo aparece leyendo el código: la tabla de `kodo review` titulaba una columna «Queue confidence» y prometía «confidence up» / «do not integrate», pero `reviewConfidence()` sólo se imprime en `kodo review <REF>` — `src/integration/queue.js` no lo importa siquiera. Documentación escrita desde el plan (donde ese cableado estaba previsto) en vez de desde el código integrado. El mismo patrón, más leve, en `kodo inbox-orch`: enumeraba dos kinds de cinco porque nadie volvió a tocar la frase al añadir productores nuevos.

## Propuesta de skill
Una skill `docs-vs-code-drift`: dada una sección de README, extrae sus afirmaciones verificables (nombres de comando, claves de config, literales de log, enums y kinds enumerados) y grepea cada una contra `src/`, marcando en rojo las que no tengan respaldo y en ámbar las enumeraciones incompletas frente al `Object.freeze(new Set([...]))` correspondiente. Habría encontrado los dos desfases de esta sesión sin leer 65 KB de README.
