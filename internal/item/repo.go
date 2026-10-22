package item

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"modernc.org/sqlite"
	sqlite3 "modernc.org/sqlite/lib"

	"github.com/bjzhush/ai-overview/internal/store/db"
)

// errSlugTaken is returned by the repo when the (kind, slug) index rejects a write.
var errSlugTaken = errors.New("slug taken")

// errNoRow is returned when the item does not exist or is soft-deleted.
var errNoRow = errors.New("item not found")

// repo translates between Item and sqlc rows. All functions take *db.Queries
// so they run inside the caller's transaction.
type repo struct{}

func (repo) get(ctx context.Context, q *db.Queries, id string) (Item, error) {
	row, err := q.GetItem(ctx, id)
	if err != nil {
		return Item{}, mapErr("get item", err)
	}
	return fromRow(row)
}

func (repo) create(ctx context.Context, q *db.Queries, it Item) (Item, error) {
	tags, links, attrs, err := encodeJSON(it)
	if err != nil {
		return Item{}, err
	}
	row, err := q.CreateItem(ctx, db.CreateItemParams{
		ID: it.ID, Kind: it.Kind, Name: it.Name, Slug: it.Slug, Status: it.Status,
		Summary: it.Summary, Tags: tags, Links: links, Notes: it.Notes,
		Rating: nullInt(it.Rating), Pinned: boolInt(it.Pinned), SortOrder: it.SortOrder,
		Attrs: attrs, CreatedAt: it.CreatedAt, UpdatedAt: it.UpdatedAt,
	})
	if err != nil {
		return Item{}, mapErr("create item", err)
	}
	return fromRow(row)
}

func (repo) update(ctx context.Context, q *db.Queries, it Item) (Item, error) {
	tags, links, attrs, err := encodeJSON(it)
	if err != nil {
		return Item{}, err
	}
	row, err := q.UpdateItem(ctx, db.UpdateItemParams{
		Name: it.Name, Slug: it.Slug, Status: it.Status, Summary: it.Summary,
		Tags: tags, Links: links, Notes: it.Notes, Rating: nullInt(it.Rating),
		Pinned: boolInt(it.Pinned), SortOrder: it.SortOrder, Attrs: attrs,
		UpdatedAt: it.UpdatedAt, ID: it.ID,
	})
	if err != nil {
		return Item{}, mapErr("update item", err)
	}
	return fromRow(row)
}

func (repo) softDelete(ctx context.Context, q *db.Queries, id, now string) error {
	n, err := q.SoftDeleteItem(ctx, db.SoftDeleteItemParams{
		DeletedAt: sql.NullString{String: now, Valid: true}, UpdatedAt: now, ID: id,
	})
	if err != nil {
		return fmt.Errorf("delete item: %w", err)
	}
	if n == 0 {
		return errNoRow
	}
	return nil
}

func (repo) list(ctx context.Context, q *db.Queries, kind, status string) ([]Item, error) {
	rows, err := q.ListItems(ctx, db.ListItemsParams{Kind: nullable(kind), Status: nullable(status)})
	if err != nil {
		return nil, fmt.Errorf("list items: %w", err)
	}
	return fromRows(rows)
}

func (repo) listByKinds(ctx context.Context, q *db.Queries, kinds []string, includeArchived bool) ([]Item, error) {
	rows, err := q.ListItemsByKinds(ctx, db.ListItemsByKindsParams{Kinds: kinds, IncludeArchived: boolInt(includeArchived)})
	if err != nil {
		return nil, fmt.Errorf("list items by kinds: %w", err)
	}
	return fromRows(rows)
}

func (repo) maxSortOrder(ctx context.Context, q *db.Queries, kind string) (float64, error) {
	v, err := q.MaxSortOrder(ctx, kind)
	if err != nil {
		return 0, fmt.Errorf("max sort order: %w", err)
	}
	return v, nil
}

func mapErr(op string, err error) error {
	if errors.Is(err, sql.ErrNoRows) {
		return errNoRow
	}
	var se *sqlite.Error
	if errors.As(err, &se) && se.Code() == sqlite3.SQLITE_CONSTRAINT_UNIQUE {
		return errSlugTaken
	}
	return fmt.Errorf("%s: %w", op, err)
}

func fromRows(rows []db.Item) ([]Item, error) {
	out := make([]Item, 0, len(rows))
	for _, r := range rows {
		it, err := fromRow(r)
		if err != nil {
			return nil, err
		}
		out = append(out, it)
	}
	return out, nil
}

func fromRow(r db.Item) (Item, error) {
	it := Item{
		ID: r.ID, Kind: r.Kind, Name: r.Name, Slug: r.Slug, Status: r.Status,
		Summary: r.Summary, Notes: r.Notes, Pinned: r.Pinned != 0, SortOrder: r.SortOrder,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	}
	if r.Rating.Valid {
		v := int(r.Rating.Int64)
		it.Rating = &v
	}
	if err := decodeCol(r.Tags, &it.Tags); err != nil {
		return Item{}, fmt.Errorf("item %s tags: %w", r.ID, err)
	}
	if err := decodeCol(r.Links, &it.Links); err != nil {
		return Item{}, fmt.Errorf("item %s links: %w", r.ID, err)
	}
	if err := decodeCol(r.Attrs, &it.Attrs); err != nil {
		return Item{}, fmt.Errorf("item %s attrs: %w", r.ID, err)
	}
	if it.Tags == nil {
		it.Tags = []string{}
	}
	if it.Links == nil {
		it.Links = []Link{}
	}
	if it.Attrs == nil {
		it.Attrs = map[string]any{}
	}
	return it, nil
}

// decodeCol keeps numbers as json.Number so integers round-trip exactly.
func decodeCol(s string, v any) error {
	d := json.NewDecoder(bytes.NewReader([]byte(s)))
	d.UseNumber()
	return d.Decode(v)
}

func encodeJSON(it Item) (tags, links, attrs string, err error) {
	enc := func(v any) string {
		if err != nil {
			return ""
		}
		var b []byte
		b, err = json.Marshal(v)
		return string(b)
	}
	tags, links, attrs = enc(nonNil(it.Tags)), enc(nonNilLinks(it.Links)), enc(nonNilMap(it.Attrs))
	if err != nil {
		err = fmt.Errorf("encode item json: %w", err)
	}
	return
}

func nonNil(s []string) []string {
	if s == nil {
		return []string{}
	}
	return s
}

func nonNilLinks(s []Link) []Link {
	if s == nil {
		return []Link{}
	}
	return s
}

func nonNilMap(m map[string]any) map[string]any {
	if m == nil {
		return map[string]any{}
	}
	return m
}

func nullInt(p *int) sql.NullInt64 {
	if p == nil {
		return sql.NullInt64{}
	}
	return sql.NullInt64{Int64: int64(*p), Valid: true}
}

func boolInt(b bool) int64 {
	if b {
		return 1
	}
	return 0
}

func nullable(s string) any {
	if s == "" {
		return nil
	}
	return s
}
