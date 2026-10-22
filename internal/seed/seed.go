// Package seed writes sample data for UI development. The spec numbers are
// placeholders, not real model parameters.
package seed

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/bjzhush/ai-overview/internal/apperr"
	"github.com/bjzhush/ai-overview/internal/item"
	"github.com/bjzhush/ai-overview/internal/relation"
)

func s(v string) *string { return &v }
func n(v int) *int       { return &v }

var samples = []item.CreateInput{
	// Harness
	{Kind: "harness", Name: "Claude Code", Status: s(item.StatusInUse), Pinned: true, Rating: n(5),
		Summary: "终端里的主力 coding agent", Tags: []string{"agent", "coding", "cli"},
		Links: []item.Link{{Label: "文档", URL: "https://docs.claude.com/claude-code"}},
		Attrs: map[string]any{"form": "cli", "vendor": "Anthropic", "open_source": false,
			"pricing": "subscription", "config_path": "~/.claude/settings.json"}},
	{Kind: "harness", Name: "Cursor", Status: s(item.StatusWatching),
		Summary: "AI 原生 IDE", Tags: []string{"ide", "coding"},
		Attrs: map[string]any{"form": "ide", "vendor": "Anysphere", "open_source": false, "pricing": "subscription"}},
	{Kind: "harness", Name: "OpenCode", Status: s(item.StatusWatching),
		Summary: "开源终端 agent，可接多家渠道", Tags: []string{"agent", "cli", "oss"},
		Attrs: map[string]any{"form": "cli", "open_source": true, "pricing": "byok"}},
	{Kind: "harness", Name: "Aider", Status: s(item.StatusArchived),
		Summary: "早期用过的结对编程工具", Tags: []string{"cli"},
		Attrs: map[string]any{"form": "cli", "open_source": true, "pricing": "byok"}},

	// Model
	{Kind: "model", Name: "Claude Opus 5.5", Status: s(item.StatusInUse), Rating: n(5),
		Summary: "复杂任务和长链路 agent", Tags: []string{"coding", "agent", "reasoning"},
		Attrs: map[string]any{"vendor": "Anthropic", "model_id": "claude-opus-5-5",
			"context_window": 1000000, "max_output": 128000,
			"modalities": []string{"text", "image", "pdf"}, "release_date": "2026-09-01"}},
	{Kind: "model", Name: "Claude Sonnet 5.5", Status: s(item.StatusInUse), Pinned: true, Rating: n(5),
		Summary: "日常主力模型", Tags: []string{"coding", "agent"},
		Links: []item.Link{{Label: "文档", URL: "https://docs.claude.com"}},
		Attrs: map[string]any{"vendor": "Anthropic", "model_id": "claude-sonnet-5-5",
			"context_window": 1000000, "max_output": 64000,
			"modalities": []string{"text", "image", "pdf"}, "release_date": "2026-09-01"}},
	{Kind: "model", Name: "Gemini 3 Pro", Status: s(item.StatusWatching),
		Summary: "长上下文和多模态对比用", Tags: []string{"multimodal"},
		Attrs: map[string]any{"vendor": "Google", "model_id": "gemini-3-pro",
			"context_window": 1000000, "modalities": []string{"text", "image", "audio", "video", "pdf"}}},

	// Provider
	{Kind: "provider", Name: "Anthropic API", Status: s(item.StatusInUse),
		Summary: "官方 API，预付额度", Tags: []string{"official"},
		Attrs: map[string]any{"provider_type": "official", "api_compat": []string{"anthropic"},
			"base_url": "https://api.anthropic.com", "billing": "prepaid", "key_hint": "1Password: Anthropic API"}},
	{Kind: "provider", Name: "OpenRouter", Status: s(item.StatusWatching),
		Summary: "多家模型统一入口", Tags: []string{"aggregator"},
		Attrs: map[string]any{"provider_type": "aggregator", "api_compat": []string{"openai", "anthropic"},
			"base_url": "https://openrouter.ai/api/v1", "billing": "prepaid", "key_hint": "1Password: OpenRouter"}},
	{Kind: "provider", Name: "AWS Bedrock", Status: s(item.StatusWatching),
		Summary: "公司账号下的云上渠道", Tags: []string{"cloud"},
		Attrs: map[string]any{"provider_type": "cloud", "api_compat": []string{"anthropic"},
			"billing": "postpaid", "region": "us-east-1", "key_hint": "~/.aws/credentials 的 work profile"}},
}

type ref struct{ kind, slug string }

// sampleLinks covers all three relation types; either end may come first.
var sampleLinks = []struct {
	a, b  ref
	attrs map[string]any
}{
	{ref{"model", "claude-sonnet-5-5"}, ref{"provider", "anthropic-api"}, map[string]any{"input_price": 3, "output_price": 15}},
	{ref{"model", "claude-opus-5-5"}, ref{"provider", "anthropic-api"}, map[string]any{"input_price": 5, "output_price": 25}},
	{ref{"model", "claude-sonnet-5-5"}, ref{"provider", "openrouter"}, map[string]any{"provider_model_id": "anthropic/claude-sonnet-5.5", "input_price": 3, "output_price": 15}},
	{ref{"provider", "aws-bedrock"}, ref{"model", "claude-sonnet-5-5"}, map[string]any{"provider_model_id": "anthropic.claude-sonnet-5-5-v1:0"}},
	{ref{"model", "gemini-3-pro"}, ref{"provider", "openrouter"}, map[string]any{"provider_model_id": "google/gemini-3-pro"}},
	{ref{"harness", "claude-code"}, ref{"model", "claude-sonnet-5-5"}, map[string]any{"is_default": true}},
	{ref{"harness", "claude-code"}, ref{"model", "claude-opus-5-5"}, nil},
	{ref{"harness", "opencode"}, ref{"model", "gemini-3-pro"}, nil},
	{ref{"harness", "claude-code"}, ref{"provider", "anthropic-api"}, map[string]any{"note": "订阅登录"}},
	{ref{"harness", "opencode"}, ref{"provider", "openrouter"}, nil},
}

// Run inserts every sample whose kind+slug does not exist yet, then adds the
// sample relations that are missing. Existing data is never modified.
func Run(ctx context.Context, items *item.Service, relations *relation.Service) error {
	created, skipped := 0, 0
	for _, in := range samples {
		_, err := items.Create(ctx, in)
		switch {
		case apperr.Is(err, apperr.Conflict):
			skipped++
		case err != nil:
			return fmt.Errorf("seed %s %q: %w", in.Kind, in.Name, err)
		default:
			created++
		}
	}

	all, err := items.List(ctx, item.ListFilter{})
	if err != nil {
		return err
	}
	ids := map[ref]string{}
	for _, it := range all {
		ids[ref{it.Kind, it.Slug}] = it.ID
	}
	linked := 0
	for _, l := range sampleLinks {
		a, b := ids[l.a], ids[l.b]
		if a == "" || b == "" {
			continue // the user deleted one end; leave it alone
		}
		if err := relations.Ensure(ctx, a, b, l.attrs); err != nil {
			return fmt.Errorf("seed relation %v-%v: %w", l.a, l.b, err)
		}
		linked++
	}
	slog.Info("seed done", "created", created, "skipped", skipped, "relations", linked)
	return nil
}
