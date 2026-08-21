---
fecha: 2026-07-24
proyecto: kodo
slug: v018-homebrew-release
---

## Resumen
Se publicó v0.18.0 a Homebrew (tap externo + mirror in-tree) tras completar fase 81; se sincronizó fórmula, SHA256, tags de git y pushes multirremoto con verificación local de instalación. La metodología de dual-channel distribution demostró el patrón: canonical tap en GitHub + mirror en main repo para auditoría.

## Reto
Coordinar fórmula Homebrew en dos ubicaciones (tap externo + in-tree mirror) con checksum SHA256 sincronizado, tagging Git, y pushes atomicos a múltiples remotes (kintsugi-lab-sca + deikka). Riesgo: desincronización de versiones o checksums entre canales. Solución ad-hoc: actualizar formula primero en tap, luego replicar en mirror y pushear ambos con commit messages coordinados.

## Propuesta de skill
Crear `/gsd-homebrew-release` (o extender `gsd-complete-milestone`): detectar bump de versión, calcular SHA256 del tarball de release, actualizar ambas ubicaciones de fórmula (tap + mirror), crear annotated tag, pushear main + tag a ambos remotes, verificar instalación local vía `brew upgrade`, y reportar versión. Atomiza el workflow actual y elimina fricción de sincronización manual.
