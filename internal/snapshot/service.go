// Package snapshot saves the whole board (in the export format) and serves a
// saved one back as a read-only board view.
package snapshot

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	"github.com/oklog/ulid/v2"

	"github.com/bjzhush/ai-overview/internal/apperr"
	"github.com/bjzhush/ai-overview/internal/board"
	"github.com/bjzhush/ai-overview/internal/item"
	"github.com/bjzhush/ai-overview/internal/kind"
	"github.com/bjzhush/ai-overview/internal/relation"
	"github.com/bjzhush/ai-overview/internal/store"
	"github.com/bjzhush/ai-overview/internal/store/db"
	"github.com/bjzhush/ai-overview/internal/transfer"
)

const (
	defaultLabel = "手动快照"
	maxLabel     = 100
)

var errNotFound = apperr.New(apperr.NotFound, "快照不存在")

// Meta is a snapshot without its data, as listed.
type Meta struct {
	ID            string `json:"id"`
	Label         string `json:"label"`
	ItemCount     int64  `json:"itemCount"`
	RelationCount int64  `json:"relationCount"`
	CreatedAt     string `json:"createdAt"`
}

// BoardView is a board as it was in a snapshot, shaped like GET /boards/{key}.
type BoardView struct {
	board.View
	Snapshot Meta `json:"snapshot"`
}

type Service struct {
	db       *sql.DB
	reg      *kind.Registry
	transfer *transfer.Service
	now      func() time.Time
}

func NewService(sqldb *sql.DB, reg *kind.Registry, tr *transfer.Service) *Service {
	return &Service{db: sqldb, reg: reg, transfer: tr, now: time.Now}
}

// Create saves the current board. An empty label becomes "手动快照".
func (s *Service) Create(ctx context.Context, label string) (Meta, error) {
	label = strings.TrimSpace(label)
	if label == "" {
		label = defaultLabel
	}
	if utf8.RuneCountInString(label) > maxLabel {
		return Meta{}, apperr.Validation(map[string]string{"label": fmt.Sprintf("最多 %d 个字", maxLabel)})
	}
	doc, err := s.transfer.Export(ctx)
	if err != nil {
		return Meta{}, err
	}
	var m Meta
	err = store.WithTx(ctx, s.db, func(q *db.Queries) error {
		m, err = s.insert(ctx, q, doc, label)
		return err
	})
	return m, err
}

// CreateTx saves doc inside the caller's transaction (transfer.Snapshotter).
func (s *Service) CreateTx(ctx context.Context, q *db.Queries, doc transfer.Document, label string) error {
	_, err := s.insert(ctx, q, doc, label)
	return err
}

func (s *Service) insert(ctx context.Context, q *db.Queries, doc transfer.Document, label string) (Meta, error) {
	raw, err := json.Marshal(doc)
	if err != nil {
		return Meta{}, fmt.Errorf("encode snapshot: %w", err)
	}
	m := Meta{
		ID: ulid.Make().String(), Label: label,
		ItemCount: int64(len(doc.Items)), RelationCount: int64(len(doc.Relations)),
		CreatedAt: s.now().UTC().Format(time.RFC3339),
	}
	err = q.CreateSnapshot(ctx, db.CreateSnapshotParams{
		ID: m.ID, Label: m.Label, ItemCount: m.ItemCount, RelationCount: m.RelationCount,
		Doc: string(raw), CreatedAt: m.CreatedAt,
	})
	if err != nil {
		return Meta{}, fmt.Errorf("insert snapshot: %w", err)
	}
	return m, nil
}

// List returns every snapshot, newest first.
func (s *Service) List(ctx context.Context) ([]Meta, error) {
	rows, err := db.New(s.db).ListSnapshots(ctx)
	if err != nil {
		return nil, fmt.Errorf("list snapshots: %w", err)
	}
	out := make([]Meta, len(rows))
	for i, r := range rows {
		out[i] = Meta{ID: r.ID, Label: r.Label, ItemCount: r.ItemCount, RelationCount: r.RelationCount, CreatedAt: r.CreatedAt}
	}
	return out, nil
}

func (s *Service) meta(ctx context.Context, id string) (Meta, error) {
	r, err := db.New(s.db).GetSnapshotMeta(ctx, id)
	if errors.Is(err, sql.ErrNoRows) {
		return Meta{}, errNotFound
	}
	if err != nil {
		return Meta{}, fmt.Errorf("get snapshot: %w", err)
	}
	return Meta{ID: r.ID, Label: r.Label, ItemCount: r.ItemCount, RelationCount: r.RelationCount, CreatedAt: r.CreatedAt}, nil
}

// Doc returns the saved document, ready to download or import.
func (s *Service) Doc(ctx context.Context, id string) (Meta, transfer.Document, error) {
	m, err := s.meta(ctx, id)
	if err != nil {
		return Meta{}, transfer.Document{}, err
	}
	raw, err := db.New(s.db).GetSnapshotDoc(ctx, id)
	if err != nil {
		return Meta{}, transfer.Document{}, fmt.Errorf("get snapshot doc: %w", err)
	}
	var doc transfer.Document
	if err := json.Unmarshal([]byte(raw), &doc); err != nil {
		return Meta{}, transfer.Document{}, fmt.Errorf("decode snapshot: %w", err)
	}
	return m, doc, nil
}

func (s *Service) Delete(ctx context.Context, id string) error {
	n, err := db.New(s.db).DeleteSnapshot(ctx, id)
	if err != nil {
		return fmt.Errorf("delete snapshot: %w", err)
	}
	if n == 0 {
		return errNotFound
	}
	return nil
}

// itemID is the stand-in ID of a snapshot item: kind + slug identify it in the
// export format, and are unique among live items.
func itemID(r relation.Ref) string { return r.Kind + ":" + r.Slug }

// Board rebuilds a board view from a snapshot, with stand-in IDs. Items of
// kinds not on the board, and relations missing an end, are left out.
func (s *Service) Board(ctx context.Context, id, key string) (BoardView, error) {
	b, ok := s.reg.Board(key)
	if !ok {
		return BoardView{}, apperr.New(apperr.NotFound, "board 不存在")
	}
	m, doc, err := s.Doc(ctx, id)
	if err != nil {
		return BoardView{}, err
	}
	onBoard := make(map[string]bool, len(b.Columns))
	for _, c := range b.Columns {
		onBoard[c] = true
	}
	v := BoardView{
		View:     board.View{Board: b, Items: []item.Item{}, Relations: []relation.Relation{}},
		Snapshot: m,
	}
	ids := map[string]bool{}
	for _, p := range doc.Items {
		if !onBoard[p.Kind] {
			continue
		}
		it := fromPortable(p)
		ids[it.ID] = true
		v.Items = append(v.Items, it)
	}
	for _, p := range doc.Relations {
		from, to := itemID(p.From), itemID(p.To)
		if !ids[from] || !ids[to] {
			continue
		}
		attrs := p.Attrs
		if attrs == nil {
			attrs = map[string]any{}
		}
		v.Relations = append(v.Relations, relation.Relation{
			ID: p.Type + ":" + from + ":" + to, Type: p.Type, FromID: from, ToID: to,
			Attrs: attrs, CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
		})
	}
	return v, nil
}

func fromPortable(p item.Portable) item.Item {
	it := item.Item{
		ID: itemID(relation.Ref{Kind: p.Kind, Slug: p.Slug}), Kind: p.Kind, Name: p.Name, Slug: p.Slug,
		Status: p.Status, Summary: p.Summary, Tags: p.Tags, Links: p.Links, Notes: p.Notes,
		Rating: p.Rating, Pinned: p.Pinned, SortOrder: p.SortOrder, Attrs: p.Attrs,
		CreatedAt: p.CreatedAt, UpdatedAt: p.UpdatedAt,
	}
	if it.Tags == nil {
		it.Tags = []string{}
	}
	if it.Links == nil {
		it.Links = []item.Link{}
	}
	if it.Attrs == nil {
		it.Attrs = map[string]any{}
	}
	return it
}
