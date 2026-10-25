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

## Phase 3 decisions

16. Drag sorting only works inside a group of cards that share both pin state and status (`lib/reorder.ts`); a card dropped anywhere else snaps back. Each group gets its own `SortableContext`, and dragging starts from a grip handle. A card alone in its group shows a greyed-out handle whose tooltip explains the rule. It can't be dragged, but it still accepts drops, so a drop onto another group (`crossesGroups`) snaps back with a toast instead of failing silently.
17. `POST /items/{id}/move` puts the item at the midpoint of its neighbours. If the gaps that would create are smaller than 1e-6, it renumbers the whole kind 1..n instead.
18. Export and import (`internal/transfer`) run in a single transaction and match items by kind + slug. An item that already exists and differs from the file is overwritten and its `updated_at` becomes the import time. A new item keeps the timestamps from the file, so exporting, importing into an empty database and exporting again gives an identical file. Data missing from the file is left alone. Any validation error rolls back the whole import.
19. The models.dev import (`internal/catalog`) is configured with `-catalog-url` / `AI_OVERVIEW_CATALOG_URL` and caches the catalog for one hour.
    - `model_id` stores the vendor's official id, taken from `canonical_model_id`. Existing models are matched by that id first, then by slug.
    - With `linkTo` set, the import upserts `offered_by` with that provider's prices. If the provider's own model id differs from the official one, it goes into `provider_model_id`.
    - The search response names `modelKind` and `linkKind`, so the UI never hard-codes kind keys.
20. Relation mode starts from a card's 编辑关联… menu item. Cards in related columns become checkboxes, and every toggle immediately PUTs the source's full link set with no attrs, so existing attrs are kept. Esc or 完成 leaves the mode.
21. Screens narrower than 900px show the columns as tabs (`useMediaQuery`).

## Later changes

22. A card is a single row. Tags are right-aligned in that row (`TagStrip.tsx`) and take at most 30% of its width. Tags that don't fit collapse into `+N`. An invisible copy of the tags is measured, `lib/fitTags.ts` computes how many fit, and the count is recomputed when the row resizes. The summary, the `ShowOnCard` fields (each with its label), all tags and the http(s) links (label, or the URL when there is none; they open in a new tab) are in a details popover (`CardDetails.tsx`). It opens when you hover its info button, not the card, and clicking the button pins it open. The button is hidden when there is nothing to show. Clicks on the button or inside the popup are stopped, because React bubbles them through the portal to the card.
23. Hover linking waits until the pointer has rested on a card for 150ms (`useSettledHover`), and leaving a card waits just as long. Sweeping across cards therefore doesn't flash, and moving from one card to the next switches highlights directly. While you hover a card, any of its neighbours that are scrolled out of view in another column are counted at that column's top and bottom edges ("上方/下方还有 N 个关联"; `lib/offscreen.ts`). The hints ignore the pointer, because reaching for one would end the hover.
24. Focus mode (`?focus=<id>`) starts from a card's 聚焦关联 menu item.
    - The focused card's own column stays complete. Every other column shows only layer 1 (direct neighbours, solid ring) and then layer 2 (their neighbours, dashed border; `focusLayers`). Layer 2 never includes the focused item's own kind.
    - Hover linking and drag sorting are off while focused.
    - Focus mode and relation mode exclude each other.
    - Esc leaves the mode. An open drawer swallows Esc itself, so the first Esc only closes the drawer.
25. This replaces the design doc's 全部 / 使用中 / 关注中 filter and its 显示已弃用 switch.
    - The toolbar shows the three statuses as one multi-select toggle group. Each toggle has a status-colored dot and a count of the items that match the current search. Pressed toggles all look the same: a dark primary fill and a check, which is hidden but keeps its space when the toggle is off. Only the dot carries the status color, so pressed and not pressed are the only two looks.
    - At least one status stays selected. The default is 使用中 + 关注中.
    - The URL is `?status=in_use,archived`, omitted for the default. Older `?status=in_use` and `?archived=1` links still parse (`parseStatuses`).
    - The board page always fetches with `includeArchived=true`, so archived items are filtered on the client. This lets the counts include archived items, and relation-mode toggles keep links to archived items.
    - Hover and focus linking only go through items whose status is selected. A focus or relation-mode source that is hidden by the status filter counts as inactive.
26. Harness has no kind fields. Migration `0002_drop_harness_fields.sql` removed `open_source`, `pricing` and `config_path`, and `0003_drop_harness_form_vendor.sql` removed `form` and `vendor`. Both clear the values from stored attrs and bump `updated_at` on the items they change.
    - Without the migrations, saving those items would fail: attrs validation rejects undefined keys, and updates validate the merged attrs. An old export that still has these keys fails to import for the same reason.
    - A vendor is now recorded as a link.
    - The registry sends a kind without fields as `"fields": []`, never `null`.
27. The drawer is up to 880px wide. Each section (基本信息 / {kind} 字段 / 关联 / 链接与笔记) is a two-column grid.
    - Basic fields: 名称 | 状态, then 一句话描述 across both columns, then 标签 | 评分.
    - Kind fields: one cell each, in registry order. Only `textarea` spans both columns (`editor/layout.ts`).
    - Relation groups pair up two per row, e.g. Model | Provider in a harness drawer. Each group's "+ 添加" button sits right after its title (aria-label `添加 {kind}`), so it stays put however the chips wrap. An empty group shows 未关联.
    - Links and notes sit side by side at the bottom. Each link row has an open button that opens the URL typed so far in a new tab, even before saving. It is disabled until that URL is valid http(s).
    - A kind without fields has no {kind} 字段 section.
28. The card menu (`ItemMenu.tsx`) is grouped with separators. For an active item the groups are: 置顶 / 取消置顶 | the two other statuses (设为使用中 / 设为关注中 / 设为弃用) | 编辑 | 编辑关联… and 聚焦关联. An archived item has no pin, edit or relation entries, only 设为使用中 / 设为关注中 | 删除. This replaces the menu's old 恢复 entry, so an archived item can now go straight back to 使用中; the drawer's 恢复 button still sets 关注中 (decision 3).

29. Snapshots (`internal/snapshot`, migration `0004_snapshots.sql`) save the whole board in the export format (`transfer.Document`). The item and relation counts are stored beside it, so listing never reads the document.
    - `GET/POST /api/v1/snapshots`, `GET /snapshots/{id}/download` (an export file that 导入 JSON accepts), `GET /snapshots/{id}/boards/{key}`, `DELETE /snapshots/{id}`. An empty label becomes 手动快照; labels are at most 100 characters.
    - The board endpoint rebuilds a `board.View` plus `snapshot` meta. Items get stand-in IDs `kind:slug` and relations `type:from:to`. Only the board's kinds are kept, archived items included, and fields show by the current registry.
    - An import that changes something saves a 导入 JSON 前 snapshot inside its transaction (`transfer.Snapshotter`), so a failed import leaves none. The board is exported before the transaction starts, because the pool has one connection.
    - The preview is `BoardPage` at `/boards/:key/snapshots/:snapshotId` in read-only mode. It never fetches the live board. It keeps search, the status filter, hover linking, edge hints and focus mode. It drops the add buttons, dragging, the drawer, relation mode and the 数据 menu. Cards are not clickable, their menu has only 聚焦关联, and the details popover lists every field with a value plus the notes.
    - The list is a dialog under 数据 → 快照…. The shadcn `AlertDialogAction` here is a plain button, so a confirm handler must close the dialog itself.

## Implementation notes

- Domain errors live in `internal/apperr`. Services return them, and `httpx.WriteError` maps them to HTTP status codes, so services never import `httpx`.
- sqlc with SQLite: put `sqlc.slice(...)` after every other parameter in a query. Parameters that come after a slice get misnumbered.
- shadcn uses the base-nova style, which is built on Base UI, not Radix. Use the `render` prop instead of `asChild`, `onValueChange` / `onCheckedChange`, and the `items` prop on `Select` so it shows labels instead of values.
- Versions: react-router is v8 (library mode, same API as v7), and `@hookform/resolvers` is pinned to v5 because v6 has a peer-dependency conflict.
- `KindIcon` looks up icons in the full lucide `icons` map. This makes the bundle bigger, but a new kind can use a new icon without frontend changes.
- Test setup (`web/src/test/setup.ts`) stubs `ResizeObserver`, `scrollIntoView` and `matchMedia` for jsdom. Set `media.matches = true` to simulate a narrow screen.
- `web/src/test/kinds.json` is a snapshot of `GET /api/v1/kinds` used by the page tests. Regenerate it after changing any registry definition.

## Conventions

These are the design doc's coding conventions, restated:

- Handlers decode the request, call the service and encode the response. SQL lives only in `queries/` and the repo layer.
- Every write runs in a transaction. Wrap errors with `%w`; `httpx` maps them to HTTP status codes.
- JSON fields are camelCase. Keys inside `attrs` stay snake_case. Times are UTC RFC 3339 strings.
- The frontend never branches on a kind key. Read the field definitions instead.
