// Package relation manages links between items. The stored direction is fixed
// by the relation type; callers may pass either end.
package relation

type Relation struct {
	ID        string         `json:"id"`
	Type      string         `json:"type"`
	FromID    string         `json:"fromId"`
	ToID      string         `json:"toId"`
	Attrs     map[string]any `json:"attrs"`
	CreatedAt string         `json:"createdAt"`
	UpdatedAt string         `json:"updatedAt"`
}

// Link is one entry of PUT /items/{id}/relations. A nil Attrs means "keep the
// existing attributes" (or empty ones for a new relation).
type Link struct {
	TargetID string         `json:"targetId"`
	Attrs    map[string]any `json:"attrs"`
}

type ReplaceInput struct {
	Links []Link `json:"links"`
}

type PatchInput struct {
	// Merged key by key; a nil value deletes that key.
	Attrs map[string]any `json:"attrs"`
}
