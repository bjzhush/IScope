// Package item implements CRUD for board items of every kind.
package item

const (
	StatusInUse    = "in_use"
	StatusWatching = "watching"
	StatusArchived = "archived"
)

var validStatus = map[string]bool{StatusInUse: true, StatusWatching: true, StatusArchived: true}

type Link struct {
	Label string `json:"label"`
	URL   string `json:"url"`
}

type Item struct {
	ID        string         `json:"id"`
	Kind      string         `json:"kind"`
	Name      string         `json:"name"`
	Slug      string         `json:"slug"`
	Status    string         `json:"status"`
	Summary   string         `json:"summary"`
	Tags      []string       `json:"tags"`
	Links     []Link         `json:"links"`
	Notes     string         `json:"notes"`
	Rating    *int           `json:"rating"`
	Pinned    bool           `json:"pinned"`
	SortOrder float64        `json:"sortOrder"`
	Attrs     map[string]any `json:"attrs"`
	CreatedAt string         `json:"createdAt"`
	UpdatedAt string         `json:"updatedAt"`
}

// Detail is the GET /items/{id} payload. Relations arrive in phase 2.
type Detail struct {
	Item
	Relations []any `json:"relations"`
}

type CreateInput struct {
	Kind      string         `json:"kind"`
	Name      string         `json:"name"`
	Slug      *string        `json:"slug"`
	Status    *string        `json:"status"`
	Summary   string         `json:"summary"`
	Tags      []string       `json:"tags"`
	Links     []Link         `json:"links"`
	Notes     string         `json:"notes"`
	Rating    *int           `json:"rating"`
	Pinned    bool           `json:"pinned"`
	SortOrder *float64       `json:"sortOrder"`
	Attrs     map[string]any `json:"attrs"`
}

// Patch holds the fields present in a PATCH body; nil pointers are absent.
type Patch struct {
	Kind      *string
	Name      *string
	Slug      *string
	Status    *string
	Summary   *string
	Tags      *[]string
	Links     *[]Link
	Notes     *string
	Rating    *NullInt
	Pinned    *bool
	SortOrder *float64
	// Attrs is merged key by key; a nil value deletes that key.
	Attrs map[string]any
}

// NullInt is a present value that may be JSON null.
type NullInt struct{ Value *int }

type ListFilter struct {
	Kind   string
	Status string
	Q      string
	Tag    string
}
