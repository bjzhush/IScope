package catalog

import (
	"context"
	"net/http"
	"slices"
	"time"

	"github.com/bjzhush/ai-overview/internal/apperr"
	"github.com/bjzhush/ai-overview/internal/httpx"
	"github.com/bjzhush/ai-overview/internal/item"
	"github.com/bjzhush/ai-overview/internal/kind"
	"github.com/bjzhush/ai-overview/internal/relation"
)

// The catalog import writes into these registry keys.
const (
	modelKind    = "model"
	providerKind = "provider"
)

type ImportInput struct {
	ProviderID string `json:"providerId"`
	ModelID    string `json:"modelId"`
	// LinkTo is an optional Provider item to link with offered_by, carrying
	// this catalog provider's prices.
	LinkTo string `json:"linkTo"`
}

type ImportResult struct {
	Item     item.Item          `json:"item"`
	Created  bool               `json:"created"`
	Relation *relation.Relation `json:"relation,omitempty"`
}

type Importer struct {
	source    *Source
	reg       *kind.Registry
	items     *item.Service
	relations *relation.Service
}

func NewImporter(source *Source, reg *kind.Registry, items *item.Service, relations *relation.Service) *Importer {
	return &Importer{source: source, reg: reg, items: items, relations: relations}
}

// Import creates the model or, when one already matches (model_id equal to
// the official id, else same slug), merges the catalog values into its attrs;
// other fields and attrs are kept. With LinkTo, the offered_by relation gets
// this provider's prices, plus its own model id when that differs.
func (im *Importer) Import(ctx context.Context, in ImportInput) (ImportResult, error) {
	e, err := im.source.Find(ctx, in.ProviderID, in.ModelID)
	if err != nil {
		return ImportResult{}, err
	}
	var provider item.Item
	if in.LinkTo != "" {
		provider, err = im.items.Get(ctx, in.LinkTo)
		if err != nil || provider.Kind != providerKind {
			return ImportResult{}, apperr.Validation(map[string]string{"linkTo": "不是有效的 Provider 条目"})
		}
	}

	attrs := im.attrs(e)
	existing, err := im.findModel(ctx, e)
	if err != nil {
		return ImportResult{}, err
	}
	var res ImportResult
	if existing != nil {
		res.Item, err = im.items.Update(ctx, existing.ID, item.Patch{Attrs: attrs})
	} else {
		res.Item, err = im.items.Create(ctx, item.CreateInput{Kind: modelKind, Name: e.Name, Attrs: attrs})
		res.Created = true
	}
	if err != nil {
		return ImportResult{}, err
	}

	if in.LinkTo != "" {
		prices := map[string]any{}
		if e.InputPrice != nil {
			prices["input_price"] = *e.InputPrice
		}
		if e.OutputPrice != nil {
			prices["output_price"] = *e.OutputPrice
		}
		if e.ModelID != e.OfficialID {
			prices["provider_model_id"] = e.ModelID
		}
		r, err := im.relations.Upsert(ctx, res.Item.ID, provider.ID, prices)
		if err != nil {
			return ImportResult{}, err
		}
		res.Relation = &r
	}
	return res, nil
}

// attrs maps a catalog entry onto the model kind's fields, skipping values the
// field definitions would reject (unknown modalities, malformed dates).
func (im *Importer) attrs(e Entry) map[string]any {
	k, _ := im.reg.Kind(modelKind)
	allowed := func(key string) []string {
		for _, f := range k.Fields {
			if f.Key == key {
				vals := make([]string, len(f.Options))
				for i, o := range f.Options {
					vals[i] = o.Value
				}
				return vals
			}
		}
		return nil
	}
	attrs := map[string]any{"vendor": e.Vendor, "model_id": e.OfficialID}
	if e.Context > 0 {
		attrs["context_window"] = e.Context
	}
	if e.Output > 0 {
		attrs["max_output"] = e.Output
	}
	if opts := allowed("modalities"); len(opts) > 0 {
		var mods []string
		for _, o := range opts { // option order, like the form
			if slices.Contains(e.Modalities, o) {
				mods = append(mods, o)
			}
		}
		if len(mods) > 0 {
			attrs["modalities"] = mods
		}
	}
	if _, err := time.Parse(time.DateOnly, e.ReleaseDate); err == nil {
		attrs["release_date"] = e.ReleaseDate
	}
	return attrs
}

func (im *Importer) findModel(ctx context.Context, e Entry) (*item.Item, error) {
	models, err := im.items.List(ctx, item.ListFilter{Kind: modelKind})
	if err != nil {
		return nil, err
	}
	for _, m := range models {
		if id, _ := m.Attrs["model_id"].(string); id == e.OfficialID {
			return &m, nil
		}
	}
	slug := item.Slugify(e.Name, "")
	for _, m := range models {
		if m.Slug == slug {
			return &m, nil
		}
	}
	return nil, nil
}

type Handler struct {
	source   *Source
	importer *Importer
}

func NewHandler(source *Source, importer *Importer) *Handler {
	return &Handler{source: source, importer: importer}
}

func (h *Handler) Register(mux *http.ServeMux) {
	mux.HandleFunc("GET /api/v1/catalog", httpx.Handle(h.search))
	mux.HandleFunc("POST /api/v1/catalog/import", httpx.Handle(h.importModel))
}

// searchResponse tells the client which kinds an import writes, so the UI can
// offer link targets without knowing kind keys itself.
type searchResponse struct {
	SearchResult
	ModelKind string `json:"modelKind"`
	LinkKind  string `json:"linkKind"`
}

func (h *Handler) search(w http.ResponseWriter, r *http.Request) error {
	res, err := h.source.Search(r.Context(), r.URL.Query().Get("q"), r.URL.Query().Get("provider"))
	if err != nil {
		return err
	}
	httpx.Write(w, http.StatusOK, searchResponse{SearchResult: res, ModelKind: modelKind, LinkKind: providerKind})
	return nil
}

func (h *Handler) importModel(w http.ResponseWriter, r *http.Request) error {
	var in ImportInput
	if err := httpx.Decode(r, &in); err != nil {
		return err
	}
	res, err := h.importer.Import(r.Context(), in)
	if err != nil {
		return err
	}
	status := http.StatusOK
	if res.Created {
		status = http.StatusCreated
	}
	httpx.Write(w, status, res)
	return nil
}
