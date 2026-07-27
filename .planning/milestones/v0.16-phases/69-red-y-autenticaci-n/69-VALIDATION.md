---
phase: 69
slug: red-y-autenticaci-n
status: validated
nyquist_compliant: true
wave_0_complete: false
created: 2026-07-06
---

# Phase 69 — Validation Strategy

> Per-phase validation contract reconstruido retroactivamente (backfill Nyquist Phase 85, NYQ-02).
> Cobertura **citada** de `69-VERIFICATION.md` (passed 12/12 must-haves) + los 4 SUMMARY de plan.
> **Sin re-ejecutar la suite** — cada dimensión referencia el resultado empírico ya registrado.

---

## Test Infrastructure

| Property | Value |
|----------|-------|
| **Framework** | node:test (built-in runner, `node --test`) + `node:assert/strict` |
| **Config file** | none — runner nativo, convención `test/**/*.test.js` |
| **Quick run command** | `node --test test/server-auth.test.js test/server-bind.test.js test/server/auth.test.js` |
| **Full suite command** | `npm test` (`node --test $(find test -name '*.test.js' -type f)`) |
| **Estimated runtime** | ~60 segundos (suite completa **1843 pass / 1 skip / 0 fail** en la corrida citada) |
| **Evidencia citada** | `69-VERIFICATION.md` (2026-07-06T09:38:12Z, status passed, score 12/12 must-haves, `behavior_unverified: 0`, `overrides_applied: 0`) |

---

## Sampling Rate

- **Evidencia primaria:** `69-VERIFICATION.md` — verificación inicial passed, 12/12 observable truths + 6/6 required artifacts + 5/5 key-links verificados, con `behavior_unverified: 0`.
- **Política Nyquist (backfill):** la cobertura ES la cita a la evidencia preexistente; no se re-corre la suite (**D-12**).
- **UAT humano bloqueante:** esta fase **no tiene `69-UAT.md`** y su `69-VERIFICATION.md` §Human Verification Required declara explícitamente **«None»** — todos los must-haves se cubren con tests de integración/unidad que ejercitan HTTP real (servidores en puerto efímero, socket TCP crudo para el caso de crash-repro), no con comprobaciones de presencia. Las dos filas de §Manual-Only Verifications son **complementarias** (defensa en profundidad sobre red física / servicio externo vivo), no huecos de cobertura.

---

## Per-Task Verification Map (dimensión → cobertura citada)

| Requirement | Plan | Dimensión / Secure Behavior | Test Type | Automated Command | Evidencia citada (fichero + resultado) | Status |
|-------------|------|-----------------------------|-----------|-------------------|----------------------------------------|--------|
| NET-01 | 69-01 / 69-02 | `config.server.bind` por defecto `127.0.0.1` y ambos `listen()` lo usan; un bind vacío o de solo espacios **no** expone `0.0.0.0` en silencio (hardening WR-04) | integration (HTTP real, puerto efímero) | `node --test test/server-bind.test.js test/config.test.js` | `69-VERIFICATION.md` Observable Truths → Truth #1 y Truth #2 ✓ VERIFIED (`src/config.js:64` `bind: '127.0.0.1'`; `src/server.js:482` resuelve `host`; `grep -c "server.listen(port, host"` = **2**, líneas 811 y 827; `bind:''` y `bind:'   '` resuelven a loopback); Behavioral Spot-Checks → suite de fase **122 pass / 0 fail** | ✅ green |
| NET-02 | 69-02 | Default-deny en la cabecera del pipeline: el rail no-webhook (`GET /status`, `/logs`, `/comments/:id`, `DELETE /sessions/:id`) responde 401 `{"error":"unauthorized"}` sin bearer válido y 200 con el correcto; `/health` queda abierto y `/webhook` conserva su HMAC intacta | integration (HTTP real) | `node --test test/server-auth.test.js` | `69-VERIFICATION.md` Truth #3 y Truth #4 ✓ VERIFIED (`src/server.js:570-580` guard `isOpenRoute` + `parseBearer` + `timingSafeTokenEqual`; `isOpenRoute` allowlista solo `GET /health` + `POST /webhook`; el webhook con firma mala devuelve 400/401 de HMAC, **no** el 401 de bearer); Behavioral Spot-Checks → **122 pass / 0 fail** | ✅ green |
| NET-02 | 69-01 | Primitivas de auth puras/DI: comparación de bearer en tiempo constante que **nunca lanza** ante longitudes distintas; token CSPRNG de 64 hex autogenerado, persistido por el único escritor de secretos 0600 y cuyo valor **jamás** se loguea | unit | `node --test test/server/auth.test.js` | `69-VERIFICATION.md` Truth #5 y Truth #6 ✓ VERIFIED (`src/server/auth.js:66-75` length-guard + try/catch sobre `crypto.timingSafeEqual`; `:115-135` `getOrCreateApiToken` con `randomBytes(32).toString('hex')` → `writeEnvVar`, log solo del literal `ENABLED`, con aserción de captura de consola); §Required Artifacts → los 5 símbolos presentes, **39 subtests / 122 assertions** ✓ VERIFIED | ✅ green |
| NET-02 | 69-02 / 69-03 | Los dos dashboards autenticados sin filtrar el token: el web (`/`, `/dashboard`) exige `?token=` y nunca sirve el shell HTML sin auth (token JSON-escapado, WR-02); el TUI Ink adjunta el bearer en sus 4 peticiones vía un único `fetchFn` inyectado, el 401 pinta un banner distinguible (nunca frame en blanco) y el token no aparece en el render | unit + integration | `node --test test/dashboard-client.test.js test/dashboard-status-line.test.js test/format-isolation.test.js` | `69-VERIFICATION.md` Truth #7 y Truth #8 ✓ VERIFIED (`src/server.js:570-580,743-746` + `:84` `JSON.stringify(String(token)).replace(/</g,'\\u003c')`; `dashboard/index.js:90` `makeAuthedFetch` cableado como prop en `:271`; `client.js:59` discriminante `code:'unauthorized'`; `SessionTable.js:142-143` banner en amarillo con precedencia); §Key Link Verification → `fetchFn` threading ✓ WIRED; invariante de color-isolation preservada | ✅ green |
| NET-03 | 69-02 | Un body POST > 1 MB se rechaza con 413 **antes** de cualquier trabajo de auth o de HMAC; un body ≤ 1 MB (incluido el del webhook) queda byte-idéntico. Drain-and-discard, no `req.destroy()` — el cliente lee un 413 limpio | integration (HTTP real) | `node --test test/server-body-limit.test.js` | `69-VERIFICATION.md` Truth #9 ✓ VERIFIED (`src/server.js:408-450` `readBody` acotado que importa `MAX_BODY_BYTES` de `auth.js`, sin segundo literal; rama 413 en `:761-766` antes de `handleWebhookRequest`); §Key Link Verification → `/webhook` → `readBody` ✓ WIRED, «`verifySignature` never runs on an oversized body» | ✅ green |
| NET-04 | 69-02 | Un handler que lanza devuelve el cuerpo neutral `{"error":"internal error"}`; el mensaje real solo va al log. Frontera de nivel superior (CR-01) además del catch de `/comments` | integration (HTTP real) | `node --test test/server-error-hygiene.test.js` | `69-VERIFICATION.md` Truth #10 ✓ VERIFIED (`src/server.js:703-710` catch de `/comments` + `:782-793` frontera top-level del review fix: ambos loguean por `console.error` y responden el cuerpo fijo); §Post-Plan Code Review Fixes → CR-01 confirmado en `HEAD`, no solo en el claim de `69-REVIEW-FIX.md` | ✅ green |
| NET-04 | 69-02 | Un request target o un percent-encoding malformado **nunca** tumba el daemon: `new URL()` y `decodeURIComponent` guardados → 400, y el proceso sigue sirviendo (CR-01 / WR-01) | integration (socket TCP crudo) | `node --test test/server-malformed-request.test.js` | `69-VERIFICATION.md` Truth #11 ✓ VERIFIED (`src/server.js:554-561` `new URL()` guardado; `:676-683` y `:722-729` `decodeURIComponent` guardados); Behavioral Spot-Checks → «Daemon survives a raw-TCP malformed request target» → 400 + cuerpo neutral y `/health` 200 **después** ✓ PASS (socket real, no `fetch`) | ✅ green |
| NET-05 | 69-04 | Un `sessionId` fuera de `/^[A-Za-z0-9_-]+$/` se rechaza **antes** de tocar el filesystem: hard reject con exit 2 en el borde CLI (`kodo logs`), guard soft no-lanzante dentro de `createLogger` que apaga el disk sink sin matar el bucle de reconcile; ids de reconcile/UUID no afectados | unit | `node --test test/logs-reader.test.js` | `69-VERIFICATION.md` Truth #12 ✓ VERIFIED (`src/logs/reader.js:30,74-76` rechazo duro antes del join de la ruta de logs; `src/logger.js:36,259-260` guard suave vía `diskSinkEnabled`); §Key Link Verification → «Guard precedes the join at line 74-76» ✓ WIRED | ✅ green |
| NET-06 | 69-04 | La topología multi-nodo queda documentada y auditable: default loopback, el camino deliberado de exposición vía `config.server.bind` + ACL, y la semántica retenida de bearer/HMAC/health, con la nota de seguridad WR-03 sobre el token en la URL (historial del navegador + rotación) | doc guard (artefacto) | `grep -c '^## Topología multi-nodo' README.md` → `1` | `69-VERIFICATION.md` Truth #12 ✓ VERIFIED (sección presente, `README.md:143` en la corrida citada) + §Required Artifacts → `README.md` «Topología multi-nodo» ✓ VERIFIED, «Present once, includes bind default, exposure path, ACL note, retained auth semantics, and the WR-03 token-rotation security note» | ✅ green |

*Status: ⬜ pending · ✅ green · ❌ red · ⚠️ flaky / manual-only*

---

## Wave 0 Requirements

Infraestructura existente (`node:test` nativo) cubre todos los requirements — sin framework install. Los dos items que el seed dejó pendientes quedaron resueltos **dentro** de la propia ejecución, no en una wave 0 previa: los ficheros de test de auth / bind / body-limit se crearon en el plan 69-02 (`test/server-auth.test.js`, `test/server-bind.test.js`, `test/server-body-limit.test.js`, `test/server-error-hygiene.test.js`, ver `69-02-SUMMARY.md` §key-files) y las primitivas puras en 69-01 (`test/server/auth.test.js`). No hicieron falta fixtures compartidos: cada test levanta su propio `http.Server` en puerto efímero. `wave_0_complete` se conserva en `false` tal y como llegaba (**D-14**: ante duda no se re-deriva un flag de proceso ya cerrado).

---

## Manual-Only Verifications

| Behavior | Requirement | Why Manual | Evidencia |
|----------|-------------|------------|-----------|
| 401 desde otro nodo de la LAN (`curl http://<ip-del-host>:9090/status` desde un segundo host → 401; con `Authorization: Bearer <token>` → 200) | NET-01 / NET-02 | Requiere un segundo host físico o VM en la LAN. Es **complementaria**, no un hueco: la rama de código no depende del origen del paquete. | Sin UAT registrado para esta fase — `69-VERIFICATION.md` §Human Verification Required declara **«None»**. La dimensión que este item ejercita está cubierta de forma automatizada por `test/server-auth.test.js`, que conduce HTTP **real** contra un servidor en puerto efímero y afirma todos los casos (Truth #3 ✓ VERIFIED), y el default loopback por `test/server-bind.test.js` (Truth #1/#2 ✓ VERIFIED). Lo único no reproducido es el salto de red físico. |
| Webhook de Plane real con HMAC intacto (mover un work item etiquetado → el server lo despacha con el bind expuesto vía `config.server.bind`) | NET-06 | Requiere una instancia de Plane externa viva entregando el webhook. Manual-only **por construcción**: depende de un servicio de terceros. | Sin UAT registrado — `69-VERIFICATION.md` §Human Verification Required: **«None»**. La invariante que protege sí está citada: `/webhook` sigue en la allowlist de `isOpenRoute` y llega a su verificación HMAC sin pasar por el 401 de bearer (Truth #4 ✓ VERIFIED), y el 413 dispara **antes** que `verifySignature` (§Key Link Verification, `/webhook` → `readBody` ✓ WIRED). Lo no reproducido es la entrega desde el Plane real. |

---

## Validation Sign-Off

- [x] Cada requirement (NET-01..06) mapeado a ≥1 cita de evidencia real en `69-VERIFICATION.md`
- [x] Continuidad de sampling: cobertura automatizada verde para las 9 dimensiones de riesgo (bind por defecto, default-deny, primitivas de auth, ambos dashboards, cap de body, higiene de errores, request malformado, path traversal por `sessionId`, documentación de topología)
- [x] Wave 0 cubre todas las referencias MISSING (ninguna — infra nativa suficiente, los ficheros de test se crearon dentro de 69-01/69-02)
- [x] Sin watch-mode flags
- [x] Ninguna fase declarada N/A — evidencia empírica real citada
- [x] `nyquist_compliant` fijado a **true** en el frontmatter

**Approval:** validated 2026-07-27 (backfill Phase 85, NYQ-02)

---

## Reconstruction Audit 2026-07-27 (Phase 85 NYQ-02)

| Metric | Count |
|--------|-------|
| Requirements audited | 6 (NET-01..06) |
| COVERED (automated unit/integration) | 6 |
| PARTIAL | 0 |
| MISSING | 0 |
| Manual-only (by design, complementario) | 2 items de red física / servicio externo (401 desde otro nodo de la LAN; webhook de Plane real) — ninguno es requirement descubierto |
| Tests citados (no re-corridos) | **122 pass / 0 fail** en la suite de fase de 11 ficheros (`server/auth` + `config` + `server-auth` + `server-bind` + `server-body-limit` + `server-error-hygiene` + `server-malformed-request` + `dashboard-client` + `dashboard-status-line` + `format-isolation` + `logs-reader`), sobre suite completa **1843 pass / 1 skip / 0 fail** |

**Nota Nyquist:** La lógica de riesgo de la fase (superficie de escucha reducida a loopback con exposición explícita, default-deny en la cabecera del pipeline de forma que una ruta no listada siga protegida, comparación de bearer en tiempo constante que nunca lanza, token CSPRNG que nunca se loguea, corte del body pre-auth y pre-HMAC, cuerpos de error neutros, resistencia a request targets malformados y allowlist positiva contra path traversal en `sessionId`) está cubierta por tests de integración que ejercitan HTTP real —incluido un socket TCP crudo para el caso de crash— y por unit tests con DI, ya verde y verificada en `69-VERIFICATION.md` (passed 12/12, `behavior_unverified: 0`, `overrides_applied: 0`, §Gaps Summary «No gaps»). Los dos items manual-only son **complementarios por construcción** (segundo host en la LAN, instancia de Plane viva), no huecos de sampling: su rama de código sí está citada y verde. **Sin re-ejecutar la suite** — cobertura citada de `69-VERIFICATION.md` + 69-0{1,2,3,4}-SUMMARY.md. Fase declarada **nyquist-compliant**.
