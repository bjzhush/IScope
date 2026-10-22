package item

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"

	"github.com/bjzhush/ai-overview/internal/apperr"
	"github.com/bjzhush/ai-overview/internal/httpx"
)

type Handler struct{ svc *Service }

func NewHandler(svc *Service) *Handler { return &Handler{svc: svc} }

func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/items", httpx.Handle(h.list))
	mux.HandleFunc("POST /api/v1/items", httpx.Handle(h.create))
	mux.HandleFunc("GET /api/v1/items/{id}", httpx.Handle(h.get))
	mux.HandleFunc("PATCH /api/v1/items/{id}", httpx.Handle(h.update))
	mux.HandleFunc("DELETE /api/v1/items/{id}", httpx.Handle(h.delete))
}

func (h *Handler) list(w http.ResponseWriter, r *http.Request) error {
	q := r.URL.Query()
	items, err := h.svc.List(r.Context(), ListFilter{
		Kind: q.Get("kind"), Status: q.Get("status"), Q: q.Get("q"), Tag: q.Get("tag"),
	})
	if err != nil {
		return err
	}
	httpx.Write(w, http.StatusOK, items)
	return nil
}

func (h *Handler) create(w http.ResponseWriter, r *http.Request) error {
	var in CreateInput
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	it, err := h.svc.Create(r.Context(), in)
	if err != nil {
		return err
	}
	httpx.Write(w, http.StatusCreated, it)
	return nil
}

func (h *Handler) get(w http.ResponseWriter, r *http.Request) error {
	it, err := h.svc.Get(r.Context(), r.PathValue("id"))
	if err != nil {
		return err
	}
	httpx.Write(w, http.StatusOK, Detail{Item: it, Relations: []any{}})
	return nil
}

func (h *Handler) update(w http.ResponseWriter, r *http.Request) error {
	var raw map[string]json.RawMessage
	if err := httpx.Decode(r, &raw); err != nil {
		return err
	}
	p, err := parsePatch(raw)
	if err != nil {
		return err
	}
	it, err := h.svc.Update(r.Context(), r.PathValue("id"), p)
	if err != nil {
		return err
	}
	httpx.Write(w, http.StatusOK, it)
	return nil
}

func (h *Handler) delete(w http.ResponseWriter, r *http.Request) error {
	if err := h.svc.Delete(r.Context(), r.PathValue("id")); err != nil {
		return err
	}
	httpx.NoContent(w)
	return nil
}

// parsePatch decodes the fields present in a PATCH body. A JSON null is only
// accepted for rating (clears it) and for individual attrs keys (deletes them).
func parsePatch(raw map[string]json.RawMessage) (Patch, error) {
	var p Patch
	errs := map[string]string{}
	isNull := func(m json.RawMessage) bool { return bytes.Equal(bytes.TrimSpace(m), []byte("null")) }

	// field decodes raw into dst, rejecting null.
	field := func(key string, m json.RawMessage, dst any) bool {
		if isNull(m) {
			errs[key] = "不能为 null"
			return false
		}
		if err := json.Unmarshal(m, dst); err != nil {
			errs[key] = "类型错误"
			return false
		}
		return true
	}

	for key, m := range raw {
		switch key {
		case "kind":
			field(key, m, &p.Kind)
		case "name":
			field(key, m, &p.Name)
		case "slug":
			field(key, m, &p.Slug)
		case "status":
			field(key, m, &p.Status)
		case "summary":
			field(key, m, &p.Summary)
		case "notes":
			field(key, m, &p.Notes)
		case "tags":
			field(key, m, &p.Tags)
		case "links":
			field(key, m, &p.Links)
		case "pinned":
			field(key, m, &p.Pinned)
		case "sortOrder":
			field(key, m, &p.SortOrder)
		case "rating":
			p.Rating = &NullInt{}
			if !isNull(m) {
				field(key, m, &p.Rating.Value)
			}
		case "attrs":
			d := json.NewDecoder(bytes.NewReader(m))
			d.UseNumber()
			if isNull(m) {
				errs[key] = "不能为 null"
			} else if err := d.Decode(&p.Attrs); err != nil {
				errs[key] = "必须是对象"
			} else if p.Attrs == nil {
				p.Attrs = map[string]any{}
			}
		default:
			return Patch{}, apperr.New(apperr.BadRequest, fmt.Sprintf("未知字段 %q", key))
		}
	}
	if len(errs) > 0 {
		return Patch{}, apperr.Validation(errs)
	}
	return p, nil
}
