# Requirements: kodo — v0.15 «kodo up»

**Defined:** 2026-07-01
**Core Value:** Cualquier sistema de tareas puede ser el motor de kodo; el mismo sistema dispara dos modos GSD (full/quick) sin acoplar el código GSD al proveedor.

## v1 Requirements

Requisitos del milestone v0.15. Cada uno mapea a una fase del roadmap. Dos pilares con dependencia estricta: **Pilar 1** (UP + DIST — lifecycle + distribución, shippable solo) y **Pilar 2** (SETUP — onboarding dashboard-first, requiere Pilar 1).

### UP — Arranque unificado y ciclo de vida del daemon (Pilar 1)

- [ ] **UP-01**: El operador ejecuta `kodo up` y arranca el daemon (server + polling compuestos en un solo proceso) en segundo plano y se abre el dashboard como visor.
- [ ] **UP-02**: El daemon es persistente: al cerrar el dashboard (`q` / Ctrl-C) el daemon sigue corriendo en segundo plano (reaccionando a triggers).
- [ ] **UP-03**: `kodo up` es idempotente: si el daemon ya está corriendo, adjunta el dashboard al daemon existente sin hacer doble spawn ni colisionar de puerto.
- [ ] **UP-04**: El daemon expone un modo foreground supervisable (`kodo daemon run`) que bloquea sin auto-desvincularse, además del modo self-detach que usa `kodo up` sin flags.
- [ ] **UP-05**: `kodo stop` detiene el daemon completo (server + polling) de forma limpia y `kodo status` reporta su estado (running/stopped) de forma determinista, con salida `--json` scriptable.
- [ ] **UP-06**: `kodo start` (server en foreground, comportamiento legacy) sigue funcionando sin cambios tras introducir `kodo up`.

### DIST — Distribución e instalación (Pilar 1)

- [ ] **DIST-01**: El operador instala kodo con `brew install kodo` (fórmula Homebrew vía tap, `depends_on "node"` ≥20, sin bundlear el runtime).
- [ ] **DIST-02**: El operador registra kodo como servicio del sistema con `brew services start kodo`: arranca al login y se reinicia si crashea, invocando el modo foreground del daemon (`kodo daemon run`) — nunca `kodo up`.
- [ ] **DIST-03**: En una plataforma sin el patrón detach/launchd (Windows), `kodo up` degrada a modo foreground documentado sin crashear (misma guardia que el daemon de polling).

### SETUP — Onboarding dashboard-first (Pilar 2 — requiere Pilar 1)

- [ ] **SETUP-01**: En el primer arranque sin configuración (no existe `config.json` o falta la API key), `kodo up` sirve el dashboard en modo setup en lugar de salir con error.
- [ ] **SETUP-02**: El operador edita el `provider` activo, `base_url` y `workspace_slug` desde el dashboard y se persisten a `~/.kodo/config.json` (cierra CFGF-03 en su parte no-secreta).
- [ ] **SETUP-03**: El operador introduce la API key del provider en un campo enmascarado del dashboard; se persiste a `~/.kodo/.env` (permisos `0600`) y NUNCA se renderiza de vuelta ni aparece en `config.json`, `/status` ni en los logs.
- [ ] **SETUP-04**: El dashboard indica si la key ya está configurada (presencia, sin revelar el valor) y, tras cambiar provider/key, avisa de reiniciar el daemon para aplicar (sin hot-reload).
- [ ] **SETUP-05**: El wizard `kodo config` escribe a través de la misma fontanería que el dashboard (`saveConfig`/`saveProjects`/`writeEnvVar` como únicos escritores) — el camino headless y el TUI no divergen.

## Future Requirements

Diferidos a futuros milestones. Trackeados, fuera del roadmap actual.

- **CFGF-01**: Hot-reload de config en el daemon corriendo (elimina el aviso de reinicio).
- **CFGF-02**: `kodo config` CLI no-lineal completo (edición por dot-path) compartiendo fontanería — SETUP-05 solo garantiza el escritor común, no el rediseño del wizard.
- Gestión de secretos genérica (múltiples keys, vault, rotación).
- Gestor de procesos genérico (múltiples servicios, dependency graph).
- Publicación en homebrew-core (vs tap personal) — sujeta a las notability gates de Homebrew.

## Out of Scope

Exclusiones explícitas de v0.15 con su razón.

- **Semántica compose-style (Ctrl-C mata el daemon)** — contradice el modelo persistente LOCKED; el dashboard es un visor, no el dueño del proceso.
- **Nuevos endpoints en `src/server.js`** — invariante "cero endpoints nuevos desde v0.10"; el daemon compone `startServer`/`startPolling` existentes.
- **Round-trip del valor de la key** (leerlo de vuelta al render) — viola PERSIST-04; solo se muestra presencia.
- **Auto-daemonizar bajo launchd** — launchd supervisa; el proceso debe quedarse en foreground bajo `brew services`.
- **Reemplazar `kodo start`/`polling start` legacy** — se mantienen; el daemon unificado se añade como camino principal, no sustituye.

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| UP-01 | TBD | Pending |
| UP-02 | TBD | Pending |
| UP-03 | TBD | Pending |
| UP-04 | TBD | Pending |
| UP-05 | TBD | Pending |
| UP-06 | TBD | Pending |
| DIST-01 | TBD | Pending |
| DIST-02 | TBD | Pending |
| DIST-03 | TBD | Pending |
| SETUP-01 | TBD | Pending |
| SETUP-02 | TBD | Pending |
| SETUP-03 | TBD | Pending |
| SETUP-04 | TBD | Pending |
| SETUP-05 | TBD | Pending |
