package relation

import (
	"context"
	"fmt"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/bjzhush/ai-overview/internal/apperr"
	"github.com/bjzhush/ai-overview/internal/kind"
	"github.com/bjzhush/ai-overview/internal/store/db"
)

// Ref identifies an item in export files.
type Ref struct {
	Kind string `json:"kind"`
	Slug string `json:"slug"`
}

// Portable is a relation in export files, with both ends as kind + slug.
type Portable struct {
	Type      string         `json:"type"`
	From      Ref            `json:"from"`
	To        Ref            `json:"to"`
	Attrs     map[string]any `json:"attrs"`
	CreatedAt string         `json:"createdAt"`
	UpdatedAt string         `json:"updatedAt"`
}

// End is a resolved relation end.
type End struct {
	ID   string
	Kind string
}

// ImportTx upserts one relation inside the caller's transaction. The type must
// match the kinds of the two ends; direction is normalized. Existing attrs are
// replaced by the file's when they differ. Items' updated_at is left alone so
// an import into an empty database reproduces the export exactly.
func (s *Service) ImportTx(ctx context.Context, q *db.Queries, p Portable, from, to End, now string) (string, error) {
	rt, forward, ok := s.reg.RelationBetween(from.Kind, to.Kind)
	if !ok || rt.Key != p.Type {
		return "", apperr.Validation(map[string]string{"type": fmt.Sprintf("%s 与 %s 之间不能是 %q", from.Kind, to.Kind, p.Type)})
	}
	if !forward {
		from, to = to, from
	}
	attrs := p.Attrs
	if attrs == nil {
		attrs = map[string]any{}
	}
	clean, ferrs := kind.ValidateAttrs(rt.Fields, attrs)
	if len(ferrs) > 0 {
		return "", apperr.Validation(ferrs)
	}

	existing, err := s.repo.listForItem(ctx, q, from.ID)
	if err != nil {
		return "", err
	}
	for _, r := range existing {
		if r.Type == rt.Key && r.FromID == from.ID && r.ToID == to.ID {
			if sameAttrs(r.Attrs, clean) {
				return "unchanged", nil
			}
			if _, err := s.repo.updateAttrs(ctx, q, r.ID, clean, now); err != nil {
				return "", err
			}
			return "updated", nil
		}
	}
	_, err = s.repo.create(ctx, q, Relation{
		ID: ulid.Make().String(), Type: rt.Key, FromID: from.ID, ToID: to.ID, Attrs: clean,
		CreatedAt: timestampOr(p.CreatedAt, now), UpdatedAt: timestampOr(p.UpdatedAt, now),
	})
	if err != nil {
		return "", err
	}
	return "created", nil
}

func timestampOr(s, fallback string) string {
	if _, err := time.Parse(time.RFC3339, s); err == nil {
		return s
	}
	return fallback
}
