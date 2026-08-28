# typed: false
# frozen_string_literal: true

#
# Fórmula Homebrew de kodo — Phase 66 (DIST-01, DIST-02, D-05 LOCKED).
#
# Fuente in-tree del formula: espejo EXACTO de la ruta `Formula/kodo.rb` del tap
# `kintsugi-lab-sca/homebrew-kodo` (owner confirmado por el operador en el spike, D-05).
# Se mantiene aquí para ser lintable/revisable en el árbol de kodo; el ciclo real de
# `brew install` + `brew services` (no unit-testable) se valida en el checkpoint del
# Plan 66-04.
#
# Forma canónica VERIFICADA (docs.brew.sh Node-for-Formula-Authors +
# docs.brew.sh/rubydoc/Homebrew/Service.html), corregida a la realidad enviada en
# Phase 65: el entrypoint foreground supervisado es `kodo daemon run` (subcomando
# hidden en cli.js), NUNCA el comando interactivo top-level (que se auto-desvincula).
class Kodo < Formula
  desc "Automated Claude Code sessions from task-management systems"
  homepage "https://github.com/kintsugi-lab-sca/kodo"
  url "https://github.com/kintsugi-lab-sca/kodo/archive/refs/tags/v0.19.0.tar.gz"
  sha256 "d182f4b6910d480c19bce7965f1f81aac766cd7f2fc7720b3aec4ed7f829d706"
  license "MIT"

  # Node satisface engines ">=20" de package.json. NO se bundlea el runtime: es
  # dependencia del sistema, no un binario embebido (D-05).
  depends_on "node"

  def install
    # std_npm_args SIN `prefix: false` = forma CLI-app: instala paquete + deps a
    # libexec (node_modules aislado), con los ejecutables en libexec/bin.
    system "npm", "install", *std_npm_args
    # Expone `kodo` en el PATH de Homebrew vía symlink, manteniendo node_modules
    # aislado en libexec (sin polución global).
    bin.install_symlink libexec.glob("bin/*")
  end

  # Homebrew renderiza el plist launchd desde este bloque `service do` — NUNCA se
  # escribe `def plist` / XML a mano (deprecado, frágil entre /opt/homebrew e Intel).
  service do
    # CRÍTICO (Pitfall 6, load-bearing): el proceso que launchd supervisa DEBE ser el
    # entrypoint foreground `daemon run`. El comando interactivo self-detach jamás va
    # aquí: se auto-desvincula, el shim sale 0 al instante y launchd + keep_alive
    # entraría en crash-loop (~10s ThrottleInterval). `opt_bin` es el path ESTABLE
    # que resuelve Apple Silicon (/opt/homebrew) vs Intel (/usr/local) por arquitectura.
    run [opt_bin/"kodo", "daemon", "run"]
    keep_alive true                    # launchd reinicia el daemon si muere (es el supervisor)
    log_path var/"log/kodo.log"        # launchd NO hereda tu terminal → captura stdout
    error_log_path var/"log/kodo.log"  # mismo fichero preserva interleaving cronológico
    working_dir var                    # cosmético; kodo lee ~/.kodo por path absoluto
    # PATH (cierre de A1). launchd NO hereda el PATH del login shell: un LaunchAgent
    # arranca con el mínimo `/usr/bin:/bin:/usr/sbin:/sbin` (verificado: `launchctl
    # getenv PATH` vacío) → NINGÚN binario de Homebrew es alcanzable por nombre.
    #
    # A1 se planteó como «el shebang `#!/usr/bin/env node` de bin/kodo no encuentra
    # node». Eso es cierto en el ÁRBOL FUENTE pero NO en la instalación: `npm install`
    # reescribe el shebang del bin al intérprete absoluto, y el fichero instalado
    # queda con `#!/opt/homebrew/opt/node/bin/node`. Comprobado sobre el shim
    # instalado con el PATH mínimo de launchd: arranca, exit 0. El crash-loop que
    # temía A1 no se materializa por esa vía.
    #
    # La línea se queda igualmente porque el PATH SÍ es load-bearing para el daemon,
    # que resuelve subprocesos por NOMBRE: `execFileSync('git', …)` al preparar los
    # worktrees de sesión (session/manager.js) y `claude` por PATH (D-15). Con el
    # PATH de launchd solo se alcanzaría `/usr/bin/git` (y solo con las Xcode CLT
    # instaladas); nada de HOMEBREW_PREFIX/bin. Añadir el keg de node cubre además
    # el shebang si alguna vez se instala sin la reescritura de npm.
    #
    # `formula_opt_bin("node")` es el path ESTABLE del keg (…/opt/node/bin, inmune a
    # bumps de versión) y solo compone la ruta — a diferencia de
    # `Formula["node"].opt_bin` no instancia la fórmula (cop Homebrew/FormulaPathMethods).
    # NO se usa `ENV["PATH"]` (la forma que sugería la nota original): se evalúa al
    # renderizar el plist y hornearía el PATH de quien corrió `brew services` (nvm,
    # rbenv, shims de Homebrew) → plist irreproducible entre máquinas.
    environment_variables PATH: "#{formula_opt_bin("node")}:#{std_service_path_env}"
    # SOLO PATH vive aquí. NINGÚN secreto entra en el plist: viven en ~/.kodo/.env
    # (0600), cargados en runtime por config.js. El plist es world-readable en
    # ~/Library/LaunchAgents (boundary PERSIST-04 / T-66-08).
  end

  def caveats
    <<~EOS
      Bajo `brew services`, kodo corre en modo SERVER-ONLY (webhook + polling): reacciona
      a triggers de tu gestor de tareas en segundo plano. Las funciones acopladas a cmux
      (liveness y adopción de sesiones) NO operan bajo launchd, porque cmux no es alcanzable
      en el contexto headless del servicio.

      Para el modo completo (cmux-aware), lanza desde una terminal DENTRO de una sesión cmux:
        kodo up

      Los secretos se leen de ~/.kodo/.env (nunca del plist). Config: `kodo config` o `kodo up`
      (setup en el dashboard, próximamente).
    EOS
  end

  test do
    # 1) El shim arranca y commander responde: versión instalada == versión del tag.
    assert_match version.to_s, shell_output("#{bin}/kodo --version")

    # 2) Smoke de un subcomando REAL, no solo del flag de commander: `status` recorre
    #    el grafo de imports dinámicos (cli/stop-status → daemon/lifecycle → cli/format)
    #    y toca el FS, así que un node_modules mal instalado en libexec se ve aquí y no
    #    en producción. `shell_output` sin segundo argumento exige exit 0; `kodo status`
    #    lo garantiza por contrato (D-13: una consulta de estado nunca falla).
    #    `brew test` aísla HOME en un tmpdir (Formula#run_test), así que no hay
    #    ~/.kodo con PID file → el daemon reporta idle y la salida humana es `stopped`,
    #    determinista en cualquier máquina.
    assert_match "stopped", shell_output("#{bin}/kodo status")
  end
end
