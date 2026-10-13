#!/usr/bin/env python3 -I
"""Recoge hechos para /kodo-catchup y los imprime en Markdown.

Fuentes, en orden de coste: ~/.kodo (state, inbox, handoff) → git/gh de cada
repo vinculado en projects.json → Plane REST → calendario (spark). Cada fuente
falla abierta: si no responde se imprime una línea «(no disponible: …)» y se
sigue. No escribe nada en ningún sitio.

Uso: python3 -I gather.py [--since YYYY-MM-DD] [--days 7]
  --since  ventana «qué ha pasado desde». Por defecto, la última actividad
           registrada en state.json (history) o el último handoff consumido.
  --days   horizonte hacia delante para fechas límite y calendario.
"""
import argparse
import datetime as dt
import json
import os
import re
import subprocess
import sys
import urllib.parse
import urllib.request

HOME = os.path.expanduser("~")
KODO = os.path.join(HOME, ".kodo")
CAP = 8  # máximo de filas por lista; la skill recorta a 5 al redactar


def sh(cmd, cwd=None, env=None, timeout=30):
    try:
        r = subprocess.run(cmd, cwd=cwd, env=env, capture_output=True, text=True, timeout=timeout)
        return r.returncode, r.stdout.strip(), r.stderr.strip()
    except (OSError, subprocess.TimeoutExpired) as e:
        return 1, "", str(e)


def load_json(path, default):
    try:
        with open(path) as f:
            return json.load(f)
    except (OSError, ValueError):
        return default


def parse_ts(s):
    if not s:
        return None
    try:
        return dt.datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None


# ---------------------------------------------------------------- local

def section_local(state, since):
    out = ["## Local (~/.kodo)"]
    code, body, _ = sh(["curl", "-s", "-m", "3", "http://127.0.0.1:9090/health"])
    out.append(f"- daemon: {'ok ' + body[:80] if code == 0 and body else 'NO responde en :9090'}")

    sessions = state.get("sessions", {})
    out.append(f"- sesiones vivas: {len(sessions)}")
    for tid, s in list(sessions.items())[:CAP]:
        out.append(f"  - {s.get('task_ref', tid)} · {s.get('status')} · {s.get('workspace_ref')} · desde {s.get('started_at', '?')[:16]}")

    unseen = [e for e in state.get("orchestrator_inbox", []) if not e.get("seen")]
    out.append(f"- inbox-orch sin ver: {len(unseen)}")
    for e in unseen[:CAP]:
        out.append(f"  - {e.get('ts', '')[:16]} {e.get('kind', '')} {e.get('task_ref', '')} · {str(e.get('text') or '')[:140]}")

    queue = [q for q in state.get("integration_queue", []) if q.get("status") in ("pending", "ready", "queued")]
    out.append(f"- cola de integración pendiente: {len(queue)}")
    for q in queue[:CAP]:
        out.append(f"  - {q.get('task_ref', '?')} · {q.get('status')} · {q.get('branch', '')}")

    hist = state.get("history", [])
    recent = [h for h in hist if (parse_ts(h.get("ended_at") or h.get("started_at")) or dt.datetime.min.replace(tzinfo=dt.timezone.utc)) >= since]
    out.append(f"- cierres en history desde la ventana: {len(recent)}")
    for h in recent[-CAP:]:
        out.append(f"  - {h.get('task_ref')} · {h.get('status')} · ended_by={h.get('ended_by', '?')}")

    # capturas sin triar
    try:
        lines = open(os.path.join(KODO, "inbox.md")).read().splitlines()
        todo = [l for l in lines if l.startswith("- [ ]")]
    except OSError:
        todo = []
    out.append(f"- capturas sin triar (kodo inbox): {len(todo)}")
    for l in todo[:CAP]:
        out.append(f"  {l[:160]}")

    # último handoff consumido: solo «Siguiente acción» y «Decisiones»
    handoffs = sorted(p for p in os.listdir(KODO) if p.startswith("handoff-consumed-")) if os.path.isdir(KODO) else []
    if os.path.exists(os.path.join(KODO, "handoff.md")):
        out.append("- handoff.md SIN consumir presente (el daemon no relanzó al orquestador)")
    if handoffs:
        path = os.path.join(KODO, handoffs[-1])
        out.append(f"- último handoff consumido: {handoffs[-1]}")
        try:
            txt = open(path).read()
            for head in ("## Decisiones del operador pendientes", "## Refs calientes", "## Siguiente acción"):
                if head in txt:
                    body = txt.split(head, 1)[1].split("\n## ", 1)[0].strip()
                    if body:
                        out.append(f"  - {head[3:]}: {' / '.join(body.splitlines()[:4])[:300]}")
        except OSError:
            pass
    return out


# ---------------------------------------------------------------- git

def repo_paths(projects):
    paths = set()
    for v in projects.values():
        if isinstance(v, str):
            paths.add(v)
        elif isinstance(v, dict):
            paths.add(v.get("default", ""))
            paths.update((v.get("modules") or {}).values())
    return sorted(p.rstrip("/") for p in paths if p and os.path.isdir(os.path.join(p, ".git")))


def gh_pr_list(repo):
    cmd = ["gh", "pr", "list", "--state", "open", "--limit", "20", "--json",
           "number,title,headRefName,isDraft,reviewDecision,mergeable,updatedAt,author"]
    code, body, err = sh(cmd, cwd=repo)
    if code != 0:
        # segundo intento con la cuenta deikka (repos kintsugi-lab-sca/*, deikka/*)
        c2, tok, _ = sh(["gh", "auth", "token", "--user", "deikka"])
        if c2 == 0 and tok:
            env = dict(os.environ, GH_TOKEN=tok)
            code, body, err = sh(cmd, cwd=repo, env=env)
    if code != 0:
        return None, err.splitlines()[-1][:120] if err else "gh falló"
    try:
        return json.loads(body), None
    except ValueError:
        return None, "json inválido"


def section_git(projects):
    out = ["## Git / PRs por repo"]
    for repo in repo_paths(projects):
        name = os.path.basename(repo)
        sh(["git", "fetch", "-q", "--all", "--prune"], cwd=repo, timeout=60)
        _, branch, _ = sh(["git", "rev-parse", "--abbrev-ref", "HEAD"], cwd=repo)
        _, dirty, _ = sh(["git", "status", "--porcelain"], cwd=repo)
        dirty_n = len([l for l in dirty.splitlines() if l and not l.startswith("??")])
        _, main, _ = sh(["git", "symbolic-ref", "-q", "--short", "refs/remotes/origin/HEAD"], cwd=repo)
        main = main or "origin/main"
        _, ab, _ = sh(["git", "rev-list", "--left-right", "--count", f"HEAD...{main}"], cwd=repo)
        ahead, behind = (ab.split() + ["?", "?"])[:2]
        out.append(f"- **{name}** ({repo}) · HEAD={branch} · ahead {ahead} / behind {behind} de {main} · modificados {dirty_n}")

        # worktrees con commits sin push o sin integrar en main
        _, wt, _ = sh(["git", "worktree", "list", "--porcelain"], cwd=repo)
        cur, wts = {}, []
        for l in wt.splitlines() + [""]:
            if not l:
                if cur:
                    wts.append(cur)
                cur = {}
            elif l.startswith("worktree "):
                cur["path"] = l[9:]
            elif l.startswith("branch "):
                cur["branch"] = l[7:].replace("refs/heads/", "")
        pend = []
        for w in wts:
            if w.get("path") == repo or "branch" not in w:
                continue
            b = w["branch"]
            _, n, _ = sh(["git", "rev-list", "--count", f"{main}..{b}"], cwd=repo)
            c_up, _, _ = sh(["git", "rev-parse", "--verify", "-q", f"{b}@{{u}}"], cwd=repo)
            _, wd, _ = sh(["git", "status", "--porcelain", "--untracked-files=no"], cwd=w["path"])
            flags = []
            if n not in ("0", ""):
                flags.append(f"{n} commits no en {main}")
            if c_up != 0:
                flags.append("sin upstream")
            if wd:
                flags.append(f"{len(wd.splitlines())} ficheros sucios")
            if flags:
                pend.append(f"  - worktree {b} ({os.path.basename(w['path'])}): {', '.join(flags)}")
        if len(wts) > 1:
            out.append(f"  - worktrees: {len(wts) - 1} ({len(pend)} con trabajo pendiente)")
        out.extend(pend[:CAP])

        prs, err = gh_pr_list(repo)
        if err:
            out.append(f"  - PRs: (no disponible: {err})")
        else:
            bots = [p for p in prs if re.search(r"dependabot|snyk|renovate", (p.get("author") or {}).get("login", ""))]
            if bots:
                out.append(f"  - PRs de bots (dependabot/snyk): {len(bots)}")
            prs = [p for p in prs if p not in bots]
            for p in prs[:CAP]:
                out.append(f"  - PR #{p['number']} {p['title'][:70]} · {p['headRefName']} · {p.get('reviewDecision') or 'sin review'} · {p.get('mergeable')} · {p['updatedAt'][:10]}{' · draft' if p.get('isDraft') else ''}")
    return out


# ---------------------------------------------------------------- plane

class Plane:
    def __init__(self):
        env = json.load(open(os.path.join(HOME, ".claude.json")))["mcpServers"]["plane"]["env"]
        self.key = env["PLANE_API_KEY"]
        self.base = f"{env['PLANE_BASE_URL']}/api/v1/workspaces/{env['PLANE_WORKSPACE_SLUG']}"

    def get(self, path, params=None):
        url = f"{self.base}/{path}"
        if params:
            url += "?" + urllib.parse.urlencode(params)
        req = urllib.request.Request(url, headers={"X-API-Key": self.key})
        with urllib.request.urlopen(req, timeout=20) as r:
            return json.load(r)

    def all(self, path, params=None):
        params = dict(params or {}, per_page=100)
        res = []
        while True:
            d = self.get(path, params)
            res.extend(d.get("results", []))
            if not d.get("next_page_results"):
                return res
            params["cursor"] = d["next_cursor"]


def section_plane(projects, since, horizon, me_id):
    out = ["## Plane"]
    try:
        api = Plane()
        plist = api.get("projects/")["results"]
    except Exception as e:  # noqa: BLE001
        return out + [f"(no disponible: {e})"]
    today = dt.date.today()
    wanted = {pid for pid in projects}
    new_comments = []
    for p in plist:
        if p["id"] not in wanted or p.get("archived_at"):
            continue
        ident, pid = p["identifier"], p["id"]
        try:
            states = {s["id"]: s for s in api.all(f"projects/{pid}/states/")}
            labels = {l["id"]: l["name"] for l in api.all(f"projects/{pid}/labels/")}
            items = api.all(f"projects/{pid}/work-items/")
        except Exception as e:  # noqa: BLE001
            out.append(f"- **{ident}**: (no disponible: {e})")
            continue
        open_items = [i for i in items if states.get(i["state"], {}).get("group") not in ("completed", "cancelled")]
        rows = {"vencidas/próximas": [], "in review": [], "in progress": [], "lanzables (kodo+assignee, backlog/todo)": [], "actualizadas en la ventana": []}
        for i in open_items:
            st = states.get(i["state"], {})
            grp, sname = st.get("group"), st.get("name", "?")
            lbls = [labels.get(l, l) for l in i.get("labels", [])]
            ref = f"{ident}-{i['sequence_id']}"
            line = f"{ref} · {i['name'][:70]} · {sname}"
            td = i.get("target_date")
            if td:
                d = dt.date.fromisoformat(td)
                if d <= horizon:
                    rows["vencidas/próximas"].append((d, f"{line} · {'VENCIDA ' if d < today else 'vence '}{td}"))
            if grp == "started" and "review" in sname.lower():
                rows["in review"].append(line)
            elif grp == "started":
                rows["in progress"].append(line + (" · kodo" if "kodo" in lbls else ""))
            elif grp in ("backlog", "unstarted") and "kodo" in lbls and i.get("assignees"):
                rows["lanzables (kodo+assignee, backlog/todo)"].append(f"{line} · prio {i.get('priority')}")
            upd = parse_ts(i.get("updated_at"))
            if upd and upd >= since:
                rows["actualizadas en la ventana"].append(line + f" · {i['updated_at'][:16]}")
                if len(new_comments) < 20:
                    try:
                        for c in api.all(f"projects/{pid}/work-items/{i['id']}/comments/"):
                            cts = parse_ts(c.get("created_at"))
                            if cts and cts >= since and c.get("created_by") != me_id:
                                txt = c.get("comment_stripped") or c.get("comment_html", "")
                                new_comments.append(f"- {ref} · {c['created_at'][:16]} · {txt[:160]}")
                    except Exception:  # noqa: BLE001
                        pass
        if not any(rows.values()):
            continue
        out.append(f"- **{ident}** · abiertas {len(open_items)}")
        for k, v in rows.items():
            if not v:
                continue
            if k == "vencidas/próximas":
                up = sorted(x for x in v if x[0] >= today)
                over = sorted((x for x in v if x[0] < today), reverse=True)
                v = [t for _, t in up + over]
            out.append(f"  - {k}: {len(v)}")
            out.extend(f"    - {t}" for t in v[:CAP])
    if new_comments:
        out.append("- comentarios de otros en la ventana:")
        out.extend("  " + c for c in new_comments[:CAP])
    return out


# ---------------------------------------------------------------- calendario

def section_calendar(horizon):
    out = [f"## Calendario (hoy → {horizon})"]
    code, body, err = sh(["spark", "events", "--start", dt.date.today().isoformat(), "--end", horizon.isoformat()], timeout=20)
    if code != 0 or not body:
        out.append(f"(no disponible: {err[:100] or 'spark sin eventos o sin Spark Desktop abierto'})")
    else:
        drop = ("ID:", "Calendar:", "Location:", "Alerts:", "Notes:")
        for l in body.splitlines():
            st = l.strip()
            if not st or st.startswith(drop) or l.startswith("    ") or st.startswith("Calendar Events"):
                continue
            if st.startswith("Attendees:"):
                names = re.findall(r"([^,<]+?)\s*<", st[10:]) or [st[10:]]
                st = "con " + ", ".join(n.strip() for n in names)[:120]
            out.append(("  " if l.startswith("  ") else "") + st)
    return out


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--since")
    ap.add_argument("--days", type=int, default=7)
    a = ap.parse_args()

    state = load_json(os.path.join(KODO, "state.json"), {})
    projects = load_json(os.path.join(KODO, "projects.json"), {})
    now = dt.datetime.now(dt.timezone.utc)

    if a.since:
        since = dt.datetime.fromisoformat(a.since).replace(tzinfo=dt.timezone.utc)
        since_src = "argumento"
    else:
        # última ronda del orquestador = último ack de la bandeja; si no, último handoff consumido
        cands = [parse_ts(e.get("seen_at") or e.get("ts")) for e in state.get("orchestrator_inbox", []) if e.get("seen")]
        cands = [c for c in cands if c]
        if cands:
            since, since_src = max(cands), "último ack de inbox-orch"
        else:
            hs = sorted(p for p in os.listdir(KODO) if p.startswith("handoff-consumed-")) if os.path.isdir(KODO) else []
            if hs:
                since = dt.datetime.fromtimestamp(os.path.getmtime(os.path.join(KODO, hs[-1])), dt.timezone.utc)
                since_src = "último handoff consumido"
            else:
                since, since_src = now - dt.timedelta(days=3), "por defecto 3 días"
    horizon = dt.date.today() + dt.timedelta(days=a.days)

    me_id = None
    try:
        me_id = next((m["id"] for m in Plane().get("members/") if (m.get("email") or "").startswith("alex@")), None)
    except Exception:  # noqa: BLE001
        pass

    print(f"# kodo catch-up · {now.astimezone().strftime('%Y-%m-%d %H:%M')}")
    print(f"- ventana: desde {since.astimezone().strftime('%Y-%m-%d %H:%M')} ({since_src}) · horizonte {horizon}")
    print(f"- inactividad: {(now - since).days} días, {((now - since).seconds // 3600)} h")
    print()
    for block in (section_local(state, since), section_git(projects), section_plane(projects, since, horizon, me_id), section_calendar(horizon)):
        print("\n".join(block))
        print()


if __name__ == "__main__":
    sys.exit(main())
