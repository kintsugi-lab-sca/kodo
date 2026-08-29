# kodo en Linux — guía de instalación (Pop!_OS 22.04 / Ubuntu 22.04)

En Linux kodo se instala con **npm** y corre como **unidad systemd de usuario**. No hace
falta Homebrew: existe para Linux, pero exigirlo para instalar un paquete de npm es fricción
sin contrapartida.

| | macOS | Linux |
|---|---|---|
| Instalación | `brew install kodo` | `npm install -g` desde el tag |
| Servicio | launchd (`brew services`) | systemd de usuario (`kodo install --systemd`) |
| Proceso supervisado | `kodo daemon run` | `kodo daemon run` (**el mismo**) |
| Cliente de terminal | cmux u Orca | Orca (cmux es macOS-only) |

> **Estado de verificación.** Todo lo que hay abajo se ejecutó de arriba abajo en una
> **Ubuntu 22.04.5 LTS** limpia (systemd 249, aarch64, VM de OrbStack). Pop!_OS 22.04 es esa
> misma base. Lo que **no** se verificó está marcado con ⚠ allí donde aparece.

---

## 1. Node 22 o 24

Usa **NodeSource**, no nvm, si vas a correr kodo como servicio:

```bash
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs git
node --version   # v22.x
```

CI prueba **22 y 24** (suelo declarado en `engines` y LTS activa). Si prefieres la LTS activa,
cambia `setup_22.x` por `setup_24.x` — el resto de la guía es idéntico. Node 26 aún no se
prueba: pasa a LTS el 2026-10-28.

**Por qué NodeSource y no nvm:** la unidad systemd lleva un `PATH` explícito que incluye el
directorio del node con el que instalaste. Con nvm ese directorio es
`~/.nvm/versions/node/v22.22.0/bin` — **versionado**, así que el día que hagas `nvm install 24`
la unidad apunta a un node que ya no existe. Con NodeSource es `/usr/bin`, estable.

Si aun así usas nvm: funciona, pero **vuelve a correr `kodo install --systemd` después de cada
cambio de versión de node** — el instalador regenera el `PATH` con el node en curso.

## 2. npm global sin sudo

```bash
npm config set prefix ~/.local
echo 'export PATH="$HOME/.local/bin:$PATH"' >> ~/.bashrc
export PATH="$HOME/.local/bin:$PATH"
```

En Ubuntu, `~/.profile` ya añade `~/.local/bin` al PATH si el directorio existe; la línea de
`.bashrc` es el cinturón por si acaso.

## 3. Claude Code

```bash
npm install -g @anthropic-ai/claude-code
claude --version
```

kodo resuelve `claude` **por nombre**, a través del PATH. Por eso el PATH de la unidad
importa (§7).

## 4. Orca IDE — ojo con el nombre del binario

cmux es macOS-only, así que en Linux el host es [Orca](https://www.onorca.dev), que publica
build de Linux. Instálalo desde su web y **comprueba el nombre del binario**:

```bash
which -a orca-ide orca
```

> ⚠ **Trampa de Linux.** `orca` a secas es el **lector de pantalla de GNOME**, no el IDE. Si
> kodo apunta a `orca` no falla con ENOENT: **arranca otro programa**. Por eso el default en
> no-darwin es `orca-ide` (KODO-56, `src/platform-defaults.js`).

Si tu binario está en otro sitio, dile la ruta absoluta:

```bash
kodo config --set host=orca
kodo config --set orca.binary=/ruta/absoluta/a/orca-ide
```

⚠ La instalación de Orca en Linux no se verificó en esta guía (la VM de verificación no tiene
escritorio). Lo verificado es que kodo usa `orca-ide` como default fuera de macOS.

## 5. kodo

Desde un **tag**, nunca desde `main`:

```bash
npm install -g github:kintsugi-lab-sca/kodo#v0.21.0
kodo --version
which -a kodo     # → ~/.local/bin/kodo
```

(Verificado con `v0.21.0`. Sustituye por el tag que quieras instalar.)

## 6. Configuración — **antes** de arrancar el servicio

```bash
kodo check
```

En la primera ejecución abre el asistente: provider, `base_url`, `workspace_slug` y la API
key. Deja `~/.kodo/config.json` y `~/.kodo/.env` (0600).

### Elige cómo se entera esta máquina: webhook o polling

Son dos configuraciones, y solo una necesita secreto.

**A) Polling (recomendado si no tienes URL pública).** El daemon pregunta cada
`interval_s` por los work items en estado trigger asignados a esta API key. `~/.kodo/.env`
necesita **una sola** variable:

```bash
kodo config set polling.enabled true
cat ~/.kodo/.env
# PLANE_API_KEY=plane_api_...
```

Sin `KODO_WEBHOOK_SECRET_PLANE`, el daemon arranca con la ruta `/webhook` **desactivada**
(responde `503` a cualquier POST) y lo dice en el log al arrancar:

```
[kodo] webhook disabled: polling mode, no secret configured
```

**B) Webhook.** Necesitas que Plane alcance esta máquina (URL pública o túnel) y el secreto
del webhook, con el que se verifica la firma HMAC de cada evento:

```bash
printf 'KODO_WEBHOOK_SECRET_PLANE=%s\n' "$(openssl rand -hex 32)" >> ~/.kodo/.env
chmod 600 ~/.kodo/.env
```

Las dos a la vez es una combinación soportada: el lock de dispatch por `task_id` garantiza
que la tarea vista por los dos carriles se lanza una sola vez.

Si **no** hay secreto **ni** polling no queda ningún carril por el que llegue trabajo, y
`kodo daemon run` sale con código 1 nada más arrancar. `kodo install --systemd` avisa por
stderr en ese caso, nombrando la variable; no bloquea la instalación.

### Hooks de Claude Code

```bash
kodo install    # registra SessionStart / Stop / SessionEnd en ~/.claude/settings.json
```

Es una instalación **independiente** de la del servicio: `kodo install` (hooks) y
`kodo install --systemd` (unidad) no se implican.

## 7. El servicio systemd

```bash
kodo install --systemd
```

Qué hace, en orden: renderiza la unidad con las rutas **reales** de tu máquina, la escribe en
`~/.config/systemd/user/kodo.service` **solo si cambió**, `daemon-reload`, `reset-failed`,
`enable --now`, y `restart` si el fichero cambió y la unidad ya corría. Es **idempotente**:
volver a correrlo sin cambios dice `sin cambios` y no toca el fichero.

La unidad instalada (la plantilla revisable vive en
[`packaging/systemd/kodo.service`](../systemd/kodo.service)):

```ini
[Service]
Type=simple
ExecStart=/home/tu-usuario/.local/bin/kodo daemon run
Restart=always
RestartSec=5
Environment=PATH=/usr/bin:/home/tu-usuario/.local/bin:/usr/local/bin:/bin
```

Tres cosas que **no** son decoración:

1. **`daemon run`, nunca el comando interactivo.** `kodo up` se auto-detacha: systemd vería
   un exit 0 inmediato y entraría en bucle de reinicios. `daemon run` está escrito para vivir
   supervisado (no hace doble fork, es dueño único de SIGTERM/SIGINT).
2. **El `PATH` es load-bearing.** systemd no hereda el PATH del shell de login. Lo necesitan
   el shebang `#!/usr/bin/env node` del binario de npm **y** los subprocesos que el daemon
   resuelve por nombre: `git` para los worktrees, `claude` para lanzar la sesión.
3. **Ningún secreto en la unidad.** El fichero es legible; las claves viven en `~/.kodo/.env`
   (0600) y las carga el runtime.

### Que sobreviva al logout

```bash
sudo loginctl enable-linger $USER
```

Sin linger, systemd tumba tu manager de usuario al cerrar sesión y el daemon se va con él.

⚠ La supervivencia a un logout real no se pudo verificar (la VM de verificación no tiene
sesiones de logind). Lo verificado es que `enable-linger` es lo que habilita `systemctl --user`
en un entorno sin sesión interactiva.

## 8. Comprobar que funciona

```bash
kodo status
# ✓ running pid: 3525
# systemd: ✓ active (enabled) kodo.service

curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:9090/health   # → 200
```

Dale ~15s tras arrancar antes de curlear `/health`: el server bindea **después** de resolver
el provider, y esos reintentos de red tardan.

Prueba de supervisión real:

```bash
kill -9 $(systemctl --user show -p MainPID --value kodo.service)
sleep 8
kodo status    # vuelve a estar running, con OTRO pid
```

## 9. Ciclo de vida diario

```bash
kodo status    # daemon + estado de la unidad
kodo stop      # para la unidad (NO manda SIGTERM al pid)
kodo up        # arranca la unidad si está parada y engancha el dashboard
journalctl --user-unit kodo.service -f
```

Los tres comandos saben que systemd manda, y no por cosmética:

- **`kodo stop`** va por `systemctl --user stop`. Un SIGTERM al pid no para nada: con
  `Restart=always`, systemd lo reinicia — y `kodo stop` habría reportado éxito con el daemon
  vivo.
- **`kodo up`** arranca la **unidad** en vez de spawnear un daemon detached. Si no, tendrías
  un proceso que systemd no conoce, y tu siguiente `systemctl --user start` moriría con
  EADDRINUSE contra tu propio daemon.
- **`kodo status`** añade la línea de systemd. La rama `--json` no cambia: sus claves están
  congeladas; el carril scriptable para systemd es `systemctl --user is-active kodo`.

## 10. Cómo llegan las tareas: webhook o polling

kodo tiene dos carriles de trigger, y en Linux el interesante suele ser el segundo:

- **Webhook (push).** Plane hace `POST` a tu `/webhook`. Necesita que tu máquina publique una
  URL alcanzable (túnel tipo cloudflared/Tailscale) y un webhook por operador.
- **Polling (pull).** El daemon pregunta a Plane cada N segundos. **Cero red entrante, cero
  túnel, cero configuración en Plane.** Es lo que KODO-60 habilitó para el provider Plane:

  ```bash
  kodo config --set polling.enabled=true
  ```

  La clave es de **primer nivel**, no `providers.plane.polling`: describe cómo se entera
  *esta máquina*, no cómo es el provider. Dos operadores del mismo Plane pueden ir uno por
  webhook y otro por polling sin que la config del provider difiera en nada.

Los dos pueden convivir sin duplicar lanzamientos. Para un portátil detrás de un router
doméstico —el caso de esta guía— **polling es la respuesta**.

Con polling activo el secreto del webhook deja de ser obligatorio (KODO-66): el daemon
arranca con `/webhook` apagado en vez de salir con 1. Ver §6 para las dos configuraciones.

## 11. Cuando algo va mal

**`kodo status` dice `systemd: ✗ failed`.** La unidad agotó su límite de arranques: 5 en 300s.
Casi siempre es configuración. Mira la causa y arregla:

```bash
journalctl --user-unit kodo.service -n 50 --no-pager
```

Si el journal dice `falta configuración` o el daemon sale con 1 sin más, revisa `~/.kodo/.env`
(§6): con polling activo basta con `PLANE_API_KEY`; sin polling hace falta además
`KODO_WEBHOOK_SECRET_PLANE`. Luego:

```bash
kodo install --systemd    # hace reset-failed y vuelve a arrancar
```

Un `systemctl --user start` a secas **no** funciona sobre una unidad en `failed`: systemd la
rechaza hasta que se limpia el contador. Por eso el instalador hace `reset-failed`.

**`journalctl --user -u kodo` dice «No journal files were found».** Usa `--user-unit`, que
filtra el journal del sistema en vez de exigir un journal por usuario:

```bash
journalctl --user-unit kodo.service -f
```

**`kodo: command not found` tras instalar.** `~/.local/bin` no está en tu PATH (§2). Comprueba
con `which -a kodo`.

**El servicio arranca pero no encuentra `git` o `claude`.** El PATH de la unidad se congeló en
la instalación. Regenéralo:

```bash
kodo install --systemd
grep ^Environment ~/.config/systemd/user/kodo.service
```

**Cambiaste de versión de node (nvm).** Lo mismo: `kodo install --systemd` y listo.

## 12. Actualizar y desinstalar

```bash
# actualizar a un tag nuevo
npm install -g github:kintsugi-lab-sca/kodo#v0.22.0
kodo install --systemd     # refresca la unidad y reinicia si hacía falta

# desinstalar el servicio
systemctl --user disable --now kodo.service
rm ~/.config/systemd/user/kodo.service
systemctl --user daemon-reload

# desinstalar kodo
npm uninstall -g kodo
kodo uninstall             # quita los hooks de Claude Code (antes de borrar el binario)
```

`~/.kodo/` (config, `.env`, logs, estado) **no se toca** en ninguno de los dos casos. Bórralo
a mano si quieres empezar de cero.

---

## Reproducir la verificación

systemd de usuario **no se puede verificar en un contenedor**: necesita PID 1 = systemd y un
manager de usuario. Hace falta una VM. Con OrbStack:

```bash
orb create ubuntu:22.04 kodo-linux
orb run -m kodo-linux sudo loginctl enable-linger "$USER"   # habilita systemctl --user sin sesión
```

Luego, dentro de la máquina, recorre los pasos 1→8 de esta guía. Los checks que cierran la
verificación:

| # | Comprobación | Esperado |
|---|---|---|
| 1 | `kodo install --systemd` con `.env` incompleto **y polling off** | avisa nombrando `KODO_WEBHOOK_SECRET_PLANE` |
| 2 | esperar ~100s con esa config | `is-active` → `failed`, `NRestarts` → 5 |
| 3 | completar `.env` + `kodo install --systemd` | recupera de `failed` → `active` |
| 4 | `kill -9 $MainPID` | resucita con otro pid en <10s |
| 5 | `curl /health` (tras ~15s) | `200`, escuchando en `127.0.0.1:9090` |
| 6 | `kodo stop` | `stopped vía systemd`, unidad `inactive`, **no** resucita |
| 7 | `kodo up` con la unidad parada | arranca la unidad; `MainPID` == el pid de `~/.kodo/kodo.pid` |
| 8 | `kodo install --systemd` dos veces seguidas | la segunda dice `sin cambios` |
| 9 | `polling.enabled=true` **sin** secreto + `systemctl --user start kodo` | sigue `active` pasados 60s; el journal dice `webhook disabled: polling mode` |

El check 7 es el que demuestra que no hay split-brain: el pid que ve systemd y el que ve kodo
son **el mismo proceso**.
