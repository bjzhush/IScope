package relation

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/bjzhush/ai-overview/internal/store/db"
)

// errNoRow is returned when a relation or item is missing or soft-deleted.
var errNoRow = errors.New("not found")

// itemRef is the part of an item the relation logic needs.
type itemRef struct {
	ID   string
	Kind string
}

type repo struct{}

func (repo) item(ctx context.Context, q *db.Queries, id string) (itemRef, error) {
	row, err := q.GetItem(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return itemRef{}, errNoRow
	}
	if err != nil {
		return itemRef{}, fmt.Errorf("get item: %w", err)
	}
	return itemRef{ID: row.ID, Kind: row.Kind}, nil
}

func (repo) touchItems(ctx context.Context, q *db.Queries, now string, ids ...string) error {
	for _, id := range ids {
		if err := q.TouchItem(ctx, db.TouchItemParams{UpdatedAt: now, ID: id}); err != nil {
			return fmt.Errorf("touch item: %w", err)
		}
	}
	return nil
}

func (repo) get(ctx context.Context, q *db.Queries, id string) (Relation, error) {
	row, err := q.GetRelation(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return Relation{}, errNoRow
	}
	if err != nil {
		return Relation{}, fmt.Errorf("get relation: %w", err)
	}
	return fromRow(row)
}

func (repo) listForItem(ctx context.Context, q *db.Queries, itemID string) ([]Relation, error) {
	rows, err := q.ListRelationsForItem(ctx, itemID)
	if err != nil {
		return nil, fmt.Errorf("list relations for item: %w", err)
	}
	return fromRows(rows)
}

func (repo) listLive(ctx context.Context, q *db.Queries) ([]Relation, error) {
	rows, err := q.ListLiveRelations(ctx)
	if err != nil {
		return nil, fmt.Errorf("list relations: %w", err)
	}
	return fromRows(rows)
}

func (repo) create(ctx context.Context, q *db.Queries, r Relation) (Relation, error) {
	attrs, err := encodeAttrs(r.Attrs)
	if err != nil {
		return Relation{}, err
	}
	row, err := q.CreateRelation(ctx, db.CreateRelationParams{
		ID: r.ID, Type: r.Type, FromID: r.FromID, ToID: r.ToID, Attrs: attrs,
		CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
	})
	if err != nil {
		return Relation{}, fmt.Errorf("create relation: %w", err)
	}
	return fromRow(row)
}

func (repo) updateAttrs(ctx context.Context, q *db.Queries, id string, attrs map[string]any, now string) (Relation, error) {
	enc, err := encodeAttrs(attrs)
	if err != nil {
		return Relation{}, err
	}
	row, err := q.UpdateRelationAttrs(ctx, db.UpdateRelationAttrsParams{Attrs: enc, UpdatedAt: now, ID: id})
	if err != nil {
		return Relation{}, fmt.Errorf("update relation: %w", err)
	}
	return fromRow(row)
}

func (repo) delete(ctx context.Context, q *db.Queries, id string) error {
	if err := q.DeleteRelation(ctx, id); err != nil {
		return fmt.Errorf("delete relation: %w", err)
	}
	return nil
}

func fromRows(rows []db.Relation) ([]Relation, error) {
	out := make([]Relation, 0, len(rows))
	for _, row := range rows {
		r, err := fromRow(row)
		if err != nil {
			return nil, err
		}
		out = append(out, r)
	}
	return out, nil
}

func fromRow(row db.Relation) (Relation, error) {
	r := Relation{
		ID: row.ID, Type: row.Type, FromID: row.FromID, ToID: row.ToID,
		CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt,
	}
	d := json.NewDecoder(bytes.NewReader([]byte(row.Attrs)))
	d.UseNumber()
	if err := d.Decode(&r.Attrs); err != nil {
		return Relation{}, fmt.Errorf("relation %s attrs: %w", row.ID, err)
	}
	if r.Attrs == nil {
		r.Attrs = map[string]any{}
	}
	return r, nil
}

func encodeAttrs(m map[string]any) (string, error) {
	if m == nil {
		m = map[string]any{}
	}
	b, err := json.Marshal(m)
	if err != nil {
		return "", fmt.Errorf("encode relation attrs: %w", err)
	}
	return string(b), nil
}

// sameAttrs compares attrs by their JSON encoding, so json.Number(3) from the
// database equals int64(3) or float64(3) from validation.
func sameAttrs(a, b map[string]any) bool {
	x, err1 := encodeAttrs(a)
	y, err2 := encodeAttrs(b)
	return err1 == nil && err2 == nil && x == y
}
