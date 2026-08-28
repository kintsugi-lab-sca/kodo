# kodo Homebrew distribution

kodo is distributed through a **Homebrew tap**. This directory holds the **in-tree
mirror** of the formula (`Formula/kodo.rb`), lintable and versioned alongside the code.
The formula `brew` actually reads lives in a **separate** repo:

- **Tap (what `brew` reads):** `kintsugi-lab-sca/homebrew-kodo` → `Formula/kodo.rb`
  - Users: `brew tap kintsugi-lab-sca/kodo && brew install kodo`
- **Source (where the tarball comes from):** `kintsugi-lab-sca/kodo` — **must be PUBLIC**
  (Homebrew downloads the tarball **anonymously**; a private repo returns 404).

## ⚠ Release invariant (must not be missed)

> **`brew` NEVER follows `main`.** Homebrew users only get what is in the
> **tag** referenced by the `url` of the tap's formula. A code change does NOT reach
> brew users until a **new tag is cut AND the tap's formula is updated**
> (`url` + `sha256`).

Every time you want a change to reach `brew` users, perform the full ritual:

### Release ritual (for every published version)

1. **Version bump** in `package.json` (`kodo --version` reads it via commander, and the
   formula's `test do` asserts `kodo --version` == the tag's version).
2. **Commit + tag + push** to the public source repo:
   ```bash
   git tag -a vX.Y.Z -m "vX.Y.Z <summary>"
   git push kintsugi main
   git push kintsugi vX.Y.Z          # GitHub generates the tarball at /archive/refs/tags/vX.Y.Z.tar.gz
   ```
3. **sha256** of the tarball (requires the source repo to be PUBLIC):
   ```bash
   curl -sL https://github.com/kintsugi-lab-sca/kodo/archive/refs/tags/vX.Y.Z.tar.gz | shasum -a 256
   ```
4. **Update the TAP's formula** (`kintsugi-lab-sca/homebrew-kodo` → `Formula/kodo.rb`):
   - `url` → the new `vX.Y.Z` tag
   - `sha256` → the hash from step 3
   - If anything else in the formula changed (deps, service block), **copy it from this
     in-tree mirror** (`packaging/homebrew/Formula/kodo.rb`) and then adjust `url`/`sha256`.
   ```bash
   cd <clone>/homebrew-kodo && git commit -am "kodo vX.Y.Z" && git push
   ```
5. **Users update:** `brew update && brew upgrade kodo`.

### Minimum checklist before announcing a release
- [ ] `package.json` version == tag (without the `v`).
- [ ] Source repo **public** and tag pushed (anonymous tarball returns 200).
- [ ] Tap formula with the new tag's `url` + a real `sha256` (not `0000…`).
- [ ] **`sha256` ALWAYS computed** with `curl -sL …/archive/refs/tags/<tag>.tar.gz | shasum -a 256` at release time — **never reuse** a previous value (a wrong sha gives `SHA-256 mismatch` on a clean install; the GitHub archive tarball is stable, so the freshly computed value is the correct one).
- [ ] `service do` invokes `kodo daemon run` — **NEVER `kodo up`** (launchd foreground trap).
- [ ] No `environment_variables` in the plist (secrets only in `~/.kodo/.env`).

## Execution modes (spike scoping decision, Phase 66)

kodo has two ways to start, with different scope:

- **`brew services start kodo`** (launchd, at login) → **SERVER-ONLY mode**: webhook + polling reacting to triggers in the background. The functions coupled to **cmux** (session liveness/adoption) are **inert** — cmux is not reachable in launchd's headless context. The daemon degrades cleanly (never-throws; cmux noise no longer pollutes the log — gaps 66-05/66-06).
- **`kodo up`** from a terminal INSIDE a cmux session → **full cmux-aware mode**: daemon in the background + dashboard as the viewer, with liveness/adoption operational.

Rule: if you depend on the cmux features, use `kodo up`; `brew services` is for the unattended server/webhook role.

## Environment notes (macOS)

- **PATH shadow:** if you have a `kodo` in `~/.npm-global/bin` or `~/.local/bin`, `kodo`
  by name may NOT invoke the Homebrew one. Check with `which -a kodo`; use the absolute
  path `$(brew --prefix)/opt/kodo/bin/kodo` when you want brew's.
- **`node` under launchd:** `bin/kodo` uses the shebang `#!/usr/bin/env node`. Under `brew
  services`, launchd runs with a minimal PATH. If `var/log/kodo.log` shows
  `env: node: No such file or directory`, add to the formula
  `EnvironmentVariables { "PATH" => "#{Formula["node"].opt_bin}:#{ENV["PATH"]}" }`
  (open question A1 from the Phase 66 spike).

## Future (automation, non-blocking)
This ritual is a candidate for a `scripts/release.sh` or a GitHub Action that: bumps the
version, cuts the tag, computes the sha256 and opens a PR to the tap automatically — so that
"push the tag and feed the formula" stops being manual. Deferred; documented here
while it remains manual.
