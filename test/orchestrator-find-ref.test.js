// @ts-check
//
// test/orchestrator-find-ref.test.js — helper puro findOrchestratorRef (extraído de
// launchOrchestrator para reusarlo en el endpoint POST /orchestrator). Resuelve el
// `workspace:N` del orquestador desde el texto crudo de cmux.listWorkspaces().

import { describe, it, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { findOrchestratorRef } from '../src/orchestrator/launch.js';

describe('findOrchestratorRef — resolución pura del ref del orquestador', () => {
  it('devuelve el workspace:N cuando kodo-orchestrator está en la lista', () => {
    const list = 'workspace:3  KL-1\nworkspace:12  kodo-orchestrator\nworkspace:5  ROMAN-2';
    assert.equal(findOrchestratorRef(list), 'workspace:12');
  });

  it('devuelve null cuando no hay orquestador', () => {
    const list = 'workspace:3  KL-1\nworkspace:5  ROMAN-2';
    assert.equal(findOrchestratorRef(list), null);
  });

  it('devuelve null ante lista vacía', () => {
    assert.equal(findOrchestratorRef(''), null);
  });

  it('never-throws ante input no-string (null/undefined/número)', () => {
    assert.equal(findOrchestratorRef(/** @type {any} */ (null)), null);
    assert.equal(findOrchestratorRef(/** @type {any} */ (undefined)), null);
    assert.equal(findOrchestratorRef(/** @type {any} */ (42)), null);
  });

  it('devuelve null si el nombre aparece pero sin un workspace:N asociado (fall-through a crear)', () => {
    // El nombre suelto sin `workspace:N ` delante no debe resolver un ref falso.
    assert.equal(findOrchestratorRef('kodo-orchestrator (pendiente)'), null);
  });
});

describe('persist/readOrchestratorRef — ref persistido para el daemon (window-independiente)', () => {
  /** @type {string} */ let tmpHome;
  /** @type {string | undefined} */ let savedHome;
  /** @type {typeof import('../src/orchestrator/launch.js')} */ let mod;

  before(async () => {
    tmpHome = mkdtempSync(join(tmpdir(), 'kodo-orchref-'));
    mkdirSync(join(tmpHome, '.kodo'), { recursive: true });
    savedHome = process.env.HOME;
    process.env.HOME = tmpHome; // ORCHESTRATOR_REF_PATH se computa desde homedir() en load
    mod = await import(`../src/orchestrator/launch.js?orchref-${Date.now()}`);
  });

  after(() => {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (tmpHome) rmSync(tmpHome, { recursive: true, force: true });
  });

  it('readOrchestratorRef → null cuando el fichero no existe', () => {
    assert.equal(mod.readOrchestratorRef(), null);
  });

  it('roundtrip: persist escribe y read lee el mismo workspace:N', () => {
    mod.persistOrchestratorRef('workspace:38');
    assert.ok(existsSync(mod.ORCHESTRATOR_REF_PATH), 'el fichero debe existir tras persistir');
    assert.equal(mod.readOrchestratorRef(), 'workspace:38');
  });

  it('read → null ante JSON corrupto (never-throws)', () => {
    writeFileSync(mod.ORCHESTRATOR_REF_PATH, '{ not json');
    assert.equal(mod.readOrchestratorRef(), null);
  });

  it('read → null ante shape inválida (sin ref string)', () => {
    writeFileSync(mod.ORCHESTRATOR_REF_PATH, JSON.stringify({ ref: 42 }));
    assert.equal(mod.readOrchestratorRef(), null);
    writeFileSync(mod.ORCHESTRATOR_REF_PATH, JSON.stringify({ other: 'x' }));
    assert.equal(mod.readOrchestratorRef(), null);
  });
});
