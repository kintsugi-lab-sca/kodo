---
schema_version: 1
open_count: 0
waived_count: 0
fixed_count: 2
total_count: 2
last_updated: 2026-08-09T22:28:13.824Z
---

# Broken Windows Ledger

> Cross-phase defect register. `/gsd-ship` blocks while `open_count > 0`.
> Waive with `gsd-tools windows waive <id> "<reason>"` (reason required).
> Mark fixed with `gsd-tools windows fixed <id>`.

| id | phase | kind | file | line | description | status | reason | recorded_at | resolved_at |
|----|-------|------|------|------|-------------|--------|--------|-------------|-------------|
| 1 | 87 | deviation | .planning/phases/87-aislamiento-de-color-transitivo-en-el-tui/87-01-SUMMARY.md |  | SHA base real f00aabd (el plan midio contra 61a5c95); baselines re-medidos y coincidentes uno a uno | fixed |  | 2026-08-09T22:18:02.068Z | 2026-08-09T22:18:19.491Z |
| 2 | 87 | deviation | .planning/phases/87-aislamiento-de-color-transitivo-en-el-tui/87-02-SUMMARY.md |  | Baseline del plan corregido: grep -c 'imports DIRECTOS' en inbox-count.js daba 1, no 2 (grep -c cuenta lineas); criterio de 0 cumplido igualmente | fixed |  | 2026-08-09T22:28:09.641Z | 2026-08-09T22:28:13.824Z |

````json
[
  {
    "id": 1,
    "kind": "deviation",
    "phase": "87",
    "file": ".planning/phases/87-aislamiento-de-color-transitivo-en-el-tui/87-01-SUMMARY.md",
    "line": null,
    "description": "SHA base real f00aabd (el plan midio contra 61a5c95); baselines re-medidos y coincidentes uno a uno",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-09T22:18:02.068Z",
    "resolved_at": "2026-08-09T22:18:19.491Z"
  },
  {
    "id": 2,
    "kind": "deviation",
    "phase": "87",
    "file": ".planning/phases/87-aislamiento-de-color-transitivo-en-el-tui/87-02-SUMMARY.md",
    "line": null,
    "description": "Baseline del plan corregido: grep -c 'imports DIRECTOS' en inbox-count.js daba 1, no 2 (grep -c cuenta lineas); criterio de 0 cumplido igualmente",
    "status": "fixed",
    "reason": "",
    "recorded_at": "2026-08-09T22:28:09.641Z",
    "resolved_at": "2026-08-09T22:28:13.824Z"
  }
]
````
