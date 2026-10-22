-- name: GetItem :one
SELECT * FROM items WHERE id = ? AND deleted_at IS NULL;

-- name: CreateItem :one
INSERT INTO items (
  id, kind, name, slug, status, summary, tags, links, notes,
  rating, pinned, sort_order, attrs, created_at, updated_at
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: UpdateItem :one
UPDATE items SET
  name = ?, slug = ?, status = ?, summary = ?, tags = ?, links = ?, notes = ?,
  rating = ?, pinned = ?, sort_order = ?, attrs = ?, updated_at = ?
WHERE id = ? AND deleted_at IS NULL
RETURNING *;

-- name: SoftDeleteItem :execrows
UPDATE items SET deleted_at = ?, updated_at = ?
WHERE id = ? AND deleted_at IS NULL;

-- name: ListItems :many
SELECT * FROM items
WHERE deleted_at IS NULL
  AND (sqlc.narg(kind) IS NULL OR kind = sqlc.narg(kind))
  AND (sqlc.narg(status) IS NULL OR status = sqlc.narg(status))
ORDER BY kind, sort_order, id;

-- name: ListItemsByKinds :many
SELECT * FROM items
WHERE deleted_at IS NULL
  -- Keep sqlc.slice last: sqlc numbers params after a slice incorrectly.
  AND (sqlc.arg(include_archived) = 1 OR status <> 'archived')
  AND kind IN (sqlc.slice(kinds))
ORDER BY kind, sort_order, id;

-- name: MaxSortOrder :one
SELECT CAST(COALESCE(MAX(sort_order), 0) AS REAL) AS max_sort_order
FROM items WHERE kind = ? AND deleted_at IS NULL;

-- name: TouchItem :exec
UPDATE items SET updated_at = ? WHERE id = ? AND deleted_at IS NULL;

-- name: SetSortOrder :exec
UPDATE items SET sort_order = ?, updated_at = ? WHERE id = ? AND deleted_at IS NULL;

-- name: GetItemBySlug :one
SELECT * FROM items WHERE kind = ? AND slug = ? AND deleted_at IS NULL;
