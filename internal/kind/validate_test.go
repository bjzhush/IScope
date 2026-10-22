package kind

import (
	"encoding/json"
	"strings"
	"testing"
)

var testFields = []Field{
	{Key: "t", Type: FieldText},
	{Key: "ta", Type: FieldTextarea},
	{Key: "n", Type: FieldNumber},
	{Key: "ni", Type: FieldNumber, Integer: true, Min: ptr(1)},
	{Key: "nm", Type: FieldNumber, Min: ptr(0)},
	{Key: "b", Type: FieldBool},
	{Key: "s", Type: FieldSelect, Options: []Option{{"a", "A"}, {"b", "B"}}},
	{Key: "ms", Type: FieldMultiSelect, Options: []Option{{"x", "X"}, {"y", "Y"}}},
	{Key: "d", Type: FieldDate},
	{Key: "u", Type: FieldURL},
	{Key: "req", Type: FieldText, Required: true},
	{Key: "reqms", Type: FieldMultiSelect, Required: true, Options: []Option{{"x", "X"}}},
}

// decode mimics request decoding (UseNumber) so tests see the same value types.
func decode(t *testing.T, s string) map[string]any {
	t.Helper()
	d := json.NewDecoder(strings.NewReader(s))
	d.UseNumber()
	var m map[string]any
	if err := d.Decode(&m); err != nil {
		t.Fatalf("bad test json %s: %v", s, err)
	}
	return m
}

// base satisfies the required fields; each case adds one key.
const base = `"req":"r","reqms":["x"]`

func TestValidateAttrsValueTypes(t *testing.T) {
	cases := []struct {
		name    string
		attr    string // `"key": value`
		wantErr string // expected error field key, "" if valid
	}{
		{"text ok", `"t":"hello"`, ""},
		{"text number", `"t":1`, "attrs.t"},
		{"textarea ok", `"ta":"line1\nline2"`, ""},
		{"textarea bool", `"ta":true`, "attrs.ta"},
		{"number int ok", `"n":3`, ""},
		{"number float ok", `"n":3.5`, ""},
		{"number negative ok", `"n":-2`, ""},
		{"number string", `"n":"3"`, "attrs.n"},
		{"integer ok", `"ni":200000`, ""},
		{"integer float", `"ni":1.5`, "attrs.ni"},
		{"integer below min", `"ni":0`, "attrs.ni"},
		{"integer at min", `"ni":1`, ""},
		{"min zero ok", `"nm":0`, ""},
		{"min zero negative", `"nm":-0.01`, "attrs.nm"},
		{"bool true", `"b":true`, ""},
		{"bool false", `"b":false`, ""},
		{"bool string", `"b":"true"`, "attrs.b"},
		{"bool number", `"b":1`, "attrs.b"},
		{"select ok", `"s":"a"`, ""},
		{"select unknown option", `"s":"z"`, "attrs.s"},
		{"select number", `"s":1`, "attrs.s"},
		{"multiselect ok", `"ms":["x","y"]`, ""},
		{"multiselect unknown", `"ms":["x","z"]`, "attrs.ms"},
		{"multiselect duplicate", `"ms":["x","x"]`, "attrs.ms"},
		{"multiselect not array", `"ms":"x"`, "attrs.ms"},
		{"multiselect non-string item", `"ms":[1]`, "attrs.ms"},
		{"date ok", `"d":"2026-10-21"`, ""},
		{"date bad format", `"d":"2026/10/21"`, "attrs.d"},
		{"date invalid day", `"d":"2026-02-30"`, "attrs.d"},
		{"date with time", `"d":"2026-10-21T00:00:00Z"`, "attrs.d"},
		{"date number", `"d":20261021`, "attrs.d"},
		{"url http ok", `"u":"http://localhost:11434"`, ""},
		{"url https ok", `"u":"https://api.anthropic.com/v1"`, ""},
		{"url ftp", `"u":"ftp://example.com"`, "attrs.u"},
		{"url no scheme", `"u":"example.com"`, "attrs.u"},
		{"url no host", `"u":"https://"`, "attrs.u"},
		{"unknown key", `"nope":"x"`, "attrs.nope"},
		{"empty optional string dropped", `"u":"  "`, ""},
		{"null optional dropped", `"n":null`, ""},
		{"empty optional array dropped", `"ms":[]`, ""},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, errs := ValidateAttrs(testFields, decode(t, "{"+base+","+c.attr+"}"))
			if c.wantErr == "" {
				if len(errs) != 0 {
					t.Fatalf("unexpected errors: %v", errs)
				}
				return
			}
			if _, ok := errs[c.wantErr]; !ok || len(errs) != 1 {
				t.Fatalf("want only error on %s, got %v", c.wantErr, errs)
			}
		})
	}
}

func TestValidateAttrsRequired(t *testing.T) {
	cases := []struct {
		name string
		json string
		want []string
	}{
		{"both missing", `{}`, []string{"attrs.req", "attrs.reqms"}},
		{"blank string", `{"req":"   ","reqms":["x"]}`, []string{"attrs.req"}},
		{"null", `{"req":null,"reqms":["x"]}`, []string{"attrs.req"}},
		{"empty array", `{"req":"r","reqms":[]}`, []string{"attrs.reqms"}},
		{"wrong type reported once", `{"req":5,"reqms":["x"]}`, []string{"attrs.req"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			_, errs := ValidateAttrs(testFields, decode(t, c.json))
			if len(errs) != len(c.want) {
				t.Fatalf("got %v, want keys %v", errs, c.want)
			}
			for _, k := range c.want {
				if errs[k] == "" {
					t.Fatalf("missing error for %s in %v", k, errs)
				}
			}
		})
	}
}

func TestValidateAttrsNormalizes(t *testing.T) {
	out, errs := ValidateAttrs(testFields, decode(t, `{`+base+`,"ni":128000,"n":2.5,"t":"","ms":["y"]}`))
	if errs != nil {
		t.Fatal(errs)
	}
	if v, ok := out["ni"].(int64); !ok || v != 128000 {
		t.Fatalf("integer field: %#v", out["ni"])
	}
	if v, ok := out["n"].(float64); !ok || v != 2.5 {
		t.Fatalf("number field: %#v", out["n"])
	}
	if _, ok := out["t"]; ok {
		t.Fatal("blank text should be dropped")
	}
	if v, ok := out["ms"].([]string); !ok || len(v) != 1 || v[0] != "y" {
		t.Fatalf("multiselect: %#v", out["ms"])
	}
	// Go-native values (used by seed) are accepted too.
	if _, errs := ValidateAttrs(testFields, map[string]any{"req": "r", "reqms": []string{"x"}, "ni": 5, "n": 1.5}); errs != nil {
		t.Fatal(errs)
	}
}

func TestAIStackModelAttrs(t *testing.T) {
	r := Default()
	m, _ := r.Kind("model")
	_, errs := ValidateAttrs(m.Fields, decode(t, `{"vendor":"Anthropic","context_window":"big"}`))
	if errs["attrs.context_window"] == "" || len(errs) != 1 {
		t.Fatalf("got %v", errs)
	}
	_, errs = ValidateAttrs(m.Fields, decode(t, `{"model_id":"x"}`))
	if errs["attrs.vendor"] == "" {
		t.Fatalf("vendor should be required: %v", errs)
	}
}
