-- Harness dropped its open_source, pricing and config_path fields. Attrs
-- validation rejects keys a kind does not define, so strip them from stored
-- items, or editing those items would fail.

-- +goose Up
UPDATE items
SET attrs = json_remove(attrs, '$.open_source', '$.pricing', '$.config_path'),
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE kind = 'harness'
  AND (json_type(attrs, '$.open_source') IS NOT NULL
    OR json_type(attrs, '$.pricing') IS NOT NULL
    OR json_type(attrs, '$.config_path') IS NOT NULL);

-- +goose Down
-- The removed values cannot be restored.
SELECT 1;
