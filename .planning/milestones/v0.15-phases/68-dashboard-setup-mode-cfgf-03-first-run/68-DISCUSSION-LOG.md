# Phase 68: Dashboard Setup Mode + CFGF-03 + First-Run - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-07-02
**Phase:** 68-dashboard-setup-mode-cfgf-03-first-run
**Areas discussed:** Detección de first-run, UX de la pantalla de setup, Transición setup→running, Alcance rewire de kodo config

---

## Detección de first-run

| Option | Description | Selected |
|--------|-------------|----------|
| Local en dashboard + up no spawnea | Presence-check LOCAL en el dashboard (loadConfig + getProviderApiKey + campos provider); `kodo up` no spawnea el daemon si config incompleta (evita enganchar a server muerto por teardown(1)) | ✓ |
| Señal del daemon vía /status | El daemon sigue vivo sin config y expone setup_required por HTTP; requiere cambiar el teardown(1) de Phase 65 y roza «cero endpoints/campos nuevos» | |
| Solo criterio no-config.json | Dispara setup solo si falta config.json; incumple SETUP-01 (falta API key también cuenta) | |

**User's choice:** Local en dashboard + up no spawnea (Recomendado)
**Notes:** Coherente con que el dashboard ya lee config local (63/64/67) y con el invariante cero endpoints nuevos. Criterio de first-run fijado por SETUP-01 (no config.json O falta API key), extendido a campos estructurales para que el guiado sepa qué pedir.

---

## UX de la pantalla de setup

| Option | Description | Selected |
|--------|-------------|----------|
| Pantalla guiada dedicada | Nuevo modo setup lineal step-by-step (provider → base_url → workspace_slug → key) reusando text-input/masked existentes | ✓ |
| Reusar overlay config-edit auto-abierto | Auto-abrir el overlay editable con los campos requeridos como checklist; mínimo código pero menos guiado | |
| Híbrido: lista de faltantes → editor | Pantalla ligera que lista faltantes y abre el editor por campo | |

**User's choice:** Pantalla guiada dedicada (Recomendado)
**Notes:** Cumple el literal «pantalla guiada» del SC#1. Sub-decisiones confirmadas: cubre **solo Plane** (GitHub → `kodo config` headless); **solo auto en first-run** (no invocable manualmente); **selector de provider activo** añadido a la pantalla (satisface SETUP-02 literal).

---

## Transición setup→running

| Option | Description | Selected |
|--------|-------------|----------|
| Aviso honesto de reinicio | «config guardada — reinicia kodo (`kodo up`)»; sin auto-restart; leer valor recién escrito directo del archivo (Pitfall 15) | ✓ |
| Auto-restart del daemon + transición | `kodo up` rearranca el daemon y el dashboard transiciona a running en el mismo flujo | |
| Auto-restart sin auto-transición | Rearranca el daemon pero el dashboard solo avisa de reabrir | |

**User's choice:** Aviso honesto de reinicio (Recomendado)
**Notes:** Es el literal del SC#4 («aviso de reinicio honesto, sin hot-reload, coherente con v0.14»). Simple, never-throws, no tensa con el modelo daemon persistente. Pitfall 15 LOAD-BEARING: leer directo del archivo, no vía loadEnvFile no-override.

---

## Alcance rewire de kodo config

| Option | Description | Selected |
|--------|-------------|----------|
| Mínimo: escritores compartidos, key solo en dashboard | Wizard NO captura el valor de la key (evita eco del secreto); saveConfig/saveProjects ya compartidos; cualquier escritura de key pasa por writeEnvVar | ✓ |
| Wizard captura+escribe la key vía writeEnvVar | Nuevo prompt para el valor de la key en el wizard; camino headless completo pero readline ecoa el secreto | |
| Tú decides | Claude decide al planificar | |

**User's choice:** Mínimo: escritores compartidos, key solo en dashboard (Recomendado)
**Notes:** Quirúrgico. SETUP-05 se satisface con los escritores compartidos; CFGF-02 (rediseño no-lineal) diferido. La entrada del valor de la key es exclusiva del campo enmascarado del dashboard (evita vector de fuga PERSIST-04/Pitfall 11 en terminal).

---

## Claude's Discretion

- Materialización del "modo setup" en `App.js` (nuevo estado de modo vs rama de render).
- Mecánica exacta del selector de provider (lista 2-opciones estilo wizard).
- Manejo non-TTY del setup en el attach de `kodo up` (degradar a `kodo config`, never-throws).
- Punto exacto del presence-check pre-spawn en `runUp` (candidato a helper puro compartido).
- Detalle de la lectura directa del archivo para D-09.

## Deferred Ideas

- Cobertura de GitHub en la pantalla guiada (forma repos[]) → `kodo config` headless.
- Invocación manual del setup guiado post-first-run.
- Captura del valor de la key en el wizard readline (eco del secreto).
- Auto-restart del daemon tras el setup (converge con CFGF-01).
- Hot-reload de config (CFGF-01) y rediseño no-lineal de `kodo config` (CFGF-02) → futuros milestones.
