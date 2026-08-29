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
  url "https://github.com/kintsugi-lab-sca/kodo/archive/refs/tags/v0.22.0.tar.gz"
  sha256 "a8020ada2deec498fd1cbe4a61363103aed9365c157d0a23f132fc5a61d03a7f"
  license "MIT"

  # Node satisfies package.json's ">=22" engines. The runtime is NOT bundled: it is a
  # system dependency, not an embedded binary (D-05).
  #
  # KODO-65 caveat: the `node` formula tracks the newest release line, so a `brew install`
  # can hand kodo a Node newer than the CI matrix (22 and 24). Left unpinned on purpose —
  # `engines` is open-ended and pinning `node@24` here would drag the service block's
  # `formula_opt_bin("node")` with it. If a Node-version regression ever ships through the
  # brew route, pin BOTH together.
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
    # PATH (closes A1). launchd does NOT inherit the login shell's PATH: a LaunchAgent
    # starts with the bare minimum `/usr/bin:/bin:/usr/sbin:/sbin` (verified: `launchctl
    # getenv PATH` is empty) → NO Homebrew binary is reachable by name.
    #
    # A1 was framed as "bin/kodo's `#!/usr/bin/env node` shebang cannot find
    # node". That is true in the SOURCE TREE but NOT in the installation: `npm install`
    # rewrites the bin's shebang to the absolute interpreter, and the installed file
    # ends up with `#!/opt/homebrew/opt/node/bin/node`. Checked against the installed
    # shim under launchd's minimal PATH: it starts, exit 0. The crash loop
    # A1 feared does not materialise along that route.
    #
    # The line stays anyway because PATH IS load-bearing for the daemon,
    # which resolves subprocesses by NAME: `execFileSync('git', …)` when preparing
    # session worktrees (session/manager.js) and `claude` via PATH (D-15). With
    # launchd's PATH only `/usr/bin/git` would be reachable (and only with the Xcode CLT
    # installed); nothing from HOMEBREW_PREFIX/bin. Adding node's keg also covers
    # the shebang should it ever be installed without npm's rewrite.
    #
    # `formula_opt_bin("node")` is the keg's STABLE path (…/opt/node/bin, immune to
    # version bumps) and only composes the path — unlike
    # `Formula["node"].opt_bin` it does not instantiate the formula (Homebrew/FormulaPathMethods cop).
    # `ENV["PATH"]` is NOT used (the form the original note suggested): it is evaluated when
    # rendering the plist and would bake in the PATH of whoever ran `brew services` (nvm,
    # rbenv, Homebrew shims) → a plist that is not reproducible across machines.
    environment_variables PATH: "#{formula_opt_bin("node")}:#{std_service_path_env}"
    # ONLY PATH lives here. NO secret goes into the plist: they live in ~/.kodo/.env
    # (0600), loaded at runtime by config.js. The plist is world-readable under
    # ~/Library/LaunchAgents (PERSIST-04 / T-66-08 boundary).
  end

  # KODO-61: the caveats do NOT claim kodo is macOS-only — the daemon runs on Linux too.
  # What is macOS-specific is THIS route: launchd, the plist, and cmux as a client. The
  # supported Linux route is npm + a systemd user unit (packaging/linux/README.md), so the
  # last paragraph names it instead of leaving a Linuxbrew user to guess.
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

      On Linux: this formula is not the supported route and has not been verified under
      Linuxbrew (launchd and the plist above are macOS; cmux does not ship for Linux, the
      client there is Orca). Install with npm and run it as a systemd user unit instead:
        npm install -g github:kintsugi-lab-sca/kodo#v#{version}
        kodo install --systemd
      Guide: https://github.com/kintsugi-lab-sca/kodo/blob/main/packaging/linux/README.md
    EOS
  end

  test do
    # 1) The shim starts and commander answers: installed version == the tag's version.
    assert_match version.to_s, shell_output("#{bin}/kodo --version")

    # 2) Smoke test of a REAL subcommand, not just commander's flag: `status` walks
    #    the dynamic-import graph (cli/stop-status → daemon/lifecycle → cli/format)
    #    and touches the FS, so a badly installed node_modules in libexec shows up here and not
    #    in production. `shell_output` without a second argument requires exit 0; `kodo status`
    #    guarantees it by contract (D-13: a status query never fails).
    #    `brew test` isolates HOME in a tmpdir (Formula#run_test), so there is no
    #    ~/.kodo with a PID file → the daemon reports idle and the human output is `stopped`,
    #    deterministic on any machine.
    assert_match "stopped", shell_output("#{bin}/kodo status")
  end
end
