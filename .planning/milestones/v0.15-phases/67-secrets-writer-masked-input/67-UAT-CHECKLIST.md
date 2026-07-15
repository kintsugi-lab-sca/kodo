---
phase: 67-secrets-writer-masked-input
type: uat-checklist
status: complete
result: all_pass
executed: 2026-07-02
reconfirmed: 2026-07-03
source: 67-UAT.md
---

# Phase 67 — Checklist de UAT runtime (verificación manual del boundary del secreto)

**Fase:** 67-secrets-writer-masked-input
**Plan:** 67-03 (Task 4)
**Cuándo ejecutar:** tras Phase 68 (setup mode) o en cualquier momento contra un daemon vivo.
**Quién:** un humano, observando el runtime real. NO automatizable con node --test (requiere daemon + `ps`/logs/`/status`).

> El grep de higiene source-level (`test/hygiene-api-key.test.js`) es el UAT automatizado
> load-bearing y ya pasa en verde. Esta checklist es el **complemento runtime**: prueba que el
> valor tampoco se filtra en tiempo de ejecución (argv del proceso vivo, logs en disco, endpoint
> `/status`) y que el fichero `.env` real tiene los permisos correctos.

---

## Precauciones antes de empezar

- Esta checklist SÍ toca el `~/.kodo/.env` real y el daemon real (a diferencia de los tests, que
  usan DI a un tmpdir). Ejecútala a conciencia.
- Usa un valor de key **sacrificable/ficticio** reconocible para el grep, p. ej. `secret_key_123`,
  para poder buscarlo sin exponer una key real. Si introduces una key real, sustituye
  `secret_key_123` por su valor al hacer los `grep`.
- Anota el estado previo: `ls -l ~/.kodo/.env` y `cut -d= -f1 ~/.kodo/.env` (para confirmar al
  final que las otras keys se preservaron).

---

## Los 8 pasos

- [x] **1. Arrancar el daemon.**
  `kodo up`
  Esperado: el daemon + dashboard arrancan sin error.

- [x] **2. Editar la API key vía el campo enmascarado del dashboard.**
  En el dashboard: `e` (abrir editor de config) → `↓` hasta el renglón **"API key del provider"**
  → `Enter` → teclear `secret_key_123` → `Enter`.
  Esperado: mientras tecleas se pinta `•` por carácter (nunca el valor raw); tras guardar aparece
  el indicador `[configurado]` y el aviso de reiniciar el daemon para aplicar.

- [x] **3. `ps` — el valor NO aparece en el argv de ningún proceso.**
  `ps aux | grep kodo | grep -v grep`
  Esperado: **cero** ocurrencias de `secret_key_123` en la línea de comando. (P11: el secreto se
  escribe en-proceso, jamás vía shell-out `kodo config --api-key ...`.)

- [x] **4. Logs — el valor NO aparece en `~/.kodo/logs`.**
  `grep -r 'secret_key_123' ~/.kodo/logs`
  Esperado: **resultado vacío** (exit code 1). El valor nunca se loguea (console/logger/NDJSON).

- [x] **5. `/status` — el valor NO está en la respuesta del endpoint.**
  `curl -s http://localhost:9090/status | grep 'secret_key_123'`
  Esperado: **resultado vacío**. El secreto nunca cruza a `/status` (solo `config.json`/estado no-secreto).

- [x] **6. Permisos del `.env` — exactamente `-rw-------` (0600).**
  `ls -l ~/.kodo/.env`
  Esperado: `-rw-------` (owner rw, sin grupo/otros). (Pitfall 13: chmod 0600 pre-rename.)
  Comprobación equivalente: `stat -f '%Sp %Lp' ~/.kodo/.env` → `-rw------- 600`.

- [x] **7. Sin `.env.tmp` residual.**
  `ls -l ~/.kodo/.env.tmp`
  Esperado: `No such file or directory`. El write atómico (tmp + chmod + rename) no deja artefactos.

- [x] **8. Otras env vars preservadas (parse-merge-write, sin clobber).**
  `cut -d= -f1 ~/.kodo/.env`
  Esperado: siguen presentes las demás keys que había antes (p. ej. `PLANE_WEBHOOK_SECRET`), no
  solo la recién escrita. (Pitfall 14: upsert que preserva el resto de líneas verbatim.)

---

## Criterio de sign-off

Los 8 pasos en verde ⇒ el boundary del secreto está verificado end-to-end en runtime:
el valor vive **solo** en `~/.kodo/.env` (0600) y en `process.env` (cache en memoria), y **nunca**
en argv / logs / `/status` / `config.json` / snapshot. Combinado con `test/hygiene-api-key.test.js`
(source-level) y `test/config-env-writer.test.js` (writer atómico), cierra el Pilar 2a de v0.15.

## Limpieza tras el UAT

Restaura tu key real (repite el paso 2 con el valor real) y reinicia el daemon (`kodo up` o el
flujo de reinicio que aplique). Verifica de nuevo el paso 8 para confirmar que ninguna key se perdió.
