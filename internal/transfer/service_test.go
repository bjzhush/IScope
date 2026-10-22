package transfer

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/bjzhush/ai-overview/internal/apperr"
	"github.com/bjzhush/ai-overview/internal/item"
	"github.com/bjzhush/ai-overview/internal/kind"
	"github.com/bjzhush/ai-overview/internal/relation"
	"github.com/bjzhush/ai-overview/internal/seed"
	"github.com/bjzhush/ai-overview/internal/store"
)

type env struct {
	items *item.Service
	rels  *relation.Service
	svc   *Service
}

func newEnv(t *testing.T) env {
	t.Helper()
	sqldb, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqldb.Close() })
	reg := kind.Default()
	items, rels := item.NewService(sqldb, reg), relation.NewService(sqldb, reg)
	return env{items, rels, NewService(sqldb, items, rels)}
}

// canonical drops the export timestamp and re-encodes through generic JSON so
// number representations compare equal.
func canonical(t *testing.T, d Document) string {
	t.Helper()
	d.ExportedAt = ""
	b, err := json.Marshal(d)
	if err != nil {
		t.Fatal(err)
	}
	var v any
	json.Unmarshal(b, &v)
	out, _ := json.MarshalIndent(v, "", " ")
	return string(out)
}

func TestRoundTripIntoEmptyDatabase(t *testing.T) {
	ctx := context.Background()
	a := newEnv(t)
	if err := seed.Run(ctx, a.items, a.rels); err != nil {
		t.Fatal(err)
	}
	// Some variety beyond the seed: a rating, a deleted item, a moved item.
	gone, _ := a.items.Create(ctx, item.CreateInput{Kind: "provider", Name: "Gone"})
	list, _ := a.items.List(ctx, item.ListFilter{Kind: "harness"})
	a.rels.Replace(ctx, gone.ID, []relation.Link{{TargetID: list[0].ID}})
	a.items.Delete(ctx, gone.ID)
	a.items.Move(ctx, list[2].ID, item.MoveInput{BeforeID: &list[0].ID, AfterID: &list[1].ID})

	first, err := a.svc.Export(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(first.Items) != 10 || len(first.Relations) != 10 {
		t.Fatalf("export: %d items, %d relations", len(first.Items), len(first.Relations))
	}

	// Through JSON, as a real file would go.
	raw, _ := json.Marshal(first)
	var doc Document
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.UseNumber()
	if err := dec.Decode(&doc); err != nil {
		t.Fatal(err)
	}

	b := newEnv(t)
	// A distinct clock: any timestamp not carried over from the file shows up.
	b.svc.now = func() time.Time { return time.Date(2031, 1, 1, 0, 0, 0, 0, time.UTC) }
	sum, err := b.svc.Import(ctx, doc)
	if err != nil {
		t.Fatal(err)
	}
	if sum.Items.Created != 10 || sum.Relations.Created != 10 {
		t.Fatalf("summary: %+v", sum)
	}
	second, _ := b.svc.Export(ctx)
	if got, want := canonical(t, second), canonical(t, first); got != want || strings.Contains(got, "2031") {
		t.Fatalf("round trip differs:\n--- got\n%s\n--- want\n%s", got, want)
	}

	// Importing the same file again changes nothing.
	sum, err = b.svc.Import(ctx, doc)
	if err != nil || sum.Items.Unchanged != 10 || sum.Relations.Unchanged != 10 {
		t.Fatalf("re-import: %+v %v", sum, err)
	}
}

func TestImportMerges(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	e.svc.now = func() time.Time { return time.Date(2030, 1, 1, 0, 0, 0, 0, time.UTC) }
	keep, _ := e.items.Create(ctx, item.CreateInput{Kind: "harness", Name: "Keep Me"})
	cc, _ := e.items.Create(ctx, item.CreateInput{Kind: "harness", Name: "Claude Code", Summary: "old"})
	m, _ := e.items.Create(ctx, item.CreateInput{Kind: "model", Name: "Sonnet", Attrs: map[string]any{"vendor": "A"}})
	e.rels.Replace(ctx, cc.ID, []relation.Link{{TargetID: m.ID, Attrs: map[string]any{"is_default": false}}})

	doc := Document{Version: 1,
		Items: []item.Portable{
			{Kind: "harness", Name: "Claude Code", Slug: "claude-code", Summary: "new", Status: "in_use"},
			{Kind: "provider", Name: "OpenRouter", Slug: "openrouter"},
		},
		Relations: []relation.Portable{
			// Existing end (Sonnet) not in the file, written provider->model: normalized.
			{Type: "offered_by", From: relation.Ref{Kind: "provider", Slug: "openrouter"}, To: relation.Ref{Kind: "model", Slug: "sonnet"},
				Attrs: map[string]any{"input_price": 3}},
			{Type: "uses", From: relation.Ref{Kind: "harness", Slug: "claude-code"}, To: relation.Ref{Kind: "model", Slug: "sonnet"},
				Attrs: map[string]any{"is_default": true}},
		},
	}
	sum, err := e.svc.Import(ctx, doc)
	if err != nil {
		t.Fatal(err)
	}
	want := Summary{Items: Counts{Created: 1, Updated: 1}, Relations: Counts{Created: 1, Updated: 1}}
	if sum != want {
		t.Fatalf("summary %+v, want %+v", sum, want)
	}
	got, _ := e.items.Get(ctx, cc.ID)
	if got.Summary != "new" || got.Status != "in_use" || got.UpdatedAt != "2030-01-01T00:00:00Z" || got.CreatedAt != cc.CreatedAt {
		t.Fatalf("overwritten item: %+v", got)
	}
	if _, err := e.items.Get(ctx, keep.ID); err != nil {
		t.Fatal("item absent from the file must be kept")
	}
	rels, _ := e.rels.ListForItem(ctx, m.ID)
	for _, r := range rels {
		if r.Type == "offered_by" && r.FromID != m.ID {
			t.Fatalf("direction not normalized: %+v", r)
		}
		if r.Type == "uses" && r.Attrs["is_default"] != true {
			t.Fatalf("relation attrs not overwritten: %+v", r)
		}
	}
}

func TestImportErrorsRollBack(t *testing.T) {
	ctx := context.Background()
	e := newEnv(t)
	doc := Document{Version: 1,
		Items: []item.Portable{
			{Kind: "harness", Name: "Fine", Slug: "fine"},
			{Kind: "model", Name: "No Vendor", Slug: "no-vendor"},
			{Kind: "nope", Name: "X", Slug: "x"},
			{Kind: "harness", Name: "Fine again", Slug: "fine"},
		},
		Relations: []relation.Portable{
			{Type: "uses", From: relation.Ref{Kind: "harness", Slug: "fine"}, To: relation.Ref{Kind: "model", Slug: "missing"}},
			{Type: "offered_by", From: relation.Ref{Kind: "harness", Slug: "fine"}, To: relation.Ref{Kind: "harness", Slug: "fine"}},
		},
	}
	_, err := e.svc.Import(ctx, doc)
	ae, ok := apperr.As(err)
	if !ok || ae.Code != apperr.ValidationFailed {
		t.Fatalf("got %v", err)
	}
	for _, k := range []string{"items.1.attrs.vendor", "items.2.kind", "items.3.slug", "relations.0.to", "relations.1.type"} {
		if ae.Fields[k] == "" {
			t.Errorf("missing error %s in %v", k, ae.Fields)
		}
	}
	if all, _ := e.items.List(ctx, item.ListFilter{}); len(all) != 0 {
		t.Fatalf("import not rolled back: %d items", len(all))
	}

	_, err = e.svc.Import(ctx, Document{Version: 2})
	if !apperr.Is(err, apperr.BadRequest) {
		t.Fatalf("version: %v", err)
	}
}

func TestHandlers(t *testing.T) {
	e := newEnv(t)
	mux := http.NewServeMux()
	NewHandler(e.svc).Register(mux)
	e.items.Create(context.Background(), item.CreateInput{Kind: "harness", Name: "Claude Code"})

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/export", nil))
	if rec.Code != 200 || !strings.Contains(rec.Header().Get("Content-Disposition"), "attachment") ||
		!strings.Contains(rec.Body.String(), `"slug":"claude-code"`) {
		t.Fatalf("export: %d %s %s", rec.Code, rec.Header(), rec.Body)
	}

	rec2 := httptest.NewRecorder()
	mux.ServeHTTP(rec2, httptest.NewRequest("POST", "/api/v1/import", strings.NewReader(rec.Body.String())))
	if rec2.Code != 200 || !strings.Contains(rec2.Body.String(), `"unchanged":1`) {
		t.Fatalf("import: %d %s", rec2.Code, rec2.Body)
	}

	rec3 := httptest.NewRecorder()
	mux.ServeHTTP(rec3, httptest.NewRequest("POST", "/api/v1/import", strings.NewReader(`{"version":1,"items":[{"kind":"model","name":"x","slug":"x"}],"relations":[]}`)))
	if rec3.Code != 400 || !strings.Contains(rec3.Body.String(), `items.0.attrs.vendor`) {
		t.Fatalf("invalid import: %d %s", rec3.Code, rec3.Body)
	}
}
