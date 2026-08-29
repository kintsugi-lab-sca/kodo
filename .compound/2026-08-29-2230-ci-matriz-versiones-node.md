---
fecha: 2026-08-29
proyecto: kodo
slug: ci-matriz-versiones-node
---

## Resumen
CI probaba una sola versión de Node (22, ya en mantenimiento) mientras `engines` admitía 24 y 26; se añadió el eje `node: [22, 24]` a la matriz — 4 jobs — y se documentó en README y `packaging/` qué versiones se prueban y por qué 26 no.
Resultado: el suelo declarado y la LTS activa quedan cubiertos, suite local verde en 22 (3935 pass / 1 skip / 0 fail) y commit `12086138` en la rama del worktree, fast-forward limpio sobre main.

## Reto
El sandbox no tiene salida a red — `fnm install 24` falló incluso con el sandbox desactivado — así que la cobertura de Node 24 no se pudo verificar en local y queda pendiente del primer PR con la matriz nueva. Aparte, salió un hueco no previsto: `depends_on "node"` de la fórmula de Homebrew sigue la línea de release más nueva, de modo que `brew install kodo` puede entregar un Node por delante de la matriz; se dejó sin pinear a propósito (pinear `node@24` arrastraría el `formula_opt_bin("node")` del bloque de servicio) y documentado en la fórmula y el README.

## Propuesta de skill
Una skill `node-support-matrix` que cruce `engines.node` con el calendario de nodejs/Release y con los ejes del workflow, y avise cuando la matriz se quede por detrás de la LTS activa o cuando una versión probada entre en EOL — exactamente el desfase que originó KODO-65 y que volverá a abrirse el 2026-10-28 cuando v26 pase a LTS.
