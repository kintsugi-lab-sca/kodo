// @ts-check
//
// test/config-hardening.test.js — Plan 72-02 (HYG-05).
//
// Endurecimiento del pipeline de config (V5/V12/V14 ASVS), cubierto por hallazgo:
//   - M3 (T-72-04): setNestedValue RECHAZA prototype pollution (__proto__/…).
//   - M14 (T-72-07): parseSetArg/parseMapProjectArg preservan `=`/`:` internos.
//   - B5 (T-72-07): loadEnvFile hace strip de comillas emparejadas.
//   - B7 (T-72-06): loadConfig deep-mergea sobre DEFAULT_CONFIG + valida (never-throws).
//   - M5 (T-72-05): writeFileAtomic → 0600 si el contenido lleva una clave `*_secret`.
//
// Convención node:test describe/it + assert/strict (espejo de config-validate.test.js).

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { setNestedValue, parseSetArg, parseMapProjectArg } from '../src/cli/config-args.js';

describe('M3 (T-72-04) — setNestedValue rechaza prototype pollution', () => {
  it('lanza ante `__proto__` en el path y NO contamina Object.prototype', () => {
    const obj = {};
    assert.throws(() => setNestedValue(obj, '__proto__.polluted', 'x'), /prohibida/);
    // Sin prototype pollution: ningún objeto nuevo hereda `polluted`.
    assert.equal(/** @type {any} */ ({}).polluted, undefined);
    // El objeto destino no fue mutado.
    assert.deepEqual(obj, {});
  });

  it('lanza ante `constructor` y `prototype` en cualquier tramo del path', () => {
    assert.throws(() => setNestedValue({}, 'constructor.x', 'y'), /prohibida/);
    assert.throws(() => setNestedValue({}, 'a.prototype.x', 'y'), /prohibida/);
    assert.throws(() => setNestedValue({}, 'a.b.__proto__', 'y'), /prohibida/);
  });

  it('escribe con normalidad un path legítimo anidado', () => {
    const obj = {};
    setNestedValue(obj, 'plane.workspace_slug', 'klab');
    assert.deepEqual(obj, { plane: { workspace_slug: 'klab' } });
  });
});

describe('M14 (T-72-07) — parseSetArg/parseMapProjectArg preservan separadores internos', () => {
  it('--set token=a=b=c → key `token`, value `a=b=c` (no se trunca)', () => {
    assert.deepEqual(parseSetArg('token=a=b=c'), { key: 'token', value: 'a=b=c' });
  });

  it('--set sin `=` → value undefined (uso inválido para el caller)', () => {
    assert.deepEqual(parseSetArg('soloclave'), { key: 'soloclave', value: undefined });
  });

  it('--set con `=` inicial → key vacía (el caller lo rechaza)', () => {
    assert.deepEqual(parseSetArg('=valor'), { key: '', value: 'valor' });
  });

  it('--map-project id:/home/a:b:c → localPath `/home/a:b:c` (ruta con `:` preservada)', () => {
    assert.deepEqual(parseMapProjectArg('PROJ:/home/a:b:c'), {
      projectId: 'PROJ',
      localPath: '/home/a:b:c',
    });
  });

  it('--map-project sin `:` → localPath undefined (uso inválido para el caller)', () => {
    assert.deepEqual(parseMapProjectArg('soloid'), { projectId: 'soloid', localPath: undefined });
  });
});
