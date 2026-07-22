# Phase 74 — Deferred Items

Hallazgos fuera del alcance de los planes de la fase. **No se arreglan aquí** (scope boundary:
solo se auto-arregla lo causado directamente por el task en curso).

---

## D-1: `test/gsd-lock-race.test.js` — «concurrent dead-holder steal (CR-01)» es FLAKY

**Detectado:** 2026-07-15, durante el Plan 74-01 (verificación final `npm test`).
**Severidad:** baja (ruido de CI), pero **envenena la señal de regresión** de toda la fase 74 —
los planes 02..05 tocan concurrencia y locks, y un fallo intermitente ajeno hará dudar de ellos.

### Evidencia de que es preexistente y NO lo causó el Plan 74-01

- Los 6 commits del plan tocan **solo**: `src/session/handoff.js` (fichero nuevo),
  `test/session/handoff.test.js` (nuevo), `test/check-isolation.test.js` (un describe añadido) y
  3 ficheros de `.planning/`. `git diff --stat 900a7da~1..HEAD -- test/gsd-lock-race.test.js src/gsd/`
  sale **vacío**: el código bajo test es byte-idéntico al baseline.
- `src/session/handoff.js` es una hoja de cero imports y **solo lo importa su propio test**
  (`grep -rln "session/handoff.js" src/ test/`) — no puede alterar el timing de los locks de GSD.
- Reproducido **en aislamiento** en el mismo HEAD, sin el resto de la suite:
  `node --test test/gsd-lock-race.test.js` × 3 → `fail 0`, **`fail 1`**, `fail 0`.
- En la suite completa el conteo de fallos **varía entre runs** (0, luego 2, luego 1) sin cambiar
  un solo byte del repo → es sensible a timing/carga de la máquina, no determinista.

### Hipótesis (no verificada — no se investigó, está fuera de alcance)

El test es una carrera cross-process sobre el robo de un lock cuyo holder está muerto. Los defaults
de `state-lock.js` (`retries=8, backoffMs=20, ttlMs=10_000`) y el `sleepSync` con `Atomics.wait`
hacen que el veredicto dependa de que los hijos solapen su sección crítica dentro de una ventana de
milisegundos. Bajo carga (la suite lanza muchos procesos), esa ventana se pierde.

### Acción recomendada

Investigar aparte con `/gsd-debug` (no es un fix de una línea: hay que decidir si el test debe
sincronizarse con una barrera explícita en vez de con timing, como ya hace
`state-writers-concurrency.test.js` con su fichero `go`). **No tocar dentro de la Phase 74** — el
riesgo es "arreglar" el test enmascarando una carrera real del lock, que es justamente el invariante
de v0.16 Phase 70 que ese test protege.

### Nota para los planes 74-02..74-05

Si `npm test` reporta un fallo en `gsd lock steal race — concurrent dead-holder steal (CR-01)`,
**no es una regresión de la fase**: re-ejecutar la suite para confirmar que es este flake antes de
investigar. Cualquier otro fallo sí es señal real.
