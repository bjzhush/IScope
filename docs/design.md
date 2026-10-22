# AI 技术栈概览页设计文档

Oct 21, 2026 · @Shawn

## 概述与目标

本项目是一个仅供本人使用的“AI 技术栈概览页”：在一个页面用三列展示我正在使用和关注的 Harness、Model、Provider，并能在页面内编辑条目及它们之间的关联。它是一系列概览页的第一个，所以后端按“通用条目 + 类型注册”设计，后续概览页复用同一套数据模型和 API。

**目标**

- 一眼看清三类条目各有哪些、哪些在用、哪些在关注
- 在页面内完成新增、编辑、弃用、删除，以及维护三者之间的关联
- 悬停任一条目，即可看到它在另外两列中的关联项
- 新增一个概览页时，只需在后端注册新的 kind 和 board，前端不改表单代码

**非目标（本期不做）**

- 多用户、登录鉴权、权限控制
- 存储或管理 API Key 等任何密钥
- 用量、费用的统计与图表
- 自动从外部同步数据（第三期只做手动触发的导入）

## 概念与术语

三类条目按“怎么用、用什么、从哪调”划分，两两之间都是多对多关系。

| 概念 | kind 键 | 定义 | 例子 |
| --- | --- | --- | --- |
| Harness | `harness` | 直接交互的工具或运行时，决定“怎么用” | Claude Code、Cursor、OpenCode、Aider |
| Model | `model` | 模型本身，带一个出品方 | Claude Opus 5.5、Claude Sonnet 5.5 |
| Provider | `provider` | 实际调用和付费的接入渠道，决定“从哪调” | Anthropic API、OpenRouter、AWS Bedrock |

出品方（vendor）不等于 Provider：Claude Sonnet 5.5 的出品方是 Anthropic，但它可以经由 OpenRouter 或 Bedrock 调用。出品方只是 Model 的一个字段，不单独成列。

**关系类型**（任意两种 kind 之间最多一种关系类型，方向固定）

| 关系键 | 方向 | 含义 | 关系上的属性 |
| --- | --- | --- | --- |
| `offered_by` | Model → Provider | 该模型可通过该渠道调用 | 渠道内模型 ID、输入价格、输出价格 |
| `uses` | Harness → Model | 该工具中使用该模型 | 是否默认模型 |
| `connects` | Harness → Provider | 该工具接入了该渠道 | 备注 |

&#91;embedded content: 关系方向 · 3 种关系类型\]

箭头方向即存储方向；接口接受任意一端，后端自动规范。

价格放在 `offered_by` 关系上而不是 Model 上，因为同一模型在不同渠道的价格可能不同。

**状态**

| 值 | 显示 | 含义 |
| --- | --- | --- |
| `in_use` | 使用中 | 正在实际使用 |
| `watching` | 关注中 | 在跟进、试用或打算使用 |
| `archived` | 已弃用 | 不再使用；默认隐藏，可通过筛选查看和恢复 |

“已弃用”是一种状态，条目仍保留；“删除”是软删除（`deleted_at` 非空），删除后在任何接口中都不再出现。

## 技术栈与约束

后端 Go + SQLite，前端 React，最终打包成一个可执行文件加一个数据库文件。

| 层 | 选型 | 说明 |
| --- | --- | --- |
| 后端语言 | Go 1.22 及以上 | 用标准库 `net/http` 的 `ServeMux`（支持 `GET /items/{id}` 这类方法加路径参数），不引入 Web 框架 |
| 数据库 | SQLite | 驱动用 `modernc.org/sqlite`（纯 Go，无需 cgo）；连接后执行 `PRAGMA foreign_keys=ON` 和 `PRAGMA journal_mode=WAL` |
| 数据访问 | `sqlc` | 由 SQL 生成类型安全的 Go 代码；JSON 列在 Go 侧编解码 |
| 迁移 | `goose` | 迁移 SQL 用 `embed` 内嵌，服务启动时自动执行 |
| ID | ULID | `github.com/oklog/ulid/v2`，字符串存储，天然按时间排序 |
| 前端 | React 19 + TypeScript + Vite |  |
| UI 组件 | shadcn/ui + Tailwind CSS | Sheet 做编辑抽屉，Command 做可搜索的关联选择器，DropdownMenu 做卡片菜单 |
| 数据请求 | TanStack Query | 聚合接口一个查询键，写操作后失效刷新 |
| 表单 | react-hook-form + zod | zod schema 由 kind 字段定义动态生成 |
| 部署 | `embed.FS` | 前端构建产物打进 Go 二进制，非 `/api` 路径回退到 `index.html` |

**约束**

- 仅本人使用：服务默认只监听 `127.0.0.1:8080`，不做鉴权
- 不存储 API Key、密码或任何密钥；Provider 只记录“密钥放在哪里”的文字提示
- 监听地址和数据库路径可通过命令行参数或环境变量配置，数据库默认 `./data/overview.db`
- 数据量按百条级别设计：聚合接口一次返回全量，搜索和筛选在前端完成

## 数据模型

只有两张表：`items` 存所有 kind 的条目，kind 专属字段放在 JSON 列 `attrs`；`relations` 存条目之间的关联。

```sql
-- migrations/0001_init.sql
CREATE TABLE items (
  id          TEXT PRIMARY KEY,                 -- ULID
  kind        TEXT NOT NULL,                    -- harness / model / provider / ...
  name        TEXT NOT NULL,
  slug        TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'watching'
              CHECK (status IN ('in_use', 'watching', 'archived')),
  summary     TEXT NOT NULL DEFAULT '',
  tags        TEXT NOT NULL DEFAULT '[]',       -- JSON 字符串数组
  links       TEXT NOT NULL DEFAULT '[]',       -- JSON 数组 [{"label":"","url":""}]
  notes       TEXT NOT NULL DEFAULT '',         -- Markdown
  rating      INTEGER CHECK (rating BETWEEN 1 AND 5),
  pinned      INTEGER NOT NULL DEFAULT 0,
  sort_order  REAL    NOT NULL DEFAULT 0,
  attrs       TEXT NOT NULL DEFAULT '{}',       -- JSON 对象，kind 专属字段
  created_at  TEXT NOT NULL,                    -- RFC 3339, UTC
  updated_at  TEXT NOT NULL,
  deleted_at  TEXT                              -- 非空即已删除
);

CREATE UNIQUE INDEX idx_items_kind_slug
  ON items(kind, slug) WHERE deleted_at IS NULL;
CREATE INDEX idx_items_kind_status ON items(kind, status);

CREATE TABLE relations (
  id          TEXT PRIMARY KEY,                 -- ULID
  type        TEXT NOT NULL,                    -- offered_by / uses / connects / ...
  from_id     TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  to_id       TEXT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  attrs       TEXT NOT NULL DEFAULT '{}',       -- JSON 对象，关系属性
  created_at  TEXT NOT NULL,
  updated_at  TEXT NOT NULL,
  UNIQUE (type, from_id, to_id),
  CHECK (from_id <> to_id)
);

CREATE INDEX idx_relations_to ON relations(to_id);
```

**规则**

1. `slug` 在创建时由 `name` 自动生成（转小写，空格和点替换为 `-`，去掉其他符号），可手动修改；同一 kind 内未删除的条目 slug 唯一，冲突返回 409。
2. `sort_order` 用浮点数。拖拽时新值取前后相邻两项的中间值，不需要批量重排；两项间距小于 `1e-6` 时，后端把整列重新编号为 1、2、3……
3. 关系方向固定，由关系类型定义（见下一节）决定。接口接收任意一端的条目 ID，由后端根据两端的 kind 找到关系类型并规范方向后再存储，前端无需关心方向。
4. 软删除条目时，其关联记录保留在表里，但所有查询都要通过 `JOIN items` 排除两端任一已删除的关系。
5. `updated_at` 在每次写入条目或其关联时更新。所有写操作在事务中执行。

## Kind 与字段定义

kind、关系类型和 board 都在 Go 代码里注册，同一份定义既用于后端校验 `attrs`，也通过 `GET /api/v1/kinds` 下发给前端渲染表单。新增概览页 = 新增一个注册文件。

```go
// internal/kind/registry.go
type FieldType string

const (
    FieldText        FieldType = "text"
    FieldTextarea    FieldType = "textarea"
    FieldNumber      FieldType = "number"
    FieldBool        FieldType = "bool"
    FieldSelect      FieldType = "select"
    FieldMultiSelect FieldType = "multiselect"
    FieldDate        FieldType = "date"   // YYYY-MM-DD
    FieldURL         FieldType = "url"
)

type Option struct {
    Value string `json:"value"`
    Label string `json:"label"`
}

type Field struct {
    Key         string    `json:"key"`
    Label       string    `json:"label"`
    Type        FieldType `json:"type"`
    Options     []Option  `json:"options,omitempty"`     // select / multiselect
    Required    bool      `json:"required,omitempty"`
    Unit        string    `json:"unit,omitempty"`        // 显示在输入框后缀
    Min         *float64  `json:"min,omitempty"`         // number
    ShowOnCard  bool      `json:"showOnCard,omitempty"`  // 卡片上展示，每个 kind 最多 3 个
    Placeholder string    `json:"placeholder,omitempty"`
}

type Kind struct {
    Key    string  `json:"key"`
    Label  string  `json:"label"`
    Icon   string  `json:"icon"`   // lucide-react 图标名
    Fields []Field `json:"fields"`
}

type RelationType struct {
    Key      string  `json:"key"`
    FromKind string  `json:"fromKind"`
    ToKind   string  `json:"toKind"`
    Label    string  `json:"label"`
    Fields   []Field `json:"fields"` // 关系属性
}

type Board struct {
    Key     string   `json:"key"`
    Title   string   `json:"title"`
    Columns []string `json:"columns"` // kind 键，按显示顺序
}
```

注册时校验：任意两个 kind 之间最多一种关系类型（这样前端只凭两端 kind 就能确定关系类型）；字段 key 在 kind 内唯一；`ShowOnCard` 的字段不超过 3 个。

**Harness 字段**

| key | 标签 | 类型 | 选项 / 说明 | 卡片显示 |
| --- | --- | --- | --- | --- |
| `form` | 形态 | select | `cli` CLI、`ide` IDE、`desktop` 桌面、`web` Web、`framework` 框架 | 是 |
| `vendor` | 出品方 | text |  | 否 |
| `open_source` | 开源 | bool |  | 是 |
| `pricing` | 计费方式 | select | `free` 免费、`subscription` 订阅、`usage` 按量、`byok` 自带 Key | 否 |
| `config_path` | 配置位置 | text | 如 `~/.claude/settings.json` | 否 |

**Model 字段**

| key | 标签 | 类型 | 选项 / 说明 | 卡片显示 |
| --- | --- | --- | --- | --- |
| `vendor` | 出品方 | text | 必填 | 是 |
| `model_id` | 模型 ID | text | 官方 API 中的模型字符串 | 否 |
| `context_window` | 上下文窗口 | number | 单位 tokens，最小 1 | 是 |
| `max_output` | 最大输出 | number | 单位 tokens，最小 1 | 否 |
| `modalities` | 输入模态 | multiselect | `text`、`image`、`audio`、`video`、`pdf` | 否 |
| `release_date` | 发布日期 | date |  | 否 |

**Provider 字段**

| key | 标签 | 类型 | 选项 / 说明 | 卡片显示 |
| --- | --- | --- | --- | --- |
| `provider_type` | 类型 | select | `official` 官方、`aggregator` 聚合、`cloud` 云厂商、`local` 本地 | 是 |
| `api_compat` | 兼容协议 | multiselect | `openai`、`anthropic`、`gemini` | 是 |
| `base_url` | Base URL | url |  | 否 |
| `billing` | 计费 | select | `prepaid` 预付、`postpaid` 后付、`subscription` 订阅 | 否 |
| `region` | 区域 | text |  | 否 |
| `key_hint` | 密钥位置 | text | 只记录位置，如“1Password: Anthropic API”，禁止填密钥本身 | 否 |

**关系属性**

| 关系 | key | 标签 | 类型 | 说明 |
| --- | --- | --- | --- | --- |
| `offered_by` | `provider_model_id` | 渠道内模型 ID | text | 渠道内的模型名与官方不同时填写 |
| `offered_by` | `input_price` | 输入价格 | number | 单位 USD / 百万 tokens |
| `offered_by` | `output_price` | 输出价格 | number | 单位 USD / 百万 tokens |
| `uses` | `is_default` | 默认模型 | bool |  |
| `connects` | `note` | 备注 | text |  |

**Board**：`{ key: "ai-stack", title: "AI 技术栈", columns: ["harness", "model", "provider"] }`

**attrs 校验规则**（创建、更新条目和关系时都执行）

- 出现未定义的 key → 400
- 值类型不匹配（number 传字符串、select 值不在选项中、date 不是 `YYYY-MM-DD`、url 不是 http/https）→ 400
- `Required` 字段缺失或为空 → 400
- 错误按字段返回，key 形如 `attrs.context_window`，前端据此把错误显示在对应输入框下

## API 规格

所有接口以 `/api/v1` 为前缀，请求和响应均为 JSON，字段名使用 camelCase。页面只依赖聚合接口读数据，其余接口用于写入。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/kinds` | 返回所有 kind、关系类型和 board 定义 |
| GET | `/boards/{key}` | 聚合接口：该 board 各列的全部条目和它们之间的关系；`?includeArchived=true` 时包含已弃用条目 |
| GET | `/items` | 条目列表，支持 `kind`、`status`、`q`、`tag` 查询参数（供调试和以后使用） |
| POST | `/items` | 新建条目 |
| GET | `/items/{id}` | 条目详情，附带它的全部关联 |
| PATCH | `/items/{id}` | 部分更新条目 |
| DELETE | `/items/{id}` | 软删除条目，返回 204 |
| POST | `/items/{id}/move` | 列内拖拽排序 |
| PUT | `/items/{id}/relations` | 用完整集合替换该条目的全部关联 |
| PATCH | `/relations/{id}` | 修改单条关系的属性 |
| DELETE | `/relations/{id}` | 删除单条关系，返回 204 |
| GET | `/export` | 第三期：导出全部数据为 JSON |
| POST | `/import` | 第三期：导入 JSON，按 `kind + slug` 合并 |

**Item 对象**（示例数据）

```json
{
  "id": "01JB7Q2W3X4Y5Z6A7B8C9D0E1F",
  "kind": "model",
  "name": "Claude Sonnet 5.5",
  "slug": "claude-sonnet-5-5",
  "status": "in_use",
  "summary": "日常主力模型",
  "tags": ["coding", "agent"],
  "links": [{ "label": "文档", "url": "https://docs.claude.com" }],
  "notes": "",
  "rating": 5,
  "pinned": true,
  "sortOrder": 1,
  "attrs": {
    "vendor": "Anthropic",
    "model_id": "claude-sonnet-5-5",
    "modalities": ["text", "image", "pdf"]
  },
  "createdAt": "2026-10-21T08:00:00Z",
  "updatedAt": "2026-10-21T08:00:00Z"
}
```

`attrs` 内的 key 保持 snake\_case，与字段定义一致。

**Relation 对象**

```json
{
  "id": "01JB7Q...",
  "type": "offered_by",
  "fromId": "01JB7Q...（model）",
  "toId": "01JB7R...（provider）",
  "attrs": { "input_price": 3, "output_price": 15 }
}
```

**GET /boards/ai-stack 响应**

```json
{
  "board": { "key": "ai-stack", "title": "AI 技术栈", "columns": ["harness", "model", "provider"] },
  "items": [ /* Item，所有列混在一个数组里，前端按 kind 分组 */ ],
  "relations": [ /* Relation，只包含两端都在 items 中的关系 */ ]
}
```

**POST /items**：必填 `kind`、`name`；其余字段可选，`status` 默认 `watching`，`slug` 默认由 `name` 生成，`sortOrder` 默认为该列当前最大值加 1。返回 201 和完整 Item。

**PATCH /items/{id}**：只更新请求中出现的字段；`kind` 不可修改。`attrs` 按键合并，值为 `null` 表示删除该键，合并后再整体校验。返回更新后的 Item。

**POST /items/{id}/move**

```json
{ "beforeId": "01JB...", "afterId": null }
```

`beforeId` / `afterId` 是拖放后位于它上方和下方的条目，可为 `null`（放在列首或列尾）。后端据此计算新的 `sortOrder`，返回更新后的 Item。

**PUT /items/{id}/relations**

```json
{
  "links": [
    { "targetId": "01JB...（某个 model）", "attrs": { "is_default": true } },
    { "targetId": "01JB...（某个 provider）" }
  ]
}
```

语义：`links` 是该条目“应有的”全部关联。后端在一个事务中：

1. 对每个 `targetId`，根据两端 kind 查出关系类型并规范方向；找不到关系类型（例如两个 model 之间）→ 400
2. 已存在的关系：请求带了 `attrs` 就校验并替换，没带则保持原值
3. 不存在的关系：校验 `attrs` 后创建
4. 现有关系中不在 `links` 里的：删除

返回该条目更新后的全部 Relation 数组。

**错误格式**

```json
{
  "error": {
    "code": "validation_failed",
    "message": "请检查标出的字段",
    "fields": { "attrs.context_window": "必须是大于 0 的整数" }
  }
}
```

| HTTP 状态 | code | 场景 |
| --- | --- | --- |
| 400 | `bad_request` | JSON 无法解析、未知 kind 或关系类型 |
| 400 | `validation_failed` | 字段校验失败，`fields` 列出每个出错字段 |
| 404 | `not_found` | 条目或关系不存在（含已软删除） |
| 409 | `conflict` | 同 kind 下 slug 重复 |
| 500 | `internal` | 其他错误，响应中不暴露内部细节，详情写日志 |

## 前端页面与交互

页面是一个通用的 `BoardPage`，路由为 `/boards/:key`，根路径重定向到 `/boards/ai-stack`。所有编辑都在同一个右侧抽屉里完成，包括条目字段和关联。

**页面结构**

- 顶栏：board 标题；搜索框；状态筛选（全部 / 使用中 / 关注中）；“显示已弃用”开关
- 主体：按 `board.columns` 顺序排列的等宽列，CSS grid 实现
- 列头：kind 图标 + 名称 + 当前可见条目数 + “+”按钮
- 视口宽度小于 900px 时，三列折叠为三个 Tab
- 列为空时显示一句引导文案和“新增”按钮

**卡片**

- 第一行：名称（单行截断）+ 状态徽标（使用中为绿色，关注中为蓝色，已弃用为灰色并整体降低不透明度）+ 置顶图标
- 第二行：`summary`，单行截断
- 第三行：`showOnCard` 字段的值，按字段定义顺序，用“·”分隔；bool 为真时显示字段标签，select 显示选项标签，number 附带单位
- 底部：标签，最多显示 3 个，多余的显示为 `+N`
- 右上角“⋯”菜单：设为使用中 / 设为关注中 / 置顶或取消置顶 / 编辑 / 弃用；已弃用条目的菜单中改为“恢复”和“删除”，删除需二次确认
- 点击卡片空白处打开编辑抽屉
- 列内排序：置顶在前 → 状态（使用中、关注中、已弃用）→ `sortOrder` 升序

**搜索与筛选**

在前端对聚合接口返回的数据过滤：关键词匹配名称、`summary`、标签和 `attrs` 中的文本值，不区分大小写。筛选状态保存在 URL 查询参数里，刷新后保留。

**编辑抽屉**（shadcn Sheet，右侧，宽 480px）

新增和编辑共用一个组件。新增时从列头“+”进入，kind 已预设且不可改。表单分三段：

1. 基本信息：名称、状态、一句话描述、标签（输入回车添加）、链接（标签 + URL 的可增删列表）、评分、笔记（Markdown 文本框）
2. 专属字段：按 kind 的 `fields` 动态渲染，控件映射见下表
3. 关联：另外每个 kind 一组，见下方“关联编辑”

底部按钮：左侧“弃用”（已弃用时为“恢复”），右侧“取消”和“保存”。表单有未保存修改时关闭抽屉需要确认。保存失败时，把错误响应中的 `fields` 映射到对应输入框下方显示。

| 字段类型 | 控件 |
| --- | --- |
| text | Input |
| textarea | Textarea |
| number | Input type=number，`unit` 显示为后缀 |
| bool | Switch |
| select | Select |
| multiselect | 可多选的 ToggleGroup（选项少于 6 个）或带搜索的多选弹层 |
| date | Input type=date |
| url | Input type=url |

前端用同一份字段定义生成 zod schema，提交前先在本地校验一次，规则与后端一致。

**关联编辑**

- 每组显示已关联条目的标签，标签上附带关系属性摘要（如价格“$3 / $15”，默认模型显示“默认”）
- 标签上的 × 解除关联
- “+ 添加 {kind}”打开 Command 弹层，列出该 kind 中尚未关联、未弃用的条目，可搜索，选中即加入
- 点击标签打开 Popover，按关系类型的 `fields` 渲染关系属性表单
- 关联的增删改都只修改表单状态，点“保存”时统一提交

**保存流程**

1. 新增：`POST /items` 拿到 `id` → `PUT /items/{id}/relations`
2. 编辑：`PATCH /items/{id}`（只发生变化的字段）→ 关联有变化时 `PUT /items/{id}/relations`
3. 两步都成功后，失效 `['board', key]` 查询并关闭抽屉；第二步失败时抽屉保持打开并提示“条目已保存，关联保存失败”，可重试

**悬停联动**

鼠标进入卡片时，从 `relations` 计算该条目的一跳邻居（直接关联的条目）：邻居卡片加强调边框，其余卡片不透明度降到 0.3；离开时恢复。只算直接关联，例如悬停某个 Harness 时，只高亮它直接 `uses` 的 Model 和 `connects` 的 Provider。邻接表在数据加载后用 `useMemo` 预先构建。

**状态管理**

- 读：一个查询 `useQuery(['board', key])` 调聚合接口；`/kinds` 单独一个查询，`staleTime: Infinity`
- 写：卡片菜单里的状态切换、置顶使用乐观更新，失败时回滚并 toast 提示；抽屉保存不做乐观更新
- 当前打开的抽屉条目 ID 放在 URL 查询参数 `?item=<id>`（新增时 `?new=<kind>`），便于刷新后保持

## 项目结构

单仓库，Go 模块在根目录，React 在 `web/` 下；后端按领域分包，每个包内分 handler、service、repo 三层。

```
ai-overview/
├── cmd/server/main.go        # 读配置、打开数据库、执行迁移、注册路由、启动 HTTP
├── internal/
│   ├── config/               # 监听地址、数据库路径（flag + 环境变量）
│   ├── store/                # 数据库连接、PRAGMA、事务帮助函数
│   │   ├── migrations/       # *.sql，用 embed 内嵌，goose 执行
│   │   └── queries/          # sqlc 的 SQL 源文件
│   ├── kind/
│   │   ├── registry.go       # 类型定义与注册、注册时校验
│   │   ├── aistack.go        # 本页：三个 kind、三种关系类型、ai-stack board
│   │   └── validate.go       # attrs 校验，返回按字段的错误
│   ├── item/                 # handler.go / service.go / repo.go
│   ├── relation/             # 同上，含 PUT relations 的差异计算
│   ├── board/                # 聚合接口
│   ├── httpx/                # JSON 读写、统一错误响应、日志与 recover 中间件
│   └── seed/                 # 示例数据，开发用
├── web/
│   ├── embed.go              # package web; //go:embed all:dist
│   ├── src/
│   │   ├── api/              # fetch 封装、TypeScript 类型、查询键
│   │   ├── components/ui/    # shadcn 生成的组件
│   │   ├── features/board/   # BoardPage、Column、ItemCard、悬停联动
│   │   ├── features/editor/  # ItemSheet、DynamicField、RelationGroup、RelationPicker
│   │   └── lib/              # 由字段定义生成 zod schema、格式化工具
│   ├── vite.config.ts        # 开发时把 /api 代理到 127.0.0.1:8080
│   └── dist/                 # 构建产物（不提交）
├── sqlc.yaml
├── Makefile
└── go.mod
```

`go:embed` 不能引用上级目录，所以嵌入声明放在 `web/embed.go`（独立的 `web` 包），由 `main.go` 导入。开发时 `dist/` 可能为空，嵌入前用一个占位 `index.html` 保证编译通过。

**常用命令**

| 命令 | 作用 |
| --- | --- |
| `make dev` | 同时启动 `go run ./cmd/server`（:8080）和 `vite`（:5173），浏览器访问 5173 |
| `make gen` | 运行 `sqlc generate` |
| `make seed` | 向数据库写入示例数据 |
| `make test` | 运行 `go test ./...` 和前端 `vitest run` |
| `make build` | 先构建前端，再 `go build -o bin/ai-overview ./cmd/server` |

生产运行：`./bin/ai-overview -addr 127.0.0.1:8080 -db ./data/overview.db`。HTTP 层对 `/api/` 以外的路径返回嵌入的静态文件，找不到时回退到 `index.html` 交给前端路由。

## 分期计划与验收标准

分四期交付，每期结束时页面都可用；第一期不含关联，第二期补上关联和悬停联动。

**第一期：MVP**

范围：迁移和 `items` 表、kind 注册表与 attrs 校验、条目 CRUD 接口、`/kinds` 和聚合接口、三列页面、卡片与“⋯”菜单、搜索与筛选、编辑抽屉的基本信息和专属字段两段、示例数据。

- [ ] 三列都能新增、编辑、弃用、恢复、删除条目，刷新后数据保留
- [ ] 专属字段按 kind 动态渲染，不同 kind 的表单不同，且前端没有按 kind 写死的表单代码
- [ ] 提交非法 attrs（未知 key、错误类型、缺少必填）时接口返回 400，抽屉在对应字段下显示错误
- [ ] 同一 kind 下 slug 重复时返回 409，抽屉提示名称冲突
- [ ] 搜索和状态筛选即时生效，筛选条件刷新后保留
- [ ] 已弃用条目默认隐藏，打开“显示已弃用”后以灰色出现

**第二期：关联**

范围：`relations` 表与接口、抽屉中的关联区、关系属性编辑、悬停联动。

- [ ] 从任一端添加关联，打开另一端条目时能看到这条关联
- [ ] 尝试关联两个无关系类型的 kind（如两个 Model）时接口返回 400
- [ ] `PUT /items/{id}/relations` 只增删有差异的关系，未改动的关系 ID 和属性保持不变
- [ ] 删除条目后，聚合接口不再返回它的任何关联
- [ ] 悬停卡片时，直接关联的卡片高亮，其余变淡；移开后恢复

**第三期：增强**

范围：列内拖拽排序、导出与导入 JSON、从公开模型目录手动导入模型元数据、关联模式（选中一张卡片后直接在其他列勾选关联）、窄屏 Tab 布局。

- [ ] 拖拽排序后刷新，顺序保持
- [ ] 导出的 JSON 导入到空库后，数据与关联完全一致

**第四期：第二个概览页**

范围：注册新的 kind、关系类型和 board，前端加 board 切换导航。

- [ ] 新增概览页只改动后端注册文件和导航配置，表单、卡片、抽屉代码无需修改

## 给 Claude Code 的开发说明

按期开发，每期完成后对照验收清单自测；先做后端并用测试锁定行为，再做前端。建议把本文导出为 Markdown 放在仓库的 `docs/design.md`，并在 `CLAUDE.md` 中引用它。

**第一期的实施顺序**

1. 初始化 Go 模块、目录结构、Makefile、`config` 与 `store`（连接、PRAGMA、goose 迁移）
2. `kind` 包：类型定义、`aistack.go` 注册、注册时校验、`validate.go` 及其单元测试
3. `items` 的 sqlc 查询与 repo，`item` 的 service（slug 生成、attrs 合并与校验）和 handler
4. `httpx` 统一错误格式，`/kinds` 与 `/boards/{key}` 接口，`seed` 示例数据
5. 初始化 Vite + React + TypeScript + Tailwind + shadcn/ui，配置 `/api` 代理
6. API 类型与查询封装 → BoardPage 与 Column → ItemCard 与“⋯”菜单 → 搜索与筛选
7. ItemSheet 与 DynamicField，由字段定义生成 zod schema，接入后端错误映射
8. `web/embed.go` 与静态文件回退，`make build` 产出单一二进制

**编码约定**

- handler 只做解码、调用 service、编码；SQL 只出现在 repo 和 `queries/` 中
- 所有写操作走事务；错误用 `fmt.Errorf("...: %w", err)` 包装，在 `httpx` 中统一映射为 HTTP 状态
- JSON 字段 camelCase，`attrs` 内部的 key 保持 snake\_case
- 时间统一用 UTC 的 RFC 3339 字符串
- 前端不按 kind 写分支逻辑；需要区分时一律读字段定义
- 不引入本文未列出的重量级依赖；确需引入时先说明理由

**测试要求**

- `kind/validate.go`：表驱动测试覆盖每种字段类型的合法与非法值、未知 key、必填缺失
- repo 和 service：每个测试使用 `t.TempDir()` 下的临时 SQLite 文件，跑真实迁移
- `PUT /items/{id}/relations`：覆盖新增、删除、属性更新、属性保持、非法关系类型、方向规范化
- handler：用 `httptest` 覆盖每个端点的成功路径和主要错误码
- 前端：用 Vitest 和 Testing Library 覆盖 DynamicField 的各类型渲染、RelationPicker 的添加与移除

**示例数据**（`make seed`）

Harness：Claude Code、Cursor、OpenCode；Model：Claude Opus 5.5、Claude Sonnet 5.5，再加一个其他出品方的模型；Provider：Anthropic、OpenRouter、AWS Bedrock。在它们之间建立若干关联，覆盖三种关系类型。示例数据中的规格数字仅用于界面开发，不代表真实参数。
