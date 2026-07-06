# Phase 69: Red y autenticación - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-06
**Phase:** 69-Red y autenticación
**Mode:** `--auto` — sin prompts interactivos; en cada pregunta se seleccionó la opción recomendada. Este log preserva las alternativas descartadas para auditoría.
**Areas discussed:** Token bearer (almacenamiento/generación/arranque), Alcance del carril autenticado, Dashboard Ink y consumidores CLI, Documentación NET-06

---

## Token bearer: almacenamiento, generación y arranque

**Q: ¿Dónde vive el token?**

| Option | Description | Selected |
|--------|-------------|----------|
| `~/.kodo/.env` como `KODO_API_TOKEN` vía `writeEnvVar` | Reusa la fontanería atómica 0600 de Fase 67; coherente con PERSIST-04 (secretos fuera de `config.json`) | ✓ |
| `config.json` en claro | Secreto en fichero sin chmod restrictivo; rompe el boundary PERSIST-04 | |
| Keychain/credencial del SO | Sobreingeniería para un token local single-user | |

**Q: ¿Qué pasa si no hay token al arrancar?**

| Option | Description | Selected |
|--------|-------------|----------|
| Auto-generar y persistir en primer arranque | Cero fricción, seguro por defecto, loguea `auth token: ENABLED` | ✓ |
| Warning y arrancar sin auth | Repite el anti-patrón del HMAC opcional silencioso (CONCERNS.md #4) | |
| Fallar el arranque | Fricción innecesaria cuando kodo puede autoprovisionarse | |

**Notes:** Comparación timing-safe (`crypto.timingSafeEqual`), coherente con el HMAC del webhook.

---

## Alcance del carril autenticado (`/` y `/dashboard` web)

| Option | Description | Selected |
|--------|-------------|----------|
| Default-deny: todo exige bearer salvo `/health` y `/webhook` | Fail-closed; cubre `/`, `/dashboard` y rutas futuras sin mantener una lista | ✓ |
| Proteger solo los 4 endpoints de NET-02 | El dashboard web quedaría medio roto (HTML abierto, fetches 401) y cada ruta nueva nace desprotegida | |
| Dejar `/` abierto por ser "solo HTML" | El HTML embebe JS que fetchea `/status`/`/logs`; abierto no aporta nada y confunde | |

**Notes:** El HTML embebido acepta `?token=` y su JS inline lo reenvía como header. Orden de checks: bind → body 1 MB pre-auth (413) → HMAC/bearer → handler.

---

## Dashboard Ink y consumidores CLI

| Option | Description | Selected |
|--------|-------------|----------|
| Helper único que adjunta el bearer en `src/cli/dashboard/client.js` + misma lectura para `kodo status`/attach | Un solo punto de verdad para leer token y construir headers | ✓ |
| Cada consumidor lee el token por su cuenta | Duplicación; divergencia asegurada | |

**Notes:** 401 → estado visible en el TUI (patrón never-throws v0.14), nunca pantalla vacía. `/health` abierto ⇒ health-checks de `kodo up` sin cambios.

---

## Documentación NET-06

| Option | Description | Selected |
|--------|-------------|----------|
| Sección nueva «Topología multi-nodo» en `README.md` | Visible donde el usuario configura; solo se añade la sección (la pasada completa es HYG-08/Fase 72) | ✓ |
| Fichero aparte en `docs/` | El repo no tiene `docs/` como convención; menos descubrible | |

---

## Claude's Discretion

- Forma del middleware/helper de auth (función local vs módulo).
- Formato y longitud del token (≥32 bytes de entropía).
- Mecánica exacta del corte a 1 MB en `readBody` (mientras sea pre-auth → 413).
- Ubicación/estilo de tests (`node:test`, como la suite existente).
- Redacción de la sección README.

## Deferred Ideas

- Rotación/regeneración de token desde el dashboard — DX futura, no la pide ningún NET-*.
- Rate limiting del carril autenticado — fuera de scope v0.16.
