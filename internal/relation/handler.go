package relation

import (
	"net/http"

	"github.com/bjzhush/ai-overview/internal/httpx"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("PUT /api/v1/items/{id}/relations", httpx.Handle(h.replace))
	mux.HandleFunc("PATCH /api/v1/relations/{id}", httpx.Handle(h.update))
	mux.HandleFunc("DELETE /api/v1/relations/{id}", httpx.Handle(h.delete))
}

func (h *Handler) replace(w http.ResponseWriter, r *http.Request) error {
	var in ReplaceInput
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	rels, err := h.svc.Replace(r.Context(), r.PathValue("id"), in.Links)
	if err != nil {
		return err
	}
	httpx.Write(w, http.StatusOK, rels)
	return nil
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) error {
	var in PatchInput
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	rel, err := h.svc.Update(r.Context(), r.PathValue("id"), in)
	if err != nil {
		return err
	}
	httpx.Write(w, http.StatusOK, rel)
	return nil
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) error {
	if err := h.svc.Delete(r.Context(), r.PathValue("id")); err != nil {
		return err
	}
	httpx.NoContent(w)
	return nil
}
