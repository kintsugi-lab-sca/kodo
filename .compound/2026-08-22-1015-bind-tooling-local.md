---
fecha: 2026-08-22
proyecto: kodo
slug: bind-tooling-local
---

## Resumen

KODO-29: el tooling local (`kodo up`, `kodo dashboard`) asumía loopback fijo y rompía con el `server.bind` a IP de Tailscale que el propio README recomienda; se extrajo la normalización del bind —hasta ahora inline en `startServer`— al módulo puro `src/net-host.js` y ahora cliente y servidor derivan el host de la misma fuente.
Suite verde (3020 pass, 0 fail) más verificación con socket real en la IP de Tailscale de la máquina: baseUrl, `GET /health` y sonda de puerto correctos con bind ausente, `0.0.0.0` e IP concreta; el workaround de `0.0.0.0` + regla `pf` no persistente ya no hace falta.

## Reto

El bug real no era el `localhost` hardcodeado sino que la regla de normalización del bind (trim, vacío = ausente, WR-04) vivía **dentro** de `startServer`: el cliente no podía conocerla y la duplicó mal por omisión. Detectarlo requirió leer el servidor, no el cliente que fallaba. Queda una arista sin cerrar: si la IP bindeada no está asignada (Tailscale caído), `probePortInUse` devuelve `true` por su regla "error ≠ ECONNREFUSED → conservador ocupado" —bloqueada por un test explícito— y `kodo up` no arranca el daemon en silencio.

## Propuesta de skill

Una skill `find-shared-invariant`: dado un síntoma en un consumidor (cliente, CLI, test), localiza la regla equivalente en el productor (servidor, writer) y verifica si está inline —candidata a extracción— antes de parchear el consumidor. Habría señalado `src/server.js:241` desde el primer grep de `resolveBaseUrl`. No hay candidata existente en `find-skills` que cubra este eje productor↔consumidor.
