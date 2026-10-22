// Package board serves the aggregate read endpoint for a board page.
package board

import (
	"context"

	"github.com/bjzhush/ai-overview/internal/apperr"
	"github.com/bjzhush/ai-overview/internal/item"
	"github.com/bjzhush/ai-overview/internal/kind"
)

type View struct {
	Board     kind.Board  `json:"board"`
	Items     []item.Item `json:"items"`
	Relations []any       `json:"relations"` // filled in phase 2
}

type Service struct {
	reg   *kind.Registry
	items *item.Service
}

func NewService(reg *kind.Registry, items *item.Service) *Service {
	return &Service{reg: reg, items: items}
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
	return View{Board: b, Items: items, Relations: []any{}}, nil
}
