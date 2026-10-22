// Package board serves the aggregate read endpoint for a board page.
package board

import (
	"context"

	"github.com/bjzhush/ai-overview/internal/apperr"
	"github.com/bjzhush/ai-overview/internal/item"
	"github.com/bjzhush/ai-overview/internal/kind"
	"github.com/bjzhush/ai-overview/internal/relation"
)

type View struct {
	Board     kind.Board          `json:"board"`
	Items     []item.Item         `json:"items"`
	Relations []relation.Relation `json:"relations"`
}

type Service struct {
	reg       *kind.Registry
	items     *item.Service
	relations *relation.Service
}

func NewService(reg *kind.Registry, items *item.Service, relations *relation.Service) *Service {
	return &Service{reg: reg, items: items, relations: relations}
}

func (s *Service) Get(ctx context.Context, key string, includeArchived bool) (View, error) {
	b, ok := s.reg.Board(key)
	if !ok {
		return View{}, apperr.New(apperr.NotFound, "board 不存在")
	}
	items, err := s.items.ListByKinds(ctx, b.Columns, includeArchived)
	if err != nil {
		return View{}, err
	}
	all, err := s.relations.ListLive(ctx)
	if err != nil {
		return View{}, err
	}
	// Only relations whose both ends are in this view (e.g. not archived when hidden).
	ids := make(map[string]bool, len(items))
	for _, it := range items {
		ids[it.ID] = true
	}
	rels := make([]relation.Relation, 0, len(all))
	for _, r := range all {
		if ids[r.FromID] && ids[r.ToID] {
			rels = append(rels, r)
		}
	}
	return View{Board: b, Items: items, Relations: rels}, nil
}
