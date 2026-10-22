package kind

func ptr(f float64) *float64 { return &f }

// RegisterAIStack registers the AI 技术栈 page: harness / model / provider.
func RegisterAIStack(r *Registry) {
	r.RegisterKind(Kind{
		Key: "harness", Label: "Harness", Icon: "terminal",
		Fields: []Field{
			{Key: "form", Label: "形态", Type: FieldSelect, ShowOnCard: true, Options: []Option{
				{"cli", "CLI"}, {"ide", "IDE"}, {"desktop", "桌面"}, {"web", "Web"}, {"framework", "框架"},
			}},
			{Key: "vendor", Label: "出品方", Type: FieldText},
			{Key: "open_source", Label: "开源", Type: FieldBool, ShowOnCard: true},
			{Key: "pricing", Label: "计费方式", Type: FieldSelect, Options: []Option{
				{"free", "免费"}, {"subscription", "订阅"}, {"usage", "按量"}, {"byok", "自带 Key"},
			}},
			{Key: "config_path", Label: "配置位置", Type: FieldText, Placeholder: "~/.claude/settings.json"},
		},
	})

	r.RegisterKind(Kind{
		Key: "model", Label: "Model", Icon: "brain",
		Fields: []Field{
			{Key: "vendor", Label: "出品方", Type: FieldText, Required: true, ShowOnCard: true},
			{Key: "model_id", Label: "模型 ID", Type: FieldText, Placeholder: "官方 API 中的模型字符串"},
			{Key: "context_window", Label: "上下文窗口", Type: FieldNumber, Unit: "tokens", Min: ptr(1), Integer: true, ShowOnCard: true},
			{Key: "max_output", Label: "最大输出", Type: FieldNumber, Unit: "tokens", Min: ptr(1), Integer: true},
			{Key: "modalities", Label: "输入模态", Type: FieldMultiSelect, Options: []Option{
				{"text", "text"}, {"image", "image"}, {"audio", "audio"}, {"video", "video"}, {"pdf", "pdf"},
			}},
			{Key: "release_date", Label: "发布日期", Type: FieldDate},
		},
	})

	r.RegisterKind(Kind{
		Key: "provider", Label: "Provider", Icon: "cloud",
		Fields: []Field{
			{Key: "provider_type", Label: "类型", Type: FieldSelect, ShowOnCard: true, Options: []Option{
				{"official", "官方"}, {"aggregator", "聚合"}, {"cloud", "云厂商"}, {"local", "本地"},
			}},
			{Key: "api_compat", Label: "兼容协议", Type: FieldMultiSelect, ShowOnCard: true, Options: []Option{
				{"openai", "openai"}, {"anthropic", "anthropic"}, {"gemini", "gemini"},
			}},
			{Key: "base_url", Label: "Base URL", Type: FieldURL},
			{Key: "billing", Label: "计费", Type: FieldSelect, Options: []Option{
				{"prepaid", "预付"}, {"postpaid", "后付"}, {"subscription", "订阅"},
			}},
			{Key: "region", Label: "区域", Type: FieldText},
			{Key: "key_hint", Label: "密钥位置", Type: FieldText, Placeholder: "只记录位置，如“1Password: Anthropic API”，禁止填密钥本身"},
		},
	})

	r.RegisterRelation(RelationType{
		Key: "offered_by", FromKind: "model", ToKind: "provider", Label: "可通过",
		Fields: []Field{
			{Key: "provider_model_id", Label: "渠道内模型 ID", Type: FieldText, Placeholder: "渠道内的模型名与官方不同时填写"},
			{Key: "input_price", Label: "输入价格", Type: FieldNumber, Unit: "USD / 百万 tokens", Min: ptr(0)},
			{Key: "output_price", Label: "输出价格", Type: FieldNumber, Unit: "USD / 百万 tokens", Min: ptr(0)},
		},
	})
	r.RegisterRelation(RelationType{
		Key: "uses", FromKind: "harness", ToKind: "model", Label: "使用",
		Fields: []Field{
			{Key: "is_default", Label: "默认模型", Type: FieldBool},
		},
	})
	r.RegisterRelation(RelationType{
		Key: "connects", FromKind: "harness", ToKind: "provider", Label: "接入",
		Fields: []Field{
			{Key: "note", Label: "备注", Type: FieldText},
		},
	})

	r.RegisterBoard(Board{Key: "ai-stack", Title: "AI 技术栈", Columns: []string{"harness", "model", "provider"}})
}

// Default returns the registry with every overview page registered.
func Default() *Registry {
	r := NewRegistry()
	RegisterAIStack(r)
	return r
}
