package catalog

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"reflect"
	"testing"

	"github.com/bjzhush/ai-overview/internal/apperr"
	"github.com/bjzhush/ai-overview/internal/item"
	"github.com/bjzhush/ai-overview/internal/kind"
	"github.com/bjzhush/ai-overview/internal/relation"
	"github.com/bjzhush/ai-overview/internal/snapshot"
	"github.com/bjzhush/ai-overview/internal/store"
	"github.com/bjzhush/ai-overview/internal/store/db"
	"github.com/bjzhush/ai-overview/internal/transfer"
)

func versionsSource(t *testing.T) *Source {
	t.Helper()
	data, err := os.ReadFile("testdata/versions.json")
	if err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.Write(data) }))
	t.Cleanup(srv.Close)
	return NewSource(srv.URL)
}

func TestCatalogKindIsMarked(t *testing.T) {
	k, ok := kind.Default().Kind(modelKind)
	if !ok || !k.CatalogImport {
		t.Fatalf("%s must be marked CatalogImport: %+v", modelKind, k)
	}
	for _, other := range kind.Default().Definitions().Kinds {
		if other.Key != modelKind && other.CatalogImport {
			t.Fatalf("only %s is written by the catalog, not %s", modelKind, other.Key)
		}
	}
}

func TestSearchResolvesLinks(t *testing.T) {
	src := versionsSource(t)
	ctx := context.Background()
	for _, c := range []struct {
		link, provider, model string
	}{
		{"https://models.dev/models/anthropic/claude-opus-5-6", "anthropic", "claude-opus-5-6"},
		{"https://models.dev/models/anthropic/claude-opus-5-6/", "anthropic", "claude-opus-5-6"},
		{"https://openrouter.ai/anthropic/claude-opus-5-6", "openrouter", "anthropic/claude-opus-5-6"},
		{"  https://www.openrouter.ai/anthropic/claude-opus-5-6/providers?tab=x#top ", "openrouter", "anthropic/claude-opus-5-6"},
		// Whole segments only: claude-opus-5 is not a prefix match of claude-opus-5-6.
		{"https://openrouter.ai/anthropic/claude-opus-5", "openrouter", "anthropic/claude-opus-5"},
		// A lab with no provider of its own: the first entry with that canonical id.
		{"https://models.dev/models/qwen/qwen-4", "siliconflow", "qwen/qwen-4"},
	} {
		res, err := src.Search(ctx, c.link, "")
		if err != nil {
			t.Fatal(err)
		}
		if !res.Resolved || res.Total != 1 || res.Entries[0].ProviderID != c.provider || res.Entries[0].ModelID != c.model {
			t.Errorf("%s: %+v", c.link, res)
		}
	}

	for _, c := range []struct {
		link  string
		total int
		only  string // every result's provider, when the host named one
	}{
		{"https://openrouter.ai/anthropic/claude-nope", 0, ""},
		{"https://openrouter.ai/anthropic/claude-opus-5-6x", 0, ""}, // ids match whole segments only
		{"https://openrouter.ai/anthropic/opus", 3, "openrouter"},   // keyword "opus" within OpenRouter
		{"https://unknown.example/x/claude-opus-5-6", 2, ""},        // keyword across the catalog
		{"https://models.dev/models/anthropic/nope", 0, ""},
		{"https://models.dev/", 7, ""}, // no path: everything
	} {
		res, _ := src.Search(ctx, c.link, "")
		if res.Resolved || res.Total != c.total {
			t.Errorf("%s: resolved=%v total=%d", c.link, res.Resolved, res.Total)
		}
		for _, e := range res.Entries {
			if c.only != "" && e.ProviderID != c.only {
				t.Errorf("%s: result from %s", c.link, e.ProviderID)
			}
		}
	}
}

type updateEnv struct {
	up    *Updater
	im    *Importer
	items *item.Service
	rels  *relation.Service
	snaps *snapshot.Service
	ids   map[string]string
}

func newUpdateEnv(t *testing.T) updateEnv {
	t.Helper()
	ctx := context.Background()
	sqldb, err := store.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqldb.Close() })
	reg := kind.Default()
	items, rels := item.NewService(sqldb, reg), relation.NewService(sqldb, reg)
	tr := transfer.NewService(sqldb, items, rels)
	snaps := snapshot.NewService(sqldb, reg, tr)
	im := NewImporter(versionsSource(t), reg, items, rels)
	e := updateEnv{up: NewUpdater(im, sqldb, tr, snaps), im: im, items: items, rels: rels, snaps: snaps, ids: map[string]string{}}

	res, err := im.Import(ctx, ImportInput{ProviderID: "anthropic", ModelID: "claude-opus-5-5"})
	if err != nil {
		t.Fatal(err)
	}
	opus := res.Item.ID
	e.ids["opus"] = opus
	tags := []string{"flagship"}
	notes := "我的笔记"
	links := []item.Link{{Label: "models.dev", URL: "https://models.dev/models/anthropic/claude-opus-5-5"}, {Label: "博客", URL: "https://example.com/opus"}}
	if _, err := items.Update(ctx, opus, item.Patch{Tags: &tags, Notes: &notes, Links: &links, Attrs: map[string]any{"vendor": "Anthropic"}}); err != nil {
		t.Fatal(err)
	}
	for _, in := range []item.CreateInput{
		{Kind: "harness", Name: "Claude Code"},
		{Kind: "provider", Name: "OpenRouter"},
		{Kind: "provider", Name: "Anthropic API"},
		{Kind: "provider", Name: "Some Cloud"},
	} {
		it, err := items.Create(ctx, in)
		if err != nil {
			t.Fatal(err)
		}
		e.ids[in.Name] = it.ID
	}
	if _, err := rels.Replace(ctx, e.ids["Claude Code"], []relation.Link{{TargetID: opus, Attrs: map[string]any{"is_default": true}}}); err != nil {
		t.Fatal(err)
	}
	for name, attrs := range map[string]map[string]any{
		"OpenRouter":    {"input_price": 5.5, "output_price": 27.5, "provider_model_id": "anthropic/claude-opus-5-5"},
		"Anthropic API": {"input_price": 5, "output_price": 25},
		"Some Cloud":    {"input_price": 9},
	} {
		if _, err := rels.Upsert(ctx, opus, e.ids[name], attrs); err != nil {
			t.Fatal(err)
		}
	}
	return e
}

func (e updateEnv) offer(t *testing.T, provider string) map[string]any {
	t.Helper()
	rels, err := e.rels.ListForItem(context.Background(), e.ids["opus"])
	if err != nil {
		t.Fatal(err)
	}
	for _, r := range rels {
		if r.ToID == e.ids[provider] {
			return normalizeJSON(r.Attrs).(map[string]any)
		}
	}
	t.Fatalf("no relation to %s", provider)
	return nil
}

var toOpus56 = UpdateInput{ProviderID: "anthropic", ModelID: "claude-opus-5-6", SourceURL: "https://models.dev/models/anthropic/claude-opus-5-6"}

func TestUpdateDryRunWritesNothing(t *testing.T) {
	e := newUpdateEnv(t)
	ctx := context.Background()
	in := toOpus56
	in.TargetID, in.DryRun = e.ids["opus"], true
	res, err := e.up.Update(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	if !res.DryRun || res.SnapshotID != "" || res.Item.Name != "Claude Opus 5.6" {
		t.Fatalf("result: %+v", res)
	}
	byKey := map[string]Change{}
	for _, c := range res.Changes {
		byKey[c.Key] = c
	}
	if byKey["name"].Old != "Claude Opus 5.5" || byKey["release_date"].New != nil || byKey["release_date"].Old != "2026-08-01" {
		t.Fatalf("changes: %+v", res.Changes)
	}
	if _, ok := byKey["vendor"]; ok {
		t.Fatalf("unchanged vendor listed: %+v", res.Changes)
	}
	status := map[string]string{}
	for _, p := range res.Prices {
		status[p.ProviderName] = p.Status + "/" + p.Source
	}
	want := map[string]string{"OpenRouter": "updated/OpenRouter", "Anthropic API": "updated/Anthropic", "Some Cloud": "not_found/"}
	if !reflect.DeepEqual(status, want) {
		t.Fatalf("prices: %v", status)
	}

	it, _ := e.items.Get(ctx, e.ids["opus"])
	if it.Name != "Claude Opus 5.5" || e.offer(t, "Anthropic API")["input_price"] != 5.0 {
		t.Fatalf("dry run wrote: %s %v", it.Name, e.offer(t, "Anthropic API"))
	}
	if list, _ := e.snaps.List(ctx); len(list) != 0 {
		t.Fatalf("dry run saved a snapshot: %+v", list)
	}
}

func TestUpdateOverwritesCatalogDataAndKeepsTheRest(t *testing.T) {
	e := newUpdateEnv(t)
	ctx := context.Background()
	in := toOpus56
	in.TargetID = e.ids["opus"]
	res, err := e.up.Update(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	it, _ := e.items.Get(ctx, e.ids["opus"])
	a := normalizeJSON(it.Attrs).(map[string]any)
	if it.Name != "Claude Opus 5.6" || a["model_id"] != "claude-opus-5-6" || a["context_window"] != 2000000.0 ||
		a["max_output"] != 128000.0 || !reflect.DeepEqual(a["modalities"], []any{"text"}) {
		t.Fatalf("catalog attrs: %s %v", it.Name, a)
	}
	if _, ok := a["release_date"]; ok {
		t.Fatalf("release_date the new entry lacks was kept: %v", a)
	}
	if !reflect.DeepEqual(it.Tags, []string{"flagship"}) || it.Notes != "我的笔记" || it.Slug != "claude-opus-5-5" {
		t.Fatalf("kept fields: %+v", it)
	}
	wantLinks := []item.Link{{Label: "models.dev", URL: "https://models.dev/models/anthropic/claude-opus-5-6"}, {Label: "博客", URL: "https://example.com/opus"}}
	if !reflect.DeepEqual(it.Links, wantLinks) {
		t.Fatalf("links: %+v", it.Links)
	}

	// Prices: matched providers get the new version's, provider_model_id follows.
	if got := e.offer(t, "OpenRouter"); !reflect.DeepEqual(got, map[string]any{"input_price": 4.4, "output_price": 22.0, "provider_model_id": "anthropic/claude-opus-5-6"}) {
		t.Fatalf("OpenRouter: %v", got)
	}
	if got := e.offer(t, "Anthropic API"); !reflect.DeepEqual(got, map[string]any{"input_price": 4.0, "output_price": 20.0}) {
		t.Fatalf("Anthropic API: %v", got)
	}
	if got := e.offer(t, "Some Cloud"); !reflect.DeepEqual(got, map[string]any{"input_price": 9.0}) {
		t.Fatalf("unmatched provider kept its price: %v", got)
	}
	// The harness link and its default flag stay.
	rels, _ := e.rels.ListForItem(ctx, e.ids["Claude Code"])
	if len(rels) != 1 || rels[0].ToID != e.ids["opus"] || rels[0].Attrs["is_default"] != true {
		t.Fatalf("harness link: %+v", rels)
	}

	// The snapshot holds the old version.
	list, _ := e.snaps.List(ctx)
	if len(list) != 1 || list[0].ID != res.SnapshotID || list[0].Label != "更新前：Claude Opus 5.5 → Claude Opus 5.6" {
		t.Fatalf("snapshots: %+v", list)
	}
	v, err := e.snaps.Board(ctx, res.SnapshotID, "ai-stack")
	if err != nil {
		t.Fatal(err)
	}
	for _, old := range v.Items {
		if old.Slug == "claude-opus-5-5" && old.Name != "Claude Opus 5.5" {
			t.Fatalf("snapshot item: %+v", old)
		}
	}
}

func TestUpdateRefusals(t *testing.T) {
	e := newUpdateEnv(t)
	ctx := context.Background()
	in := toOpus56
	in.TargetID = e.ids["OpenRouter"]
	if _, err := e.up.Update(ctx, in); !isCode(err, apperr.ValidationFailed) {
		t.Fatalf("non-model target: %v", err)
	}
	in.TargetID, in.SourceURL = e.ids["opus"], "ftp://x"
	if _, err := e.up.Update(ctx, in); !isCode(err, apperr.ValidationFailed) {
		t.Fatalf("bad source url: %v", err)
	}

	// Another card already is Opus 5.6: refuse rather than leave two.
	if _, err := e.im.Import(ctx, ImportInput{ProviderID: "anthropic", ModelID: "claude-opus-5-6"}); err != nil {
		t.Fatal(err)
	}
	in.SourceURL = ""
	if _, err := e.up.Update(ctx, in); !isCode(err, apperr.Conflict) {
		t.Fatalf("duplicate model: %v", err)
	}
	if list, _ := e.snaps.List(ctx); len(list) != 0 {
		t.Fatalf("refusal saved a snapshot: %+v", list)
	}
}

func TestUpdateRollsBackEverythingOnError(t *testing.T) {
	e := newUpdateEnv(t)
	ctx := context.Background()
	// Broken Cloud offers 5.6 at a negative price, which the relation rejects
	// after the snapshot and the item are written.
	broken, err := e.items.Create(ctx, item.CreateInput{Kind: "provider", Name: "Broken Cloud"})
	if err != nil {
		t.Fatal(err)
	}
	if _, err := e.rels.Upsert(ctx, e.ids["opus"], broken.ID, map[string]any{"input_price": 1}); err != nil {
		t.Fatal(err)
	}
	in := toOpus56
	in.TargetID = e.ids["opus"]
	if _, err := e.up.Update(ctx, in); !isCode(err, apperr.ValidationFailed) {
		t.Fatalf("want a validation error, got %v", err)
	}
	it, _ := e.items.Get(ctx, e.ids["opus"])
	if it.Name != "Claude Opus 5.5" || e.offer(t, "OpenRouter")["input_price"] != 5.5 {
		t.Fatalf("partial write: %s %v", it.Name, e.offer(t, "OpenRouter"))
	}
	if list, _ := e.snaps.List(ctx); len(list) != 0 {
		t.Fatalf("snapshot survived the rollback: %+v", list)
	}
}

func TestImportKeepsTheSourceLinkOnce(t *testing.T) {
	e := newUpdateEnv(t)
	ctx := context.Background()
	link := "https://openrouter.ai/anthropic/claude-opus-5-6"
	in := ImportInput{ProviderID: "openrouter", ModelID: "anthropic/claude-opus-5-6", SourceURL: link}
	res, err := e.im.Import(ctx, in)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Created || !reflect.DeepEqual(res.Item.Links, []item.Link{{Label: "OpenRouter", URL: link}}) {
		t.Fatalf("created: %+v", res.Item.Links)
	}
	res, _ = e.im.Import(ctx, in)
	if res.Created || len(res.Item.Links) != 1 {
		t.Fatalf("second import: %+v", res.Item.Links)
	}
	in.SourceURL = "javascript:alert(1)"
	if _, err := e.im.Import(ctx, in); !isCode(err, apperr.ValidationFailed) {
		t.Fatalf("bad url: %v", err)
	}
}

func isCode(err error, code apperr.Code) bool {
	var ae *apperr.Error
	return errors.As(err, &ae) && ae.Code == code
}

// Compile-time check that the snapshot service fits the updater.
var _ interface {
	CreateTx(context.Context, *db.Queries, transfer.Document, string) (string, error)
} = (*snapshot.Service)(nil)
