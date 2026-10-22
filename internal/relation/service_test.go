package relation

import (
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/oklog/ulid/v2"

	"github.com/bjzhush/ai-overview/internal/apperr"
	"github.com/bjzhush/ai-overview/internal/kind"
	"github.com/bjzhush/ai-overview/internal/store"
	"github.com/bjzhush/ai-overview/internal/store/db"
)

type fixture struct {
	t     *testing.T
	ctx   context.Context
	db    *sql.DB
	svc   *Service
	clock time.Time
}

func newFixture(t *testing.T, reg *kind.Registry) *fixture {
	t.Helper()
	ctx := context.Background()
	sqldb, err := store.Open(ctx, filepath.Join(t.TempDir(), "test.db"))
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { sqldb.Close() })
	f := &fixture{t: t, ctx: ctx, db: sqldb, svc: NewService(sqldb, reg), clock: time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)}
	f.svc.now = func() time.Time { return f.clock }
	return f
}

// item inserts an item row directly; relation tests don't need item logic.
func (f *fixture) item(kind string) string {
	f.t.Helper()
	id := ulid.Make().String()
	_, err := db.New(f.db).CreateItem(f.ctx, db.CreateItemParams{
		ID: id, Kind: kind, Name: id, Slug: strings.ToLower(id), Status: "watching",
		Tags: "[]", Links: "[]", Attrs: "{}", CreatedAt: "t0", UpdatedAt: "t0",
	})
	if err != nil {
		f.t.Fatal(err)
	}
	return id
}

func (f *fixture) updatedAt(id string) string {
	f.t.Helper()
	row, err := db.New(f.db).GetItem(f.ctx, id)
	if err != nil {
		f.t.Fatal(err)
	}
	return row.UpdatedAt
}

func (f *fixture) replace(id string, links ...Link) []Relation {
	f.t.Helper()
	if links == nil {
		links = []Link{} // an empty variadic call means "no relations"
	}
	rels, err := f.svc.Replace(f.ctx, id, links)
	if err != nil {
		f.t.Fatalf("replace: %v", err)
	}
	return rels
}

func wantCode(t *testing.T, err error, code apperr.Code, field string) {
	t.Helper()
	e, ok := apperr.As(err)
	if !ok || e.Code != code {
		t.Fatalf("want %s, got %v", code, err)
	}
	if field != "" && e.Fields[field] == "" {
		t.Fatalf("want error on %q, got %v", field, e.Fields)
	}
}

func byOther(rels []Relation, id string) map[string]Relation {
	m := map[string]Relation{}
	for _, r := range rels {
		m[otherEnd(r, id)] = r
	}
	return m
}

func TestReplaceNormalizesDirectionFromEitherEnd(t *testing.T) {
	f := newFixture(t, kind.Default())
	h, m, p := f.item("harness"), f.item("model"), f.item("provider")

	// From the provider side: offered_by is stored model -> provider.
	rels := f.replace(p, Link{TargetID: m, Attrs: map[string]any{"input_price": 3}})
	if len(rels) != 1 || rels[0].Type != "offered_by" || rels[0].FromID != m || rels[0].ToID != p {
		t.Fatalf("offered_by: %+v", rels)
	}
	// From the model side: uses is stored harness -> model.
	rels = f.replace(m, Link{TargetID: p}, Link{TargetID: h})
	got := byOther(rels, m)
	if got[h].Type != "uses" || got[h].FromID != h || got[h].ToID != m {
		t.Fatalf("uses: %+v", got[h])
	}
	// The other end sees the same relations.
	fromHarness, _ := f.svc.ListForItem(f.ctx, h)
	if len(fromHarness) != 1 || fromHarness[0].ID != got[h].ID {
		t.Fatalf("harness view: %+v", fromHarness)
	}
	// connects harness -> provider.
	rels = f.replace(p, Link{TargetID: m}, Link{TargetID: h, Attrs: map[string]any{"note": "x"}})
	if c := byOther(rels, p)[h]; c.Type != "connects" || c.FromID != h || c.ToID != p {
		t.Fatalf("connects: %+v", c)
	}
}

func TestReplaceOnlyTouchesDifferences(t *testing.T) {
	f := newFixture(t, kind.Default())
	m, p1, p2, p3 := f.item("model"), f.item("provider"), f.item("provider"), f.item("provider")

	first := byOther(f.replace(m,
		Link{TargetID: p1, Attrs: map[string]any{"input_price": 3, "output_price": 15}},
		Link{TargetID: p2, Attrs: map[string]any{"input_price": 1}},
		Link{TargetID: p3},
	), m)

	f.clock = f.clock.Add(time.Hour)
	second := byOther(f.replace(m,
		Link{TargetID: p1}, // keep: no attrs sent
		Link{TargetID: p2, Attrs: map[string]any{"input_price": 2}}, // update attrs
		Link{TargetID: p3, Attrs: map[string]any{}},                 // same (empty) attrs: no write
	), m)

	if r := second[p1]; r.ID != first[p1].ID || r.UpdatedAt != first[p1].UpdatedAt || !sameAttrs(r.Attrs, first[p1].Attrs) {
		t.Fatalf("kept relation changed: %+v -> %+v", first[p1], r)
	}
	if r := second[p2]; r.ID != first[p2].ID || r.Attrs["input_price"] != json.Number("2") || r.UpdatedAt == first[p2].UpdatedAt {
		t.Fatalf("updated relation: %+v", r)
	}
	if r := second[p3]; r.ID != first[p3].ID || r.UpdatedAt != first[p3].UpdatedAt {
		t.Fatalf("unchanged relation was rewritten: %+v", r)
	}

	// Removing one deletes only that relation and touches both ends.
	f.clock = f.clock.Add(time.Hour)
	before := f.updatedAt(p1)
	third := byOther(f.replace(m, Link{TargetID: p2}, Link{TargetID: p3}), m)
	if _, ok := third[p1]; ok || len(third) != 2 || third[p2].ID != first[p2].ID {
		t.Fatalf("after removal: %+v", third)
	}
	if f.updatedAt(p1) == before || f.updatedAt(m) != f.clock.Format(time.RFC3339) {
		t.Fatal("removal should touch both ends")
	}

	// A no-op replace writes nothing.
	f.clock = f.clock.Add(time.Hour)
	stamp := f.updatedAt(m)
	f.replace(m, Link{TargetID: p2}, Link{TargetID: p3})
	if f.updatedAt(m) != stamp {
		t.Fatal("no-op replace touched the item")
	}

	// Empty set removes everything.
	if rels := f.replace(m, []Link{}...); len(rels) != 0 {
		t.Fatalf("empty replace: %+v", rels)
	}
}

func TestReplaceErrors(t *testing.T) {
	f := newFixture(t, kind.Default())
	m1, m2, p := f.item("model"), f.item("model"), f.item("provider")

	_, err := f.svc.Replace(f.ctx, m1, []Link{{TargetID: m2}})
	wantCode(t, err, apperr.BadRequest, "")

	cases := []struct {
		name  string
		links []Link
		field string
	}{
		{"self", []Link{{TargetID: m1}}, "links.0.targetId"},
		{"missing target", []Link{{TargetID: "nope"}}, "links.0.targetId"},
		{"empty target", []Link{{TargetID: ""}}, "links.0.targetId"},
		{"duplicate", []Link{{TargetID: p}, {TargetID: p}}, "links.1.targetId"},
		{"unknown attr", []Link{{TargetID: p, Attrs: map[string]any{"color": "red"}}}, "links.0.attrs.color"},
		{"bad attr", []Link{{TargetID: p, Attrs: map[string]any{"input_price": -1}}}, "links.0.attrs.input_price"},
		{"nil links", nil, "links"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, err := f.svc.Replace(f.ctx, m1, c.links)
			wantCode(t, err, apperr.ValidationFailed, c.field)
		})
	}
	// A failed request leaves nothing behind.
	if rels, _ := f.svc.ListForItem(f.ctx, m1); len(rels) != 0 {
		t.Fatalf("partial write: %+v", rels)
	}

	_, err = f.svc.Replace(f.ctx, "nope", []Link{})
	wantCode(t, err, apperr.NotFound, "")
}

func TestReplaceRequiredRelationFields(t *testing.T) {
	reg := kind.NewRegistry()
	reg.RegisterKind(kind.Kind{Key: "a"})
	reg.RegisterKind(kind.Kind{Key: "b"})
	reg.RegisterRelation(kind.RelationType{Key: "r", FromKind: "a", ToKind: "b",
		Fields: []kind.Field{{Key: "why", Label: "why", Type: kind.FieldText, Required: true}}})
	f := newFixture(t, reg)
	a, b := f.item("a"), f.item("b")

	_, err := f.svc.Replace(f.ctx, a, []Link{{TargetID: b}})
	wantCode(t, err, apperr.ValidationFailed, "links.0.attrs.why")

	f.replace(a, Link{TargetID: b, Attrs: map[string]any{"why": "x"}})
	// Existing relation, no attrs sent: kept as is, no required error.
	if rels := f.replace(b, Link{TargetID: a}); rels[0].Attrs["why"] != "x" {
		t.Fatalf("kept attrs: %+v", rels)
	}
}

func TestSoftDeletedItemsHideRelations(t *testing.T) {
	f := newFixture(t, kind.Default())
	m, p := f.item("model"), f.item("provider")
	rel := f.replace(m, Link{TargetID: p})[0]

	if _, err := db.New(f.db).SoftDeleteItem(f.ctx, db.SoftDeleteItemParams{
		DeletedAt: sql.NullString{String: "t", Valid: true}, UpdatedAt: "t", ID: p,
	}); err != nil {
		t.Fatal(err)
	}
	if rels, _ := f.svc.ListForItem(f.ctx, m); len(rels) != 0 {
		t.Fatalf("for item: %+v", rels)
	}
	if rels, _ := f.svc.ListLive(f.ctx); len(rels) != 0 {
		t.Fatalf("live: %+v", rels)
	}
	_, err := f.svc.Update(f.ctx, rel.ID, PatchInput{Attrs: map[string]any{"input_price": 1}})
	wantCode(t, err, apperr.NotFound, "")
	wantCode(t, f.svc.Delete(f.ctx, rel.ID), apperr.NotFound, "")
	// Linking to a deleted item is rejected.
	_, err = f.svc.Replace(f.ctx, m, []Link{{TargetID: p}})
	wantCode(t, err, apperr.ValidationFailed, "links.0.targetId")
}

func TestUpdateAndDelete(t *testing.T) {
	f := newFixture(t, kind.Default())
	m, p := f.item("model"), f.item("provider")
	rel := f.replace(m, Link{TargetID: p, Attrs: map[string]any{"input_price": 3, "provider_model_id": "x"}})[0]

	got, err := f.svc.Update(f.ctx, rel.ID, PatchInput{Attrs: map[string]any{"output_price": 15, "provider_model_id": nil}})
	if err != nil {
		t.Fatal(err)
	}
	if got.Attrs["input_price"] != json.Number("3") || got.Attrs["output_price"] == nil || got.Attrs["provider_model_id"] != nil {
		t.Fatalf("merged: %#v", got.Attrs)
	}
	_, err = f.svc.Update(f.ctx, rel.ID, PatchInput{Attrs: map[string]any{"input_price": "cheap"}})
	wantCode(t, err, apperr.ValidationFailed, "attrs.input_price")
	_, err = f.svc.Update(f.ctx, rel.ID, PatchInput{})
	wantCode(t, err, apperr.ValidationFailed, "attrs")

	if err := f.svc.Delete(f.ctx, rel.ID); err != nil {
		t.Fatal(err)
	}
	wantCode(t, f.svc.Delete(f.ctx, rel.ID), apperr.NotFound, "")
}

func TestEnsureIsAdditive(t *testing.T) {
	f := newFixture(t, kind.Default())
	h, m1, m2 := f.item("harness"), f.item("model"), f.item("model")
	if err := f.svc.Ensure(f.ctx, h, m1, map[string]any{"is_default": true}); err != nil {
		t.Fatal(err)
	}
	if err := f.svc.Ensure(f.ctx, m2, h, nil); err != nil {
		t.Fatal(err)
	}
	// Ensuring an existing link does not overwrite its attrs.
	if err := f.svc.Ensure(f.ctx, h, m1, map[string]any{"is_default": false}); err != nil {
		t.Fatal(err)
	}
	rels := byOther(mustList(t, f, h), h)
	if len(rels) != 2 || rels[m1].Attrs["is_default"] != true {
		t.Fatalf("ensure: %+v", rels)
	}
}

func mustList(t *testing.T, f *fixture, id string) []Relation {
	t.Helper()
	rels, err := f.svc.ListForItem(f.ctx, id)
	if err != nil {
		t.Fatal(err)
	}
	return rels
}

func TestHandler(t *testing.T) {
	f := newFixture(t, kind.Default())
	mux := http.NewServeMux()
	NewHandler(f.svc).Register(mux)
	m, m2, p := f.item("model"), f.item("model"), f.item("provider")

	do := func(method, path, body string) *httptest.ResponseRecorder {
		rec := httptest.NewRecorder()
		mux.ServeHTTP(rec, httptest.NewRequest(method, path, strings.NewReader(body)))
		return rec
	}
	expect := func(rec *httptest.ResponseRecorder, status int, contains string) {
		t.Helper()
		if rec.Code != status || !strings.Contains(rec.Body.String(), contains) {
			t.Fatalf("got %d %s; want %d containing %s", rec.Code, rec.Body, status, contains)
		}
	}

	rec := do("PUT", "/api/v1/items/"+p+"/relations", `{"links":[{"targetId":"`+m+`","attrs":{"input_price":3,"output_price":15}}]}`)
	expect(rec, 200, `"fromId":"`+m+`"`)
	var rels []Relation
	json.Unmarshal(rec.Body.Bytes(), &rels)
	if !strings.Contains(rec.Body.String(), `"input_price":3`) {
		t.Fatalf("attrs encoding: %s", rec.Body)
	}

	expect(do("PUT", "/api/v1/items/"+m+"/relations", `{"links":[{"targetId":"`+m2+`"}]}`), 400, `"bad_request"`)
	expect(do("PUT", "/api/v1/items/"+m+"/relations", `{"links":[{"targetId":"`+p+`","attrs":{"input_price":"x"}}]}`), 400, `"links.0.attrs.input_price"`)
	expect(do("PUT", "/api/v1/items/"+m+"/relations", `{}`), 400, `"links"`)
	expect(do("PUT", "/api/v1/items/"+m+"/relations", `{"links":[],"extra":1}`), 400, `"bad_request"`)
	expect(do("PUT", "/api/v1/items/nope/relations", `{"links":[]}`), 404, `"not_found"`)

	expect(do("PATCH", "/api/v1/relations/"+rels[0].ID, `{"attrs":{"input_price":null}}`), 200, `"output_price":15`)
	expect(do("PATCH", "/api/v1/relations/"+rels[0].ID, `{"attrs":{"input_price":-1}}`), 400, `"attrs.input_price"`)
	expect(do("PATCH", "/api/v1/relations/nope", `{"attrs":{}}`), 404, `"not_found"`)
	expect(do("DELETE", "/api/v1/relations/"+rels[0].ID, ``), 204, ``)
	expect(do("DELETE", "/api/v1/relations/"+rels[0].ID, ``), 404, `"not_found"`)
}
