#!/usr/bin/env python3 -I
"""Limpieza segura de worktrees de sesión de kodo (`<repo>/.claude/worktrees/<id>`).

Un worktree se borra (con su rama local) solo si se cumplen las cuatro condiciones:

  1. tarea   — la tarea de la sesión está en Done o Cancelled en Plane.
  2. commits — la rama no tiene commits propios: `rev-list --count <base>..HEAD` es 0
               contra la rama principal de algún remoto, recién traída con `git fetch`.
  3. limpio  — sin modificados ni sin seguimiento; los ignorados cuentan salvo los
               regenerables (node_modules, tmp, log, .venv…).
  4. sesión  — ni fila en `sessions` de state.json, ni worktree `locked`, ni proceso
               con el cwd dentro.

Falla cerrado: si una condición no se puede comprobar (tarea sin identificar, Plane
caído, remoto inaccesible, lsof sin salida) el worktree se conserva y se dice por qué.

La tarea se identifica por el nombre del directorio (= session_id, sin el sufijo
`.dirty` que pone `cleanupWorktree` a los sucios) en `sessions` e
`history` de ~/.kodo/state.json y, si ya salió de history, en el `session.start` de
~/.kodo/logs/<session_id>.ndjson.

Uso: python3 -I sessions.py [--apply] [--repo PATH ...]
  sin --apply  simulación: lista veredictos, no borra nada.
  --repo       repos a revisar (por defecto, los de ~/.kodo/projects.json).

Plane: $PLANE_API_KEY, $PLANE_BASE_URL y $PLANE_WORKSPACE_SLUG; lo que falte se toma
del servidor MCP `plane` de ~/.claude.json.
"""
import argparse
import json
import os
import subprocess
import sys
import urllib.error
import urllib.request

HOME = os.path.expanduser("~")
KODO = os.path.join(HOME, ".kodo")
DONE_GROUPS = ("completed", "cancelled")
REGENERABLE_DIRS = {
    "node_modules", "tmp", "log", "logs", ".venv", "venv", "__pycache__", ".pytest_cache",
    ".mypy_cache", ".ruff_cache", ".cache", "coverage", ".next", ".turbo", ".parcel-cache",
    ".sass-cache", "vendor", ".bundle", "builds", "dist", "build", ".ruby-lsp",
}
REGENERABLE_SUFFIXES = (".pyc", ".log", ".DS_Store")


def sh(cmd, cwd=None, timeout=60):
    try:
        r = subprocess.run(cmd, cwd=cwd, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout.rstrip(), r.stderr.strip()  # rstrip: porcelain empieza por espacio
    except (OSError, subprocess.TimeoutExpired) as e:
        return 1, "", str(e)


def git(repo, *args, timeout=60):
    return sh(["git", "-C", repo, *args], timeout=timeout)


def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


# ---------------------------------------------------------------- repos

def project_paths(projects):
    """{project_id: [paths]} desde projects.json (valor str o {default, modules})."""
    out = {}
    for pid, v in projects.items():
        if isinstance(v, str):
            out[pid] = [v]
        elif isinstance(v, dict):
            out[pid] = [v.get("default")] + list((v.get("modules") or {}).values())
    return {pid: [os.path.normpath(p) for p in ps if p] for pid, ps in out.items()}


def repo_root(path):
    code, common, _ = git(path, "rev-parse", "--path-format=absolute", "--git-common-dir")
    if code != 0 or not common:
        return None
    return os.path.dirname(os.path.realpath(common)) if os.path.basename(common) == ".git" else None


def fetch_bases(repo):
    """Trae cada remoto y devuelve (bases, fallos): bases = refs de su rama principal."""
    bases, failed = [], []
    _, remotes, _ = git(repo, "remote")
    for r in remotes.split():
        code, _, err = git(repo, "fetch", "--quiet", r, timeout=120)
        if code != 0:
            failed.append(f"{r} ({(err.splitlines() or ['?'])[-1][:80]})")
            continue
        code, head, _ = git(repo, "symbolic-ref", "--short", f"refs/remotes/{r}/HEAD")
        candidates = [head] if code == 0 and head else [f"{r}/main", f"{r}/master"]
        for c in candidates:
            if git(repo, "rev-parse", "--verify", "--quiet", f"refs/remotes/{c}")[0] == 0:
                bases.append(c)
                break
    return bases, failed


def list_worktrees(repo):
    code, out, err = git(repo, "worktree", "list", "--porcelain")
    if code != 0:
        raise RuntimeError(err or "git worktree list falló")
    wts, cur = [], {}
    for line in out.splitlines() + [""]:
        if not line:
            if cur:
                wts.append(cur)
            cur = {}
            continue
        key, _, val = line.partition(" ")
        cur[key] = val or True
    parent = os.path.join(repo, ".claude", "worktrees")
    return [w for w in wts if os.path.dirname(os.path.realpath(w["worktree"])) == os.path.realpath(parent)]


# ---------------------------------------------------------------- condiciones

def live_cwds():
    """cwd de todos los procesos (lsof). None si no se puede saber."""
    _, out, _ = sh(["lsof", "-nP", "-w", "-d", "cwd", "-F", "n"], timeout=60)
    cwds = {line[1:] for line in out.splitlines() if line.startswith("n/")}
    return cwds or None


def check_session(wt, sid, state, cwds):
    path = os.path.realpath(wt["worktree"])
    for s in state.get("sessions", {}).values():
        if s.get("session_id") == sid or (s.get("worktree_path") and os.path.realpath(s["worktree_path"]) == path):
            return f"sesión viva en state.json ({s.get('task_ref', '?')})"
    if "locked" in wt:
        reason = wt["locked"] if isinstance(wt["locked"], str) else ""
        return f"worktree locked {reason}".strip()
    if cwds is None:
        return "no se pudo listar procesos (lsof)"
    hits = [c for c in cwds if c == path or c.startswith(path + os.sep)]
    if hits:
        return f"proceso con cwd dentro ({len(hits)})"
    return None


def regenerable(rel):
    rel = rel.rstrip("/")
    parts = rel.split("/")
    return any(p in REGENERABLE_DIRS for p in parts) or rel.endswith(REGENERABLE_SUFFIXES)


def check_clean(wt):
    code, out, err = git(wt["worktree"], "status", "--porcelain", "--ignored")
    if code != 0:
        return f"git status falló: {err[:80]}"
    dirty, kept = [], []
    for line in out.splitlines():
        flag, rel = line[:2], line[3:]
        if flag == "!!":
            if not regenerable(rel):
                kept.append(rel)
        else:
            dirty.append(rel)
    if dirty:
        return f"sucio: {len(dirty)} sin commit ({', '.join(dirty[:3])})"
    if kept:
        return f"ignorados no regenerables: {', '.join(kept[:3])}" + (" …" if len(kept) > 3 else "")
    return None


def check_commits(wt, bases, failed):
    if not bases:
        return "no se pudo traer ningún remoto" + (f": {'; '.join(failed)}" if failed else " (sin remotos)")
    counts = []
    for b in bases:
        code, n, _ = git(wt["worktree"], "rev-list", "--count", f"{b}..HEAD")
        if code == 0 and n.isdigit():
            if int(n) == 0:
                return None
            counts.append(f"{n} sobre {b}")
    return "commits propios: " + (", ".join(counts) or "rev-list falló")


# ---------------------------------------------------------------- tarea

def identify(sid, state):
    """(task_id, task_ref, [project_id] o None) para un session_id, o None."""
    for s in state.get("sessions", {}).values():
        if s.get("session_id") == sid:
            return s.get("task_id"), s.get("task_ref"), [s["project_id"]] if s.get("project_id") else None
    for h in reversed(state.get("history", [])):
        if h.get("session_id") == sid:
            return h.get("task_id"), h.get("task_ref"), [h["project_id"]] if h.get("project_id") else None
    try:
        with open(os.path.join(KODO, "logs", f"{sid}.ndjson")) as f:
            for line in f:
                try:
                    ev = json.loads(line)
                except ValueError:
                    continue
                if ev.get("event") == "session.start" and ev.get("session_id") == sid and ev.get("task_id"):
                    return ev["task_id"], ev.get("task_ref"), None
    except OSError:
        pass
    return None


class Plane:
    def __init__(self):
        mcp = load_json(os.path.join(HOME, ".claude.json"), {}).get("mcpServers", {}).get("plane", {}).get("env", {})
        self.key = os.environ.get("PLANE_API_KEY") or mcp.get("PLANE_API_KEY")
        base = os.environ.get("PLANE_BASE_URL") or mcp.get("PLANE_BASE_URL")
        slug = os.environ.get("PLANE_WORKSPACE_SLUG") or mcp.get("PLANE_WORKSPACE_SLUG")
        self.base = f"{base.rstrip('/')}/api/v1/workspaces/{slug}" if base and slug else None
        self.states, self.idents = {}, None

    def get(self, path):
        if not (self.key and self.base):
            raise RuntimeError("sin PLANE_API_KEY / PLANE_BASE_URL / PLANE_WORKSPACE_SLUG")
        req = urllib.request.Request(f"{self.base}/{path}", headers={"X-API-Key": self.key})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)

    def all(self, path):
        res, cursor = [], None
        while True:
            d = self.get(f"{path}?per_page=100" + (f"&cursor={cursor}" if cursor else ""))
            res.extend(d.get("results", []))
            if not d.get("next_page_results"):
                return res
            cursor = d["next_cursor"]

    def state_of(self, pid, tid):
        """(group, nombre, ref) de la tarea; None si no existe en ese proyecto."""
        try:
            item = self.get(f"projects/{pid}/work-items/{tid}/")
        except urllib.error.HTTPError as e:
            if e.code == 404:
                return None
            raise
        if pid not in self.states:
            self.states[pid] = {s["id"]: s for s in self.all(f"projects/{pid}/states/")}
        if self.idents is None:
            self.idents = {p["id"]: p["identifier"] for p in self.all("projects/")}
        st = self.states[pid].get(item.get("state"), {})
        ref = f"{self.idents.get(pid, '?')}-{item.get('sequence_id')}"
        return st.get("group"), st.get("name", "?"), ref


def check_task(sid, state, plane, repo_pids):
    """(motivo_de_fallo o None, etiqueta de tarea)."""
    ident = identify(sid, state)
    if not ident or not ident[0]:
        return "tarea no identificada", "?"
    tid, ref, pids = ident
    label = ref or tid[:8]
    try:
        for pid in pids or repo_pids:
            found = plane.state_of(pid, tid)
            if found:
                group, name, pref = found
                label = f"{ref or pref} ({name})"
                return (None if group in DONE_GROUPS else f"tarea en {name}"), label
    except (OSError, ValueError, RuntimeError, KeyError) as e:
        return f"Plane no responde: {str(e)[:80]}", label
    return "tarea no encontrada en Plane", label


# ---------------------------------------------------------------- main

def remove(repo, wt):
    path, branch = wt["worktree"], wt.get("branch", "")
    code, _, err = git(repo, "worktree", "remove", path)
    if code != 0:
        return f"git worktree remove falló: {err[:120]}"
    if branch.startswith("refs/heads/"):
        code, _, err = git(repo, "branch", "-D", branch[len("refs/heads/"):])
        if code != 0:
            return f"worktree borrado, rama no: {err[:120]}"
    git(repo, "worktree", "prune")
    return None


def main():
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--apply", action="store_true", help="borrar los que cumplen las cuatro condiciones")
    ap.add_argument("--repo", action="append", help="repo a revisar (repetible)")
    args = ap.parse_args()

    state = load_json(os.path.join(KODO, "state.json"), None)
    if state is None:
        print(f"error: no se puede leer {KODO}/state.json; no se toca nada", file=sys.stderr)
        return 2
    pmap = project_paths(load_json(os.path.join(KODO, "projects.json"), {}))

    asked = [os.path.normpath(os.path.abspath(p)) for p in args.repo or []]
    roots = {p: repo_root(p) for p in {p for ps in pmap.values() for p in ps} | set(asked) if os.path.isdir(p)}
    wanted = {roots.get(p) for p in asked} if asked else set(roots.values())
    repos = {r: [pid for pid, ps in pmap.items() if any(roots.get(p) == r for p in ps)] for r in wanted if r}

    cwds, plane = live_cwds(), Plane()
    mode = "APLICANDO" if args.apply else "SIMULACIÓN (sin --apply no se borra nada)"
    print(f"# Worktrees de sesión · {mode}\n")
    totals = []
    for repo in sorted(repos):
        name = os.path.basename(repo)
        try:
            wts = list_worktrees(repo)
        except RuntimeError as e:
            print(f"## {name}: error listando worktrees: {e}\n")
            continue
        if not wts:
            continue
        bases, failed = fetch_bases(repo)
        print(f"## {name} · bases: {', '.join(bases) or 'ninguna'}" + (f" · remotos caídos: {'; '.join(failed)}" if failed else ""))
        ok = kept = 0
        for wt in wts:
            name_dir = os.path.basename(wt["worktree"])
            sid = name_dir.removesuffix(".dirty")  # cleanupWorktree de kodo mueve los sucios a <sid>.dirty
            branch = wt.get("branch", "(detached)").replace("refs/heads/", "")
            reason1, task = check_task(sid, state, plane, repos[repo])
            reasons = [r for r in (
                reason1,
                check_commits(wt, bases, failed),
                check_clean(wt),
                check_session(wt, sid, state, cwds),
            ) if r]
            if reasons:
                verdict = "SE CONSERVA"
            elif args.apply:
                err = remove(repo, wt)
                verdict, reasons = ("BORRADO", []) if not err else ("SE CONSERVA", [err])
            else:
                verdict = "BORRABLE"
            ok, kept = (ok + 1, kept) if verdict in ("BORRABLE", "BORRADO") else (ok, kept + 1)
            print(f"- {name_dir} · {branch} · {task} · **{verdict}**" + (f" · {' | '.join(reasons)}" if reasons else ""))
        verb = "borrados" if args.apply else "borrables"
        print(f"  → {ok} {verb}, {kept} se conservan\n")
        totals.append((name, ok, kept))
    if totals:
        print("## Resumen")
        for name, ok, kept in totals:
            print(f"- {name}: {ok} {'borrados' if args.apply else 'borrables'}, {kept} se conservan")
    return 0


if __name__ == "__main__":
    sys.exit(main())
