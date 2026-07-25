# Deferred items — Phase 83

## 83-04 · RMW del inbox sobre string UTF-8: un byte inválido bloquea el marcado

**Origen:** consecuencia deliberada del guard compare-and-swap de `markCapture` (Plan 04, GAP-1).

**Qué pasa:** el RMW lee con `readFileSync(inboxPath, 'utf-8')`. Si el fichero contiene bytes que
no son UTF-8 válido (un hand-edit en latin-1, un pegado desde otra codificación), Node los
sustituye por U+FFFD y `Buffer.byteLength(raw, 'utf-8')` deja de igualar el `size` del fichero de
forma PERMANENTE. El guard lo interpreta como «el fichero cambió» en los 5 intentos y `markCapture`
devuelve `{ok:false, reason:'concurrent-write'}` sin tocar nada: la captura no se puede cerrar
hasta que el operador arregle el byte.

**Por qué NO se arregla aquí:** la dirección del fallo es la correcta. La alternativa —publicar—
reescribiría ese byte ajeno como mojibake, violando la preservación byte a byte de D-04 (el
fichero es human-editable por diseño). Fallar ruidosamente es estrictamente mejor que corromper en
silencio, y esta plan tenía por objetivo exactamente eso.

**Arreglo real, si algún día compensa:** hacer el round-trip del RMW sobre `Buffer` en vez de sobre
`string`, troceando por `0x0a` y sustituyendo solo el slice de la línea marcada. Elimina de raíz la
desigualdad byte/carácter y hace la preservación byte a byte estructural en vez de accidental. Es
un cambio de la forma interna de `markCapture` (no de su contrato público) y no cabía en el alcance
quirúrgico de un plan de gap-closure.

**Impacto observado hoy:** ninguno en el carril normal — todo lo que kodo escribe es UTF-8 válido.
Solo alcanzable por un hand-edit del operador con otra codificación.
