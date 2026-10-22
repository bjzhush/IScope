package kind

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestKindsEndpoint(t *testing.T) {
	mux := http.NewServeMux()
	Default().Register(mux)
	rec := httptest.NewRecorder()
	mux.ServeHTTP(rec, httptest.NewRequest("GET", "/api/v1/kinds", nil))
	if rec.Code != 200 {
		t.Fatalf("status %d", rec.Code)
	}
	var d Definitions
	if err := json.Unmarshal(rec.Body.Bytes(), &d); err != nil {
		t.Fatal(err)
	}
	if len(d.Kinds) != 3 || d.Kinds[0].Key != "harness" || len(d.RelationTypes) != 3 || d.Boards[0].Key != "ai-stack" {
		t.Fatalf("payload: %s", rec.Body)
	}
	body := rec.Body.String()
	for _, want := range []string{`"showOnCard":true`, `"integer":true`, `"fromKind":"model"`, `"min":1`} {
		if !strings.Contains(body, want) {
			t.Errorf("payload missing %s", want)
		}
	}
}
