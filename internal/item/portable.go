package item

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/bjzhush/ai-overview/internal/apperr"
	"github.com/bjzhush/ai-overview/internal/store/db"
)

// Portable is an item in export files: identified by kind + slug, no ID.
type Portable struct {
	Kind      string         `json:"kind"`
	Name      string         `json:"name"`
	Slug      string         `json:"slug"`
	Status    string         `json:"status"`
	Summary   string         `json:"summary"`
	Tags      []string       `json:"tags"`
	Links     []Link         `json:"links"`
	Notes     string         `json:"notes"`
	Rating    *int           `json:"rating"`
	Pinned    bool           `json:"pinned"`
	SortOrder float64        `json:"sortOrder"`
	Attrs     map[string]any `json:"attrs"`
	CreatedAt string         `json:"createdAt"`
	UpdatedAt string         `json:"updatedAt"`
}

func ToPortable(it Item) Portable {
	return Portable{
		Kind: it.Kind, Name: it.Name, Slug: it.Slug, Status: it.Status, Summary: it.Summary,
		Tags: it.Tags, Links: it.Links, Notes: it.Notes, Rating: it.Rating, Pinned: it.Pinned,
		SortOrder: it.SortOrder, Attrs: it.Attrs, CreatedAt: it.CreatedAt, UpdatedAt: it.UpdatedAt,
	}
}

type ImportResult string

const (
	Created   ImportResult = "created"
	Updated   ImportResult = "updated"
	Unchanged ImportResult = "unchanged"
)

// ImportTx upserts one portable item by kind + slug inside the caller's
// transaction. New items keep the file's timestamps; an existing item whose
// content differs is overwritten and gets updated_at = now.
// Validation errors use field paths relative to the item ("name", "attrs.x").
func (s *Service) ImportTx(ctx context.Context, q *db.Queries, p Portable, now string) (Item, ImportResult, error) {
	k, ok := s.reg.Kind(p.Kind)
	if !ok {
		return Item{}, "", apperr.Validation(map[string]string{"kind": fmt.Sprintf("未知的 kind %q", p.Kind)})
	}
	it := Item{
		ID: ulid.Make().String(), Kind: k.Key, Name: p.Name, Slug: p.Slug, Status: p.Status,
		Summary: p.Summary, Tags: p.Tags, Links: p.Links, Notes: p.Notes, Rating: p.Rating,
		Pinned: p.Pinned, SortOrder: p.SortOrder, Attrs: p.Attrs,
		CreatedAt: timestampOr(p.CreatedAt, now), UpdatedAt: timestampOr(p.UpdatedAt, now),
	}
	if it.Status == "" {
		it.Status = StatusWatching
	}
	if err := s.normalize(k, &it, it.Slug != ""); err != nil {
		return Item{}, "", err
	}

	row, err := q.GetItemBySlug(ctx, db.GetItemBySlugParams{Kind: it.Kind, Slug: it.Slug})
	if errors.Is(err, sql.ErrNoRows) {
		created, err := s.repo.create(ctx, q, it)
		if errors.Is(err, errSlugTaken) {
			return Item{}, "", apperr.Validation(map[string]string{"slug": "同类下已存在同名条目"})
		}
		return created, Created, err
	}
	if err != nil {
		return Item{}, "", fmt.Errorf("get item by slug: %w", err)
	}
	cur, err := fromRow(row)
	if err != nil {
		return Item{}, "", err
	}
	it.ID, it.CreatedAt, it.UpdatedAt = cur.ID, cur.CreatedAt, cur.UpdatedAt
	if sameContent(cur, it) {
		return cur, Unchanged, nil
	}
	it.UpdatedAt = now
	updated, err := s.repo.update(ctx, q, it)
	return updated, Updated, err
}

// sameContent compares everything an import can change.
func sameContent(a, b Item) bool {
	strip := func(it Item) Portable {
		p := ToPortable(it)
		p.CreatedAt, p.UpdatedAt = "", ""
		return p
	}
	x, err1 := json.Marshal(strip(a))
	y, err2 := json.Marshal(strip(b))
	return err1 == nil && err2 == nil && string(x) == string(y)
}

func timestampOr(s, fallback string) string {
	if _, err := time.Parse(time.RFC3339, s); err == nil {
		return s
	}
	return fallback
}
