---
fecha: 2026-08-10
proyecto: kodo
slug: orquestador-incidente-duplicados
---

## Resumen
Sesión orquestadora que revisó y mergeó KODO-15 (zombis: 1da0c56→81bf3c7) y KODO-16 (identidad del orquestador: c03c927+a850f19→5c4b4e4, suite 2708 pass), paró el incidente de orquestadores duplicados (4 vigilantes concurrentes terminados: daemon viejo, orchestrate --polling, polling, up) y relanzó el daemon con el fix, verificando en vivo que kodo check ya no duplica. Despachada ROMAN-216 (workspace:40); traspaso de supervisión al orquestador registrado post-fix (workspace:39, UUID AF04A3D3) por decisión del operador.

## Reto
Diagnóstico contaminado por el propio observador: ps muestra forks efímeros con el cmdline del padre (tandas fantasma de "duplicados") y el read-screen de workspace:39 mostró a otro claude corriendo diagnósticos casi idénticos a los míos, lo que invirtió dos veces la conclusión; la identidad solo quedó clara cruzando CMUX_WORKSPACE_ID propio + UUID del registro + ppid.

## Propuesta de skill
Checklist "verificar-identidad-orquestador" (¿mi CMUX_WORKSPACE_ID == registro? ¿ppid de los pids sospechosos? ¿workspaces reales en cmux tree?) antes de concluir duplicación — hoy fue prosa ad-hoc en dos lecciones de kodo-orchestrate; merecería paso 0 formal del flujo de diagnóstico.
