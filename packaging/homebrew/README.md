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
- [ ] `service do` invoca `kodo daemon run` — **NUNCA `kodo up`** (launchd foreground trap).
- [ ] Sin `environment_variables` en el plist (secretos solo en `~/.kodo/.env`).

## Notas de entorno (macOS)

- **PATH shadow:** si tienes un `kodo` en `~/.npm-global/bin` o `~/.local/bin`, `kodo`
  por nombre puede NO invocar el de Homebrew. Verifica con `which -a kodo`; usa la ruta
  absoluta `$(brew --prefix)/opt/kodo/bin/kodo` cuando quieras el de brew.
- **`node` bajo launchd:** `bin/kodo` usa shebang `#!/usr/bin/env node`. Bajo `brew
  services`, launchd corre con un PATH mínimo. Si `var/log/kodo.log` muestra
  `env: node: No such file or directory`, añade a la fórmula
  `EnvironmentVariables { "PATH" => "#{Formula["node"].opt_bin}:#{ENV["PATH"]}" }`
  (open question A1 del spike de Phase 66).

## Futuro (automatización, no bloqueante)
Este ritual es candidato a un `scripts/release.sh` o un GitHub Action que: bumpee la
versión, corte el tag, compute el sha256 y abra un PR al tap automáticamente — para que
"subir el tag y alimentar la fórmula" deje de ser manual. Diferido; documentado aquí
mientras sea manual.
