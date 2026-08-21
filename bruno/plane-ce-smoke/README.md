# Plane CE smoke — checkpoint D-07 (Phase 52)

Colección [Bruno](https://www.usebruno.com/) para verificar empíricamente el shape del **201**
de creación de work-items contra tu Plane **CE** real — el único ítem MEDIUM-confidence de la
Phase 52 (`createTask`). Cada request mapea a un método real de `src/providers/plane/client.js`.

## Setup (1 min)

1. Abre Bruno → **Open Collection** → selecciona esta carpeta (`bruno/plane-ce-smoke/`).
2. Selecciona el environment **"Plane CE"** (arriba a la derecha) y rellena:
   - `baseUrl` — host de tu Plane (ej. `https://plane.midominio.com`). **Sin** `/api/v1` (la colección lo añade).
   - `workspaceSlug` — el slug del workspace.
   - `apiKey` — **secret var**: el valor de `PLANE_API_KEY` de `~/.kodo/.env`.
   - `projectId` — lo rellenas tras correr el request 01.
3. Ejecuta en orden. Mira la consola de Bruno (panel inferior) para los `console.log`.

## Requests

| # | Request | Verifica | Método de kodo |
|---|---------|----------|----------------|
| 01 | List Projects | Creds OK + obtener un `projectId` | `listProjects` |
| 02 | List States | UUID del estado in-progress (D-04) | `listStates` |
| 03 | List Labels | lookup del marker `kodo:adopted` (Q1) | (lado lookup) |
| 04 | Create Label | create del marker → label UUID (Q1) | `createLabel` |
| 05 | **Create Work Item (D-07)** | **shape del 201** (id, sequence_id, state, project) | `createWorkItem` |
| 06 | Get Work Item | qué campos vienen embebidos vs caches | `getWorkItem` |

El request **05** es el del checkpoint. Body mínimo `{ "name": ... }` (único campo required)
para aislar el shape del 201.

## Cómo reportar a kodo

- Si el 201 trae `id` + `sequence_id` (numérico) + `state`/`project` resolubles → responde
  **"approved"** con el `sequence_id` que viste.
- Si el shape diverge (falta `sequence_id`, `state` no resoluble, etc.) → **pega el JSON crudo**
  del 201 y ajusto `normalizeWorkItem` antes de cerrar la fase.

## Notas

- Las URLs conservan el **trailing slash** (`/work-items/`, `/labels/`): Plane CE es
  trailing-slash-strict y un POST sin `/` da 404 solo en create — load-bearing.
- Esta colección es throwaway (verificación puntual). Puedes borrar `bruno/` tras el checkpoint.
  No está trackeada en git salvo que la añadas explícitamente; el `apiKey` es un secret var
  (no se persiste en plano en los `.bru`).
- La work-item de prueba ("kodo adopt smoke test") queda creada en tu Plane — bórrala desde
  la UI si no la quieres.
