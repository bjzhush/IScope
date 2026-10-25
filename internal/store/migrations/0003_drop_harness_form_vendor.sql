-- Harness dropped its last two fields, form and vendor, so it has no attrs at
-- all now. Clear them, for the same reason as 0002.

-- +goose Up
UPDATE items
SET attrs = '{}',
    updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')
WHERE kind = 'harness' AND attrs <> '{}';

-- +goose Down
-- The removed values cannot be restored.
SELECT 1;
