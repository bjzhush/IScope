package item

import (
	"context"
	"encoding/json"
	"path/filepath"
	"testing"

	"github.com/bjzhush/ai-overview/internal/apperr"
	"github.com/bjzhush/ai-overview/internal/kind"
	"github.com/bjzhush/ai-overview/internal/store"
)

func newTestService(t *testing.T) *Service {
	t.Helper()
	sqldb, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqldb.Close() })
	return NewService(sqldb, kind.Default())
}

func strp(s string) *string { return &s }

func model(name string) CreateInput {
	return CreateInput{Kind: "model", Name: name, Attrs: map[string]any{"vendor": "Anthropic"}}
}

func mustCreate(t *testing.T, s *Service, in CreateInput) Item {
	t.Helper()
	it, err := s.Create(context.Background(), in)
	if err != nil {
		t.Fatalf("create %q: %v", in.Name, err)
	}
	return it
}

func wantCode(t *testing.T, err error, code apperr.Code, field string) {
	t.Helper()
	e, ok := apperr.As(err)
	if !ok || e.Code != code {
		t.Fatalf("want %s, got %v", code, err)
	}
	if field != "" && e.Fields[field] == "" {
		t.Fatalf("want error on field %q, got %v", field, e.Fields)
	}
}

func TestCreateDefaults(t *testing.T) {
	s := newTestService(t)
	a := mustCreate(t, s, model("Claude Sonnet 5.5"))
	if a.Slug != "claude-sonnet-5-5" || a.Status != StatusWatching || a.SortOrder != 1 {
		t.Fatalf("defaults: %+v", a)
	}
	if a.Tags == nil || a.Links == nil || a.Rating != nil || a.CreatedAt == "" || a.CreatedAt != a.UpdatedAt {
		t.Fatalf("empty fields: %+v", a)
	}
	b := mustCreate(t, s, model("Claude Opus 5.5"))
	if b.SortOrder != 2 {
		t.Fatalf("second sortOrder = %v", b.SortOrder)
	}
	// sortOrder is per kind.
	h := mustCreate(t, s, CreateInput{Kind: "harness", Name: "Claude Code"})
	if h.SortOrder != 1 {
		t.Fatalf("harness sortOrder = %v", h.SortOrder)
	}
}

func TestCreateNormalizesAndValidates(t *testing.T) {
	s := newTestService(t)
	in := model("  Haiku  ")
	in.Tags = []string{" a ", "b", "a", ""}
	in.Links = []Link{{Label: " 文档 ", URL: " https://docs.claude.com "}}
	in.Attrs["context_window"] = json.Number("200000")
	it := mustCreate(t, s, in)
	if it.Name != "Haiku" || len(it.Tags) != 2 || it.Links[0].URL != "https://docs.claude.com" {
		t.Fatalf("normalized: %+v", it)
	}
	if it.Attrs["context_window"] != json.Number("200000") {
		t.Fatalf("attrs round-trip: %#v", it.Attrs["context_window"])
	}

	bad := []struct {
		name  string
		in    CreateInput
		code  apperr.Code
		field string
	}{
		{"unknown kind", CreateInput{Kind: "nope", Name: "x"}, apperr.BadRequest, ""},
		{"blank name", CreateInput{Kind: "harness", Name: "  "}, apperr.ValidationFailed, "name"},
		{"bad status", CreateInput{Kind: "harness", Name: "x", Status: strp("done")}, apperr.ValidationFailed, "status"},
		{"bad rating", CreateInput{Kind: "harness", Name: "x", Rating: new(int)}, apperr.ValidationFailed, "rating"},
		{"bad link", CreateInput{Kind: "harness", Name: "x", Links: []Link{{URL: "javascript:alert(1)"}}}, apperr.ValidationFailed, "links.0.url"},
		{"bad slug", CreateInput{Kind: "harness", Name: "x", Slug: strp("Has Space")}, apperr.ValidationFailed, "slug"},
		{"missing required attr", CreateInput{Kind: "model", Name: "x"}, apperr.ValidationFailed, "attrs.vendor"},
		{"unknown attr", CreateInput{Kind: "harness", Name: "x", Attrs: map[string]any{"color": "red"}}, apperr.ValidationFailed, "attrs.color"},
		{"wrong attr type", CreateInput{Kind: "model", Name: "x", Attrs: map[string]any{"vendor": "A", "context_window": "big"}}, apperr.ValidationFailed, "attrs.context_window"},
	}
	for _, c := range bad {
		t.Run(c.name, func(t *testing.T) {
			_, err := s.Create(context.Background(), c.in)
			wantCode(t, err, c.code, c.field)
		})
	}
}

func TestSlugConflict(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	a := mustCreate(t, s, model("Claude Sonnet 5.5"))

	_, err := s.Create(ctx, model("claude sonnet 5.5"))
	wantCode(t, err, apperr.Conflict, "name")

	_, err = s.Create(ctx, CreateInput{Kind: "model", Name: "Other", Slug: strp("claude-sonnet-5-5"), Attrs: map[string]any{"vendor": "A"}})
	wantCode(t, err, apperr.Conflict, "slug")

	// Same slug in another kind is fine.
	mustCreate(t, s, CreateInput{Kind: "harness", Name: "Claude Sonnet 5.5"})

	// Renaming does not change the slug.
	b := mustCreate(t, s, model("Opus"))
	b, err = s.Update(ctx, b.ID, Patch{Name: strp("Opus Renamed")})
	if err != nil || b.Slug != "opus" {
		t.Fatalf("rename: %+v %v", b, err)
	}
	// Patching to a taken slug conflicts.
	_, err = s.Update(ctx, b.ID, Patch{Slug: strp("claude-sonnet-5-5")})
	wantCode(t, err, apperr.Conflict, "slug")

	// After soft delete the slug is free again.
	if err := s.Delete(ctx, a.ID); err != nil {
		t.Fatal(err)
	}
	mustCreate(t, s, model("Claude Sonnet 5.5"))
}

func TestUpdatePatchSemantics(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	in := model("M")
	in.Attrs["model_id"] = "m-1"
	in.Attrs["context_window"] = 1000
	five := 5
	in.Rating = &five
	in.Summary = "keep me"
	it := mustCreate(t, s, in)

	got, err := s.Update(ctx, it.ID, Patch{
		Status: strp(StatusInUse),
		Attrs:  map[string]any{"model_id": nil, "max_output": json.Number("64000")},
	})
	if err != nil {
		t.Fatal(err)
	}
	if got.Status != StatusInUse || got.Summary != "keep me" || got.Rating == nil || *got.Rating != 5 {
		t.Fatalf("untouched fields changed: %+v", got)
	}
	if _, ok := got.Attrs["model_id"]; ok {
		t.Fatal("null attr should be deleted")
	}
	if got.Attrs["vendor"] != "Anthropic" || got.Attrs["max_output"] == nil || got.Attrs["context_window"] == nil {
		t.Fatalf("attrs not merged: %#v", got.Attrs)
	}

	got, err = s.Update(ctx, it.ID, Patch{Rating: &NullInt{}})
	if err != nil || got.Rating != nil {
		t.Fatalf("clear rating: %+v %v", got.Rating, err)
	}

	// Merged attrs are validated as a whole: deleting a required key fails.
	_, err = s.Update(ctx, it.ID, Patch{Attrs: map[string]any{"vendor": nil}})
	wantCode(t, err, apperr.ValidationFailed, "attrs.vendor")

	_, err = s.Update(ctx, it.ID, Patch{Kind: strp("provider")})
	wantCode(t, err, apperr.ValidationFailed, "kind")
	if _, err = s.Update(ctx, it.ID, Patch{Kind: strp("model")}); err != nil {
		t.Fatalf("same kind should be allowed: %v", err)
	}

	_, err = s.Update(ctx, "missing", Patch{Name: strp("x")})
	wantCode(t, err, apperr.NotFound, "")
}

func TestDeleteHidesItem(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	it := mustCreate(t, s, model("M"))
	if err := s.Delete(ctx, it.ID); err != nil {
		t.Fatal(err)
	}
	_, err := s.Get(ctx, it.ID)
	wantCode(t, err, apperr.NotFound, "")
	_, err = s.Update(ctx, it.ID, Patch{Name: strp("x")})
	wantCode(t, err, apperr.NotFound, "")
	wantCode(t, s.Delete(ctx, it.ID), apperr.NotFound, "")
	list, _ := s.List(ctx, ListFilter{})
	if len(list) != 0 {
		t.Fatalf("deleted item listed: %+v", list)
	}
}

func TestListFilters(t *testing.T) {
	s := newTestService(t)
	ctx := context.Background()
	mustCreate(t, s, CreateInput{Kind: "harness", Name: "Claude Code", Tags: []string{"agent"}, Status: strp(StatusInUse)})
	mustCreate(t, s, CreateInput{Kind: "harness", Name: "Cursor", Summary: "IDE fork", Status: strp(StatusArchived)})
	mustCreate(t, s, CreateInput{Kind: "provider", Name: "OpenRouter", Attrs: map[string]any{"api_compat": []any{"openai"}}})

	cases := []struct {
		f    ListFilter
		want int
	}{
		{ListFilter{}, 3},
		{ListFilter{Kind: "harness"}, 2},
		{ListFilter{Status: StatusArchived}, 1},
		{ListFilter{Q: "ide"}, 1},     // summary, case-insensitive
		{ListFilter{Q: "OPENAI"}, 1},  // attrs array value
		{ListFilter{Tag: "Agent"}, 1}, // tag, case-insensitive
		{ListFilter{Q: "zzz"}, 0},
	}
	for _, c := range cases {
		got, err := s.List(ctx, c.f)
		if err != nil || len(got) != c.want {
			t.Errorf("List(%+v) = %d items, err %v; want %d", c.f, len(got), err, c.want)
		}
	}
	_, err := s.List(ctx, ListFilter{Kind: "nope"})
	wantCode(t, err, apperr.BadRequest, "")

	items, _ := s.ListByKinds(ctx, []string{"harness", "model"}, false)
	if len(items) != 1 {
		t.Fatalf("ListByKinds without archived = %d", len(items))
	}
	items, _ = s.ListByKinds(ctx, []string{"harness", "model"}, true)
	if len(items) != 2 {
		t.Fatalf("ListByKinds with archived = %d", len(items))
	}
}
