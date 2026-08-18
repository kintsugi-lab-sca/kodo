---
fecha: 2026-08-18
proyecto: kodo
slug: kodo13-identifier-plane
---

## Resumen
Arreglado KODO-13: `init()` del provider de Plane solo resolvía los proyectos contra la API cuando venían como UUID strings, así que el identifier cacheado en config.json nunca se revalidaba y un proyecto renombrado (ITROMAN → ITCLIP) producía refs fantasma.
El ref sale ahora del identifier que devuelve Plane (fail-open ante fallo de red), con warning de divergencia y un nuevo `kodo doctor --identifiers`; verificado end-to-end contra la instancia real.

## Reto
La condición `typeof config.projects[0] === 'string'` hacía que el bug fuera invisible en la lectura rápida: el código SÍ resolvía contra la API, pero solo en el estado pre-`kodo config`. Además, mover la resolución fuera del config del caller no salió del diseño sino del test de contrato de TaskProvider, que pasa un config congelado — el `Object.freeze` fue quien delató el efecto lateral.

## Propuesta de skill
Una skill `verify-against-provider`: para bugs de "el dato local no coincide con el remoto", montar un script de solo lectura que reproduzca el estado obsoleto contra la API real y demuestre el antes/después, en vez de fiarse únicamente de los stubs de `globalThis.fetch` (que devuelven `{results: []}` y ocultan precisamente el camino que falla).
