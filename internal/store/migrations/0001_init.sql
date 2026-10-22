-- +goose Up
CREATE TABLE items (
  id          TEXT PRIMARY KEY,                 -- ULID
  kind        TEXT NOT NULL,                    -- harness / model / provider / ...
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'watching'
              CHECK (status IN ('in_use', 'watching', 'archived')),
  summary     TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '[]',       -- JSON string array
  links       TEXT NOT NULL DEFAULT '[]',       -- JSON array [{"label":"","url":""}]
  notes       TEXT NOT NULL DEFAULT '',         -- Markdown
  rating      INTEGER CHECK (rating BETWEEN 1 AND 5),
  pinned      INTEGER NOT NULL DEFAULT 0,
  sort_order  REAL    NOT NULL DEFAULT 0,
  attrs       TEXT NOT NULL DEFAULT '{}',       -- JSON object, kind-specific fields
  created_at  TEXT NOT NULL,                    -- RFC 3339, UTC
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT                              -- non-null means soft-deleted
);

CREATE UNIQUE INDEX idx_items_kind_slug
  ON items(kind, slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_items_kind_status ON items(kind, status);

CREATE TABLE relations (
  id          TEXT PRIMARY KEY,                 -- ULID
  type        TEXT NOT NULL,                    -- offered_by / uses / connects / ...
  from_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  to_id       TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  attrs       TEXT NOT NULL DEFAULT '{}',       -- JSON object, relation fields
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (type, from_id, to_id),
  CHECK (from_id <> to_id)
);

CREATE INDEX idx_relations_to ON relations(to_id);

-- +goose Down
DROP TABLE relations;
DROP TABLE items;
