package item

import (
	"regexp"
	"strings"
	"unicode"
)

var slugPattern = regexp.MustCompile(`^[a-z0-9]+(-[a-z0-9]+)*$`)

// Slugify lowercases name, turns whitespace and dots into "-", drops every
// other character outside [a-z0-9-], then collapses and trims dashes. When
// nothing survives (e.g. a Chinese name) it falls back to the ULID's tail.
func Slugify(name, id string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(name) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '-' || r == '.' || unicode.IsSpace(r):
			b.WriteByte('-')
		}
	}
	parts := strings.FieldsFunc(b.String(), func(r rune) bool { return r == '-' })
	if s := strings.Join(parts, "-"); s != "" {
		return s
	}
	if len(id) > 8 {
		id = id[len(id)-8:]
	}
	return strings.ToLower(id)
}

func validSlug(s string) bool { return slugPattern.MatchString(s) }
