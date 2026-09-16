---
fecha: 2026-09-16
proyecto: kodo
slug: ocr-delegate-en-reviewer
---

## Resumen
`kodo review start` inyecta el spec de `ocr delegate` (revisables, excluidos, checklist por regla del proyecto) en el prompt del reviewer, fail-open y con reglas para kodo y clipping.
Verificado sobre ramas reales de clipping (hasta 149 ficheros, 6 checklists en 8,8 KB) y con prompt idéntico byte a byte al de antes cuando falta `ocr` o la regla.

## Reto
El presupuesto del prompt tecleado por `cmux send`: en diffs grandes las listas de ficheros se comían los checklists, y los escapes literales `\t`/`\n` que cmux convierte en Tab/Enter.

## Propuesta de skill
Una skill `ocr-rules-author` que, dado un repo, lea su CLAUDE.md y un rango de git, genere un `rule.json` de OCR y lo valide con `ocr rules check` y `ocr delegate preview` antes de darlo por bueno.
