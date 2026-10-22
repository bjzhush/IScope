package main

import (
	"context"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/bjzhush/ai-overview/internal/item"
	"github.com/bjzhush/ai-overview/internal/kind"
	"github.com/bjzhush/ai-overview/internal/store"
)

// Builds the real route table (ServeMux panics on conflicting patterns) and
// checks that API and SPA paths reach the right handler.
func TestRoutes(t *testing.T) {
	sqldb, err := store.Open(context.Background(), filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	defer sqldb.Close()
	reg := kind.Default()
	h := newHandler(reg, item.NewService(sqldb, reg))

	cases := []struct {
		method, path string
		status       int
		contains     string
	}{
		{"GET", "/api/v1/healthz", 200, ""},
		{"GET", "/api/v1/kinds", 200, `"kinds"`},
		{"GET", "/api/v1/boards/ai-stack", 200, `"items":[]`},
		{"GET", "/api/v1/nope", 404, `"not_found"`},
		{"POST", "/api/v1/nope", 404, `"not_found"`},
		{"GET", "/", 200, "<"},
		{"GET", "/boards/ai-stack", 200, "<"},
		{"POST", "/boards/ai-stack", 405, ""},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest(c.method, c.path, nil))
		if rec.Code != c.status || !strings.Contains(rec.Body.String(), c.contains) {
			t.Errorf("%s %s = %d %q", c.method, c.path, rec.Code, rec.Body)
		}
	}
}
