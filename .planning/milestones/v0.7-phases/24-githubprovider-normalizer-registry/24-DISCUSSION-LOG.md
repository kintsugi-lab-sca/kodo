# Phase 24: GitHubProvider + Normalizer + Registry - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-05-14
**Phase:** 24-githubprovider-normalizer-registry
**Areas discussed:** Contrato (bloqueante), Normalizer Issue→TaskItem, updateTaskState mapping, resolveRef + listProjects, init() + listPendingTasks

---

## Contrato del Provider (bloqueante)

| Option | Description | Selected |
|--------|-------------|----------|
| Seguir contrato real | GitHubProvider implementa los 9 métodos REALES de `interface.js`/`PlaneProvider`. Actualizar ROADMAP/REQUIREMENTS Phase 24 SC#1 para reflejarlo. Riesgo mínimo, pasa el gate del registry. | ✓ |
| Refactor del contrato | Cambiar `interface.js` + `PlaneProvider` para adoptar la firma ROADMAP. Fase extra de refactor, alto riesgo de regresión en Plane que ya está en prod. | |
| Contrato híbrido | Mantener interface.js como está pero exponer los métodos extra como helpers no validados. Implementables sin tocar PlaneProvider. | |

**User's choice:** Seguir contrato real
**Notes:** ROADMAP/REQUIREMENTS describen un contrato fantasma que jamás existió. La validación de `registry.js:73-77` solo deja pasar lo que está en `TASK_PROVIDER_METHODS`. Acción: actualizar `.planning/ROADMAP.md` y `.planning/REQUIREMENTS.md` antes de planificar.

---

## Normalizer Issue→TaskItem

### Sub-area: priority default

| Option | Description | Selected |
|--------|-------------|----------|
| `null` (simétrico Plane) | Plane normalizer ya devuelve `null` cuando no hay match. Mantiene contrato cross-provider uniforme. La REQ GH-03 dice 'default medium' pero esa redacción rompe la simetría; actualizar REQ. | ✓ |
| `'medium'` (literal REQ) | Seguir REQUIREMENTS GH-03 al pie. Asume que TODOS los issues sin label priority son 'medium' — distorsiona métricas. | |
| `'none'` (valor válido) | `VALID_PRIORITIES` incluye `'none'`. Más explícito pero desvío del pattern Plane. | |

**User's choice:** `null` (simétrico Plane)

### Sub-area: priority value whitelist

| Option | Description | Selected |
|--------|-------------|----------|
| Solo high/medium/low + urgent | Aceptar `priority:urgent` + high/medium/low. Cualquier otra variante (p0/critical/blocker) → cae al default. | ✓ |
| Mapeo explícito con aliases | Aceptar p0/critical/blocker→urgent, p1→high, etc. Más flexible pero mantiene mapping table. | |
| Solo high/medium/low estrictos | Solo esos 3 exactos. Si quiere urgent debe usar high. | |

**User's choice:** Solo high/medium/low + urgent

### Sub-area: description format

| Option | Description | Selected |
|--------|-------------|----------|
| Markdown crudo | Guardar `issue.body` tal cual (Markdown). GitHub devuelve Markdown que ya es human-readable y útil para LLM. | ✓ |
| Strip Markdown a plaintext | Strip ligero para producir plaintext puro. Simetría formal con Plane stripHtml pero pierde contexto (code blocks). | |
| Markdown crudo + truncate | Markdown crudo limitado a N chars (e.g. 8000). | |

**User's choice:** Markdown crudo

### Sub-area: groups field

| Option | Description | Selected |
|--------|-------------|----------|
| Array vacío `[]` | Plane normalizer hardcodea `groups: []` y lo enriquece después con módulos cacheados. GitHub no tiene 'modules'; milestone es opcional y poco usado. | ✓ |
| Milestone como single group | Si `issue.milestone` existe, `groups: [milestone.title]`. Permite filtrar por milestone. | |
| Milestone + assignees | Mezcla semántica temporal con personas. Puede confundir al consumidor. | |

**User's choice:** Array vacío `[]`
**Notes:** Cierra la open question del STATE.md sobre milestone extraction.

---

## updateTaskState mapping

### Sub-area: TaskItem.state value

| Option | Description | Selected |
|--------|-------------|----------|
| Literal `'open'`/`'closed'` | Devolver `issue.state` directo. Dispatcher es config-driven; con `states.done='closed'` el match automático funciona. | ✓ |
| Mapeo a semántica Plane | `open→In Progress`, `closed→Done`. Rompe el principio de que cada provider expone sus estados. | |
| Mapeo configurable | Leer config.states y devolver el nombre lógico. Más semántico pero crea indirección. | |

**User's choice:** Literal `'open'`/`'closed'`

### Sub-area: updateTaskState translation

| Option | Description | Selected |
|--------|-------------|----------|
| Config-driven `states.{trigger,review,done}` | Provider lee `config.providers.github.states` (Phase 26 schema). Si stateName matchea, PATCH. Simétrico con Plane que también lee states del config. | ✓ |
| Hardcoded en provider.js | Map estático dentro del provider. Más simple ahora pero impide customizar sin tocar código. | |
| Passthrough estricto | Solo `'open'`/`'closed'` literal. Forza a callers a saber que es GitHub. Rompe abstraction. | |

**User's choice:** Config-driven
**Notes:** Phase 24 asume schema disponible (mismo patrón Phase 23↔Phase 26 con `api_key_env`).

---

## resolveRef + listProjects

### Sub-area: ref format

| Option | Description | Selected |
|--------|-------------|----------|
| Solo `owner/repo#N` estricto | Regex strict. Cualquier otra cosa → throw. Predecible, sin lógica de inferencia. | ✓ |
| Estricto + atajo `#N` con config | Acepta `#N` y resuelve usando `repos[0]`. Conveniente para 1-repo pero ambiguo. | |
| Tolerante a variaciones | Acepta `owner/repo#N`, `owner/repo/issues/N`, URL completa. Más flexible pero 3 regex. YAGNI. | |

**User's choice:** Solo `owner/repo#N` estricto

### Sub-area: listProjects return

| Option | Description | Selected |
|--------|-------------|----------|
| Repos configurados sin API call | Lee `config.providers.github.repos` y devuelve los 3 campos = `owner/repo`. Cero API calls, determinístico. | ✓ |
| Enriquecer con `/repos/{owner}/{repo}` | N API calls para `repo.description`. Penaliza rate limit. | |
| Discovery via `/user/repos` | Lista TODOS los repos del PAT. Rompe contrato. | |

**User's choice:** Repos configurados sin API call

---

## init() + listPendingTasks

### Sub-area: init() body

| Option | Description | Selected |
|--------|-------------|----------|
| No-op (`async init() {}`) | GitHub no necesita cache: labels embedded en cada issue, states fijos, sin modules. Karpathy R2 simplicity. | ✓ |
| Cache labels per-repo | Por cada repo, llamar `client.listLabels`. YAGNI — Phase 26 puede llamar directo si lo necesita. | |
| Lazy init con timestamp guard | Mirror Plane pattern pero sin cache real. Overhead conceptual sin beneficio. | |

**User's choice:** No-op

### Sub-area: listPendingTasks implementation

| Option | Description | Selected |
|--------|-------------|----------|
| `client.listIssues({labels:['kodo'], state:'open'})` por repo | Mismo patrón que Plane. Sin etag (esa optimización es de Phase 25). Server-side filter via query string. | ✓ |
| Filter en cliente JS | Sin label filter en API, filtrar en JS. Más tráfico, más CPU. | |
| Combinar `kodo` + `kodo:gsd` queries | 2 queries por repo y dedupe. Más API calls. El filter único ya captura los `kodo*`. | |

**User's choice:** `client.listIssues({labels:['kodo'], state:'open'})` por repo

---

## Claude's Discretion

- D-40: Nombre del helper privado `parseRef` (no exportado, sin colisión con Plane).
- D-41: Tipos JSDoc del `opts.client` en el factory.
- D-42: Orden de métodos en el objeto provider retornado (siguiendo TASK_PROVIDER_METHODS).

## Deferred Ideas

- Auto-pagination en `listPendingTasks` — single-page max 100. Si emerge demand, v0.8+.
- `listProjects` con enrichment via `/repos/{owner}/{repo}` — Phase 26 wizard puede hacerlo directo.
- Discovery de repos via `/user/repos` — Phase 26 helper, no contrato.
- Milestone extraction a `TaskItem.groups` — descartado (cierra open question STATE.md).
- Aliases de priority (`p0`/`critical`/`blocker`) — v0.8+ si demand.
- State mapping a semántica Plane — rompe contrato cross-provider.
- `updateTaskState` con map de aliases — passthrough hard.
- GitHub webhook ingress + `parseTriggerEvent`/`verifySignature` reales — REQUIREMENTS Out of Scope.
- Cachear labels per-repo en init() — Phase 26 puede llamar al cliente directo si lo necesita.
