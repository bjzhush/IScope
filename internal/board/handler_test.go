package board

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"testing"

	"github.com/bjzhush/ai-overview/internal/item"
	"github.com/bjzhush/ai-overview/internal/kind"
	"github.com/bjzhush/ai-overview/internal/relation"
	"github.com/bjzhush/ai-overview/internal/store"
)

func TestBoardEndpoint(t *testing.T) {
	ctx := context.Background()
	sqldb, err := store.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer sqldb.Close()
	reg := kind.Default()
	items := item.NewService(sqldb, reg)
	archived := item.StatusArchived
	created := map[string]string{}
	for _, in := range []item.CreateInput{
		{Kind: "harness", Name: "Claude Code"},
		{Kind: "provider", Name: "OpenRouter"},
		{Kind: "harness", Name: "Aider", Status: &archived},
		{Kind: "provider", Name: "Gone"},
	} {
		it, err := items.Create(ctx, in)
		if err != nil {
			t.Fatal(err)
		}
		created[in.Name] = it.ID
	}
	rels := relation.NewService(sqldb, reg)
	for _, h := range []string{"Claude Code", "Aider"} {
		links := []relation.Link{{TargetID: created["OpenRouter"]}, {TargetID: created["Gone"]}}
		if _, err := rels.Replace(ctx, created[h], links); err != nil {
			t.Fatal(err)
		}
	}
	items.Delete(ctx, created["Gone"])

	mux := http.NewServeMux()
	NewHandler(NewService(reg, items, rels)).Register(mux)

	get := func(path string) (*httptest.ResponseRecorder, View) {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		var v View
		json.Unmarshal(rec.Body.Bytes(), &v)
		return rec, v
	}

	rec, v := get("/api/v1/boards/ai-stack")
	// Deleted "Gone" and archived "Aider" hide their relations.
	if rec.Code != 200 || v.Board.Key != "ai-stack" || len(v.Items) != 2 || len(v.Relations) != 1 {
		t.Fatalf("default: %d %s", rec.Code, rec.Body)
	}
	_, v = get("/api/v1/boards/ai-stack?includeArchived=true")
	if len(v.Items) != 3 || len(v.Relations) != 2 {
		t.Fatalf("includeArchived: %d items, %d relations", len(v.Items), len(v.Relations))
	}
	for _, r := range v.Relations {
		if r.ToID == created["Gone"] {
			t.Fatal("relation to deleted item returned")
		}
	}
	if rec, _ := get("/api/v1/boards/nope"); rec.Code != 404 {
		t.Fatalf("unknown board: %d", rec.Code)
	}
}
