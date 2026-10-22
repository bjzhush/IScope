# ai-overview

Personal "AI 技术栈概览页". The full design is in `docs/design.md`. Read it before you change behavior. This file records how the code is laid out and the decisions that settle the doc's open points.

## Layout and commands

- Go module `github.com/bjzhush/ai-overview` at the repo root, React app in `web/`.
- sqlc is a tool in a separate module (`tools/go.mod`), which keeps its dependencies out of the main `go.mod`. Run it with `make gen`, which calls `go tool -modfile=tools/go.mod sqlc generate`. The generated code goes to `internal/store/db/`. Never edit those files by hand.
- sqlc reads the schema straight from the goose migrations in `internal/store/migrations/`.
- `make dev`, `make gen`, `make seed`, `make test` and `make build` work as described in the design doc. Use npm for the frontend.

## Decisions on top of the design doc (agreed for phase 1)

1. The drawer has no slug field. The slug is generated on create and does not change when the item is renamed. A 409 response carries `fields: {"name": ...}`.
2. Slugify: lowercase, replace spaces and dots with `-`, keep only `[a-z0-9-]`, collapse repeated `-` and trim it from both ends. If the result is empty, use the last 8 characters of the ULID, lowercased.
3. Restoring an archived item sets its status to `watching`.
4. `Field.Integer bool` (json `integer`) marks integer-only number fields: `context_window` and `max_output`. Prices get `Min: 0`.
5. `0001_init.sql` creates both tables. In phase 1 the board and item-detail endpoints return `relations: []`, and the seed writes items only.
6. Routing uses react-router v7 in library mode.
7. Phase 1 has no Tab layout on narrow screens; the columns scroll horizontally instead. Tabs come in phase 3.
8. When `Required` counts as missing: an empty string after trimming, or an empty array for multiselect. A bool field cannot be required; registration rejects it.
9. Top-level validation:
   - `name` must be non-empty after trimming.
   - `rating` must be 1–5 or `null`.
   - `links[].url` must be http or https.
   - `tags` are trimmed and deduplicated.
   - In a PATCH, `null` clears a nullable field (`rating`). On any other field it returns 400.
10. The board query key is `['board', key, { includeArchived }]`.
11. `make seed` runs `server -seed` and exits. It skips any `kind + slug` that already exists, so running it twice is safe.

## Phase 2 decisions (relations)

12. Relation chips show the relation fields marked `ShowOnCard`. A number field shows its `Prefix` (prices show as `$3`), and a bool field shows its `ShortLabel` when true (`默认`).
13. Any change to a relation also updates `updated_at` on both items it links. A PUT that changes nothing writes nothing.
14. The drawer looks up relation names and add-relation candidates in the board data fetched with `includeArchived=true`. It only renders the form after the item detail has been fetched again since the drawer opened, so cached data from before another save never seeds the form.
15. `make seed` only adds missing sample relations (`relation.Service.Ensure`). It never changes or deletes existing ones.

## Implementation notes

- Domain errors live in `internal/apperr`. Services return them, and `httpx.WriteError` maps them to HTTP status codes, so services never import `httpx`.
- sqlc with SQLite: put `sqlc.slice(...)` after every other parameter in a query. Parameters that come after a slice get misnumbered.
- shadcn uses the base-nova style, which is built on Base UI, not Radix. Use the `render` prop instead of `asChild`, `onValueChange` / `onCheckedChange`, and the `items` prop on `Select` so it shows labels instead of values.
- Versions: react-router is v8 (library mode, same API as v7), and `@hookform/resolvers` is pinned to v5 because v6 has a peer-dependency conflict.
- `KindIcon` looks up icons in the full lucide `icons` map. This makes the bundle bigger, but a new kind can use a new icon without frontend changes.
- `web/src/test/kinds.json` is a snapshot of `GET /api/v1/kinds` used by the page tests. Regenerate it after changing any registry definition.

## Conventions

These are the design doc's coding conventions, restated:

- Handlers decode the request, call the service and encode the response. SQL lives only in `queries/` and the repo layer.
- Every write runs in a transaction. Wrap errors with `%w`; `httpx` maps them to HTTP status codes.
- JSON fields are camelCase. Keys inside `attrs` stay snake_case. Times are UTC RFC 3339 strings.
- The frontend never branches on a kind key. Read the field definitions instead.
