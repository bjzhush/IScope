// Package transfer exports all data as JSON and imports it back, merging by
// kind + slug.
package transfer

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"sort"
	"strings"
	"time"

	"github.com/bjzhush/ai-overview/internal/apperr"
	"github.com/bjzhush/ai-overview/internal/item"
	"github.com/bjzhush/ai-overview/internal/relation"
	"github.com/bjzhush/ai-overview/internal/store"
	"github.com/bjzhush/ai-overview/internal/store/db"
)

const Version = 1

type Document struct {
	Version    int                 `json:"version"`
	ExportedAt string              `json:"exportedAt"`
	Items      []item.Portable     `json:"items"`
	Relations  []relation.Portable `json:"relations"`
}

type Counts struct {
	Created   int `json:"created"`
	Updated   int `json:"updated"`
	Unchanged int `json:"unchanged"`
}

type Summary struct {
	Items     Counts `json:"items"`
	Relations Counts `json:"relations"`
}

func (c *Counts) add(result string) {
	switch result {
	case "created":
		c.Created++
	case "updated":
		c.Updated++
	default:
		c.Unchanged++
	}
}

type Service struct {
	db        *sql.DB
	items     *item.Service
	relations *relation.Service
	now       func() time.Time
}

func NewService(sqldb *sql.DB, items *item.Service, relations *relation.Service) *Service {
	return &Service{db: sqldb, items: items, relations: relations, now: time.Now}
}

// Export returns every live item (archived included) and every live relation.
func (s *Service) Export(ctx context.Context) (Document, error) {
	items, err := s.items.List(ctx, item.ListFilter{})
	if err != nil {
		return Document{}, err
	}
	rels, err := s.relations.ListLive(ctx)
	if err != nil {
		return Document{}, err
	}
	refs := make(map[string]relation.Ref, len(items))
	doc := Document{
		Version:    Version,
		ExportedAt: s.now().UTC().Format(time.RFC3339),
		Items:      make([]item.Portable, 0, len(items)),
		Relations:  make([]relation.Portable, 0, len(rels)),
	}
	for _, it := range items {
		refs[it.ID] = relation.Ref{Kind: it.Kind, Slug: it.Slug}
		doc.Items = append(doc.Items, item.ToPortable(it))
	}
	for _, r := range rels {
		doc.Relations = append(doc.Relations, relation.Portable{
			Type: r.Type, From: refs[r.FromID], To: refs[r.ToID], Attrs: r.Attrs,
			CreatedAt: r.CreatedAt, UpdatedAt: r.UpdatedAt,
		})
	}
	// Stable output: relations by type, then ends.
	sort.SliceStable(doc.Relations, func(i, j int) bool {
		a, b := doc.Relations[i], doc.Relations[j]
		return relKey(a) < relKey(b)
	})
	return doc, nil
}

func relKey(r relation.Portable) string {
	return strings.Join([]string{r.Type, r.From.Kind, r.From.Slug, r.To.Kind, r.To.Slug}, "\x00")
}

// Import merges doc into the database in one transaction: items are matched
// by kind + slug (overwritten when different, created when missing), then
// relations are matched by their two ends. Nothing absent from doc is touched.
// Any validation error rolls the whole import back.
func (s *Service) Import(ctx context.Context, doc Document) (Summary, error) {
	if doc.Version != Version {
		return Summary{}, apperr.New(apperr.BadRequest, fmt.Sprintf("不支持的文件版本 %d，应为 %d", doc.Version, Version))
	}
	var sum Summary
	now := s.now().UTC().Format(time.RFC3339)
	err := store.WithTx(ctx, s.db, func(q *db.Queries) error {
		errs := map[string]string{}
		ends := map[relation.Ref]relation.End{}

		for i, p := range doc.Items {
			it, result, err := s.items.ImportTx(ctx, q, p, now)
			if err != nil {
				if !collect(errs, fmt.Sprintf("items.%d.", i), err) {
					return err
				}
				continue
			}
			ref := relation.Ref{Kind: it.Kind, Slug: it.Slug}
			if _, dup := ends[ref]; dup {
				errs[fmt.Sprintf("items.%d.slug", i)] = fmt.Sprintf("文件中重复的条目 %s/%s", it.Kind, it.Slug)
				continue
			}
			ends[ref] = relation.End{ID: it.ID, Kind: it.Kind}
			sum.Items.add(string(result))
		}

		resolve := func(ref relation.Ref) (relation.End, bool, error) {
			if e, ok := ends[ref]; ok {
				return e, true, nil
			}
			row, err := q.GetItemBySlug(ctx, db.GetItemBySlugParams{Kind: ref.Kind, Slug: ref.Slug})
			if errors.Is(err, sql.ErrNoRows) {
				return relation.End{}, false, nil
			}
			if err != nil {
				return relation.End{}, false, fmt.Errorf("resolve %s/%s: %w", ref.Kind, ref.Slug, err)
			}
			e := relation.End{ID: row.ID, Kind: row.Kind}
			ends[ref] = e
			return e, true, nil
		}

		for i, p := range doc.Relations {
			prefix := fmt.Sprintf("relations.%d.", i)
			from, okFrom, err := resolve(p.From)
			if err != nil {
				return err
			}
			to, okTo, err := resolve(p.To)
			if err != nil {
				return err
			}
			if !okFrom || !okTo {
				missing, side := p.From, "from"
				if okFrom {
					missing, side = p.To, "to"
				}
				errs[prefix+side] = fmt.Sprintf("找不到条目 %s/%s", missing.Kind, missing.Slug)
				continue
			}
			result, err := s.relations.ImportTx(ctx, q, p, from, to, now)
			if err != nil {
				if !collect(errs, prefix, err) {
					return err
				}
				continue
			}
			sum.Relations.add(result)
		}

		if len(errs) > 0 {
			return apperr.Validation(errs)
		}
		return nil
	})
	return sum, err
}

// collect copies a validation error's fields under prefix. It reports false
// for any other error, which aborts the import.
func collect(errs map[string]string, prefix string, err error) bool {
	e, ok := apperr.As(err)
	if !ok || e.Code != apperr.ValidationFailed {
		return false
	}
	for k, m := range e.Fields {
		errs[prefix+k] = m
	}
	return true
}
