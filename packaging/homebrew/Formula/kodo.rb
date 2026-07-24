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
  url "https://github.com/kintsugi-lab-sca/kodo/archive/refs/tags/v0.18.0.tar.gz"
  sha256 "6c9251dbbeb4d476f470b44e89930966edea83ab992f79b83a2ced6add8c7542"
  license "MIT"

  # depends_on node (satisface engines ">=20" de package.json). NO se bundlea el
  # runtime: Node es dependencia del sistema, no un binario embebido (D-05).
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
    # Se OMITE deliberadamente el bloque de variables de entorno del plist: los
    # secretos viven en ~/.kodo/.env (0600), cargados en runtime por config.js. El
    # plist es world-readable en ~/Library/LaunchAgents → nunca meter secretos ahí
    # (boundary PERSIST-04 / T-66-08).
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
    assert_match version.to_s, shell_output("#{bin}/kodo --version")
  end
end
