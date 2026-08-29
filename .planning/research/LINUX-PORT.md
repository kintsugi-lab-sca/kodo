# Linux — viabilidad y plan de port (KODO-33)

> Investigación con **verificación empírica**, no análisis estático. Todo lo que
> aparece como «verificado» se ejecutó en un contenedor Linux real
> (`node:20-bookworm-slim`, `Linux aarch64`, kernel 7.0.14) durante la sesión de
> KODO-33 sobre el árbol en v0.20.0.

---

## Veredicto

**kodo ya corre en Linux.** El core no necesita ni una línea de código nuevo para
arrancar: lo que falta no es un port, es *soporte declarado* — packaging, CI y
documentación — más una limpieza de tres acoplamientos cosméticos a cmux.

La razón de fondo es que el trabajo duro se hizo sin querer, en KODO-18: la
abstracción `WorkspaceHost` (`src/host/interface.js`) desacopló el ciclo de vida
de la sesión del cliente de terminal, y el segundo host que se implementó —Orca—
**es multiplataforma**. cmux es el único componente macOS-only del stack, y desde
KODO-18 es sustituible con una clave de config.

| | Estado en Linux |
|---|---|
| Core (Node 20, ESM, sin deps nativas) | ✅ funciona |
| Test suite (3562 tests) | ✅ 3558 pass / 1 fail (fuga de entorno, no de plataforma) |
| CLI (`--version`, `status`, `doctor`, `check`) | ✅ funciona |
| Host `orca` | ✅ Orca publica build Linux |
| Host `cmux` | ❌ macOS-only (Linux en waitlist) |
| Packaging (`brew services` → launchd) | ⚠️ no aplica; falta unidad systemd |
| CI | ❌ no existe matriz de plataforma |

---

## Evidencia

### 1. El test suite pasa en Linux

Ejecutado sobre un clone completo del árbol, montado en `/work/kodo`, con
`git` + `procps` instalados y **como usuario no-root** (uid 1000):

```
# tests 3562
# suites 780
# pass 3558
# fail 1
# cancelled 2
# skipped 1
```

Comparativa macOS (misma revisión, misma sesión): `3562 tests / 3561 pass / 0 fail`.

**El único fallo es una fuga de entorno de los tests, no un fallo de plataforma.**
`test/cli/insecure-gate.test.js` y `test/cli/kodo-start-regression.test.js`
arrancan el server *real*, que resuelve el provider en `startServer`
(`src/server.js:315`) y muere con:

```
Error: Plane API key not found. Set PLANE_API_KEY env var.
    at new PlaneClient (src/providers/plane/client.js:69:13)
```

En macOS pasan porque la máquina del operador tiene un `~/.kodo/.env` real. En
**cualquier** máquina limpia —macOS incluido— fallarían igual. Es un defecto de
aislamiento de la suite que Linux se limitó a hacer visible.

### 2. Tres fallos más que Linux reveló, y que tampoco son de Linux

En la primera pasada (árbol copiado sin `.git`, montado en `/app`, como root)
fallaron tres tests más. Los tres se explican, y los tres **pasan** al corregir el
entorno. Se documentan porque cada uno señala una fragilidad real de la suite:

| Test | Causa | Fragilidad que destapa |
|---|---|---|
| `test/hooks/install.test.js` — «Test 2: idempotente» | Filtra los commands por `c.includes('kodo')`, y el command es la ruta absoluta del hook. En `/app/src/hooks/…` no hay ningún «kodo». | **El test pasa en macOS por accidente**: porque el checkout vive en un directorio llamado `kodo`. Clona el repo en `~/dev/trabajo` y falla en macOS igual. |
| `test/manager.test.js` — `isGitRepo (KODO-9)` | El árbol copiado no tenía `.git`. | Test acoplado a que el cwd sea un repo git de verdad. |
| `test/skill-sync.test.js` — `SKILL-04 #3: dest file unreadable` | Corría como root; `chmod 000` no impide leer a root. | Simular «ilegible» con permisos POSIX no es fiable bajo un uid privilegiado (contenedores, CI). |

Ninguno bloquea el port. Los tres son deuda de test que conviene cerrar *antes*
de meter Linux en CI, o el pipeline nacerá rojo por motivos equivocados.

### 3. El CLI arranca

```
$ node bin/kodo --version
0.20.0
$ node bin/kodo status
stopped                                    # exit 0
$ node bin/kodo doctor
✓ clean — config y projects.json están alineados
WARN  no se pudo leer ~/.claude/settings.json  # correcto: no hay Claude Code instalado
✓ sin problemas                            # exit 0
$ node bin/kodo check
Primera vez? Vamos a configurar kodo.      # wizard de first-run, correcto
```

Esto es exactamente el smoke test que la fórmula de Homebrew ejecuta en
`brew test` (`packaging/homebrew/Formula/kodo.rb:96`), y da el mismo resultado.

---

## Por qué el core ya es portable

No es suerte; es consecuencia de decisiones que ya están en el árbol:

1. **Sin dependencias nativas.** `commander`, `ink`, `picocolors`, `react`. Todo
   JS puro, `"type": "module"`, `engines.node >= 20`. Nada que compilar.

2. **`process.platform` solo se consulta para Windows.** Tres sitios
   (`src/cli/up.js:155`, `src/daemon/lifecycle.js:156`, `src/cli/polling.js:237`),
   y los tres implementan un *refuse-with-guidance* para `win32`. Linux cae por el
   camino POSIX, que es el mismo que macOS.

3. **`~/.kodo` es la única raíz de estado**, centralizada en `src/paths.js`
   (KODO-43) sobre `os.homedir()`. Cero rutas macOS-específicas
   (`~/Library/Application Support` aparece una vez, en un comentario de
   `src/integration/queue.js:79`, explicando por qué el separador de claves es NUL).

4. **Los binarios externos que invoca son POSIX estándar** y todos existen en
   Linux: `git`, `/bin/sh`, `ps -o lstart=`, `pgrep -f`. Verificado:
   `ps` y `pgrep` de procps-ng 4.0.2 producen el formato que el código espera —
   `processStartMatches` fuerza `LC_ALL=C` (`src/daemon/lifecycle.js:113`), que
   estabiliza el parseo en ambas plataformas.

5. **`fs.watchFile` por polling, no `fs.watch`.** `src/logs/follow.js:6` lo dice
   explícitamente: *«NO fs.watch — edge cases inotify/FSEvents por plataforma»*.
   La decisión de portabilidad ya estaba tomada.

---

## El único bloqueante real: cmux

**cmux es macOS-only.** Terminal nativa Swift sobre Ghostty; su web ofrece
*waitlist* para el resto de plataformas. No hay build de Linux hoy y no hay fecha.

Eso hace que el default de fábrica (`host: 'cmux'`, `src/config.js:95`) sea
inservible en Linux, junto con todo lo que cuelga de él: liveness por color de
tab, `sidebar doctor`, adopción de sesiones ad-hoc vía `surface resume show`.

**La salida ya está construida.** Orca corre en **macOS, Windows y Linux** (open
source, MIT), y kodo lo soporta como host de primera clase desde KODO-18:

```bash
kodo config --set host=orca
kodo config --set orca.binary=/usr/bin/orca-ide
```

El README ya enumera las degradaciones fail-open de esa ruta (§*Known limits*):
sin notificaciones de sistema, sin grupos de sidebar, sin adopción por
descubrimiento, sin branding del propio daemon. Ninguna aborta un launch.

> ⚠️ **Trampa específica de Linux, ya anotada en el código**
> (`src/config.js:106-109`): en Linux `orca` a secas resuelve al **lector de
> pantalla de GNOME**, no al IDE. El binario correcto es `orca-ide`. El default
> de config (`/usr/local/bin/orca`) es directamente *peligroso* en Linux: no
> falla con ENOENT, ejecuta otro programa. Esto debe cambiar (ver F2-1).

---

## Inventario de hallazgos

Severidad: **B** bloqueante · **D** degradable (funciona, con pérdida) · **C** cosmético.

| # | Sev | Ubicación | Qué pasa en Linux | Acción |
|---|-----|-----------|-------------------|--------|
| 1 | **B** | `src/config.js:95` — `host: 'cmux'` default | El default de fábrica apunta a un binario inexistente. First-run en Linux queda sin host. | Detectar plataforma en el wizard de `kodo check` y proponer `orca` en no-darwin. |
| 2 | **B** | `src/config.js:110` — `orca.binary: '/usr/local/bin/orca'` | En Linux resuelve al lector de pantalla GNOME si el operador lo deja al default y el path no existe. **No falla: ejecuta otro programa.** | Default por plataforma: `orca-ide` en linux. |
| 3 | **B** | `packaging/homebrew/` | `service do` renderiza launchd. `brew services` existe en Linux (systemd) pero el tap y la fórmula están escritos para macOS (`opt_bin` Apple Silicon/Intel, caveats de cmux). | Añadir unidad systemd *user* + documentar `npm i -g`. |
| 4 | **D** | `src/check.js:20,163` — `sidebar-doctor` sin guard de host | Con `host: orca` se invoca igualmente el motor cmux → 2 `execFile` a un binario ausente por cada `check`. Fail-open lo traga, pero es trabajo inútil y ruido en el log. | Guard `resolveHostName() === 'cmux'` antes de `executeFn`. |
| 5 | **D** | `src/cli/dashboard/open.js:74` — `binary = 'open'` | La tecla `o` del dashboard (abrir la tarea en el navegador) da `ENOENT` en Linux: `open` no existe. | Default por plataforma → `xdg-open`. El discriminante `ENOENT` ya existe; solo falta el binario correcto. |
| 6 | **C** | `src/server.js:268` — `brandServiceWorkspace` | Ya es seguro: se guarda tras `CMUX_WORKSPACE_ID`, que en Linux es `undefined` → `shouldBrandWorkspace` devuelve false y no se llama a cmux. | Ninguna. Documentado en README §*Known limits*. |
| 7 | **C** | `src/hooks/session-end.js:184` — fallback `|| cmux` | Solo entra si la resolución del host lanza. En Linux acabaría en un `execFile` fallido, tragado por el never-throws. | Ninguna, o degradar a no-op en no-darwin. |
| 8 | **C** | `README.md:38` — *«Requires macOS…»* | Afirmación desactualizada respecto de lo que el propio código soporta. | Reescribir la matriz de plataformas. |

---

## Plan de port

Cuatro fases, secuenciales. Estimaciones para una persona que ya conoce el árbol.

### F1 — Saneamiento de la suite (medio día)

Prerrequisito de todo lo demás: **CI en Linux no puede nacer roja**.

1. `test/cli/insecure-gate.test.js` y `test/cli/kodo-start-regression.test.js`:
   inyectar la API key (env var en el `spawnSync`) o stubear el provider, para
   que no dependan del `~/.kodo/.env` de la máquina.
2. `test/hooks/install.test.js` Test 2: filtrar por `/src/hooks/` en vez de por
   el substring `kodo` — la primitiva correcta ya existe en el módulo bajo
   prueba (`commandMatchesFile`, `src/hooks/install.js:41`).
3. `test/skill-sync.test.js` SKILL-04 #3: saltar el caso si `process.getuid() === 0`,
   o simular el error de fs por inyección en vez de por permisos.
4. `test/manager.test.js` `isGitRepo`: `git init` en un tmpdir en vez de asumir
   que el cwd es un repo.

**Éxito:** la suite pasa en verde en Linux, como root y como no-root, en un
directorio que no se llame `kodo`.

### F2 — Defaults conscientes de la plataforma (medio día)

Cambios quirúrgicos, todos con el mismo patrón (`process.platform` inyectable,
como ya hacen `up.js` y `lifecycle.js`):

1. `src/config.js`: `orca.binary` y `host` resueltos por plataforma. En no-darwin,
   `host: 'orca'` y `orca.binary: 'orca-ide'`.
2. `src/cli/dashboard/open.js`: `binary` default `xdg-open` en linux, `open` en darwin.
3. `src/check.js`: guard de host antes del piggyback del sidebar doctor.

**Éxito:** en Linux, `kodo check` no invoca cmux ni una vez; la tecla `o` del
dashboard abre el navegador.

### F3 — Packaging y arranque (1 día)

`brew services` no es la vía idiomática en Linux. Dos rutas, ambas baratas:

1. **`npm install -g`** — funciona hoy sin cambios (`bin/kodo` usa
   `#!/usr/bin/env node`). Solo hay que documentarlo.
2. **Unidad systemd de usuario** — equivalente exacto del plist. El entrypoint
   supervisado es el mismo que ya usa launchd, `kodo daemon run`
   (`src/daemon/run.js` ya está escrito para ser supervisado: no hace doble fork
   y maneja el EPIPE de stdout roto). Esbozo:

   ```ini
   # ~/.config/systemd/user/kodo.service
   [Service]
   ExecStart=%h/.local/bin/kodo daemon run
   Restart=always
   Environment=PATH=%h/.local/bin:/usr/local/bin:/usr/bin:/bin
   ```

   Mismo razonamiento que el `environment_variables PATH:` de la fórmula: el
   daemon resuelve `git` y `claude` **por nombre**, así que el PATH es
   load-bearing, no cosmético.

**Éxito:** `systemctl --user start kodo` levanta el daemon, sobrevive a un
`kill -9` y `kodo status` lo ve.

### F4 — CI y documentación (medio día)

1. Matriz `ubuntu-latest` × `macos-latest` en el workflow de tests.
2. README: sustituir *«Requires macOS»* por una matriz honesta —
   macOS con cmux u Orca, Linux con Orca, Windows fuera de alcance (el código ya
   lo rechaza explícitamente en tres sitios).
3. Nota sobre `orca` vs `orca-ide` en Linux, visible, no enterrada en un comentario.

**Éxito:** un PR que rompa Linux se pone rojo antes del merge.

---

## Coste total

**2 a 3 días** de trabajo para «Linux soportado y en CI».

El grueso no es escribir código: F1 (deuda de test) y F3 (packaging) son el 70%
del esfuerzo. El cambio funcional real —F2— son tres defaults.

---

## Lo que este plan NO cubre

- **Windows.** El código lo rechaza a propósito en tres sitios, con mensajes de
  guía. Es una decisión tomada, no una laguna. Fuera de alcance.
- **Portar cmux.** No es nuestro repo. La ruta Linux es Orca.
- **Paridad de features entre hosts.** Las limitaciones de Orca (adopción,
  notificaciones, sidebar) son de su CLI, no de kodo, y ya están documentadas y
  degradadas fail-open. Un Linux con Orca tendrá exactamente las mismas
  limitaciones que un macOS con Orca — ni una más.

---

## Reproducir la verificación

```bash
git clone --no-hardlinks . /tmp/linux-clone
docker run --rm -v /tmp/linux-clone:/work/kodo -w /work/kodo node:20-bookworm-slim sh -c '
  apt-get update -qq && apt-get install -y -qq git procps
  npm ci --silent
  chown -R node:node /work/kodo /home/node
  su node -c "cd /work/kodo && export HOME=/home/node && npm test"
'
```

El directorio de montaje **debe** llamarse `kodo` mientras el hallazgo de
`install.test.js` (F1-2) siga abierto.
