// @ts-check
//
// src/integration/suggest.js — KODO-26 (cola de integración): heurística de tier.
//
// Hoja PURA de CERO imports: entra el resumen del diff de una rama, sale UNA sugerencia
// de cómo integrarla. No hace I/O, no llama a git, no lee state.json y no lanza nunca.
// Quien calcula el diff es `capture.js`; quien decide de verdad es el operador — esto es
// una SUGERENCIA visible y explicable, no una decisión (invariante del enunciado).
//
// El mapeo es el de la política de merge de 3 tiers del operador (blast radius):
//   docs/tests-only            → 'ff'      (Tier 1: riesgo bajo, fast-forward local)
//   src sin nada sensible      → 'merge'   (Tier 2: feature/refactor)
//   migraciones/auth/billing   → 'pr'      (Tier 3: riesgo alto, PR + review)
//   diff grande (> UMBRAL)     → 'pr'      (el tamaño es su propio blast radius)
//   sin datos inspeccionables  → 'review'  (kodo NO adivina: que lo mire un humano)
//
// DEGRADACIÓN POR BASE ATRASADA (regla dura, no heurística): un `ff` solo se sugiere si la
// rama contiene la base entera (`baseOk === true`). Si la base avanzó por debajo, o si no se
// pudo verificar (`null`), el `ff` NO es aplicable — `git merge --ff-only` fallaría — y la
// sugerencia baja a 'merge'. Es la única regla que puede pisar al resto, y solo va en esa
// dirección: jamás sube un tier, jamás convierte un 'pr' en algo más barato.

/**
 * Umbral de líneas tocadas (insertions + deletions) a partir del cual el tamaño manda por sí
 * solo: un diff así ya no se revisa de un vistazo en un fast-forward local. Valor deliberado y
 * redondo — no está calibrado sobre ninguna medición, es la línea que el operador puede mover
 * en un sitio. Se compara con `>` (400 exactas todavía no fuerzan PR).
 */
export const BIG_DIFF_LINES = 400;

/**
 * Rutas de alto blast radius (Tier 3). CONSTANTE DE MÓDULO, jamás compilada desde input
 * externo (anti-ReDoS). Alternación plana sin cuantificadores anidados: no hay backtracking
 * catastrófico posible.
 *
 * Cubre las tres familias que el operador nombra explícitamente — migraciones de esquema,
 * autenticación y cobros — más los ficheros de credenciales, que pertenecen a la misma clase
 * («si esto sale mal, no se arregla con un revert»). El match es por SEGMENTO de ruta
 * (`(^|/)…(/|$)`), no por subcadena: `src/authors/index.js` NO es `auth`, y `db/migrate/…` sí.
 */
const RISKY_PATH_RE =
  /(^|\/)(db\/migrate|migrations?|migrate|auth|authentication|authorization|billing|payments?|stripe|subscriptions?|credentials|secrets)(\/|$)|(^|\/)(schema\.rb|structure\.sql|\.env|\.env\.[A-Za-z0-9_.-]+|master\.key)$/i;

/**
 * Documentación y tests (Tier 1). Misma disciplina que `RISKY_PATH_RE`: constante, alternación
 * plana, match por segmento salvo en las extensiones.
 *
 * Incluye `.planning/` y `.compound/` porque en este repo son documentación de proceso, no
 * código — un cambio ahí no puede romper la suite. Incluye los sufijos `*.test.js`,
 * `*.spec.ts`, `*_test.go` y los directorios `test/`, `spec/`, `__tests__/`.
 */
const DOCS_TESTS_PATH_RE =
  /(^|\/)(docs?|documentation|\.planning|\.compound|test|tests|spec|specs|__tests__)(\/|$)|\.(md|mdx|txt|rst|adoc)$|(^|\/)[^/]+[._-](test|spec)\.[A-Za-z0-9]+$/i;

/**
 * Deriva la sugerencia de integración de una rama.
 *
 * PURA y TOTAL: cualquier entrada — incluidas las degeneradas (`files` no-array, `lines`
 * NaN, objeto vacío, `undefined`) — devuelve uno de los cuatro literales. Nunca lanza.
 *
 * @param {{
 *   files?: string[] | null,
 *   lines?: number | null,
 *   baseOk?: boolean | null,
 * }} [input]
 *   `files`: rutas relativas tocadas por la rama respecto de su base. `null` (o no-array) =
 *   NO se pudo inspeccionar el diff — distinto de `[]`, que es «se inspeccionó y no hay
 *   ficheros» (típico de una rama con solo merge commits). Los dos caen a 'review', pero por
 *   razones distintas y ambas legítimas: sin ficheros no hay blast radius que estimar.
 *   `lines`: insertions + deletions. `null` = desconocido → no dispara el corte por tamaño.
 *   `baseOk`: ¿la rama contiene la base entera? Solo `true` habilita el 'ff'.
 * @returns {'ff'|'merge'|'pr'|'review'}
 */
export function suggestTier(input) {
  const files = input && Array.isArray(input.files) ? input.files : null;
  const lines = input && typeof input.lines === 'number' && Number.isFinite(input.lines)
    ? input.lines
    : null;
  const baseOk = input ? input.baseOk : undefined;

  // Sin diff inspeccionable no hay heurística honesta que aplicar. 'review' NO es un fallback
  // de conveniencia: es el cuarto tier del contrato, y significa exactamente «kodo no sabe».
  if (files === null || files.length === 0) return 'review';

  if (files.some((f) => typeof f === 'string' && RISKY_PATH_RE.test(f))) return 'pr';
  if (lines !== null && lines > BIG_DIFF_LINES) return 'pr';

  const docsTestsOnly = files.every((f) => typeof f === 'string' && DOCS_TESTS_PATH_RE.test(f));
  // La degradación va aquí, en el único lane que puede producir 'ff' — no como un
  // post-proceso sobre el resultado, para que sea imposible degradar un 'pr' por error.
  if (docsTestsOnly) return baseOk === true ? 'ff' : 'merge';

  return 'merge';
}
