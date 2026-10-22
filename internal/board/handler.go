package board

import (
	"net/http"

	"github.com/bjzhush/ai-overview/internal/httpx"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/boards/{key}", httpx.Handle(h.get))
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) error {
	v, err := h.svc.Get(r.Context(), r.PathValue("key"), r.URL.Query().Get("includeArchived") == "true")
	if err != nil {
		return err
	}
	httpx.Write(w, http.StatusOK, v)
	return nil
}
