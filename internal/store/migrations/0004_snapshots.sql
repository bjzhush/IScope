-- +goose Up
-- Whole-board snapshots. doc holds a transfer.Document (the export format), so a
-- snapshot can be previewed or imported back. The counts are stored so listing
-- never has to read doc.
CREATE TABLE snapshots (
  id             TEXT PRIMARY KEY,               -- ULID
  label          TEXT NOT NULL,
  item_count     INTEGER NOT NULL,
  relation_count INTEGER NOT NULL,
  doc            TEXT NOT NULL,                  -- JSON transfer.Document
  created_at     TEXT NOT NULL                   -- RFC 3339, UTC
);

-- +goose Down
DROP TABLE snapshots;
