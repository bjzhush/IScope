// Package kind holds the registry of item kinds, relation types and boards.
// The same definitions drive backend attrs validation and frontend form rendering.
package kind

import "fmt"

type FieldType string

const (
	FieldText        FieldType = "text"
	FieldTextarea    FieldType = "textarea"
	FieldNumber      FieldType = "number"
	FieldBool        FieldType = "bool"
	FieldSelect      FieldType = "select"
	FieldMultiSelect FieldType = "multiselect"
	FieldDate        FieldType = "date" // YYYY-MM-DD
	FieldURL         FieldType = "url"
)

var validFieldTypes = map[FieldType]bool{
	FieldText: true, FieldTextarea: true, FieldNumber: true, FieldBool: true,
	FieldSelect: true, FieldMultiSelect: true, FieldDate: true, FieldURL: true,
}

const maxShowOnCard = 3

type Option struct {
	Value string `json:"value"`
	Label string `json:"label"`
}

type Field struct {
	Key      string    `json:"key"`
	Label    string    `json:"label"`
	Type     FieldType `json:"type"`
	Options  []Option  `json:"options,omitempty"` // select / multiselect
	Required bool      `json:"required,omitempty"`
	Unit     string    `json:"unit,omitempty"`    // shown as input suffix
	Min      *float64  `json:"min,omitempty"`     // number
	Integer  bool      `json:"integer,omitempty"` // number: whole numbers only
	// On item fields: shown on the card. On relation fields: shown in the
	// relation chip summary.
	ShowOnCard  bool   `json:"showOnCard,omitempty"`
	Placeholder string `json:"placeholder,omitempty"`
	Prefix      string `json:"prefix,omitempty"`     // number: compact display prefix, e.g. "$"
	ShortLabel  string `json:"shortLabel,omitempty"` // bool: compact text when true, e.g. "默认"
}

type Kind struct {
	Key    string  `json:"key"`
	Label  string  `json:"label"`
	Icon   string  `json:"icon"` // lucide-react icon name
	Fields []Field `json:"fields"`
}

type RelationType struct {
	Key      string  `json:"key"`
	FromKind string  `json:"fromKind"`
	ToKind   string  `json:"toKind"`
	Label    string  `json:"label"`
	Fields   []Field `json:"fields"`
}

type Board struct {
	Key     string   `json:"key"`
	Title   string   `json:"title"`
	Columns []string `json:"columns"` // kind keys in display order
}

// Definitions is the payload of GET /api/v1/kinds.
type Definitions struct {
	Kinds         []Kind         `json:"kinds"`
	RelationTypes []RelationType `json:"relationTypes"`
	Boards        []Board        `json:"boards"`
}

// Registry keeps definitions in registration order. Register* panic on invalid
// definitions: they are programming errors caught at startup.
type Registry struct {
	kinds     []Kind
	relations []RelationType
	boards    []Board
}

func NewRegistry() *Registry { return &Registry{} }

func (r *Registry) RegisterKind(k Kind) {
	if k.Key == "" {
		panic("kind: empty kind key")
	}
	if _, ok := r.Kind(k.Key); ok {
		panic(fmt.Sprintf("kind %q: already registered", k.Key))
	}
	checkFields("kind "+k.Key, k.Fields)
	n := 0
	for _, f := range k.Fields {
		if f.ShowOnCard {
			n++
		}
	}
	if n > maxShowOnCard {
		panic(fmt.Sprintf("kind %q: %d showOnCard fields, max %d", k.Key, n, maxShowOnCard))
	}
	if k.Fields == nil {
		k.Fields = []Field{} // a kind without fields still sends "fields": []
	}
	r.kinds = append(r.kinds, k)
}

func (r *Registry) RegisterRelation(rt RelationType) {
	name := "relation " + rt.Key
	if rt.Key == "" {
		panic("kind: empty relation key")
	}
	for _, x := range r.relations {
		if x.Key == rt.Key {
			panic(name + ": already registered")
		}
	}
	for _, k := range []string{rt.FromKind, rt.ToKind} {
		if _, ok := r.Kind(k); !ok {
			panic(fmt.Sprintf("%s: unknown kind %q", name, k))
		}
	}
	if rt.FromKind == rt.ToKind {
		panic(name + ": self relations are not supported")
	}
	if x, _, ok := r.RelationBetween(rt.FromKind, rt.ToKind); ok {
		panic(fmt.Sprintf("%s: kinds %s and %s already related by %q", name, rt.FromKind, rt.ToKind, x.Key))
	}
	checkFields(name, rt.Fields)
	if rt.Fields == nil {
		rt.Fields = []Field{}
	}
	r.relations = append(r.relations, rt)
}

func (r *Registry) RegisterBoard(b Board) {
	name := "board " + b.Key
	if b.Key == "" {
		panic("kind: empty board key")
	}
	if _, ok := r.Board(b.Key); ok {
		panic(name + ": already registered")
	}
	if len(b.Columns) == 0 {
		panic(name + ": no columns")
	}
	seen := map[string]bool{}
	for _, c := range b.Columns {
		if _, ok := r.Kind(c); !ok {
			panic(fmt.Sprintf("%s: unknown kind %q", name, c))
		}
		if seen[c] {
			panic(fmt.Sprintf("%s: duplicate column %q", name, c))
		}
		seen[c] = true
	}
	r.boards = append(r.boards, b)
}

func (r *Registry) Kind(key string) (Kind, bool) {
	for _, k := range r.kinds {
		if k.Key == key {
			return k, true
		}
	}
	return Kind{}, false
}

func (r *Registry) Board(key string) (Board, bool) {
	for _, b := range r.boards {
		if b.Key == key {
			return b, true
		}
	}
	return Board{}, false
}

func (r *Registry) RelationType(key string) (RelationType, bool) {
	for _, x := range r.relations {
		if x.Key == key {
			return x, true
		}
	}
	return RelationType{}, false
}

// RelationBetween finds the relation type linking kinds a and b in either
// direction. forward reports whether a is the stored "from" side.
func (r *Registry) RelationBetween(a, b string) (rt RelationType, forward bool, ok bool) {
	for _, x := range r.relations {
		switch {
		case x.FromKind == a && x.ToKind == b:
			return x, true, true
		case x.FromKind == b && x.ToKind == a:
			return x, false, true
		}
	}
	return RelationType{}, false, false
}

func (r *Registry) Definitions() Definitions {
	return Definitions{Kinds: r.kinds, RelationTypes: r.relations, Boards: r.boards}
}

func checkFields(owner string, fields []Field) {
	seen := map[string]bool{}
	for _, f := range fields {
		where := fmt.Sprintf("%s field %q", owner, f.Key)
		if f.Key == "" {
			panic(owner + ": field with empty key")
		}
		if seen[f.Key] {
			panic(where + ": duplicate key")
		}
		seen[f.Key] = true
		if !validFieldTypes[f.Type] {
			panic(fmt.Sprintf("%s: unknown type %q", where, f.Type))
		}
		hasOptions := f.Type == FieldSelect || f.Type == FieldMultiSelect
		if hasOptions && len(f.Options) == 0 {
			panic(where + ": select needs options")
		}
		if !hasOptions && len(f.Options) > 0 {
			panic(where + ": options only allowed on select/multiselect")
		}
		vals := map[string]bool{}
		for _, o := range f.Options {
			if vals[o.Value] {
				panic(fmt.Sprintf("%s: duplicate option %q", where, o.Value))
			}
			vals[o.Value] = true
		}
		if f.Type == FieldBool && f.Required {
			panic(where + ": bool fields cannot be required")
		}
		if f.Type != FieldNumber && (f.Min != nil || f.Integer || f.Prefix != "") {
			panic(where + ": min/integer/prefix only allowed on number")
		}
		if f.Type != FieldBool && f.ShortLabel != "" {
			panic(where + ": shortLabel only allowed on bool")
		}
	}
}
