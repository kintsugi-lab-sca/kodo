---
fecha: 2026-08-29
proyecto: kodo
slug: ci-matriz-linux-readme-plataformas
---

## Resumen
Se añadió el workflow de tests con matriz ubuntu-latest × macos-latest (Node 20) que monta el checkout en un directorio no llamado `kodo` y verifica que no exista `~/.kodo/.env`, cerrando la fase F4 del port a Linux.
El README pasó de afirmar «macOS + cmux» a una tabla de plataformas real con la trampa `orca` vs `orca-ide` visible, y los caveats de la fórmula Homebrew dejaron de dar a entender que kodo es solo-macOS.

## Reto
No se pudo correr la suite en Linux para validar la pata de ubuntu: la VM `kodo-linux` de OrbStack figura «running» pero `orbctl run` se cuelga sin devolver salida, y el daemon de Docker (mismo motor) tampoco responde. El workflow solo se probará a sí mismo en el primer push, y queda además la decisión abierta de que Node 20 está EOL desde abril de 2026 mientras `engines` sigue declarando `>=20`.

## Propuesta de skill
Una skill `ci-condiciones-limpias` que simule localmente las condiciones exactas de un runner alojado —HOME en un tmpdir, credenciales de provider fuera del entorno, checkout copiado a un directorio con nombre arbitrario— y corra la suite ahí; es el paso que permitió verificar sin depender de Docker ni de una VM, y se repite en cada tarea que toque CI.
