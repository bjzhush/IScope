package relation

import (
	"context"
	"database/sql"
	"errors"
	"fmt"
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

var (
	errItemNotFound     = apperr.New(apperr.NotFound, "条目不存在")
	errRelationNotFound = apperr.New(apperr.NotFound, "关联不存在")
)

// ListForItem returns the live relations touching itemID.
func (s *Service) ListForItem(ctx context.Context, itemID string) ([]Relation, error) {
	return s.repo.listForItem(ctx, db.New(s.db), itemID)
}

// ListLive returns every relation whose both ends are live items.
func (s *Service) ListLive(ctx context.Context) ([]Relation, error) {
	return s.repo.listLive(ctx, db.New(s.db))
}

// planned is one validated entry of a Replace request.
type planned struct {
	rt       kind.RelationType
	fromID   string
	toID     string
	targetID string
	index    int            // position in the request, for error paths
	attrs    map[string]any // nil: keep existing / empty for new
}

// Replace makes links the complete set of relations of itemID: it creates the
// missing ones, updates attrs that were sent, keeps the rest untouched, and
// deletes relations not listed. It returns the item's relations afterwards.
func (s *Service) Replace(ctx context.Context, itemID string, links []Link) ([]Relation, error) {
	if links == nil {
		return nil, apperr.Validation(map[string]string{"links": "必填"})
	}
	var out []Relation
	err := store.WithTx(ctx, s.db, func(q *db.Queries) error {
		it, err := s.repo.item(ctx, q, itemID)
		if errors.Is(err, errNoRow) {
			return errItemNotFound
		}
		if err != nil {
			return err
		}

		plans, err := s.plan(ctx, q, it, links)
		if err != nil {
			return err
		}

		existing, err := s.repo.listForItem(ctx, q, it.ID)
		if err != nil {
			return err
		}
		byKey := map[string]Relation{}
		for _, r := range existing {
			byKey[r.Type+"|"+r.FromID+"|"+r.ToID] = r
		}

		now := s.timestamp()
		touched := map[string]bool{}
		keep := map[string]bool{}
		for _, p := range plans {
			key := p.rt.Key + "|" + p.fromID + "|" + p.toID
			keep[key] = true
			if cur, ok := byKey[key]; ok {
				if p.attrs == nil || sameAttrs(cur.Attrs, p.attrs) {
					continue
				}
				if _, err := s.repo.updateAttrs(ctx, q, cur.ID, p.attrs, now); err != nil {
					return err
				}
			} else {
				attrs := p.attrs
				if attrs == nil {
					// A new relation without attrs must still pass required fields.
					clean, ferrs := kind.ValidateAttrs(p.rt.Fields, map[string]any{})
					if len(ferrs) > 0 {
						return apperr.Validation(prefixed(fmt.Sprintf("links.%d.", p.index), ferrs))
					}
					attrs = clean
				}
				if _, err := s.repo.create(ctx, q, Relation{
					ID: ulid.Make().String(), Type: p.rt.Key, FromID: p.fromID, ToID: p.toID,
					Attrs: attrs, CreatedAt: now, UpdatedAt: now,
				}); err != nil {
					return err
				}
			}
			touched[p.targetID] = true
		}
		for key, r := range byKey {
			if keep[key] {
				continue
			}
			if err := s.repo.delete(ctx, q, r.ID); err != nil {
				return err
			}
			touched[otherEnd(r, it.ID)] = true
		}

		if len(touched) > 0 {
			ids := []string{it.ID}
			for id := range touched {
				ids = append(ids, id)
			}
			if err := s.repo.touchItems(ctx, q, now, ids...); err != nil {
				return err
			}
		}
		out, err = s.repo.listForItem(ctx, q, it.ID)
		return err
	})
	return out, err
}

// plan validates every link and resolves its relation type and direction.
func (s *Service) plan(ctx context.Context, q *db.Queries, it itemRef, links []Link) ([]planned, error) {
	errs := map[string]string{}
	seen := map[string]bool{}
	plans := make([]planned, 0, len(links))
	for i, l := range links {
		prefix := fmt.Sprintf("links.%d.", i)
		switch {
		case l.TargetID == "":
			errs[prefix+"targetId"] = "必填"
			continue
		case l.TargetID == it.ID:
			errs[prefix+"targetId"] = "不能关联自身"
			continue
		case seen[l.TargetID]:
			errs[prefix+"targetId"] = "重复的关联"
			continue
		}
		seen[l.TargetID] = true

		target, err := s.repo.item(ctx, q, l.TargetID)
		if errors.Is(err, errNoRow) {
			errs[prefix+"targetId"] = "条目不存在"
			continue
		}
		if err != nil {
			return nil, err
		}
		rt, forward, ok := s.reg.RelationBetween(it.Kind, target.Kind)
		if !ok {
			return nil, apperr.New(apperr.BadRequest, fmt.Sprintf("%s 与 %s 之间没有可用的关系类型", it.Kind, target.Kind))
		}
		p := planned{rt: rt, fromID: it.ID, toID: target.ID, targetID: target.ID, index: i}
		if !forward {
			p.fromID, p.toID = target.ID, it.ID
		}
		if l.Attrs != nil {
			clean, ferrs := kind.ValidateAttrs(rt.Fields, l.Attrs)
			for k, m := range prefixed(prefix, ferrs) {
				errs[k] = m
			}
			p.attrs = clean
		}
		plans = append(plans, p)
	}
	if len(errs) > 0 {
		return nil, apperr.Validation(errs)
	}
	return plans, nil
}

// Update merges attrs into one relation and validates the result.
func (s *Service) Update(ctx context.Context, id string, in PatchInput) (Relation, error) {
	if in.Attrs == nil {
		return Relation{}, apperr.Validation(map[string]string{"attrs": "必填"})
	}
	var out Relation
	err := store.WithTx(ctx, s.db, func(q *db.Queries) error {
		cur, err := s.repo.get(ctx, q, id)
		if errors.Is(err, errNoRow) {
			return errRelationNotFound
		}
		if err != nil {
			return err
		}
		rt, ok := s.reg.RelationType(cur.Type)
		if !ok {
			return fmt.Errorf("relation %s has unregistered type %q", id, cur.Type)
		}
		merged := map[string]any{}
		for k, v := range cur.Attrs {
			merged[k] = v
		}
		for k, v := range in.Attrs {
			if v == nil {
				delete(merged, k)
			} else {
				merged[k] = v
			}
		}
		clean, ferrs := kind.ValidateAttrs(rt.Fields, merged)
		if len(ferrs) > 0 {
			return apperr.Validation(ferrs)
		}
		if sameAttrs(cur.Attrs, clean) {
			out = cur
			return nil
		}
		now := s.timestamp()
		if out, err = s.repo.updateAttrs(ctx, q, id, clean, now); err != nil {
			return err
		}
		return s.repo.touchItems(ctx, q, now, cur.FromID, cur.ToID)
	})
	return out, err
}

func (s *Service) Delete(ctx context.Context, id string) error {
	return store.WithTx(ctx, s.db, func(q *db.Queries) error {
		cur, err := s.repo.get(ctx, q, id)
		if errors.Is(err, errNoRow) {
			return errRelationNotFound
		}
		if err != nil {
			return err
		}
		if err := s.repo.delete(ctx, q, id); err != nil {
			return err
		}
		return s.repo.touchItems(ctx, q, s.timestamp(), cur.FromID, cur.ToID)
	})
}

// Ensure links a and b if they are not linked yet; existing relations are left
// as they are. Used by seed data.
func (s *Service) Ensure(ctx context.Context, aID, bID string, attrs map[string]any) error {
	current, err := s.ListForItem(ctx, aID)
	if err != nil {
		return err
	}
	links := make([]Link, 0, len(current)+1)
	for _, r := range current {
		other := otherEnd(r, aID)
		if other == bID {
			return nil
		}
		links = append(links, Link{TargetID: other})
	}
	links = append(links, Link{TargetID: bID, Attrs: attrs})
	_, err = s.Replace(ctx, aID, links)
	return err
}

// Upsert links a and b, merging attrs into the existing relation if there is
// one (other keys are kept) or creating it otherwise.
func (s *Service) Upsert(ctx context.Context, aID, bID string, attrs map[string]any) (Relation, error) {
	current, err := s.ListForItem(ctx, aID)
	if err != nil {
		return Relation{}, err
	}
	links := make([]Link, 0, len(current)+1)
	for _, r := range current {
		if otherEnd(r, aID) == bID {
			return s.Update(ctx, r.ID, PatchInput{Attrs: attrs})
		}
		links = append(links, Link{TargetID: otherEnd(r, aID)})
	}
	rels, err := s.Replace(ctx, aID, append(links, Link{TargetID: bID, Attrs: attrs}))
	if err != nil {
		return Relation{}, err
	}
	for _, r := range rels {
		if otherEnd(r, aID) == bID {
			return r, nil
		}
	}
	return Relation{}, fmt.Errorf("upsert relation %s-%s: not found after replace", aID, bID)
}

func prefixed(prefix string, errs kind.FieldErrors) map[string]string {
	out := make(map[string]string, len(errs))
	for k, m := range errs {
		out[prefix+k] = m
	}
	return out
}

func otherEnd(r Relation, id string) string {
	if r.FromID == id {
		return r.ToID
	}
	return r.FromID
}
