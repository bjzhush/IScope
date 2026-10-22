package kind

import (
	"net/http"

	"github.com/bjzhush/ai-overview/internal/httpx"
)

// Register mounts GET /api/v1/kinds.
func (r *Registry) Register(mux *http.ServeMux) {
	defs := r.Definitions()
	mux.HandleFunc("GET /api/v1/kinds", func(w http.ResponseWriter, _ *http.Request) {
		httpx.Write(w, http.StatusOK, defs)
	})
}
