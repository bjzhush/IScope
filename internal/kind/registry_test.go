package kind

import (
	"strings"
	"testing"
)

func TestDefaultRegistry(t *testing.T) {
	r := Default()
	d := r.Definitions()
	if len(d.Kinds) != 3 || len(d.RelationTypes) != 3 || len(d.Boards) != 1 {
		t.Fatalf("got %d kinds, %d relations, %d boards", len(d.Kinds), len(d.RelationTypes), len(d.Boards))
	}
	b, ok := r.Board("ai-stack")
	if !ok || strings.Join(b.Columns, ",") != "harness,model,provider" {
		t.Fatalf("board: %+v", b)
	}

	cases := []struct {
		a, b    string
		key     string
		forward bool
	}{
		{"model", "provider", "offered_by", true},
		{"provider", "model", "offered_by", false},
		{"harness", "model", "uses", true},
		{"model", "harness", "uses", false},
		{"harness", "provider", "connects", true},
		{"provider", "harness", "connects", false},
	}
	for _, c := range cases {
		rt, fwd, ok := r.RelationBetween(c.a, c.b)
		if !ok || rt.Key != c.key || fwd != c.forward {
			t.Errorf("RelationBetween(%s,%s) = %s,%v,%v", c.a, c.b, rt.Key, fwd, ok)
		}
	}
	if _, _, ok := r.RelationBetween("model", "model"); ok {
		t.Error("model-model should have no relation type")
	}
}

func mustPanic(t *testing.T, want string, fn func()) {
	t.Helper()
	defer func() {
		r := recover()
		if r == nil {
			t.Fatalf("expected panic containing %q", want)
		}
		if msg, _ := r.(string); !strings.Contains(msg, want) {
			t.Fatalf("panic %q does not contain %q", r, want)
		}
	}()
	fn()
}

func twoKinds() *Registry {
	r := NewRegistry()
	r.RegisterKind(Kind{Key: "a"})
	r.RegisterKind(Kind{Key: "b"})
	return r
}

func TestRegistrationChecks(t *testing.T) {
	sel := []Option{{"x", "X"}}
	cases := []struct {
		name string
		want string
		fn   func(r *Registry)
	}{
		{"duplicate kind", "already registered", func(r *Registry) { r.RegisterKind(Kind{Key: "a"}) }},
		{"duplicate field key", "duplicate key", func(r *Registry) {
			r.RegisterKind(Kind{Key: "c", Fields: []Field{{Key: "f", Type: FieldText}, {Key: "f", Type: FieldText}}})
		}},
		{"too many showOnCard", "showOnCard", func(r *Registry) {
			var fs []Field
			for _, k := range []string{"f1", "f2", "f3", "f4"} {
				fs = append(fs, Field{Key: k, Type: FieldText, ShowOnCard: true})
			}
			r.RegisterKind(Kind{Key: "c", Fields: fs})
		}},
		{"unknown field type", "unknown type", func(r *Registry) {
			r.RegisterKind(Kind{Key: "c", Fields: []Field{{Key: "f", Type: "color"}}})
		}},
		{"select without options", "needs options", func(r *Registry) {
			r.RegisterKind(Kind{Key: "c", Fields: []Field{{Key: "f", Type: FieldSelect}}})
		}},
		{"options on text", "options only", func(r *Registry) {
			r.RegisterKind(Kind{Key: "c", Fields: []Field{{Key: "f", Type: FieldText, Options: sel}}})
		}},
		{"duplicate option", "duplicate option", func(r *Registry) {
			r.RegisterKind(Kind{Key: "c", Fields: []Field{{Key: "f", Type: FieldSelect, Options: append(sel, sel...)}}})
		}},
		{"required bool", "cannot be required", func(r *Registry) {
			r.RegisterKind(Kind{Key: "c", Fields: []Field{{Key: "f", Type: FieldBool, Required: true}}})
		}},
		{"integer on text", "min/integer/prefix", func(r *Registry) {
			r.RegisterKind(Kind{Key: "c", Fields: []Field{{Key: "f", Type: FieldText, Integer: true}}})
		}},
		{"prefix on text", "min/integer/prefix", func(r *Registry) {
			r.RegisterKind(Kind{Key: "c", Fields: []Field{{Key: "f", Type: FieldText, Prefix: "$"}}})
		}},
		{"shortLabel on text", "shortLabel", func(r *Registry) {
			r.RegisterKind(Kind{Key: "c", Fields: []Field{{Key: "f", Type: FieldText, ShortLabel: "x"}}})
		}},
		{"relation unknown kind", "unknown kind", func(r *Registry) {
			r.RegisterRelation(RelationType{Key: "r", FromKind: "a", ToKind: "zzz"})
		}},
		{"self relation", "self relations", func(r *Registry) {
			r.RegisterRelation(RelationType{Key: "r", FromKind: "a", ToKind: "a"})
		}},
		{"second relation same pair", "already related", func(r *Registry) {
			r.RegisterRelation(RelationType{Key: "r1", FromKind: "a", ToKind: "b"})
			r.RegisterRelation(RelationType{Key: "r2", FromKind: "b", ToKind: "a"})
		}},
		{"relation field check", "duplicate key", func(r *Registry) {
			r.RegisterRelation(RelationType{Key: "r", FromKind: "a", ToKind: "b",
				Fields: []Field{{Key: "f", Type: FieldText}, {Key: "f", Type: FieldText}}})
		}},
		{"board unknown column", "unknown kind", func(r *Registry) {
			r.RegisterBoard(Board{Key: "x", Columns: []string{"a", "zzz"}})
		}},
		{"board duplicate column", "duplicate column", func(r *Registry) {
			r.RegisterBoard(Board{Key: "x", Columns: []string{"a", "a"}})
		}},
		{"board no columns", "no columns", func(r *Registry) {
			r.RegisterBoard(Board{Key: "x"})
		}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			r := twoKinds()
			mustPanic(t, c.want, func() { c.fn(r) })
		})
	}
}
