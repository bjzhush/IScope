package catalog

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"time"

	"github.com/bjzhush/ai-overview/internal/apperr"
	"github.com/bjzhush/ai-overview/internal/item"
	"github.com/bjzhush/ai-overview/internal/relation"
	"github.com/bjzhush/ai-overview/internal/store"
	"github.com/bjzhush/ai-overview/internal/store/db"
	"github.com/bjzhush/ai-overview/internal/transfer"
)

// catalogKeys are the model attrs a catalog entry owns. An update replaces all
// of them, clearing those the new entry lacks, so no old version's value stays.
var catalogKeys = []string{"vendor", "model_id", "context_window", "max_output", "modalities", "release_date"}

// The offered_by attrs an update rewrites from the catalog.
var priceKeys = []string{"input_price", "output_price", "provider_model_id"}

type UpdateInput struct {
	TargetID   string `json:"targetId"`
	ProviderID string `json:"providerId"`
	ModelID    string `json:"modelId"`
	SourceURL  string `json:"sourceUrl"`
	// DryRun runs the whole update and rolls it back, to preview the result.
	DryRun bool `json:"dryRun"`
}

// Change is one item value the update replaces: "name" or an attr key.
type Change struct {
	Key string `json:"key"`
	Old any    `json:"old"`
	New any    `json:"new"`
}

// PriceChange reports one offered_by relation of the target. Source names the
// catalog provider matched by name ("" when none). Status is updated,
// unchanged or not_found (no matching provider, or the model is not offered
// there); not_found keeps the old prices.
type PriceChange struct {
	ProviderID   string         `json:"providerId"`
	ProviderName string         `json:"providerName"`
	Source       string         `json:"source"`
	Status       string         `json:"status"`
	Old          map[string]any `json:"old"`
	New          map[string]any `json:"new"`
}

type UpdateResult struct {
	Item       item.Item     `json:"item"`
	SnapshotID string        `json:"snapshotId,omitempty"`
	Changes    []Change      `json:"changes"`
	Prices     []PriceChange `json:"prices"`
	DryRun     bool          `json:"dryRun"`
}

// Updater overwrites an existing model with another catalog entry, typically
// its next version, keeping everything that is not catalog data.
type Updater struct {
	importer  *Importer
	db        *sql.DB
	transfer  *transfer.Service
	snapshots transfer.Snapshotter
	now       func() time.Time
}

func NewUpdater(im *Importer, sqldb *sql.DB, tr *transfer.Service, sn transfer.Snapshotter) *Updater {
	return &Updater{importer: im, db: sqldb, transfer: tr, snapshots: sn, now: time.Now}
}

var errDryRun = errors.New("dry run")

// Update writes, in one transaction: a snapshot of the board as it was, the
// item with the entry's name and catalog attrs (links get the source page),
// and new prices on every offered_by relation whose provider matches a catalog
// provider offering the model. Relations, tags, notes and the rest are kept.
func (u *Updater) Update(ctx context.Context, in UpdateInput) (UpdateResult, error) {
	im := u.importer
	if err := checkSourceURL(in.SourceURL); err != nil {
		return UpdateResult{}, err
	}
	target, err := im.items.Get(ctx, in.TargetID)
	if err != nil || target.Kind != modelKind {
		return UpdateResult{}, apperr.Validation(map[string]string{"targetId": "不是有效的 Model 条目"})
	}
	e, err := im.source.Find(ctx, in.ProviderID, in.ModelID)
	if err != nil {
		return UpdateResult{}, err
	}
	models, err := im.items.List(ctx, item.ListFilter{Kind: modelKind})
	if err != nil {
		return UpdateResult{}, err
	}
	for _, m := range models {
		if id, _ := m.Attrs["model_id"].(string); m.ID != target.ID && id == e.OfficialID {
			return UpdateResult{}, apperr.New(apperr.Conflict, fmt.Sprintf("看板上已有这个模型：%s", m.Name))
		}
	}

	// The item: catalog attrs replaced as a whole, the rest kept.
	next := item.ToPortable(target)
	next.Name = e.Name
	next.Attrs = map[string]any{}
	for k, v := range target.Attrs {
		next.Attrs[k] = v
	}
	for _, k := range catalogKeys {
		delete(next.Attrs, k)
	}
	for k, v := range im.attrs(e) {
		next.Attrs[k] = v
	}
	if in.SourceURL != "" {
		next.Links = withSourceLink(target.Links, e, in.SourceURL)
	}
	res := UpdateResult{DryRun: in.DryRun, Changes: changes(target, next), Prices: []PriceChange{}}

	// Prices: every offered_by from the target, matched by provider name.
	rels, err := im.relations.ListForItem(ctx, target.ID)
	if err != nil {
		return UpdateResult{}, err
	}
	variants, providers, err := im.source.variants(ctx, e.CanonicalID)
	if err != nil {
		return UpdateResult{}, err
	}
	type relWrite struct {
		p  relation.Portable
		to relation.End
	}
	var writes []relWrite
	for _, r := range rels {
		if r.FromID != target.ID {
			continue
		}
		prov, err := im.items.Get(ctx, r.ToID)
		if err != nil || prov.Kind != providerKind {
			continue
		}
		pc := PriceChange{ProviderID: prov.ID, ProviderName: prov.Name, Status: "not_found", Old: pick(r.Attrs, priceKeys)}
		pc.New = pc.Old
		var attrs map[string]any
		if cp, ok := matchProvider(prov.Name, providers); ok {
			pc.Source = cp.Name
			if v, ok := variants[cp.ID]; ok {
				attrs = map[string]any{}
				for k, val := range r.Attrs {
					attrs[k] = val
				}
				for _, k := range priceKeys {
					delete(attrs, k)
				}
				for k, val := range offerAttrs(v) {
					attrs[k] = val
				}
				pc.New = pick(attrs, priceKeys)
				pc.Status = "unchanged"
				if !reflect.DeepEqual(normalizeJSON(pc.Old), normalizeJSON(pc.New)) {
					pc.Status = "updated"
				}
			}
		}
		res.Prices = append(res.Prices, pc)
		if pc.Status == "updated" {
			writes = append(writes, relWrite{
				p:  relation.Portable{Type: r.Type, Attrs: attrs},
				to: relation.End{ID: prov.ID, Kind: prov.Kind},
			})
		}
	}

	var before transfer.Document
	if !in.DryRun {
		// Before the transaction: the pool's single connection is then taken.
		if before, err = u.transfer.Export(ctx); err != nil {
			return UpdateResult{}, err
		}
	}
	now := u.now().UTC().Format(time.RFC3339)
	err = store.WithTx(ctx, u.db, func(q *db.Queries) error {
		if !in.DryRun {
			id, err := u.snapshots.CreateTx(ctx, q, before, fmt.Sprintf("更新前：%s → %s", target.Name, e.Name))
			if err != nil {
				return err
			}
			res.SnapshotID = id
		}
		updated, _, err := im.items.ImportTx(ctx, q, next, now)
		if err != nil {
			return err
		}
		res.Item = updated
		from := relation.End{ID: target.ID, Kind: target.Kind}
		for _, w := range writes {
			if _, err := im.relations.ImportTx(ctx, q, w.p, from, w.to, now); err != nil {
				return err
			}
		}
		if in.DryRun {
			return errDryRun
		}
		return nil
	})
	if err != nil && !errors.Is(err, errDryRun) {
		return UpdateResult{}, err
	}
	return res, nil
}

// offerAttrs are a catalog entry's offered_by values: its prices, and its own
// model id when that differs from the vendor's.
func offerAttrs(e Entry) map[string]any {
	out := map[string]any{}
	if e.InputPrice != nil {
		out["input_price"] = *e.InputPrice
	}
	if e.OutputPrice != nil {
		out["output_price"] = *e.OutputPrice
	}
	if e.ModelID != e.OfficialID {
		out["provider_model_id"] = e.ModelID
	}
	return out
}

func changes(cur item.Item, next item.Portable) []Change {
	out := []Change{}
	if cur.Name != next.Name {
		out = append(out, Change{Key: "name", Old: cur.Name, New: next.Name})
	}
	for _, k := range catalogKeys {
		o, n := cur.Attrs[k], next.Attrs[k]
		if !reflect.DeepEqual(normalizeJSON(o), normalizeJSON(n)) {
			out = append(out, Change{Key: k, Old: o, New: n})
		}
	}
	return out
}

func pick(m map[string]any, keys []string) map[string]any {
	out := map[string]any{}
	for _, k := range keys {
		if v, ok := m[k]; ok {
			out[k] = v
		}
	}
	return out
}

// normalizeJSON round-trips v through JSON, so stored values (json.Number,
// []any) and fresh ones (int64, []string) compare equal when they encode the
// same.
func normalizeJSON(v any) any {
	raw, err := json.Marshal(v)
	if err != nil {
		return v
	}
	var out any
	if err := json.Unmarshal(raw, &out); err != nil {
		return v
	}
	return out
}

func normName(s string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(s) {
		if (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9') {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// matchProvider finds the catalog provider for a board provider's name: the
// same name once normalized, else the shortest name that contains it or is
// contained in it ("Anthropic API" -> "Anthropic").
func matchProvider(name string, providers []Provider) (Provider, bool) {
	want := normName(name)
	if want == "" {
		return Provider{}, false
	}
	var best *Provider
	for i, p := range providers {
		have := normName(p.Name)
		if have == "" {
			continue
		}
		if have == want {
			return p, true
		}
		if strings.Contains(have, want) || strings.Contains(want, have) {
			if best == nil || len(have) < len(normName(best.Name)) {
				best = &providers[i]
			}
		}
	}
	if best == nil {
		return Provider{}, false
	}
	return *best, true
}

// variants returns the entries of one model across providers, by provider id.
func (s *Source) variants(ctx context.Context, canonical string) (map[string]Entry, []Provider, error) {
	entries, providers, err := s.load(ctx)
	if err != nil {
		return nil, nil, err
	}
	out := map[string]Entry{}
	for _, e := range entries {
		if e.CanonicalID == canonical {
			if _, dup := out[e.ProviderID]; !dup {
				out[e.ProviderID] = e
			}
		}
	}
	return out, providers, nil
}
