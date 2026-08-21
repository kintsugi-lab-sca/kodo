---
fecha: 2026-07-23
proyecto: kodo
slug: phase79-sidebar-doctor-cadena-auto
---

## Resumen
Cadena autónoma completa de la Phase 79 (discuss --auto → plan → execute → review+fix → verify): `kodo sidebar doctor` entregado (allowlist no-destructivo, motor scan/execute espejo de gsd/doctor, CLI, guard source-hygiene), suite 2347 pass.
Verificación en human_needed 5/6: solo queda la convergencia `--fix` en vivo (79-UAT.md), diferida honestamente porque no había sesión suelta real y fabricarla habría mutado el sidebar del operador.

## Reto
El checkpoint human-verify del plan 03 en cadena --auto: auto-aprobarlo a ciegas habría fabricado una verificación visual; se resolvió ejecutando la parte read-only en vivo (dry-run + list --json) y difiriendo explícitamente la rama mutante a UAT — el verifier respetó esa frontera en vez de contarla como verificada.

## Propuesta de skill
Un skill "uat-sidebar-doctor" (o paso de /gsd-verify-work) que monte el escenario UAT de forma segura: lanzar 1 workspace kodo de prueba suelto, correr dry-run→--fix→list --json, comprobar convergencia y limpiar — convertiría los 3 tests manuales de 79-UAT.md en semi-automáticos.
