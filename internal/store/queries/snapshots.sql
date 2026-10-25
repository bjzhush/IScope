-- name: CreateSnapshot :exec
INSERT INTO snapshots (id, label, item_count, relation_count, doc, created_at)
VALUES (?, ?, ?, ?, ?, ?);

-- name: ListSnapshots :many
SELECT id, label, item_count, relation_count, created_at FROM snapshots
ORDER BY created_at DESC, id DESC;

-- name: GetSnapshotDoc :one
SELECT doc FROM snapshots WHERE id = ?;

-- name: GetSnapshotMeta :one
SELECT id, label, item_count, relation_count, created_at FROM snapshots WHERE id = ?;

-- name: DeleteSnapshot :execrows
DELETE FROM snapshots WHERE id = ?;
