# Deferred items — Phase 84

Ítems que esta fase **decide no cerrar**, cada uno con su razón y su trigger real. Un ítem sin
trigger es una intención, no un diferido: por eso la columna nunca queda vacía.

| Ítem | Qué se difiere | Por qué no aquí | Trigger |
|---|---|---|---|
| **D-08b** | Distribuir `kodo-capture` también por el carril de **auto-sync del orquestador**. `src/orchestrator/launch.js` sigue sincronizando solo `kodo-orchestrate`. | Generalizar ese carril es una decisión de producto que el CONTEXT no toma, y §Integration Points acota CAPT-05 al handler del CLI. Consecuencia **conocida y aceptada**: un operador que solo use `kodo orchestrate` y nunca ejecute `kodo skill sync` **no recibirá** `/kodo-capture`. Blindado en la dirección contraria por el guard source-hygiene de `test/skill-sync.test.js`, que impide "terminar el trabajo" por inercia. | El primer operador que reporte que `/kodo-capture` no le aparece. |
| **D-08** | Renombrar `.claude/skills/kodo-orchestrate/skill.md` → `SKILL.md` (convención de Claude Code). | Cambia el **path de distribución**: dejaría un fichero huérfano en el `~/.claude/skills/kodo-orchestrate/` de cada operador salvo que corra `--prune`. Además rompería `SKILL_PATH` (`src/hooks/stop.js:21`), hoy constante muerta que quedaría apuntando a la nada. Ver la nota de riesgo A1 abajo. | La próxima vez que se toque el contenido de esa skill por otra razón, **o** un barrido de deuda con `--prune` documentado. |
| **D-24** | Tecla en el dashboard para abrir/triar el inbox desde el conteo. | CAPT-07 pide **conteo**, no navegación. El keybar del pie queda byte-idéntico; el conteo no es interactivo ni seleccionable. | Que el conteo demuestre generar presión real y el operador pida el atajo. |
| **D-13** | Vincular una captura a una tarea (`task_ref` como campo de la línea). | Exige abrir el formato de línea **congelado** en la Phase 83 y romper su golden (`test/inbox-format-golden.test.js`), que es justamente el contrato contra el que esta fase verifica. | Un caso de uso real que la derivación por proyecto (`deriveTag`) no cubra. |
| **format-isolation transitivo** | Endurecer `test/format-isolation.test.js` para que el guard de color-isolation siga imports **transitivos**, no solo directos. | El walker (`walkImports`) ya vive en el propio fichero, pero se usa para otra suite; **no se ha medido** el radio de ficheros del dashboard que se pondrían rojos al activarlo. Abrirlo aquí convertiría una fase de superficies en una de saneo. | La Phase 85, que ya es la fase de saneo, es el candidato natural. |
| **83-05 · drenaje de stdout** | Extender el barrido del drenaje de stdout a los comandos no-inbox (`polling` / `daemon` / `gsd` / `sidebar` / `skill`). | Deuda registrada en `83-05` con umbral en 64 KB. **Medido aquí:** el payload `--json` de `skill sync`, ya con `skills[]` (D-04), sigue siendo de **decenas de bytes** (160 medidos con las dos skills sincronizadas) — tres órdenes de magnitud por debajo del umbral. Esta fase **no** lo justifica. | Un comando cuyo payload `--json` se acerque a 64 KB, o un truncado observado en la práctica. |

---

## Nota de riesgo sobre D-08 (A1 del research — **no verificado**)

Los docs de Claude Code documentan el entrypoint **siempre** como `SKILL.md` y no declaran
tolerancia de mayúsculas. Es **plausible, y no verificable en macOS** (filesystem case-insensitive:
`existsSync(join(dir, 'skill.md'))` devuelve `true` aunque en disco solo exista `SKILL.md`), que
`kodo-orchestrate/skill.md` **no cargue como skill en un filesystem case-sensitive** — CI, contenedor
u operador Linux. Eso eleva la prioridad de D-08 por encima de lo cosmético: no sería un rename de
estilo, sino la corrección de un fallo de carga.

Esta fase mitiga la mitad que **sí** le corresponde: el gate de entrypoint acepta ambas grafías en
los dos sitios (`src/cli/skill-sync.js` y `src/skill/sync.js`, D-07), de modo que `kodo-capture` se
distribuye correctamente en Linux. Lo que queda diferido es el rename del fichero de
`kodo-orchestrate`, que es lo que tiene coste de migración en el HOME del operador.

---

## Ajenos por construcción — registrados en sus fases, no re-listados aquí

- **R-82-01** — carrera de 2.º orden en `stealLock` con holder vivo: esta fase no toca
  `src/gsd/lock.js`.
- **RMW del inbox sobre string UTF-8** (`83/deferred-items.md`): el conteo de CAPT-07 **solo lee**;
  esta fase no escribe en el inbox.
- **CAPT-F1 / CAPT-F2** (filtros y rotación del inbox): diferidos a v2 en su propio backlog, no
  deuda de esta fase.
