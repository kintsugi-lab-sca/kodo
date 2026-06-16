// @ts-check
//
// test/prompt-file.test.js — ficheros de prompt de sesión (src/session/prompt-file.js).
//
// Cubre el contrato write/path/remove que usan buildClaudeCommand (escribe) y el
// stop hook (borra): contenido VERBATIM, path determinístico por sessionId, y
// borrado fail-open (ausencia / sessionId vacío NUNCA lanzan).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { writePromptFile, removePromptFile, promptFilePath } from '../src/session/prompt-file.js';

describe('prompt-file', () => {
  it('writePromptFile escribe el contenido VERBATIM y devuelve el path', () => {
    const sid = 'pf-test-verbatim';
    // Veneno: \n y \t literales, backslashes, comilla simple, multibyte, em-dash.
    const prompt = "Trabaja en: Hero 'difícil'. Ruta C:\\new\\tabla, regex \\t, 4–5 fotografías.";
    const file = writePromptFile(sid, prompt);
    try {
      assert.equal(file, promptFilePath(sid), 'devuelve el path determinístico');
      assert.equal(readFileSync(file, 'utf-8'), prompt, 'sin escapar ni colapsar nada');
    } finally {
      removePromptFile(sid);
    }
  });

  it('promptFilePath es determinístico y único por sessionId', () => {
    assert.equal(promptFilePath('a'), promptFilePath('a'));
    assert.notEqual(promptFilePath('a'), promptFilePath('b'));
    assert.match(promptFilePath('sess-xyz'), /kodo-prompts[/\\]sess-xyz\.txt$/);
  });

  it('removePromptFile borra el fichero existente', () => {
    const sid = 'pf-test-remove';
    const file = writePromptFile(sid, 'algo');
    assert.ok(existsSync(file), 'precondición: el fichero existe');
    removePromptFile(sid);
    assert.ok(!existsSync(file), 'el fichero fue borrado');
  });

  it('removePromptFile es fail-open: ausencia o sessionId vacío no lanzan', () => {
    assert.doesNotThrow(() => removePromptFile('pf-test-inexistente-jamas-escrito'));
    assert.doesNotThrow(() => removePromptFile(undefined));
    assert.doesNotThrow(() => removePromptFile(null));
    assert.doesNotThrow(() => removePromptFile(''));
  });
});
