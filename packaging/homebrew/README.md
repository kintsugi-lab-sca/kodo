# Distribución Homebrew de kodo

kodo se distribuye por un **tap de Homebrew**. Este directorio contiene el **espejo
in-tree** de la fórmula (`Formula/kodo.rb`), lintable y versionado junto al código.
La fórmula que `brew` realmente lee vive en un repo **separado**:

- **Tap (lo que lee `brew`):** `kintsugi-lab-sca/homebrew-kodo` → `Formula/kodo.rb`
  - Usuarios: `brew tap kintsugi-lab-sca/kodo && brew install kodo`
- **Fuente (de donde sale el tarball):** `kintsugi-lab-sca/kodo` — **debe ser PÚBLICO**
  (Homebrew descarga el tarball de forma **anónima**; un repo privado da 404).

## ⚠ Invariante de release (NO se nos puede pasar)

> **`brew` NUNCA sigue `main`.** Los usuarios de Homebrew solo reciben lo que hay en el
> **tag** referenciado por la `url` de la fórmula del tap. Un cambio de código NO llega
> a los usuarios de brew hasta que se **corta un tag nuevo Y se actualiza la fórmula del
> tap** (`url` + `sha256`).

Cada vez que quieras que un cambio llegue a los usuarios de `brew`, haz el ritual completo:

### Ritual de release (por cada versión que se publique)

1. **Bump de versión** en `package.json` (`kodo --version` lo lee vía commander, y el
   `test do` de la fórmula asierta `kodo --version` == versión del tag).
2. **Commit + tag + push** al repo fuente público:
   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z <resumen>"
   git push kintsugi main
   git push kintsugi vX.Y.Z          # GitHub genera el tarball en /archive/refs/tags/vX.Y.Z.tar.gz
   ```
3. **sha256** del tarball (requiere el repo fuente PÚBLICO):
   ```bash
   curl -sL https://github.com/kintsugi-lab-sca/kodo/archive/refs/tags/vX.Y.Z.tar.gz | shasum -a 256
   ```
4. **Actualizar la fórmula del TAP** (`kintsugi-lab-sca/homebrew-kodo` → `Formula/kodo.rb`):
   - `url` → el nuevo tag `vX.Y.Z`
   - `sha256` → el hash del paso 3
   - Si cambió algo más de la fórmula (deps, service block), **copia desde este espejo
     in-tree** (`packaging/homebrew/Formula/kodo.rb`) y luego ajusta `url`/`sha256`.
   ```bash
   cd <clone>/homebrew-kodo && git commit -am "kodo vX.Y.Z" && git push
   ```
5. **Usuarios actualizan:** `brew update && brew upgrade kodo`.

### Checklist mínimo antes de anunciar una release
- [ ] `package.json` version == tag (sin la `v`).
- [ ] Repo fuente **público** y tag pusheado (tarball 200 anónimo).
- [ ] Fórmula del tap con `url` del tag nuevo + `sha256` real (no `0000…`).
- [ ] **`sha256` calculado SIEMPRE** con `curl -sL …/archive/refs/tags/<tag>.tar.gz | shasum -a 256` en el momento del release — **nunca reusar** un valor previo (un sha equivocado da `SHA-256 mismatch` en instalación limpia; el tarball de GitHub archive es estable, así que el valor recién calculado es el bueno).
- [ ] `service do` invoca `kodo daemon run` — **NUNCA `kodo up`** (launchd foreground trap).
- [ ] En `environment_variables` del plist **solo** `PATH` — cero secretos (viven en `~/.kodo/.env`).
- [ ] `brew style` y `brew audit` limpios sobre la fórmula del tap.

## Modo de ejecución (decisión de alcance del spike, Phase 66)

kodo tiene dos formas de arrancar, con alcance distinto:

- **`brew services start kodo`** (launchd, login) → **modo SERVER-ONLY**: webhook + polling reaccionando a triggers en segundo plano. Las funciones acopladas a **cmux** (liveness/adopción de sesiones) quedan **inertes** — cmux no es alcanzable en el contexto headless de launchd. El daemon degrada limpio (never-throws; el ruido de cmux ya no contamina el log — gaps 66-05/66-06).
- **`kodo up`** desde una terminal DENTRO de una sesión cmux → **modo pleno cmux-aware**: daemon en background + dashboard como visor, con liveness/adopción operativas.

Regla: si dependes de las features de cmux, usa `kodo up`; `brew services` es para el rol server/webhook desatendido.

## Notas de entorno (macOS)

- **PATH shadow:** si tienes un `kodo` en `~/.npm-global/bin` o `~/.local/bin`, `kodo`
  por nombre puede NO invocar el de Homebrew. Verifica con `which -a kodo`; usa la ruta
  absoluta `$(brew --prefix)/opt/kodo/bin/kodo` cuando quieras el de brew.
- **PATH bajo launchd (A1, CERRADO):** launchd no hereda el PATH del login shell — un
  LaunchAgent arranca con `/usr/bin:/bin:/usr/sbin:/sbin` y ahí no hay nada de Homebrew.
  La fórmula lo resuelve declarando el PATH en el plist:
  ```ruby
  environment_variables PATH: "#{formula_opt_bin("node")}:#{std_service_path_env}"
  ```
  Dos precisiones sobre cómo estaba planteado A1:
  - **El shebang NO era el problema.** `bin/kodo` usa `#!/usr/bin/env node` en el árbol
    fuente, pero `npm install` reescribe el shebang al intérprete absoluto: el fichero
    instalado queda con `#!/opt/homebrew/opt/node/bin/node`. Con el PATH mínimo de launchd
    el shim arranca igual (verificado, exit 0) — el `env: node: No such file or directory`
    que se temía no se materializa por esa vía.
  - **El PATH sigue siendo load-bearing** por los subprocesos que el daemon resuelve por
    nombre: `git` (worktrees de sesión) y `claude` (D-15). Sin la línea solo se alcanza
    `/usr/bin/git`, y solo con las Xcode CLT instaladas.

  La sintaxis de la nota original (`EnvironmentVariables { "PATH" => … }`) no es válida
  dentro de `service do`: `EnvironmentVariables` es la clave del **plist**, que Homebrew
  renderiza a partir del método `environment_variables`. Y no se usa `ENV["PATH"]`, que
  hornearía el PATH de quien renderiza el plist (nvm, rbenv, shims) en vez de uno estable.

## Futuro (automatización, no bloqueante)
Este ritual es candidato a un `scripts/release.sh` o un GitHub Action que: bumpee la
versión, corte el tag, compute el sha256 y abra un PR al tap automáticamente — para que
"subir el tag y alimentar la fórmula" deje de ser manual. Diferido; documentado aquí
mientras sea manual.
