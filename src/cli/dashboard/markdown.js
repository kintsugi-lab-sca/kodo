// @ts-check
//
// src/cli/dashboard/markdown.js — Phase 75 Plan 03 (LIVE-06; D-05/D-06/T-75-02).
//
// Mini-renderer markdown LINE-BASED best-effort para el overlay del plan LIGERO (carril
// phaseId==null). NO es un parser CommonMark (D-05, RESEARCH Pitfall 3): mapea cada línea
// a un `<Text>` de ink con estilo heurístico (heading/label/bullet/fence). SOLO se aplica
// al carril light desde `renderOverlay` cuando `snap.render === 'markdown'`; la rama GSD
// jamás pasa por aquí (D-02 LOCKED, SC3).
//
// ── Color-isolation (D-12) ─────────────────────────────────────────────────────────
// TODO el color sale de props de `<Text>` de ink (bold/dimColor/color name). CERO
// picocolors, CERO ANSI inline — el guard `test/format-isolation.test.js` escanea los
// imports de src/cli/dashboard/**.
//
// ── Saneo del contenido LLM (T-75-02, V5) ──────────────────────────────────────────
// El markdown del plan lo escribe un LLM (contenido no confiable). Cada línea pasa por
// `stripControlChars` ANTES de proyectarse al terminal — neutraliza OSC-52/CSI/C1.
//
// ── Marcador invisible (D-06) ──────────────────────────────────────────────────────
// El strip del marcador `<!-- kodo:handoff … -->` se delega en `stripHandoffMarker` de
// handoff.js (dueño ÚNICO del contrato, D-13) — NO una regex ad-hoc divergente aquí.

import { Text } from 'ink';
import { createElement as h } from 'react';
import { stripHandoffMarker } from '../../session/handoff.js';
import { stripControlChars } from '../sanitize.js';

/** Delimitador de code fence (triple comilla invertida). */
const FENCE = '```';

/**
 * Renderiza un array de líneas de markdown a un array de `<Text>` (uno por línea), en el
 * MISMO orden y con keys estables por índice absoluto. Best-effort line-based (NO CommonMark).
 *
 * El toggle de code fence se acumula recorriendo las líneas desde 0, de modo que el estado
 * es correcto aunque el caller luego sliceе el array por scroll (se slicean los elementos,
 * no las líneas — el fence ya quedó resuelto por posición absoluta).
 *
 * Estilo por línea (tras `stripControlChars`):
 *   - dentro de un fence (incl. la línea delimitadora ```) → `{ dimColor: true }`.
 *   - heading (`# `/`## `) → `{ bold: true, color: 'cyan' }`, con el marcador handoff strippeado (D-06).
 *   - label (`**` inicial, p. ej. `**Hecho:**`) → `{ bold: true }`.
 *   - bullet (`- `/`* `) → sin atributo (plano).
 *   - resto → sin atributo (plano).
 *
 * @param {string[]} lines  Líneas del markdown del plan ligero (contenido de un LLM).
 * @returns {import('react').ReactElement[]} Un `<Text>` por línea. Nunca lanza.
 */
export function renderMarkdownLines(lines) {
  /** @type {import('react').ReactElement[]} */
  const out = [];
  let inFence = false;
  const arr = Array.isArray(lines) ? lines : [];
  for (let i = 0; i < arr.length; i++) {
    // Saneo del contenido LLM ANTES de cualquier decisión de estilo (T-75-02).
    const clean = stripControlChars(arr[i]);
    const trimmed = clean.trimStart();
    const key = `md-${i}`;

    // 1. Code fence: el delimitador ``` alterna el estado; la línea delimitadora y las de
    //    dentro se pintan dim. Se evalúa PRIMERO para que el contenido del fence no se
    //    reinterprete como heading/label/bullet.
    if (trimmed.startsWith(FENCE)) {
      out.push(h(Text, { key, dimColor: true }, clean));
      inFence = !inFence;
      continue;
    }
    if (inFence) {
      out.push(h(Text, { key, dimColor: true }, clean));
      continue;
    }

    // 2. Heading: strip del marcador handoff (D-06 — dueño único), bold + cyan.
    if (trimmed.startsWith('# ') || trimmed.startsWith('## ')) {
      out.push(h(Text, { key, bold: true, color: 'cyan' }, stripHandoffMarker(clean)));
      continue;
    }

    // 3. Label (`**Hecho:**`, `**NEXT:**`): bold, sin color.
    if (trimmed.startsWith('**')) {
      out.push(h(Text, { key, bold: true }, clean));
      continue;
    }

    // 4. Bullet / resto: plano (best-effort; no se transforma el texto).
    out.push(h(Text, { key }, clean));
  }
  return out;
}
