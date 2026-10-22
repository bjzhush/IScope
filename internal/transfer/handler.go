package transfer

import (
	"fmt"
	"net/http"
	"time"

	"github.com/bjzhush/ai-overview/internal/httpx"
)

const maxImport = 16 << 20

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/export", httpx.Handle(h.export))
	mux.HandleFunc("POST /api/v1/import", httpx.Handle(h.importDoc))
}

func (h *Handler) export(w http.ResponseWriter, r *http.Request) error {
	doc, err := h.svc.Export(r.Context())
	if err != nil {
		return err
	}
	name := fmt.Sprintf("ai-overview-%s.json", time.Now().Format("20060102-150405"))
	w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, name))
	httpx.Write(w, http.StatusOK, doc)
	return nil
}

func (h *Handler) importDoc(w http.ResponseWriter, r *http.Request) error {
	var doc Document
	if err := httpx.DecodeLimit(r, &doc, maxImport); err != nil {
		return err
	}
	sum, err := h.svc.Import(r.Context(), doc)
	if err != nil {
		return err
	}
	httpx.Write(w, http.StatusOK, sum)
	return nil
}
