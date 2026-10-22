package item

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/bjzhush/ai-overview/internal/apperr"
	"github.com/bjzhush/ai-overview/internal/kind"
	"github.com/bjzhush/ai-overview/internal/store"
	"github.com/bjzhush/ai-overview/internal/store/db"
)

type Service struct {
	db   *sql.DB
	reg  *kind.Registry
	repo repo
	now  func() time.Time
}

func NewService(sqldb *sql.DB, reg *kind.Registry) *Service {
	return &Service{db: sqldb, reg: reg, now: time.Now}
}

func (s *Service) timestamp() string { return s.now().UTC().Format(time.RFC3339) }

var errNotFound = apperr.New(apperr.NotFound, "条目不存在")

func (s *Service) Get(ctx context.Context, id string) (Item, error) {
	it, err := s.repo.get(ctx, db.New(s.db), id)
	if errors.Is(err, errNoRow) {
		return Item{}, errNotFound
	}
	return it, err
}

func (s *Service) Create(ctx context.Context, in CreateInput) (Item, error) {
	k, ok := s.reg.Kind(in.Kind)
	if !ok {
		return Item{}, apperr.New(apperr.BadRequest, fmt.Sprintf("未知的 kind %q", in.Kind))
	}
	now := s.timestamp()
	it := Item{
		ID: ulid.Make().String(), Kind: k.Key, Name: in.Name, Status: StatusWatching,
		Summary: in.Summary, Tags: in.Tags, Links: in.Links, Notes: in.Notes,
		Rating: in.Rating, Pinned: in.Pinned, Attrs: in.Attrs,
		CreatedAt: now, UpdatedAt: now,
	}
	if in.Status != nil {
		it.Status = *in.Status
	}
	slugGiven := in.Slug != nil
	if slugGiven {
		it.Slug = *in.Slug
	}
	if err := s.normalize(k, &it, slugGiven); err != nil {
		return Item{}, err
	}

	var out Item
	err := store.WithTx(ctx, s.db, func(q *db.Queries) error {
		if in.SortOrder != nil {
			it.SortOrder = *in.SortOrder
		} else {
			max, err := s.repo.maxSortOrder(ctx, q, it.Kind)
			if err != nil {
				return err
			}
			it.SortOrder = max + 1
		}
		var err error
		out, err = s.repo.create(ctx, q, it)
		return err
	})
	return out, s.mapWriteErr(err, slugGiven)
}

func (s *Service) Update(ctx context.Context, id string, p Patch) (Item, error) {
	var out Item
	err := store.WithTx(ctx, s.db, func(q *db.Queries) error {
		it, err := s.repo.get(ctx, q, id)
		if err != nil {
			return err
		}
		k, ok := s.reg.Kind(it.Kind)
		if !ok {
			return fmt.Errorf("item %s has unregistered kind %q", id, it.Kind)
		}
		if p.Kind != nil && *p.Kind != it.Kind {
			return apperr.Validation(map[string]string{"kind": "不可修改"})
		}
		applyPatch(&it, p)
		if err := s.normalize(k, &it, p.Slug != nil); err != nil {
			return err
		}
		it.UpdatedAt = s.timestamp()
		out, err = s.repo.update(ctx, q, it)
		return err
	})
	return out, s.mapWriteErr(err, p.Slug != nil)
}

func (s *Service) Delete(ctx context.Context, id string) error {
	err := store.WithTx(ctx, s.db, func(q *db.Queries) error {
		return s.repo.softDelete(ctx, q, id, s.timestamp())
	})
	if errors.Is(err, errNoRow) {
		return errNotFound
	}
	return err
}

func (s *Service) List(ctx context.Context, f ListFilter) ([]Item, error) {
	if f.Kind != "" {
		if _, ok := s.reg.Kind(f.Kind); !ok {
			return nil, apperr.New(apperr.BadRequest, fmt.Sprintf("未知的 kind %q", f.Kind))
		}
	}
	if f.Status != "" && !validStatus[f.Status] {
		return nil, apperr.New(apperr.BadRequest, fmt.Sprintf("未知的 status %q", f.Status))
	}
	items, err := s.repo.list(ctx, db.New(s.db), f.Kind, f.Status)
	if err != nil {
		return nil, err
	}
	q, tag := strings.ToLower(strings.TrimSpace(f.Q)), strings.TrimSpace(f.Tag)
	out := items[:0]
	for _, it := range items {
		if (tag == "" || hasTag(it, tag)) && (q == "" || matches(it, q)) {
			out = append(out, it)
		}
	}
	return out, nil
}

// ListByKinds returns the live items of the given kinds, for board aggregation.
func (s *Service) ListByKinds(ctx context.Context, kinds []string, includeArchived bool) ([]Item, error) {
	return s.repo.listByKinds(ctx, db.New(s.db), kinds, includeArchived)
}

func (s *Service) mapWriteErr(err error, slugGiven bool) error {
	switch {
	case errors.Is(err, errNoRow):
		return errNotFound
	case errors.Is(err, errSlugTaken):
		field := "name"
		if slugGiven {
			field = "slug"
		}
		return &apperr.Error{Code: apperr.Conflict, Message: "同类下已存在同名条目",
			Fields: map[string]string{field: "同类下已存在同名条目"}}
	}
	return err
}

func applyPatch(it *Item, p Patch) {
	set := func(dst *string, src *string) {
		if src != nil {
			*dst = *src
		}
	}
	set(&it.Name, p.Name)
	set(&it.Slug, p.Slug)
	set(&it.Status, p.Status)
	set(&it.Summary, p.Summary)
	set(&it.Notes, p.Notes)
	if p.Tags != nil {
		it.Tags = *p.Tags
	}
	if p.Links != nil {
		it.Links = *p.Links
	}
	if p.Rating != nil {
		it.Rating = p.Rating.Value
	}
	if p.Pinned != nil {
		it.Pinned = *p.Pinned
	}
	if p.SortOrder != nil {
		it.SortOrder = *p.SortOrder
	}
	if p.Attrs != nil {
		merged := make(map[string]any, len(it.Attrs)+len(p.Attrs))
		for k, v := range it.Attrs {
			merged[k] = v
		}
		for k, v := range p.Attrs {
			if v == nil {
				delete(merged, k)
			} else {
				merged[k] = v
			}
		}
		it.Attrs = merged
	}
}

// normalize trims and validates every user-editable field in place, filling
// in the slug when it was not given explicitly.
func (s *Service) normalize(k kind.Kind, it *Item, slugGiven bool) error {
	errs := map[string]string{}

	it.Name = strings.TrimSpace(it.Name)
	if it.Name == "" {
		errs["name"] = "必填"
	}
	if slugGiven {
		it.Slug = strings.TrimSpace(it.Slug)
		if !validSlug(it.Slug) {
			errs["slug"] = "只能包含小写字母、数字和连字符"
		}
	} else if it.Slug == "" {
		it.Slug = Slugify(it.Name, it.ID)
	}
	if !validStatus[it.Status] {
		errs["status"] = "不是有效的状态"
	}
	if it.Rating != nil && (*it.Rating < 1 || *it.Rating > 5) {
		errs["rating"] = "必须是 1 到 5 之间的整数"
	}

	tags := make([]string, 0, len(it.Tags))
	seen := map[string]bool{}
	for _, t := range it.Tags {
		t = strings.TrimSpace(t)
		if t != "" && !seen[t] {
			seen[t] = true
			tags = append(tags, t)
		}
	}
	it.Tags = tags

	links := make([]Link, 0, len(it.Links))
	for i, l := range it.Links {
		l.Label, l.URL = strings.TrimSpace(l.Label), strings.TrimSpace(l.URL)
		if !kind.ValidURL(l.URL) {
			errs["links."+strconv.Itoa(i)+".url"] = "必须是 http 或 https 链接"
		}
		links = append(links, l)
	}
	it.Links = links

	attrs, attrErrs := kind.ValidateAttrs(k.Fields, it.Attrs)
	for f, m := range attrErrs {
		errs[f] = m
	}
	it.Attrs = attrs

	if len(errs) > 0 {
		return apperr.Validation(errs)
	}
	return nil
}

func hasTag(it Item, tag string) bool {
	for _, t := range it.Tags {
		if strings.EqualFold(t, tag) {
			return true
		}
	}
	return false
}

func matches(it Item, q string) bool {
	if strings.Contains(strings.ToLower(it.Name), q) || strings.Contains(strings.ToLower(it.Summary), q) {
		return true
	}
	for _, t := range it.Tags {
		if strings.Contains(strings.ToLower(t), q) {
			return true
		}
	}
	for _, v := range it.Attrs {
		if attrMatches(v, q) {
			return true
		}
	}
	return false
}

func attrMatches(v any, q string) bool {
	switch x := v.(type) {
	case string:
		return strings.Contains(strings.ToLower(x), q)
	case []string:
		for _, s := range x {
			if strings.Contains(strings.ToLower(s), q) {
				return true
			}
		}
	case []any:
		for _, e := range x {
			if attrMatches(e, q) {
				return true
			}
		}
	}
	return false
}
