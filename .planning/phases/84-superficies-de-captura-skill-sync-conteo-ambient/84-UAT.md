---
status: complete
phase: 84-superficies-de-captura-skill-sync-conteo-ambient
source: [84-01-SUMMARY.md, 84-02-SUMMARY.md, 84-03-SUMMARY.md]
started: 2026-07-26T10:57:16Z
updated: 2026-07-26T11:37:21Z
---

## Current Test

[testing complete]

## Tests

### 1. Cold Start Smoke Test
expected: Mata cualquier proceso `kodo` en marcha. Arranca el dashboard desde cero (`node bin/kodo`). El TUI bootea sin errores ni trazas de stack, la cabecera se pinta completa (título, indicador de conexión) y la tabla de sesiones carga con datos vivos. Salir con `q` deja la terminal limpia.
result: pass

### 2. Case-tolerance del entrypoint en filesystem case-sensitive (D6 / 84-01)
expected: El gate de entrypoint de `kodo skill sync` acepta tanto `SKILL.md` como `skill.md`, en ese orden. En macOS el test pasa trivialmente (filesystem case-insensitive), así que la comprobación real es en un filesystem case-sensitive — CI Linux o una imagen APFS case-sensitive. Ahí, una skill cuyo entrypoint en disco sea `skill.md` en minúsculas debe sincronizarse igual que una con `SKILL.md`.
result: pass
coverage_id: D6-84-01

### 3. Carga e invocación real de /kodo-capture (D6 / 84-02)
expected: En una sesión de Claude Code recién arrancada, la skill `/kodo-capture` aparece disponible. Al invocarla mid-session con un texto arbitrario, ejecuta `kodo capture` SIN pedir prompt de permiso (gracias a `allowed-tools: Bash(kodo capture *)`), la captura aterriza en `~/.kodo/inbox.md`, y el modelo se limita a reportar el resultado — ante un fallo, imprime el stderr verbatim y para, sin escribir el inbox por su cuenta.
result: pass
coverage_id: D6-84-02

### 4. Conteo ambient de capturas sin enrutar en el dashboard (D9 / 84-03)
expected: Con el inbox vacío, la cabecera del dashboard no muestra ningún conteo (ni un `0`). Tras `kodo capture` ×3, al abrir el dashboard la cabecera muestra `3 sin enrutar` en amarillo, después del indicador de conexión, sin robar atención al resto de la cabecera. Tras `kodo inbox discard` ×3, el elemento DESAPARECE por completo en vez de mostrar `0`.
result: pass
coverage_id: D9-84-03

### 5. `kodo skill sync` distribuye las DOS skills del registro en la misma invocación, en el orden de `KODO_SKILLS`, con una línea por skill
expected: `kodo skill sync` distribuye las DOS skills del registro en la misma invocación, en el orden de `KODO_SKILLS`, con una línea por skill (D-01, D-05)
result: pass
source: automated
coverage_id: D1-84-01

### 6. El registro es una allowlist literal congelada y NUNCA se descubre por directorio
expected: `worktree-cleanup` no se distribuye (D-01, mitigación de T-84-01)
result: pass
source: automated
coverage_id: D2-84-01

### 7. Resiliencia por skill: una entrada en error no aborta el bucle
expected: Una entrada en error —devuelto o lanzado— no aborta el bucle; la otra se sincroniza y el exit agregado es 1 (D-03, mitigación de T-84-04)
result: pass
source: automated
coverage_id: D3-84-01

### 8. El gate de exit 2 sigue anclado SOLO a `kodo-orchestrate`
expected: Su literal de stderr es byte-idéntico, comparado con `assert.equal` (D-02, T-84-05)
result: pass
source: automated
coverage_id: D4-84-01

### 9. El payload `--json` crece de forma ADITIVA con orden de claves fijo
expected: `status` y `files_changed` conservan su posición como agregado (D-04, DX-06)
result: pass
source: automated
coverage_id: D5-84-01

### 10. Cero regresión en los consumidores single-skill
expected: Los 8 unit de `syncSkill`, las 2 de `onConsoleWarn`, las 3 de `cleanupFn ordering` y los tres consumidores single-skill siguen exactamente como estaban (D-06, D-08b)
result: pass
source: automated
coverage_id: D7-84-01

### 11. La ayuda de commander habla en plural y nombra ambas skills y su destino
expected: `kodo skill --help` menciona `kodo-capture`; el diff de `src/cli.js` es de 1 línea
result: pass
source: automated
coverage_id: D8-84-01

### 12. Los seis ítems diferidos de la fase quedan registrados con su trigger real
expected: `deferred-items.md` existe y menciona D-08b, D-08, D-24, D-13, format-isolation y 83-05, cada uno con su columna de Trigger
result: pass
source: automated
coverage_id: D9-84-01

### 13. La skill `/kodo-capture` existe como skill de proyecto con frontmatter
expected: `name`, `description`, `argument-hint`, `allowed-tools: Bash(kodo capture *)` en `.claude/skills/kodo-capture/SKILL.md`
result: pass
source: automated
coverage_id: D1-84-02

### 14. El fichero contiene exactamente una invocación y un solo bloque cercado
expected: No hay un segundo camino de escritura (D-10, D-14 corolario)
result: pass
source: automated
coverage_id: D2-84-02

### 15. El argv extraído del markdown es exactamente el canónico
expected: `kodo capture --origin skill -- "<texto>"`; editarlo pone rojo el test
result: pass
source: automated
coverage_id: D3-84-02

### 16. La línea del skill-path es byte-idéntica al golden de Phase 83
expected: Cambia solo el origen a `skill`
result: pass
source: automated
coverage_id: D4-84-02

### 17. El argv sobrevive al commander real con un texto que empieza por guion
expected: La ausencia del separador `--` es un fallo duro observable
result: pass
source: automated
coverage_id: D5-84-02

### 18. El leaf cuenta exactamente lo mismo que `listCaptures`
expected: Sobre fixtures adversariales y de volumen — la deriva entre los dos lectores es un fallo de suite (D-17 + D-18)
result: pass
source: automated
coverage_id: D1-84-03

### 19. El leaf nunca lanza
expected: Fichero ausente, EACCES, un directorio en vez de un fichero y contenido binario cuentan 0 (D-20)
result: pass
source: automated
coverage_id: D2-84-03

### 20. El leaf resuelve su path perezosamente
expected: Dos `kodoDir` distintos dan conteos distintos en el mismo proceso, y `homedirFn` aísla el HOME (D-19)
result: pass
source: automated
coverage_id: D3-84-03

### 21. El conteo es estrictamente de solo lectura y tolera un `O_APPEND` concurrente
expected: La línea parcial no casa la regex y no se cuenta (CAPT-07, T-84-18)
result: pass
source: automated
coverage_id: D4-84-03

### 22. El dashboard pinta `{N} sin enrutar` en amarillo como tercer hijo del header
expected: Después del indicador de conexión (D-22); zero-one-many sin rama de plural; el entero va crudo sin separador de millares
result: pass
source: automated
coverage_id: D5-84-03

### 23. Con 0 capturas abiertas el elemento no se emite
expected: La cabecera queda byte-idéntica a la actual (D-23)
result: pass
source: automated
coverage_id: D6-84-03

### 24. En terminal estrecho el indicador de conexión conserva su posición
expected: El conteo, último hijo, es lo que ink envuelve — sin aritmética de anchos (backstop de 84-UI-SPEC)
result: pass
source: automated
coverage_id: D7-84-03

### 25. El leaf no arrastra el paquete de color al grafo de imports del TUI
expected: Ningún archivo de `src/cli/dashboard/` importa picocolors (T-84-17); `inbox-count.js` solo importa `node:fs`, `node:path`, `node:os`
result: pass
source: automated
coverage_id: D8-84-03

## Summary

total: 25
passed: 25
issues: 0
pending: 0
skipped: 0
blocked: 0

## Gaps

[none yet]
