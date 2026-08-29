---
fecha: 2026-08-29
proyecto: kodo
slug: kodo59-systemd-packaging
---

## Resumen
F3 del port a Linux: kodo se instala con `npm i -g` desde un tag y corre como unidad systemd
de usuario, con `stop`/`up`/`status` conscientes de quién es el dueño del ciclo de vida.
Verificado de arriba abajo en una Ubuntu 22.04 real (VM OrbStack); suite 3935/3936 verde.

## Reto
Los dos fallos que importaban no se veían en el código, solo al ejecutar: (1) `daemon run`
sale con 1 si falta `KODO_WEBHOOK_SECRET_<PROVIDER>` —también en modo polling, donde no llega
ningún webhook— y con `Restart=always` eso era un bucle invisible; (2) el `StartLimit` que
puse para frenar ese bucle no llegaba a dispararse, porque un arranque fallido tarda ~15s y
5 intentos son ~75s: la ventana de 60s reseteaba el contador antes del quinto. Ninguno de los
dos se habría detectado en contenedor: systemd de usuario exige una VM.

## Propuesta de skill
Una skill `verify-in-linux-vm` que, dado un repo Node con packaging systemd, levante una VM
OrbStack Ubuntu (`orb create` + `loginctl enable-linger`), instale desde `npm pack`, y corra
una tabla de checks declarada por el proyecto (arranque, `kill -9`, `/health`, idempotencia
de la reinstalación) devolviendo el diff contra lo esperado. Hoy son ~8 pasos manuales y dos
trampas: `orb run` no crea sesión de logind, y `journalctl --user` falla donde
`journalctl --user-unit` funciona.
