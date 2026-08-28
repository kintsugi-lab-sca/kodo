// @ts-check
//
// src/cli/exit-codes.js — códigos de salida del CLI (KODO-42).
//
// El contrato NO nace aquí: lo publica el README (tabla de `kodo capture` / `kodo inbox`,
// línea de exit codes de `kodo integrate`, `kodo doctor`) y lo consumen scripts y el
// orquestador. Estas constantes solo lo hacen greppable: hasta KODO-42 eran literales
// numéricos sueltos repartidos por `src/cli.js` (35 llamadas), imposibles de cruzar con
// la documentación sin leer el fichero entero.
//
//   0 — la acción se ejecutó.
//   1 — falló: error de fs/red/git, precondición rota, o excepción no prevista.
//   2 — uso incorrecto o gate de configuración: argumento inválido, id inexistente,
//       entrada ya cerrada, provider sin configurar.
//
// Los módulos `src/cli/*.js` que ya devolvían estos códigos como números siguen
// haciéndolo; KODO-42 no los reescribe en bloque (queda para el módulo que se toque).

export const EXIT_SUCCESS = 0;
export const EXIT_ERROR = 1;
export const EXIT_USAGE = 2;
