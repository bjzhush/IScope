package item

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/bjzhush/ai-overview/internal/relation"
)

func newTestServer(t *testing.T) http.Handler {
	t.Helper()
	mux := http.NewServeMux()
	s := newTestService(t)
	NewHandler(s, relation.NewService(s.db, s.reg)).Register(mux)
	return mux
}

type errResp struct {
	Error struct {
		Code   string            `json:"code"`
		Fields map[string]string `json:"fields"`
	} `json:"error"`
}

func do(t *testing.T, h http.Handler, method, path, body string) *httptest.ResponseRecorder {
	t.Helper()
	req := httptest.NewRequest(method, path, strings.NewReader(body))
	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	return rec
}

func expect(t *testing.T, rec *httptest.ResponseRecorder, status int, code string) errResp {
	t.Helper()
	if rec.Code != status {
		t.Fatalf("status = %d, want %d; body %s", rec.Code, status, rec.Body)
	}
	var e errResp
	if code != "" {
		json.Unmarshal(rec.Body.Bytes(), &e)
		if e.Error.Code != code {
			t.Fatalf("code = %q, want %q; body %s", e.Error.Code, code, rec.Body)
		}
	}
	return e
}

func TestItemEndpoints(t *testing.T) {
	h := newTestServer(t)

	rec := do(t, h, "POST", "/api/v1/items", `{"kind":"model","name":"Claude Sonnet 5.5","status":"in_use",
		"tags":["coding"],"rating":5,"pinned":true,
		"attrs":{"vendor":"Anthropic","context_window":200000,"modalities":["text","image"]}}`)
	expect(t, rec, http.StatusCreated, "")
	var it Item
	json.Unmarshal(rec.Body.Bytes(), &it)
	if it.ID == "" || it.Slug != "claude-sonnet-5-5" || !it.Pinned || it.SortOrder != 1 {
		t.Fatalf("created: %s", rec.Body)
	}
	if !strings.Contains(rec.Body.String(), `"context_window":200000`) || !strings.Contains(rec.Body.String(), `"sortOrder":1`) {
		t.Fatalf("json shape: %s", rec.Body)
	}

	rec = do(t, h, "GET", "/api/v1/items/"+it.ID, "")
	expect(t, rec, http.StatusOK, "")
	if !strings.Contains(rec.Body.String(), `"relations":[]`) {
		t.Fatalf("detail: %s", rec.Body)
	}

	rec = do(t, h, "PATCH", "/api/v1/items/"+it.ID, `{"summary":"主力","rating":null,"attrs":{"modalities":null}}`)
	expect(t, rec, http.StatusOK, "")
	if !strings.Contains(rec.Body.String(), `"rating":null`) || strings.Contains(rec.Body.String(), "modalities") {
		t.Fatalf("patched: %s", rec.Body)
	}

	rec = do(t, h, "GET", "/api/v1/items?kind=model&q=sonnet", "")
	expect(t, rec, http.StatusOK, "")
	var list []Item
	json.Unmarshal(rec.Body.Bytes(), &list)
	if len(list) != 1 {
		t.Fatalf("list: %s", rec.Body)
	}

	expect(t, do(t, h, "DELETE", "/api/v1/items/"+it.ID, ""), http.StatusNoContent, "")
	expect(t, do(t, h, "GET", "/api/v1/items/"+it.ID, ""), http.StatusNotFound, "not_found")
	expect(t, do(t, h, "DELETE", "/api/v1/items/"+it.ID, ""), http.StatusNotFound, "not_found")
	rec = do(t, h, "GET", "/api/v1/items", "")
	if strings.TrimSpace(rec.Body.String()) != "[]" {
		t.Fatalf("empty list should be []: %s", rec.Body)
	}
}

func TestItemEndpointErrors(t *testing.T) {
	h := newTestServer(t)
	rec := do(t, h, "POST", "/api/v1/items", `{"kind":"harness","name":"Cursor"}`)
	expect(t, rec, http.StatusCreated, "")
	var it Item
	json.Unmarshal(rec.Body.Bytes(), &it)

	cases := []struct {
		name, method, path, body string
		status                   int
		code, field              string
	}{
		{"bad json", "POST", "/api/v1/items", `{"kind":`, 400, "bad_request", ""},
		{"empty body", "POST", "/api/v1/items", ``, 400, "bad_request", ""},
		{"trailing json", "POST", "/api/v1/items", `{"kind":"harness","name":"a"}{}`, 400, "bad_request", ""},
		{"unknown top-level field", "POST", "/api/v1/items", `{"kind":"harness","name":"a","color":1}`, 400, "bad_request", ""},
		{"unknown kind", "POST", "/api/v1/items", `{"kind":"nope","name":"a"}`, 400, "bad_request", ""},
		{"wrong top-level type", "POST", "/api/v1/items", `{"kind":"harness","name":"a","rating":"5"}`, 400, "validation_failed", "rating"},
		{"unknown attr", "POST", "/api/v1/items", `{"kind":"harness","name":"a","attrs":{"x":1}}`, 400, "validation_failed", "attrs.x"},
		{"wrong attr type", "POST", "/api/v1/items", `{"kind":"harness","name":"a","attrs":{"open_source":"yes"}}`, 400, "validation_failed", "attrs.open_source"},
		{"missing required attr", "POST", "/api/v1/items", `{"kind":"model","name":"a"}`, 400, "validation_failed", "attrs.vendor"},
		{"slug conflict", "POST", "/api/v1/items", `{"kind":"harness","name":"cursor"}`, 409, "conflict", "name"},
		{"patch unknown field", "PATCH", "/api/v1/items/" + it.ID, `{"id":"x"}`, 400, "bad_request", ""},
		{"patch null name", "PATCH", "/api/v1/items/" + it.ID, `{"name":null}`, 400, "validation_failed", "name"},
		{"patch kind", "PATCH", "/api/v1/items/" + it.ID, `{"kind":"model"}`, 400, "validation_failed", "kind"},
		{"patch bad attr", "PATCH", "/api/v1/items/" + it.ID, `{"attrs":{"form":"phone"}}`, 400, "validation_failed", "attrs.form"},
		{"patch missing", "PATCH", "/api/v1/items/nope", `{"name":"x"}`, 404, "not_found", ""},
		{"get missing", "GET", "/api/v1/items/nope", ``, 404, "not_found", ""},
		{"list bad status", "GET", "/api/v1/items?status=done", ``, 400, "bad_request", ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			e := expect(t, do(t, h, c.method, c.path, c.body), c.status, c.code)
			if c.field != "" && e.Error.Fields[c.field] == "" {
				t.Fatalf("missing field error %q: %+v", c.field, e.Error.Fields)
			}
		})
	}
}
