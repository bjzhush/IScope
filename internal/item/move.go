package item

import (
	"context"
	"fmt"
	"slices"

	"github.com/bjzhush/ai-overview/internal/apperr"
	"github.com/bjzhush/ai-overview/internal/store"
	"github.com/bjzhush/ai-overview/internal/store/db"
)

// minGap is the smallest sortOrder gap allowed between neighbours; a move that
// would create a smaller one renumbers the column 1..n instead.
const minGap = 1e-6

// MoveInput names the items directly above and below the drop position;
// nil means the top or bottom.
type MoveInput struct {
	BeforeID *string `json:"beforeId"`
	AfterID  *string `json:"afterId"`
}

// Move places an item between two neighbours of the same kind by giving it the
// midpoint of their sortOrder, renumbering the whole column when the gap is
// too small to split.
func (s *Service) Move(ctx context.Context, id string, in MoveInput) (Item, error) {
	var out Item
	err := store.WithTx(ctx, s.db, func(q *db.Queries) error {
		it, err := s.repo.get(ctx, q, id)
		if err != nil {
			return err
		}
		all, err := s.repo.list(ctx, q, it.Kind, "")
		if err != nil {
			return err
		}
		col := slices.DeleteFunc(all, func(x Item) bool { return x.ID == id })

		find := func(field string, ref *string) (int, error) {
			if ref == nil {
				return -1, nil
			}
			i := slices.IndexFunc(col, func(x Item) bool { return x.ID == *ref })
			if i < 0 {
				return -1, apperr.Validation(map[string]string{field: "不是同一列中的其他条目"})
			}
			return i, nil
		}
		bi, err := find("beforeId", in.BeforeID)
		if err != nil {
			return err
		}
		ai, err := find("afterId", in.AfterID)
		if err != nil {
			return err
		}
		if bi >= 0 && ai >= 0 && bi >= ai {
			return apperr.Validation(map[string]string{"beforeId": "必须位于 afterId 之前"})
		}

		now := s.timestamp()
		switch {
		case bi >= 0 && ai >= 0:
			lo, hi := col[bi].SortOrder, col[ai].SortOrder
			if (hi-lo)/2 < minGap {
				err = s.renumber(ctx, q, slices.Insert(col, bi+1, it), id, now)
			} else {
				err = setSortOrder(ctx, q, id, lo+(hi-lo)/2, now)
			}
		case bi >= 0:
			err = setSortOrder(ctx, q, id, col[bi].SortOrder+1, now)
		case ai >= 0:
			err = setSortOrder(ctx, q, id, col[ai].SortOrder-1, now)
		}
		if err != nil {
			return err
		}
		out, err = s.repo.get(ctx, q, id)
		return err
	})
	return out, s.mapWriteErr(err, false)
}

// renumber assigns 1..n in the given order. Only the moved item's updated_at
// changes; the others merely shift.
func (s *Service) renumber(ctx context.Context, q *db.Queries, order []Item, movedID, now string) error {
	for i, x := range order {
		stamp := x.UpdatedAt
		if x.ID == movedID {
			stamp = now
		}
		if err := setSortOrder(ctx, q, x.ID, float64(i+1), stamp); err != nil {
			return err
		}
	}
	return nil
}

func setSortOrder(ctx context.Context, q *db.Queries, id string, order float64, stamp string) error {
	if err := q.SetSortOrder(ctx, db.SetSortOrderParams{SortOrder: order, UpdatedAt: stamp, ID: id}); err != nil {
		return fmt.Errorf("set sort order: %w", err)
	}
	return nil
}
