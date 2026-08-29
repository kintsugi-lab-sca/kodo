---
fecha: 2026-08-29
proyecto: kodo
slug: kodo66-webhook-secret-opcional
---

## Resumen
Con `polling.enabled` el daemon ya no exige `KODO_WEBHOOK_SECRET_<PROVIDER>`: arranca con la
ruta `/webhook` apagada (503 neutro) en vez de salir con 1, cerrando el bucle de reinicios bajo
systemd que dejó abierto KODO-59. Suite 3947/3948 verde y daemon real verificado end-to-end.

## Reto
El gate vivía en `startServer` sin saber nada del carril de polling, y quitarlo tenía tres
bordes que había que respetar a la vez: `--insecure`/`KODO_ALLOW_INSECURE` (KODO-52) debía
seguir siendo el ÚNICO camino para aceptar webhooks sin firma; apagar la ruta no podía sacarla
de `isOpenRoute` (un 401 ahí revelaría que hay auth detrás, así que el 503 va antes del
rate-limit y del HMAC); y el caso sin secreto NI polling debía seguir fallando. Queda pendiente
la validación bajo systemd en la VM `kodo-linux`: ni `orb run` ni `ssh …@orb` respondieron.

## Propuesta de skill
`verify-in-linux-vm` (ya propuesta en KODO-59, sin construir): además de levantar la VM y correr
la tabla de checks, necesita un pre-check de salud del canal — si `orb run` no devuelve en N
segundos, decirlo y ofrecer el fallback en vez de dejar la validación colgada.
