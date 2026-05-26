// @ts-check
//
// src/cli/dashboard/App.js — Phase 34 Plan 02 (TUI-01/TUI-03/TUI-04).
//
// Componente root ink del dashboard. En Phase 34 NO renderiza datos reales: el
// cuerpo es el placeholder estático `starting…` (D-02). El header con contadores
// + indicador "live" y el cuerpo con datos llegan en Phase 36.
//
// Chrome estático D-01:
//   - banner `kodo dashboard` (arriba)
//   - placeholder central `starting…` (U+2026, NO tres puntos ASCII)
//   - footer hint `q quit`
//
// Lifecycle de salida:
//   - `q` → useApp().exit() (D-08): desmonta limpio, NO process.exit.
//   - `Esc` deliberadamente NO sale (D-11): reservado para overlays de Phase 38.
//   - useInput gateado por useStdin().isRawModeSupported (belt-and-suspenders,
//     Pitfall 1) — defensa extra aunque el guard pre-render de index.js ya
//     rechaza non-TTY.
//
// Color-isolation (D-12): todo el color sale de props de <Text> de ink; cero
// import del helper de color del CLI clásico. Markup via React.createElement
// plano (no JSX, no build step).

import { Box, Text, useApp, useInput, useStdin } from 'ink';
import { createElement } from 'react';

/**
 * Componente root del dashboard TUI.
 *
 * @param {object} props
 * @param {string} props.baseUrl - Base URL del server kodo (resuelta en index.js;
 *   no se consume todavía en Phase 34 — el cuerpo es placeholder estático).
 * @returns {import('react').ReactElement}
 */
export default function App({ baseUrl }) {
  const { exit } = useApp();
  const { isRawModeSupported } = useStdin();

  useInput(
    (input) => {
      // `q` sale via exit() (D-08): clean unmount, NO process.exit.
      // `Esc` deliberadamente NO se maneja (D-11): reservado Phase 38.
      if (input === 'q') exit();
    },
    { isActive: isRawModeSupported },
  );

  return createElement(
    Box,
    { flexDirection: 'column', borderStyle: 'round', paddingX: 1 },
    createElement(Text, { bold: true }, 'kodo dashboard'),
    createElement(Box, { marginY: 1, paddingX: 1 }, createElement(Text, { dimColor: true }, 'starting…')),
    createElement(Text, { dimColor: true }, 'q quit'),
  );
}
