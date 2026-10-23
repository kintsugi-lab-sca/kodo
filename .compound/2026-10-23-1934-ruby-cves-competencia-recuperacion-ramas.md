---
fecha: 2026-10-23
proyecto: kodo
slug: ruby-cves-competencia-recuperacion-ramas
---

## Resumen
Orquestación del 23-oct: análisis de competencia IA (SCP-168) integrado y volcado a F5, Anthropic directo en SCP-86, dos PRs de clipping mergeadas, 5 docs integrados y pusheados, y aviso de Ruby (CVEs regexp) auditado en 10 repos y resuelto con 5 PRs de bump (SCP, optiai, personalchat, liken) más 3 PRs de gemas en personalchat.
Recuperados por `git fsck` los commits de SCP-167 cuya rama borró el cierre con «Remove worktree»; cuatro lecciones operativas guardadas en claude-mem (#37324, #37331, #37337, #37338).

## Reto
El Enter remoto de cmux (`\r`) solo entra en Claude Code cuando va en la misma llamada que el texto: cualquier texto que ya estaba en el prompt («/exit», borradores del operador) no se envía ni con `--force`, y cuatro sesiones quedaron horas esperando un Enter humano.

## Propuesta de skill
Un comando `kodo nudge <ref> '<texto>'` que teclee texto+Enter en una sola escritura, verifique con read-screen que la sesión pasó a «working» y, si no, lo diga; y `kodo close <ref>` que haga /exit + Keep worktree con la misma verificación.
