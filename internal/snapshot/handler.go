package snapshot

import (
	"fmt"
	"net/http"
	"strings"

	"github.com/bjzhush/ai-overview/internal/httpx"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/snapshots", httpx.Handle(h.list))
	mux.HandleFunc("POST /api/v1/snapshots", httpx.Handle(h.create))
	mux.HandleFunc("GET /api/v1/snapshots/{id}/download", httpx.Handle(h.download))
	mux.HandleFunc("GET /api/v1/snapshots/{id}/boards/{key}", httpx.Handle(h.board))
	mux.HandleFunc("DELETE /api/v1/snapshots/{id}", httpx.Handle(h.delete))
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) error {
	list, err := h.svc.List(r.Context())
	if err != nil {
		return err
	}
	httpx.Write(w, http.StatusOK, list)
	return nil
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) error {
	var in struct {
		Label string `json:"label"`
	}
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	m, err := h.svc.Create(r.Context(), in.Label)
	if err != nil {
		return err
	}
	httpx.Write(w, http.StatusCreated, m)
	return nil
}

// download serves the snapshot as an export file, which 导入 JSON accepts.
func (h *Handler) download(w http.ResponseWriter, r *http.Request) error {
	m, doc, err := h.svc.Doc(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	// 2026-10-26T06:30:00Z -> 20261026-063000
	stamp := strings.NewReplacer("-", "", ":", "", "T", "-", "Z", "").Replace(m.CreatedAt)
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="ai-overview-snapshot-%s.json"`, stamp))
	httpx.Write(w, http.StatusOK, doc)
	return nil
}

func (h *Handler) board(w http.ResponseWriter, r *http.Request) error {
	v, err := h.svc.Board(r.Context(), r.PathValue("id"), r.PathValue("key"))
	if err != nil {
		return err
	}
	httpx.Write(w, http.StatusOK, v)
	return nil
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) error {
	if err := h.svc.Delete(r.Context(), r.PathValue("id")); err != nil {
		return err
	}
	httpx.NoContent(w)
	return nil
}
