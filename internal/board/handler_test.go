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
	for _, in := range []item.CreateInput{
		{Kind: "harness", Name: "Claude Code"},
		{Kind: "provider", Name: "OpenRouter"},
		{Kind: "harness", Name: "Aider", Status: &archived},
	} {
		if _, err := items.Create(ctx, in); err != nil {
			t.Fatal(err)
		}
	}
	gone, _ := items.Create(ctx, item.CreateInput{Kind: "provider", Name: "Gone"})
	items.Delete(ctx, gone.ID)

	mux := http.NewServeMux()
	NewHandler(NewService(reg, items)).Register(mux)

	get := func(path string) (*httptest.ResponseRecorder, View) {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest("GET", path, nil))
		var v View
		json.Unmarshal(rec.Body.Bytes(), &v)
		return rec, v
	}

	rec, v := get("/api/v1/boards/ai-stack")
	if rec.Code != 200 || v.Board.Key != "ai-stack" || len(v.Items) != 2 || v.Relations == nil {
		t.Fatalf("default: %d %s", rec.Code, rec.Body)
	}
	_, v = get("/api/v1/boards/ai-stack?includeArchived=true")
	if len(v.Items) != 3 {
		t.Fatalf("includeArchived: %d items", len(v.Items))
	}
	if rec, _ := get("/api/v1/boards/nope"); rec.Code != 404 {
		t.Fatalf("unknown board: %d", rec.Code)
	}
}
