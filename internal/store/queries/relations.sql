-- Every read joins both ends so relations of soft-deleted items never surface.

-- name: GetRelation :one
SELECT r.* FROM relations r
JOIN items a ON a.id = r.from_id AND a.deleted_at IS NULL
JOIN items b ON b.id = r.to_id AND b.deleted_at IS NULL
WHERE r.id = ?;

-- name: ListRelationsForItem :many
SELECT r.* FROM relations r
JOIN items a ON a.id = r.from_id AND a.deleted_at IS NULL
JOIN items b ON b.id = r.to_id AND b.deleted_at IS NULL
WHERE r.from_id = sqlc.arg(item_id) OR r.to_id = sqlc.arg(item_id)
ORDER BY r.id;

-- name: ListLiveRelations :many
SELECT r.* FROM relations r
JOIN items a ON a.id = r.from_id AND a.deleted_at IS NULL
JOIN items b ON b.id = r.to_id AND b.deleted_at IS NULL
ORDER BY r.id;

-- name: CreateRelation :one
INSERT INTO relations (id, type, from_id, to_id, attrs, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?)
RETURNING *;

-- name: UpdateRelationAttrs :one
UPDATE relations SET attrs = ?, updated_at = ?
WHERE id = ?
RETURNING *;

-- name: DeleteRelation :exec
DELETE FROM relations WHERE id = ?;
