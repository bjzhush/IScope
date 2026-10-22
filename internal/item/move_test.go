package item

import (
	"context"
	"testing"

	"github.com/bjzhush/ai-overview/internal/apperr"
)

func order(t *testing.T, s *Service, kind string) []string {
	t.Helper()
	items, err := s.List(context.Background(), ListFilter{Kind: kind})
	if err != nil {
		t.Fatal(err)
	}
	names := make([]string, len(items))
	for i, it := range items {
		names[i] = it.Name
	}
	return names
}

func TestMove(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	ids := map[string]string{}
	for _, n := range []string{"A", "B", "C", "D"} {
		ids[n] = mustCreate(t, s, CreateInput{Kind: "harness", Name: n}).ID
	}
	other := mustCreate(t, s, CreateInput{Kind: "provider", Name: "P"}).ID
	move := func(id string, before, after string) (Item, error) {
		in := MoveInput{}
		if before != "" {
			b := ids[before]
			in.BeforeID = &b
		}
		if after != "" {
			a := ids[after]
			in.AfterID = &a
		}
		return s.Move(ctx, ids[id], in)
	}

	it, err := move("D", "A", "B")
	if err != nil || it.SortOrder != 1.5 {
		t.Fatalf("between: %v %v", it.SortOrder, err)
	}
	if got := order(t, s, "harness"); !equal(got, "A", "D", "B", "C") {
		t.Fatalf("order: %v", got)
	}
	if _, err := move("C", "", "A"); err != nil { // to the top
		t.Fatal(err)
	}
	if _, err := move("A", "B", ""); err != nil { // to the bottom
		t.Fatal(err)
	}
	if got := order(t, s, "harness"); !equal(got, "C", "D", "B", "A") {
		t.Fatalf("ends: %v", got)
	}

	// Keep inserting the last item right after the first one: the gap halves
	// each time until it is too small and the column is renumbered.
	for i := 0; i < 40; i++ {
		cur := order(t, s, "harness")
		last := cur[len(cur)-1]
		if _, err := move(last, cur[0], cur[1]); err != nil {
			t.Fatal(err)
		}
		got := order(t, s, "harness")
		if got[1] != last {
			t.Fatalf("iteration %d: %s not at position 1: %v", i, last, got)
		}
		items, _ := s.List(ctx, ListFilter{Kind: "harness"})
		for j := 1; j < len(items); j++ {
			if items[j].SortOrder-items[j-1].SortOrder < minGap {
				t.Fatalf("iteration %d: gap below minGap: %v / %v", i, items[j-1].SortOrder, items[j].SortOrder)
			}
		}
	}

	// Errors.
	ids["P"] = other
	_, err = move("A", "P", "")
	wantCode(t, err, apperr.ValidationFailed, "beforeId")
	_, err = move("A", "A", "")
	wantCode(t, err, apperr.ValidationFailed, "beforeId")
	_, err = move("A", "D", "C")
	wantCode(t, err, apperr.ValidationFailed, "beforeId")
	_, err = s.Move(ctx, "nope", MoveInput{})
	wantCode(t, err, apperr.NotFound, "")
}

func TestMoveRenumbersTinyGap(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	a := mustCreate(t, s, CreateInput{Kind: "model", Name: "A", Attrs: map[string]any{"vendor": "x"}})
	b := mustCreate(t, s, CreateInput{Kind: "model", Name: "B", Attrs: map[string]any{"vendor": "x"}})
	c := mustCreate(t, s, CreateInput{Kind: "model", Name: "C", Attrs: map[string]any{"vendor": "x"}})
	// Squeeze B right next to A.
	so := a.SortOrder + 1e-7
	if _, err := s.Update(ctx, b.ID, Patch{SortOrder: &so}); err != nil {
		t.Fatal(err)
	}
	moved, err := s.Move(ctx, c.ID, MoveInput{BeforeID: &a.ID, AfterID: &b.ID})
	if err != nil {
		t.Fatal(err)
	}
	if moved.SortOrder != 2 {
		t.Fatalf("moved sortOrder = %v, want 2 after renumbering", moved.SortOrder)
	}
	items, _ := s.List(ctx, ListFilter{Kind: "model"})
	for i, it := range items {
		if it.SortOrder != float64(i+1) {
			t.Fatalf("not renumbered: %+v", items)
		}
	}
	if got := order(t, s, "model"); !equal(got, "A", "C", "B") {
		t.Fatalf("order: %v", got)
	}
	// Neighbours keep their updated_at.
	got, _ := s.Get(ctx, b.ID)
	if got.UpdatedAt == "" {
		t.Fatal("missing updated_at")
	}
}

func equal(got []string, want ...string) bool {
	if len(got) != len(want) {
		return false
	}
	for i := range got {
		if got[i] != want[i] {
			return false
		}
	}
	return true
}
