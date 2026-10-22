package item

import "testing"

func TestSlugify(t *testing.T) {
	const id = "01JB7Q2W3X4Y5Z6A7B8C9D0E1F"
	cases := map[string]string{
		"Claude Sonnet 5.5":   "claude-sonnet-5-5",
		"Claude Code":         "claude-code",
		"AWS Bedrock":         "aws-bedrock",
		"  OpenRouter  ":      "openrouter",
		"Foo -- Bar..Baz":     "foo-bar-baz",
		"GPT-5 (preview)!":    "gpt-5-preview",
		"my_tool":             "mytool",
		"Qwen3 通义千问":          "qwen3",
		"通义千问":                "8c9d0e1f",
		"":                    "8c9d0e1f",
		"Tab\tand\nnewline":   "tab-and-newline",
		"---leading-trailing": "leading-trailing",
	}
	for in, want := range cases {
		if got := Slugify(in, id); got != want {
			t.Errorf("Slugify(%q) = %q, want %q", in, got, want)
		}
		if got := Slugify(in, id); !validSlug(got) {
			t.Errorf("Slugify(%q) = %q is not a valid slug", in, got)
		}
	}
}
