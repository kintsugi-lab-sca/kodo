# Phase 11: Quick Mode Recognition & Persistence - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisiones se capturan en CONTEXT.md — este log preserva las alternativas consideradas.

**Date:** 2026-04-28
**Phase:** 11-quick-mode-recognition-persistence
**Areas discussed:** Skip-perms source-hygiene, Threading de gsd_mode, Telemetría 'no-match' tolerado, Contrato de lectura de gsd_mode ausente

---

## Skip-perms source-hygiene (QUICK-04)

### Q1 — ¿Cómo deriva `buildClaudeCommand` la decisión skip-perms para incluir `kodo:gsd-quick`?

| Option | Description | Selected |
|--------|-------------|----------|
| A — `getGsdMode()` como fuente única (Recomendada) | manager.js importa getGsdMode y deriva skipPerms = yolo \|\| getGsdMode(flags) !== null. Centraliza la regla en un solo helper, futuras variantes (kodo:gsd-foo) no requieren tocar manager. | ✓ |
| B — Threading de gsdMode desde dispatcher | Dispatcher pasa gsdMode vía opts.gsdMode. launchWorkItem y buildClaudeCommand reciben el modo explícito. Más cableado pero el seam queda explicito en la firma. | |
| C — Añadir literal 'gsd-quick' al OR | Mínimo cambio (un término más en el or). Mantiene la deuda actual y obliga a Phase 13 a testear literales en lugar del helper. | |

**User's choice:** A — getGsdMode() como fuente única
**Notes:** Coherente con la decisión D-03 (manager deriva localmente para gsd_mode). Single source of truth en `src/labels.js`.

### Q2 — Comentario en manager.js:259-261 tras el refactor

| Option | Description | Selected |
|--------|-------------|----------|
| Generalizar a 'cualquier modo GSD' (Recomendada) | "Las sesiones GSD (full y quick) corren slash commands autónomos; pedir confirmación por tool call rompe la automatización. Tanto kodo:gsd como kodo:gsd-quick implican skip-permissions." Documenta el invariante a nivel de modo. | ✓ |
| Citar getGsdMode como contrato | Documenta el seam en lugar del invariante. | |
| Listar literales explícitos | Más legible para quien busque por string, pero crece con cada modo nuevo. | |

**User's choice:** Generalizar a 'cualquier modo GSD'

---

## Threading de gsd_mode hasta SessionRecord (QUICK-03)

### Q1 — ¿Dónde se deriva `gsd_mode` antes de persistirse en SessionRecord?

| Option | Description | Selected |
|--------|-------------|----------|
| A — buildSessionFromTask deriva vía getGsdMode(flags) (Recomendada) | Coherente con la decisión de skip-perms. Una sola fuente: flags. Sin cambios de firma. getGsdMode corre 2 veces pero el coste es nulo. | ✓ |
| B — Threading explícito desde dispatcher | Dispatcher pasa opts.gsdMode → launchWorkItem → buildSessionFromTask. Firma más grande pero el owner del cálculo queda explícito. | |
| C — Híbrido (threading + fallback derivado) | Defensa en profundidad. Añade ramas de bifurcación y test surface. | |

**User's choice:** A — buildSessionFromTask deriva localmente
**Notes:** Cero acoplamiento extra entre dispatcher y manager. La duplicación de cómputo es despreciable.

### Q2 — Cuando `flags=['gsd']` (modo full explícito), ¿qué persiste `buildSessionFromTask`?

| Option | Description | Selected |
|--------|-------------|----------|
| Persistir gsd_mode='full' siempre que gsd:true (Recomendada) | Sesiones nuevas tienen gsd_mode siempre presente cuando gsd:true. Hooks Phase 12 leen directamente sin defaults. Sesiones legacy son las únicas con gsd:true sin gsd_mode. | ✓ |
| Persistir gsd_mode sólo cuando es 'quick' | Field aditivo en sentido estricto. Hooks tendrían que defaultear (gsd_mode \|\| 'full'). Mantiene state.json más pequeño pero añade contrato de lectura. | |
| Persistir sólo gsd_mode (deprecar gsd:true) | Una sola fuente: gsd_mode ∈ {null,'full','quick'}. Out of scope per REQUIREMENTS (no migration). | |

**User's choice:** Persistir gsd_mode siempre que gsd:true

---

## Telemetría del 'no-match' tolerado en quick

### Q1 — `quick + match` (resolver encuentra fase pero la descartamos del SessionRecord)

| Option | Description | Selected |
|--------|-------------|----------|
| Añadir campo mode='quick' y mantener phase_id (Recomendada) | gsd.phase.resolved {mode:'quick', phase_id, match_heading}. Forense útil. mode también se añade en full ('mode:full') para schema homogéneo. | ✓ |
| Añadir mode pero omitir phase_id en quick | Consistente con SessionRecord. Pierdes la señal forense de "qué vio el resolver". | |
| No tocar el evento (mantener WIP actual) | Sin campo mode. Incoherencia state↔log se mantiene. | |

**User's choice:** Añadir mode + mantener phase_id

### Q2 — `quick + no-match` (caso tolerado)

| Option | Description | Selected |
|--------|-------------|----------|
| Emitir gsd.phase.resolved {matched:false, code:'no-match', tolerated:true, mode:'quick'} (Recomendada) | Mantiene D-14 (dispatcher = única fuente). Forense: 'no hubo match pero quick lo tolera'. Nivel info (no warn). | ✓ |
| Emitir info log no tipado | Más ligero pero rompe la taxonomía cerrada. | |
| Mantener silencio (WIP actual) | break sin evento. kodo logs no podrá reconstruir por qué arrancó sin phase_id. | |

**User's choice:** Emitir gsd.phase.resolved tipado con tolerated:true

### Q3 — ¿gsd.bootstrap también lleva campo `mode`?

| Option | Description | Selected |
|--------|-------------|----------|
| Sí, mode={'full'\|'quick'} (Recomendada) | Schema homogéneo: todos los eventos GSD del dispatcher llevan mode. Permite kodo logs --event-type gsd.bootstrap separar bootstraps quick. | ✓ |
| No, gsd.bootstrap no lleva mode | Bootstrap es idéntico en ambos modos. Si el código es idéntico, el evento también. | |

**User's choice:** Sí, mode en gsd.bootstrap

---

## Contrato de lectura de gsd_mode ausente

### Q1 — Sesión legacy con `gsd:true` sin `gsd_mode`: ¿cómo se interpreta?

| Option | Description | Selected |
|--------|-------------|----------|
| Default 'full' implícito — legacy == full (Recomendada) | Coincide con el comportamiento histórico (kodo:gsd siempre fue full antes de v0.4). Cero ruido. Documentar como invariante D-XX. | ✓ |
| Default 'full' + log.warn por legacy | Mismo default pero con warning. Añade ruido en hooks. | |
| Considerar ambiguo — abortar/no-op | Forzaría limpiar state.json. Disruptivo, viola 'no migration'. | |

**User's choice:** Default 'full' implícito

### Q2 — ¿Centralizamos la lectura en helper `getSessionMode(session)`?

| Option | Description | Selected |
|--------|-------------|----------|
| Sí, exportar getSessionMode (Recomendada) | function getSessionMode(session) { if (!session?.gsd) return null; return session.gsd_mode \|\| 'full'; }. Una sola fuente para 'legacy == full'. | ✓ |
| No, cada consumer hace inline `session.gsd_mode \|\| 'full'` | Más ligero pero Phase 12 tendrá que repetir el default en 3 sitios y QUICK-08 testear cada uno. | |
| Sí pero en src/session/state.js (no en labels.js) | Coloca el helper junto al type Session. Más correcto semánticamente pero añade un import más en el dispatcher. | |

**User's choice:** Sí, exportar getSessionMode desde labels.js

---

## Claude's Discretion

- Granularidad de plans (cuántos plan files, qué dependencies entre ellos): a decidir en `/gsd-plan-phase 11`.
- Naming exacto de campos en JSDoc del Session typedef: a decidir en planning.
- Idioma de comentarios y mensajes nuevos en código: inglés (consistente con dispatcher.js y manager.js existentes).

## Deferred Ideas

- Lectura efectiva de `getSessionMode` en hooks → Phase 12.
- Reescritura del párrafo `## Sesiones GSD` en `prompt.md` → Phase 12.
- Tests cross-cutting de los 4 estados → Phase 13.
- Migración de sesiones legacy → out of scope per REQUIREMENTS.
