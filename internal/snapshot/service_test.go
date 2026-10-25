package snapshot

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

	"github.com/bjzhush/ai-overview/internal/item"
	"github.com/bjzhush/ai-overview/internal/kind"
	"github.com/bjzhush/ai-overview/internal/relation"
	"github.com/bjzhush/ai-overview/internal/store"
	"github.com/bjzhush/ai-overview/internal/transfer"
)

type env struct {
	t     *testing.T
	items *item.Service
	rels  *relation.Service
	tr    *transfer.Service
	mux   *http.ServeMux
	ids   map[string]string
}

func newEnv(t *testing.T) env {
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
	svc := NewService(sqldb, reg, tr)
	// Distinct, increasing times so the list order is deterministic.
	clock := time.Date(2026, 10, 26, 6, 30, 0, 0, time.UTC)
	svc.now = func() time.Time { clock = clock.Add(time.Minute); return clock }
	tr.SetSnapshotter(svc)
	mux := http.NewServeMux()
	NewHandler(svc).Register(mux)
	transfer.NewHandler(tr).Register(mux)

	e := env{t: t, items: items, rels: rels, tr: tr, mux: mux, ids: map[string]string{}}
	archived := item.StatusArchived
	for _, in := range []item.CreateInput{
		{Kind: "harness", Name: "Claude Code"},
		{Kind: "harness", Name: "Aider", Status: &archived},
		{Kind: "model", Name: "Claude Opus 5.5", Attrs: map[string]any{"vendor": "Anthropic", "context_window": 1000000}},
		{Kind: "provider", Name: "OpenRouter"},
	} {
		it, err := items.Create(ctx, in)
		if err != nil {
			t.Fatal(err)
		}
		e.ids[in.Name] = it.ID
	}
	yes := map[string]any{"is_default": true}
	if _, err := rels.Replace(ctx, e.ids["Claude Code"], []relation.Link{{TargetID: e.ids["Claude Opus 5.5"], Attrs: yes}}); err != nil {
		t.Fatal(err)
	}
	if _, err := rels.Upsert(ctx, e.ids["Claude Opus 5.5"], e.ids["OpenRouter"], map[string]any{"input_price": 5}); err != nil {
		t.Fatal(err)
	}
	return e
}

func (e env) do(method, path string, body any) *httptest.ResponseRecorder {
	e.t.Helper()
	var buf bytes.Buffer
	if body != nil {
		json.NewEncoder(&buf).Encode(body)
	}
	rec := httptest.NewRecorder()
	e.mux.ServeHTTP(rec, httptest.NewRequest(method, path, &buf))
	return rec
}

func (e env) list() []Meta {
	e.t.Helper()
	var out []Meta
	if err := json.Unmarshal(e.do("GET", "/api/v1/snapshots", nil).Body.Bytes(), &out); err != nil {
		e.t.Fatal(err)
	}
	return out
}

func (e env) create(label string) Meta {
	e.t.Helper()
	rec := e.do("POST", "/api/v1/snapshots", map[string]string{"label": label})
	if rec.Code != http.StatusCreated {
		e.t.Fatalf("create: %d %s", rec.Code, rec.Body)
	}
	var m Meta
	json.Unmarshal(rec.Body.Bytes(), &m)
	return m
}

func TestCreateAndList(t *testing.T) {
	e := newEnv(t)
	if got := e.list(); len(got) != 0 {
		t.Fatalf("empty list: %+v", got)
	}
	first := e.create("  ")
	second := e.create("改模型前")
	if first.Label != "手动快照" || first.ItemCount != 4 || first.RelationCount != 2 {
		t.Fatalf("first: %+v", first)
	}
	got := e.list()
	if len(got) != 2 || got[0].ID != second.ID || got[1].ID != first.ID || got[0].Label != "改模型前" {
		t.Fatalf("newest first: %+v", got)
	}
	if rec := e.do("POST", "/api/v1/snapshots", map[string]string{"label": strings.Repeat("长", 101)}); rec.Code != 400 {
		t.Fatalf("long label: %d", rec.Code)
	}
}

func TestBoardShowsTheSnapshotNotTheCurrentData(t *testing.T) {
	e := newEnv(t)
	m := e.create("")
	ctx := context.Background()
	newName := "Claude Opus 5.6"
	if _, err := e.items.Update(ctx, e.ids["Claude Opus 5.5"], item.Patch{Name: &newName}); err != nil {
		t.Fatal(err)
	}
	e.items.Delete(ctx, e.ids["OpenRouter"])

	rec := e.do("GET", "/api/v1/snapshots/"+m.ID+"/boards/ai-stack", nil)
	if rec.Code != 200 {
		t.Fatalf("board: %d %s", rec.Code, rec.Body)
	}
	var v BoardView
	json.Unmarshal(rec.Body.Bytes(), &v)
	if v.Board.Key != "ai-stack" || v.Snapshot.ID != m.ID || len(v.Items) != 4 || len(v.Relations) != 2 {
		t.Fatalf("view: %s", rec.Body)
	}
	byID := map[string]item.Item{}
	for _, it := range v.Items {
		byID[it.ID] = it
	}
	opus := byID["model:claude-opus-5-5"]
	if opus.Name != "Claude Opus 5.5" || opus.Attrs["vendor"] != "Anthropic" {
		t.Fatalf("old values: %+v", opus)
	}
	if byID["harness:aider"].Status != "archived" || byID["provider:openrouter"].Name != "OpenRouter" {
		t.Fatalf("archived and deleted-since items: %+v", byID)
	}
	// Stand-in IDs on both ends match the items, and attrs survive.
	for _, r := range v.Relations {
		if _, ok := byID[r.FromID]; !ok {
			t.Fatalf("dangling from: %+v", r)
		}
		if _, ok := byID[r.ToID]; !ok {
			t.Fatalf("dangling to: %+v", r)
		}
		if r.Type == "uses" && r.Attrs["is_default"] != true {
			t.Fatalf("relation attrs: %+v", r)
		}
	}

	if rec := e.do("GET", "/api/v1/snapshots/nope/boards/ai-stack", nil); rec.Code != 404 {
		t.Fatalf("missing snapshot: %d", rec.Code)
	}
	if rec := e.do("GET", "/api/v1/snapshots/"+m.ID+"/boards/nope", nil); rec.Code != 404 {
		t.Fatalf("missing board: %d", rec.Code)
	}
}

func TestDownloadImportsBack(t *testing.T) {
	e := newEnv(t)
	m := e.create("")
	newName := "Claude Opus 5.6"
	if _, err := e.items.Update(context.Background(), e.ids["Claude Opus 5.5"], item.Patch{Name: &newName}); err != nil {
		t.Fatal(err)
	}

	rec := e.do("GET", "/api/v1/snapshots/"+m.ID+"/download", nil)
	if rec.Code != 200 {
		t.Fatalf("download: %d", rec.Code)
	}
	if cd := rec.Header().Get("Content-Disposition"); cd != `attachment; filename="ai-overview-snapshot-20261026-063100.json"` {
		t.Fatalf("Content-Disposition: %s", cd)
	}
	if rec := e.do("POST", "/api/v1/import", json.RawMessage(rec.Body.Bytes())); rec.Code != 200 {
		t.Fatalf("import: %d %s", rec.Code, rec.Body)
	}
	it, _ := e.items.Get(context.Background(), e.ids["Claude Opus 5.5"])
	if it.Name != "Claude Opus 5.5" {
		t.Fatalf("restored name: %s", it.Name)
	}
	if rec := e.do("GET", "/api/v1/snapshots/nope/download", nil); rec.Code != 404 {
		t.Fatalf("missing: %d", rec.Code)
	}
}

func TestDelete(t *testing.T) {
	e := newEnv(t)
	m := e.create("")
	if rec := e.do("DELETE", "/api/v1/snapshots/"+m.ID, nil); rec.Code != 204 {
		t.Fatalf("delete: %d", rec.Code)
	}
	if len(e.list()) != 0 {
		t.Fatal("still listed")
	}
	if rec := e.do("DELETE", "/api/v1/snapshots/"+m.ID, nil); rec.Code != 404 {
		t.Fatalf("again: %d", rec.Code)
	}
}

func TestImportSavesASnapshotOnlyWhenItChangesSomething(t *testing.T) {
	e := newEnv(t)
	ctx := context.Background()
	doc, err := e.tr.Export(ctx)
	if err != nil {
		t.Fatal(err)
	}
	post := func(d transfer.Document) int { return e.do("POST", "/api/v1/import", d).Code }

	// Identical file: nothing changes, no snapshot.
	if code := post(doc); code != 200 || len(e.list()) != 0 {
		t.Fatalf("unchanged import: %d, %d snapshots", code, len(e.list()))
	}

	// A failing import rolls its snapshot back with everything else.
	bad := doc
	bad.Items = append([]item.Portable{}, doc.Items...)
	bad.Items[0].Name = "Renamed"
	bad.Items[1].Name = ""
	if code := post(bad); code != 400 || len(e.list()) != 0 {
		t.Fatalf("failed import: %d, %d snapshots", code, len(e.list()))
	}

	// A changing import keeps a snapshot of the board as it was before.
	good := doc
	good.Items = append([]item.Portable{}, doc.Items...)
	good.Items[0].Name = "Renamed"
	if code := post(good); code != 200 {
		t.Fatalf("import: %d", code)
	}
	got := e.list()
	if len(got) != 1 || got[0].Label != "导入 JSON 前" || got[0].ItemCount != 4 {
		t.Fatalf("snapshots: %+v", got)
	}
	var v BoardView
	json.Unmarshal(e.do("GET", "/api/v1/snapshots/"+got[0].ID+"/boards/ai-stack", nil).Body.Bytes(), &v)
	for _, it := range v.Items {
		if it.Name == "Renamed" {
			t.Fatal("snapshot taken after the import")
		}
	}
}
