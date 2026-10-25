package catalog

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"

	"github.com/bjzhush/ai-overview/internal/apperr"
	"github.com/bjzhush/ai-overview/internal/item"
	"github.com/bjzhush/ai-overview/internal/kind"
	"github.com/bjzhush/ai-overview/internal/relation"
	"github.com/bjzhush/ai-overview/internal/store"
)

// serveFixture serves testdata/api.json and counts requests.
func serveFixture(t *testing.T) (*httptest.Server, *atomic.Int32) {
	t.Helper()
	data, err := os.ReadFile("testdata/api.json")
	if err != nil {
		t.Fatal(err)
	}
	var hits atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits.Add(1)
		w.Write(data)
	}))
	t.Cleanup(srv.Close)
	return srv, &hits
}

func TestSearchAndCache(t *testing.T) {
	srv, hits := serveFixture(t)
	src := NewSource(srv.URL)
	clock := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	src.now = func() time.Time { return clock }
	ctx := context.Background()

	res, err := src.Search(ctx, "", "")
	if err != nil {
		t.Fatal(err)
	}
	if res.Total != 4 || len(res.Providers) != 2 { // "empty" provider omitted
		t.Fatalf("all: %+v", res)
	}

	res, _ = src.Search(ctx, "SONNET", "")
	if res.Total != 2 {
		t.Fatalf("keyword: %+v", res.Entries)
	}
	res, _ = src.Search(ctx, "sonnet", "openrouter")
	if res.Total != 1 || res.Entries[0].ModelID != "anthropic/claude-sonnet-5-5" {
		t.Fatalf("provider filter: %+v", res.Entries)
	}
	e := res.Entries[0]
	// Vendor comes from canonical_model_id, not from the aggregator.
	if e.Vendor != "Anthropic" || e.ProviderName != "OpenRouter" || *e.InputPrice != 3.3 {
		t.Fatalf("entry: %+v", e)
	}
	gem, _ := src.Find(ctx, "openrouter", "google/gemini-3-pro")
	if gem.Vendor != "google" { // prefix with no matching provider: used as-is
		t.Fatalf("unknown vendor prefix: %+v", gem)
	}

	if hits.Load() != 1 {
		t.Fatalf("expected one fetch, got %d", hits.Load())
	}
	clock = clock.Add(2 * time.Hour)
	src.Search(ctx, "", "")
	if hits.Load() != 2 {
		t.Fatalf("cache should expire after an hour, fetches = %d", hits.Load())
	}

	_, err = src.Find(ctx, "anthropic", "nope")
	if !apperr.Is(err, apperr.NotFound) {
		t.Fatalf("find missing: %v", err)
	}
}

func TestUpstreamErrors(t *testing.T) {
	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "down", http.StatusBadGateway)
	}))
	defer bad.Close()
	garbage := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Write([]byte("<html>"))
	}))
	defer garbage.Close()

	for _, url := range []string{bad.URL, garbage.URL, "http://127.0.0.1:1/none"} {
		_, err := NewSource(url).Search(context.Background(), "", "")
		if !apperr.Is(err, apperr.BadRequest) {
			t.Errorf("%s: got %v", url, err)
		}
	}
}

func newImporter(t *testing.T) (*Importer, *item.Service, *relation.Service) {
	t.Helper()
	srv, _ := serveFixture(t)
	sqldb, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqldb.Close() })
	reg := kind.Default()
	items, rels := item.NewService(sqldb, reg), relation.NewService(sqldb, reg)
	return NewImporter(NewSource(srv.URL), reg, items, rels), items, rels
}

func TestImportCreatesThenMerges(t *testing.T) {
	im, items, rels := newImporter(t)
	ctx := context.Background()

	res, err := im.Import(ctx, ImportInput{ProviderID: "anthropic", ModelID: "claude-haiku-5-5"})
	if err != nil {
		t.Fatal(err)
	}
	a := res.Item.Attrs
	if !res.Created || res.Item.Name != "Claude Haiku 5.5" || a["vendor"] != "Anthropic" || a["context_window"] == nil {
		t.Fatalf("created: %+v", res.Item)
	}
	// Invalid values are skipped rather than failing the import.
	if _, ok := a["max_output"]; ok {
		t.Fatal("zero output limit should be skipped")
	}
	if _, ok := a["release_date"]; ok {
		t.Fatal("malformed date should be skipped")
	}
	if b, _ := json.Marshal(a["modalities"]); string(b) != `["text","image"]` {
		t.Fatalf("modalities: %s", b)
	}

	// The user edits the model; a later import keeps their fields.
	status := item.StatusInUse
	items.Update(ctx, res.Item.ID, item.Patch{Status: &status, Attrs: map[string]any{"model_id": "claude-sonnet-5-5"}})
	sonnet, _ := items.Create(ctx, item.CreateInput{Kind: "model", Name: "My Sonnet", Summary: "keep",
		Attrs: map[string]any{"vendor": "Anthropic", "model_id": "claude-sonnet-5-5"}})
	_ = sonnet

	or, _ := items.Create(ctx, item.CreateInput{Kind: "provider", Name: "OpenRouter"})
	res, err = im.Import(ctx, ImportInput{ProviderID: "anthropic", ModelID: "claude-sonnet-5-5", LinkTo: or.ID})
	if err != nil {
		t.Fatal(err)
	}
	// Matched by model_id: the first model with that model_id wins.
	if res.Created || res.Item.Status != item.StatusInUse || res.Item.Attrs["release_date"] != "2026-09-01" {
		t.Fatalf("merged: %+v", res.Item)
	}
	if res.Relation == nil || res.Relation.Type != "offered_by" || res.Relation.Attrs["output_price"] == nil {
		t.Fatalf("relation: %+v", res.Relation)
	}

	// Re-import from OpenRouter's listing: same model (matched through the
	// official id), same relation, OpenRouter's prices and its own model id;
	// relation attrs the catalog does not provide are kept.
	if _, err := rels.Update(ctx, res.Relation.ID, relation.PatchInput{Attrs: map[string]any{"input_price": 1}}); err != nil {
		t.Fatal(err)
	}
	res2, err := im.Import(ctx, ImportInput{ProviderID: "openrouter", ModelID: "anthropic/claude-sonnet-5-5", LinkTo: or.ID})
	if err != nil {
		t.Fatal(err)
	}
	r := res2.Relation
	if res2.Created || res2.Item.ID != res.Item.ID || res2.Item.Attrs["model_id"] != "claude-sonnet-5-5" {
		t.Fatalf("duplicate model from aggregator: %+v", res2.Item)
	}
	if r.ID != res.Relation.ID || r.Attrs["provider_model_id"] != "anthropic/claude-sonnet-5-5" || jsonStr(r.Attrs["input_price"]) != "3.3" {
		t.Fatalf("price update: %+v", r)
	}
	// From the official provider, no provider_model_id is written.
	if _, ok := res.Relation.Attrs["provider_model_id"]; ok {
		t.Fatalf("official import wrote provider_model_id: %+v", res.Relation.Attrs)
	}

	_, err = im.Import(ctx, ImportInput{ProviderID: "anthropic", ModelID: "claude-haiku-5-5", LinkTo: res.Item.ID})
	if !apperr.Is(err, apperr.ValidationFailed) {
		t.Fatalf("linkTo a model: %v", err)
	}
}

func jsonStr(v any) string {
	b, _ := json.Marshal(v)
	return string(b)
}

func TestHandlers(t *testing.T) {
	im, _, _ := newImporter(t)
	mux := http.NewServeMux()
	NewHandler(im.source, im, nil).Register(mux)

	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/catalog?q=gemini", nil))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"total":1`) || !strings.Contains(rec.Body.String(), `"linkKind":"provider"`) {
		t.Fatalf("search: %d %s", rec.Code, rec.Body)
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/api/v1/catalog/import", strings.NewReader(`{"providerId":"openrouter","modelId":"google/gemini-3-pro"}`)))
	if rec.Code != 201 || !strings.Contains(rec.Body.String(), `"created":true`) {
		t.Fatalf("import: %d %s", rec.Code, rec.Body)
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/api/v1/catalog/import", strings.NewReader(`{"providerId":"openrouter","modelId":"google/gemini-3-pro"}`)))
	if rec.Code != 200 || !strings.Contains(rec.Body.String(), `"created":false`) {
		t.Fatalf("re-import: %d %s", rec.Code, rec.Body)
	}
	rec = httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("POST", "/api/v1/catalog/import", strings.NewReader(`{"providerId":"x","modelId":"y"}`)))
	if rec.Code != 404 {
		t.Fatalf("missing: %d %s", rec.Code, rec.Body)
	}
}
