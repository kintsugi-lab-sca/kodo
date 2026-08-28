# typed: false
# frozen_string_literal: true
#
# kodo Homebrew formula — Phase 66 (DIST-01, DIST-02, D-05 LOCKED).
#
# In-tree source of the formula: EXACT mirror of the `Formula/kodo.rb` path in the
# `kintsugi-lab-sca/homebrew-kodo` tap (owner confirmed by the operator during the spike, D-05).
# It is kept here so it stays lintable/reviewable inside the kodo tree; the real
# `brew install` + `brew services` cycle (not unit-testable) is validated at the
# Plan 66-04 checkpoint.
#
# VERIFIED canonical form (docs.brew.sh Node-for-Formula-Authors +
# docs.brew.sh/rubydoc/Homebrew/Service.html), corrected against what actually shipped in
# Phase 65: the supervised foreground entrypoint is `kodo daemon run` (a hidden
# subcommand in cli.js), NEVER the top-level interactive command (which self-detaches).
class Kodo < Formula
  desc "Automated Claude Code sessions from task-management systems"
  homepage "https://github.com/kintsugi-lab-sca/kodo"
  url "https://github.com/kintsugi-lab-sca/kodo/archive/refs/tags/v0.19.0.tar.gz"
  sha256 "d182f4b6910d480c19bce7965f1f81aac766cd7f2fc7720b3aec4ed7f829d706"
  license "MIT"

  # depends_on node (satisfies package.json's ">=20" engines). The runtime is NOT
  # bundled: Node is a system dependency, not an embedded binary (D-05).
  depends_on "node"

  def install
    # std_npm_args WITHOUT `prefix: false` = CLI-app form: installs the package + deps
    # into libexec (isolated node_modules), with the executables in libexec/bin.
    system "npm", "install", *std_npm_args
    # Exposes `kodo` on Homebrew's PATH via a symlink, keeping node_modules
    # isolated in libexec (no global pollution).
    bin.install_symlink libexec.glob("bin/*")
  end

  # Homebrew renders the launchd plist from this `service do` block — NEVER hand-write
  # `def plist` / XML (deprecated, fragile across /opt/homebrew and Intel).
  service do
    # CRITICAL (Pitfall 6, load-bearing): the process launchd supervises MUST be the
    # `daemon run` foreground entrypoint. The self-detaching interactive command never goes
    # here: it detaches itself, the shim exits 0 instantly and launchd + keep_alive
    # would enter a crash loop (~10s ThrottleInterval). `opt_bin` is the STABLE path
    # that resolves Apple Silicon (/opt/homebrew) vs Intel (/usr/local) per architecture.
    run [opt_bin/"kodo", "daemon", "run"]
    keep_alive true                    # launchd restarts the daemon if it dies (it is the supervisor)
    log_path var/"log/kodo.log"        # launchd does NOT inherit your terminal → capture stdout
    error_log_path var/"log/kodo.log"  # the same file preserves chronological interleaving
    working_dir var                    # cosmetic; kodo reads ~/.kodo by absolute path
    # The plist's environment-variables block is deliberately OMITTED: secrets
    # live in ~/.kodo/.env (0600), loaded at runtime by config.js. The
    # plist is world-readable under ~/Library/LaunchAgents → never put secrets there
    # (PERSIST-04 / T-66-08 boundary).
  end

  def caveats
    <<~EOS
      Under `brew services`, kodo runs in SERVER-ONLY mode (webhook + polling): it reacts
      to triggers from your task manager in the background. The functions coupled to cmux
      (session liveness and adoption) do NOT operate under launchd, because cmux is not
      reachable in the service's headless context.

      For the full (cmux-aware) mode, launch from a terminal INSIDE a cmux session:
        kodo up

      Secrets are read from ~/.kodo/.env (never from the plist). Config: `kodo config` or `kodo up`
      (dashboard setup, coming soon).
    EOS
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/kodo --version")
  end
end
