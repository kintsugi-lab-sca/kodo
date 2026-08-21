---
fecha: 2026-07-26
proyecto: kodo
slug: phase84-superficies-captura
---

## Resumen
Cadena GSD completa de la Phase 84 (discuss → research → UI-SPEC → pattern-map → plan → execute → review → verify) sobre las tres superficies de captura: skill `/kodo-capture`, `kodo skill sync` multi-skill y conteo ambient en el dashboard.
15 commits, suite 2 556 → 2 586 con 0 fail; el code review destapó un BLOCKER de inyección de comandos reproducido y cerrado en la misma sesión, y la verificación cerró en `human_needed` con 3 items de UAT declarados en vez de fingir un pase limpio.

## Reto
El agujero real no lo vio ningún gate previo: la invocación congelada del `SKILL.md` usaba comillas dobles, así que `$(id -un)` en el texto de una captura **se ejecutaba** y su salida acababa escrita en el inbox — pre-aprobado por `allowed-tools: Bash(kodo capture *)`. Los dos carriles de test existentes tokenizaban la línea en JS y la pasaban como argv, de modo que **nunca veían un shell** y no podían morder el fallo por construcción. La lección generalizable: cuando el artefacto bajo contrato es una *línea de shell*, el test tiene que ejecutarla **por shell**; verificar el argv equivalente prueba otra cosa. Corolario secundario, ya vivido dos veces: un centinela de inyección tipo `$(echo PWNED)` no discrimina, porque la cadena aparece igual en el texto sin expandir — el discriminante tiene que ser algo que *solo* pueda existir tras la expansión (aquí, la ruta del HOME sandbox).

## Propuesta de skill
`shell-contract-test` — dado un artefacto que contiene una línea de comando destinada a ejecutarse por shell (SKILL.md, plantilla de prompt, snippet de README), genera el carril de test que la extrae del fichero, la ejecuta bajo `bash -c` con HOME sandbox y texto adversarial (`$(...)`, backticks, `$VAR`, apóstrofos, guion inicial), y exige la mordida en ambos sentidos. No existe candidata en el catálogo actual; lo más cercano es `try-pr-local`, que valida ramas, no contratos de línea de comando.
