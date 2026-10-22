package httpx

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
)

func TestSPA(t *testing.T) {
	h := SPA(fstest.MapFS{
		"index.html":       {Data: []byte("<html>app</html>")},
		"assets/app-1.js":  {Data: []byte("console.log(1)")},
		"assets/style.css": {Data: []byte("body{}")},
	})
	cases := []struct {
		path, body, cache string
	}{
		{"/", "app", "no-cache"},
		{"/boards/ai-stack", "app", "no-cache"},
		{"/boards/ai-stack?item=1", "app", "no-cache"},
		{"/index.html", "app", "no-cache"},
		{"/assets", "app", "no-cache"},
		{"/assets/app-1.js", "console.log", "immutable"},
		{"/../etc/passwd", "app", "no-cache"},
	}
	for _, c := range cases {
		rec := httptest.NewRecorder()
		h.ServeHTTP(rec, httptest.NewRequest("GET", c.path, nil))
		if rec.Code != http.StatusOK || !strings.Contains(rec.Body.String(), c.body) ||
			!strings.Contains(rec.Header().Get("Cache-Control"), c.cache) {
			t.Errorf("%s: %d %q cache=%q", c.path, rec.Code, rec.Body, rec.Header().Get("Cache-Control"))
		}
	}
}
