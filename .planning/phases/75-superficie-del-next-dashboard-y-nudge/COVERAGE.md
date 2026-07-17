---
phase: 75
external_surface: "contrato de datos/HTTP PROPIO de kodo (state.json, /status, canal de nudge cmux)"
decided_by: "CONTEXT.md D-01/D-02/D-09, invariantes cross-milestone, ROADMAP §Phase 75 SC1"
default_policy: "Full coverage by default — pero D-01 pre-decide el carril filesystem y la invariante «cero endpoints nuevos» invierte los verbos de red"
---

# Phase 75 — API Coverage Matrix

**Superficie en juego:** NO es una API de terceros. Es el **contrato de datos/HTTP propio de kodo** que
esta fase consume para surface el estado vivo que produjo la Phase 74: la clave `tasks` de
`~/.kodo/state.json`, el artefacto de plan ligero `~/.kodo/plans/<task_id>.md`, el endpoint `GET /status`
y el canal de nudge de cmux hacia el workspace del orquestador.

> El detector determinista devolvió `detected:true` con la señal `{verb: "consume", noun: "endpoint"}`
> desde el goal de la ROADMAP («…no aparece ningún endpoint nuevo en `src/server.js`…»). El gate de sello
> (`check api-coverage.verify-pre`) re-dispara sobre este scope, por eso esta matriz se escribe ahora.
> Cada OPT-OUT lleva su razón de una línea.

## Capability Matrix

| capability | decision | reason |
|---|---|---|
| Leer `state.json` clave `tasks` por filesystem directo (`readTasks`) | INTEGRATE | Carril elegido en D-01: la TUI ya lee el filesystem local (`plan.js`, `progress.js`); un reader leaf never-throws lee un solo fichero por tick de poll y colapsa fallo a `{}` (LIVE-05, SC1). |
| Leer el plan ligero `~/.kodo/plans/<task_id>.md` (`readLightPlan`) | INTEGRATE | Carril existente (Phase 46, D-07). LIVE-06 extiende su RENDER, no su lectura; sigue priorizando GSD (D-02). |
| Enviar el nudge por el canal existente `cmux send` al workspace `kodo-orchestrator` | INTEGRATE | Canal ya vivo (`session-end.js:243-254`); LIVE-07 solo añade +1 línea ES al texto por-modo (D-09). Cero canal nuevo. |
| Extender el payload de `GET /status` con `state.tasks` | OPT-OUT | D-01: se elige el carril filesystem; `/status` sirve `listSessions()` (`server.js:589`) y no debe tocarse. La limitación multi-nodo (dashboard remoto) queda como Deferred Idea de otro milestone. |
| Añadir un endpoint nuevo en `src/server.js` para servir el `NEXT:` | OPT-OUT | Invariante cross-milestone «cero endpoints nuevos desde v0.10» + ROADMAP §Phase 75 SC1 («no aparece ningún endpoint nuevo en `src/server.js`»). El `NEXT:` viaja en `state.json`, que la TUI ya lee. |
| Escribir/mutar `state.json` desde la capa de datos de la TUI | OPT-OUT | El reader es read-only puro; NUNCA `loadState()` (migra + escribe `.bak`, RESEARCH §Pitfall 1). El único escritor de `state.tasks` sigue siendo `upsertTaskHandoff` bajo `withStateLock`. |
| Relectura de `state.json` desde `buildStopNudgeText`/el nudge para obtener el `NEXT:` | OPT-OUT | D-08: la función sigue pura (cero I/O); el hook threadea el valor ya persistido en memoria tras el upsert. Cero I/O extra. |
| Nuevas dependencias npm (p. ej. `marked`/`ink-markdown` para el render) | OPT-OUT | Invariante «cero dependencias npm nuevas»: el mini-renderer (D-05) es in-house line-based. |

## Summary

- **INTEGRATE: 3** — las tres superficies de lectura/entrega ya existentes (state.json filesystem, plan ligero, canal de nudge cmux).
- **OPT-OUT: 5** — todas razonadas por D-01 (carril filesystem), la invariante «cero endpoints nuevos», la pureza del reader/nudge y «cero deps npm nuevas».
- **Sin huecos:** cada capacidad del contrato propio de kodo tiene disposición explícita. Ningún verbo de red/escritura se deja «por decidir».
