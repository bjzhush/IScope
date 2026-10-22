// Package seed writes sample data for UI development. The spec numbers are
// placeholders, not real model parameters.
package seed

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/bjzhush/ai-overview/internal/apperr"
	"github.com/bjzhush/ai-overview/internal/item"
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

// Run inserts every sample whose kind+slug does not exist yet.
func Run(ctx context.Context, svc *item.Service) error {
	created, skipped := 0, 0
	for _, in := range samples {
		_, err := svc.Create(ctx, in)
		switch {
		case apperr.Is(err, apperr.Conflict):
			skipped++
		case err != nil:
			return fmt.Errorf("seed %s %q: %w", in.Kind, in.Name, err)
		default:
			created++
		}
	}
	slog.Info("seed done", "created", created, "skipped", skipped)
	return nil
}
