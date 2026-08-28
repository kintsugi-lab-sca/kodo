---
fecha: 2026-08-28
proyecto: kodo
slug: homebrew-launchd-path
---

## Resumen
Se cerró A1 declarando `environment_variables PATH:` en el `service do` de la fórmula Homebrew y se añadió un smoke de `kodo status` al `test do`; `brew style`/`audit` quedan limpios y `npm test` verde (3376/3377).
La premisa de A1 resultó falsa: `npm install` reescribe el shebang de `bin/kodo` al node absoluto, así que el fix se justifica por `git` y `claude` (que el daemon resuelve por PATH), no por node.

## Reto
Un open question puede llevar un año escrito con un diagnóstico que nadie verificó: la nota A1 daba por hecho un fallo (`env: node`) que no ocurre tras `brew install`, y además proponía una sintaxis que ni siquiera es Ruby válido dentro de `service do`. Reproducir antes de arreglar habría ahorrado el rodeo — y el hallazgo real (el PATH importa por los subprocesos, no por el intérprete) solo apareció al ejecutar el binario instalado con el PATH mínimo de launchd.

## Propuesta de skill
Una skill `brew-formula-check` que, dada una fórmula in-tree, la copie a un tap confiado, corra `brew style` + `brew audit`, renderice el plist vía `Formulary.factory(...).service.to_plist` para inspeccionar `EnvironmentVariables`/`ProgramArguments`, y restaure el tap al salir — hoy son ~6 pasos manuales con dos trampas (Homebrew rechaza fórmulas fuera de un tap y exige `brew trust` en taps nuevos).
