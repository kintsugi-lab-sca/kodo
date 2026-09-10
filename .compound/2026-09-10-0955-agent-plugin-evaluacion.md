---
fecha: 2026-09-10
proyecto: kodo
slug: agent-plugin-evaluacion
---

## Resumen
Evalué si convertir kodo en un plugin de Claude Code, contrastando el artículo de Agent Plugins 1.0 con la superficie de instalación real del repo.
Resultado: sí como capa aditiva, pero cubre solo 2 de 7 pasos — el informe queda en `.planning/research/AGENT-PLUGIN.md` y la tarea en "In review" sin implementar nada.

## Reto
Evaluar un formato de empaquetado sin caer en la memoria: la respuesta fácil ("un plugin lo automatiza todo") era falsa, y desmontarla exigió inspeccionar plugins ya instalados en `~/.claude/plugins/cache/` como evidencia empírica — el de basecamp invoca su CLI por nombre en PATH, lo que prueba que un plugin no instala binarios. Sin ese paso, el informe habría prometido una automatización que no existe.

## Propuesta de skill
`inspect-installed-plugins`: dado un nombre o una capacidad, localiza el plugin en `~/.claude/plugins/cache/`, extrae su `plugin.json`, `hooks/hooks.json`, `.mcp.json`, `skills/` y `commands/`, y devuelve el layout real — para responder preguntas sobre el formato de plugin con evidencia local en vez de con memoria del modelo.
