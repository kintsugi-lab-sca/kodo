# Phase 81: Saneo de deuda v0.17 - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-24
**Phase:** 81-Saneo de deuda v0.17
**Areas discussed:** Semántica clear/stale de `next` (DEBT-01), Colapso de whitespace en `nextCell` (DEBT-03), Alcance del diagnóstico del flaky (DEBT-04), Entrega del doc-drift (DEBT-02)
**Mode:** `--auto` — todas las áreas auto-seleccionadas; en cada pregunta se eligió la opción recomendada sin AskUserQuestion.

---

## Semántica clear/stale de `next` (DEBT-01)

| Option | Description | Selected |
|--------|-------------|----------|
| Discriminar `null` vs `undefined` | `null` explícito = clear deliberado (handoff LLM sin `NEXT:`); campo ausente = preserva (backstop mecánico). Refina la asimetría de 74/WR-02 sin invalidarla | ✓ |
| Staleness por timestamp | Conservar el `next` pero atenuarlo/ocultarlo en TUI cuando `updated_at` supera un umbral | |
| Siempre-borrar ante ausencia | Cualquier cierre sin `NEXT:` limpia el puntero | |

**Choice (auto):** Discriminar `null` vs `undefined` — recommended default.
**Notes:** Staleness añade maquinaria TUI para un item menor (YAGNI); siempre-borrar regresiona D-03 de Phase 74 (el backstop mecánico borraría un `NEXT:` válido de una sesión anterior). La discriminación exige que `session-end.js` mapee autoría → contrato.

---

## Colapso de whitespace en `nextCell` (DEBT-03)

| Option | Description | Selected |
|--------|-------------|----------|
| Colapsar en `nextCell` (render) | `/\s+/g` → espacio único + trim en el punto de proyección; dato persistido verbatim | ✓ |
| Sanear al escribir | Colapsar en `upsertTaskHandoff` para que el dato ya llegue limpio | |
| Sanear en el enrich | Ampliar el paso `stripControlChars` de App.js para cubrir whitespace | |

**Choice (auto):** Colapsar en `nextCell` — recommended default.
**Notes:** El enunciado del item lo acota al «RENDER de fila»; mutar el dato de origen por una fuente hand-editada rara no se justifica, y ampliar `stripControlChars` mezclaría el carril de seguridad (Phase 78) con uno de layout.

---

## Alcance del diagnóstico del flaky (DEBT-04)

| Option | Description | Selected |
|--------|-------------|----------|
| Diagnóstico-first con gate de fix | `/gsd-debug` + repro bajo carga; fix SOLO con causa entendida y sin tocar semántica de locks; no-repro honesto documentado también cierra el item | ✓ |
| Fix directo del test | Ajustar el harness (timeouts/retries) para que deje de fallar | |
| Skip documentado | Marcar el test como skip con nota y diferir el diagnóstico | |

**Choice (auto):** Diagnóstico-first — recommended default (además es constraint LOCKED del milestone: NO arreglar a ciegas).
**Notes:** Retries/skip/timeouts a ciegas están explícitamente prohibidos por el goal de la fase; protegen el invariante de locks de v0.16.

---

## Entrega del doc-drift (DEBT-02)

| Option | Description | Selected |
|--------|-------------|----------|
| Quirúrgico doc-only | Corregir comentario App.js:735 + typedef SessionTable.js:817 (`render?`); suite verde sin modificación como evidencia | ✓ |
| Pasada amplia de comentarios | Aprovechar para auditar todos los comentarios del dashboard | |

**Choice (auto):** Quirúrgico doc-only — recommended default.
**Notes:** Una pasada amplia sería scope creep (Regla 3: cambios quirúrgicos); el item traza exactamente dos drifts (WR-02, WR-04).

---

## Claude's Discretion

- Redacción exacta de comentarios/JSDoc corregidos
- Estructura y naming de los tests nuevos (DEBT-01, DEBT-03)
- Agrupación de items en planes (candidato: DEBT-01+02+03 carril código, DEBT-04 carril diagnóstico)
- Formato del artefacto de diagnóstico de DEBT-04 dentro de las convenciones de `/gsd-debug`

## Deferred Ideas

None — la discusión se mantuvo dentro del scope de la fase. (FUT-01/02/03 ya trazados en REQUIREMENTS §Future.)
