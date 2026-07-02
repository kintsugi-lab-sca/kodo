---
status: testing
phase: 67-secrets-writer-masked-input
source: [67-VERIFICATION.md]
started: 2026-07-02T10:52:54Z
updated: 2026-07-02T10:52:54Z
---

## Current Test

number: 1
name: Arrancar el daemon (`kodo up`)
expected: |
  El daemon + dashboard arrancan sin error.
awaiting: user response

## Tests

### 1. Arrancar el daemon
expected: `kodo up` — el daemon + dashboard arrancan sin error.
result: [pending]

### 2. Editar la API key vía el campo enmascarado del dashboard
expected: |
  En el dashboard: `e` → `↓` hasta "API key del provider" → `Enter` → teclear `secret_key_123` → `Enter`.
  Mientras tecleas se pinta `•` por carácter (nunca el valor raw); tras guardar aparece `[configurado]`
  y el aviso de reiniciar el daemon para aplicar.
result: [pending]

### 3. `ps` — el valor NO aparece en argv
expected: |
  `ps aux | grep kodo | grep -v grep` → cero ocurrencias de `secret_key_123` en la línea de comando
  (P11: el secreto se escribe en-proceso, jamás vía shell-out).
result: [pending]

### 4. Logs — el valor NO aparece en `~/.kodo/logs`
expected: `grep -r 'secret_key_123' ~/.kodo/logs` → resultado vacío (exit 1). Nunca se loguea.
result: [pending]

### 5. `/status` — el valor NO está en la respuesta
expected: `curl -s http://localhost:9090/status | grep 'secret_key_123'` → resultado vacío.
result: [pending]

### 6. Permisos del `.env` — exactamente `-rw-------` (0600)
expected: |
  `ls -l ~/.kodo/.env` → `-rw-------` (owner rw, sin grupo/otros). Equivalente:
  `stat -f '%Sp %Lp' ~/.kodo/.env` → `-rw------- 600` (Pitfall 13: chmod 0600 pre-rename).
result: [pending]

### 7. Sin `.env.tmp` residual
expected: `ls -l ~/.kodo/.env.tmp` → `No such file or directory`. El write atómico no deja artefactos.
result: [pending]

### 8. Otras env vars preservadas (parse-merge, sin clobber)
expected: |
  `cut -d= -f1 ~/.kodo/.env` → siguen presentes las demás keys previas (p.ej. `PLANE_WEBHOOK_SECRET`),
  no solo la recién escrita (Pitfall 14: upsert que preserva el resto verbatim).
result: [pending]

## Summary

total: 8
passed: 0
issues: 0
pending: 8
skipped: 0
blocked: 0

## Gaps
