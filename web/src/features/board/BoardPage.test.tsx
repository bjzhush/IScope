// Page-level flows against an in-memory fake of the /api/v1 endpoints.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { toast } from 'sonner'
import type { Item, Relation } from '@/api/types'
import kinds from '@/test/kinds.json'
import { media } from '@/test/setup'
import { BoardPage } from './BoardPage'

let items: Item[]
let relations: Relation[]
let failNextPut = false
let requests: { method: string; path: string; body?: unknown }[]
let seq = 0

function mk(over: Partial<Item> & Pick<Item, 'kind' | 'name'>): Item {
  return {
    id: `id${++seq}`, slug: over.name.toLowerCase().replace(/\W+/g, '-'), status: 'watching',
    summary: '', tags: [], links: [], notes: '', rating: null, pinned: false, sortOrder: seq,
    attrs: {}, createdAt: '', updatedAt: '', ...over,
  }
}

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })

const fail = (status: number, code: string, fields: Record<string, string>) =>
  json(status, { error: { code, message: '请检查标出的字段', fields } })

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), 'http://localhost')
  const method = init?.method ?? 'GET'
  const body = init?.body ? JSON.parse(String(init.body)) : undefined
  requests.push({ method, path: url.pathname + url.search, body })
  const id = url.pathname.match(/^\/api\/v1\/items\/([^/]+)$/)?.[1]
  const found = items.find((i) => i.id === id)

  if (url.pathname === '/api/v1/kinds') return json(200, kinds)
  if (url.pathname === '/api/v1/boards/ai-stack') {
    const all = url.searchParams.get('includeArchived') === 'true'
    const visible = items.filter((i) => all || i.status !== 'archived')
    const ids = new Set(visible.map((i) => i.id))
    return json(200, {
      board: kinds.boards[0],
      items: visible,
      relations: relations.filter((r) => ids.has(r.fromId) && ids.has(r.toId)),
    })
  }
  if (url.pathname === '/api/v1/items' && method === 'POST') {
    if (items.some((i) => i.kind === body.kind && i.name.toLowerCase() === body.name.toLowerCase()))
      return fail(409, 'conflict', { name: '同类下已存在同名条目' })
    if (body.attrs?.vendor === 'Rejected') return fail(400, 'validation_failed', { 'attrs.vendor': '服务器拒绝了这个值' })
    const it = mk(body)
    items.push(it)
    return json(201, it)
  }
  const moveId = url.pathname.match(/^\/api\/v1\/items\/([^/]+)\/move$/)?.[1]
  if (moveId && method === 'POST') {
    const it = items.find((i) => i.id === moveId)!
    const before = items.find((i) => i.id === body.beforeId)
    const after = items.find((i) => i.id === body.afterId)
    it.sortOrder = before && after ? (before.sortOrder + after.sortOrder) / 2 : before ? before.sortOrder + 1 : after!.sortOrder - 1
    return json(200, it)
  }
  if (url.pathname === '/api/v1/import' && method === 'POST') {
    return json(200, { items: { created: body.items.length, updated: 0, unchanged: 0 }, relations: { created: 0, updated: 0, unchanged: 0 } })
  }
  if (url.pathname === '/api/v1/catalog') {
    const q = (url.searchParams.get('q') ?? '').toLowerCase()
    // A model page link resolves to the one entry its path names.
    const linked = q.startsWith('http') ? catalogEntries.find((e) => q.endsWith(`/${e.modelId}`)) : undefined
    const entries = linked ? [linked] : catalogEntries.filter((e) => e.name.toLowerCase().includes(q))
    return json(200, {
      resolved: !!linked,
      providers: [
        { id: 'anthropic', name: 'Anthropic', count: 2 },
        { id: 'openrouter', name: 'OpenRouter', count: 9 },
        { id: 'lambda', name: 'Lambda Inference Tech', count: 3 }, // a…n…t…h in order: a fuzzy match, not a substring
      ],
      entries,
      total: entries.length,
      modelKind: 'model',
      linkKind: 'provider',
    })
  }
  if (url.pathname === '/api/v1/catalog/update' && method === 'POST') {
    const target = items.find((i) => i.id === body.targetId)!
    const e = catalogEntries.find((x) => x.modelId === body.modelId)!
    if (!body.dryRun) target.name = e.name
    return json(200, {
      item: { ...target, name: e.name },
      snapshotId: body.dryRun ? undefined : 'S9',
      dryRun: body.dryRun,
      changes: [
        { key: 'name', old: 'Claude Sonnet 5.5', new: e.name },
        { key: 'context_window', old: 1000000, new: 2000000 },
      ],
      prices: [
        { providerId: 'p1', providerName: 'OpenRouter', source: 'OpenRouter', status: 'updated',
          old: { input_price: 3, output_price: 15 }, new: { input_price: 4.4, output_price: 22 } },
        { providerId: 'p2', providerName: 'Some Cloud', source: '', status: 'not_found', old: { input_price: 9 }, new: { input_price: 9 } },
      ],
    })
  }
  if (url.pathname === '/api/v1/catalog/import' && method === 'POST') {
    const e = catalogEntries.find((x) => x.modelId === body.modelId)!
    const it = mk({ kind: 'model', name: e.name, attrs: { vendor: e.vendor } })
    items.push(it)
    return json(201, { item: it, created: true })
  }
  if (id && !found) return fail(404, 'not_found', {})
  if (id && method === 'GET') return json(200, { ...found, relations: relationsOf(found!.id) })
  const relId = url.pathname.match(/^\/api\/v1\/items\/([^/]+)\/relations$/)?.[1]
  if (relId && method === 'PUT') {
    if (failNextPut) {
      failNextPut = false
      return json(500, { error: { code: 'internal', message: '服务器内部错误' } })
    }
    const self = items.find((i) => i.id === relId)!
    const keep = new Set<string>()
    for (const l of body.links as { targetId: string; attrs?: Record<string, never> }[]) {
      const target = items.find((i) => i.id === l.targetId)!
      const rt = kinds.relationTypes.find(
        (t) => (t.fromKind === self.kind && t.toKind === target.kind) || (t.toKind === self.kind && t.fromKind === target.kind),
      )
      if (!rt) return fail(400, 'bad_request', {})
      const [fromId, toId] = rt.fromKind === self.kind ? [self.id, target.id] : [target.id, self.id]
      let r = relations.find((x) => x.fromId === fromId && x.toId === toId)
      if (!r) relations.push((r = { id: `r${++seq}`, type: rt.key, fromId, toId, attrs: {}, createdAt: '', updatedAt: '' }))
      if (l.attrs) r.attrs = l.attrs
      keep.add(r.id)
    }
    relations = relations.filter((r) => keep.has(r.id) || (r.fromId !== relId && r.toId !== relId))
    return json(200, relationsOf(relId))
  }
  if (id && method === 'PATCH') {
    const { attrs, ...rest } = body
    Object.assign(found!, rest)
    for (const [k, v] of Object.entries(attrs ?? {})) {
      if (v === null) delete found!.attrs[k]
      else found!.attrs[k] = v as never
    }
    return json(200, found)
  }
  if (id && method === 'DELETE') {
    items = items.filter((i) => i.id !== id)
    return json(204)
  }
  return fail(404, 'not_found', {})
}

function relationsOf(id: string) {
  return relations.filter((r) => r.fromId === id || r.toId === id)
}

const catalogEntries = [
  { providerId: 'anthropic', providerName: 'Anthropic', modelId: 'claude-opus-5-5', officialId: 'claude-opus-5-5',
    name: 'Claude Opus 5.5', vendor: 'Anthropic', context: 1000000, modalities: ['text'], inputPrice: 5, outputPrice: 25 },
  { providerId: 'anthropic', providerName: 'Anthropic', modelId: 'claude-haiku-5-5', officialId: 'claude-haiku-5-5',
    name: 'Claude Haiku 5.5', vendor: 'Anthropic', context: 200000, modalities: ['text'] },
  { providerId: 'openrouter', providerName: 'OpenRouter', modelId: 'anthropic/claude-sonnet-5-6', officialId: 'claude-sonnet-5-6',
    name: 'Claude Sonnet 5.6', vendor: 'Anthropic', context: 2000000, modalities: ['text'], inputPrice: 4.4, outputPrice: 22 },
]

let location = ''
function LocationProbe() {
  const loc = useLocation()
  location = loc.pathname + loc.search
  return null
}

function renderPage(entry = '/boards/ai-stack') {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/boards/:key" element={<><BoardPage /><LocationProbe /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const column = (label: string) => screen.getByRole('region', { name: label })
const card = (name: string) => screen.getByRole('button', { name })
const sheet = () => screen.getByRole('dialog')

beforeEach(() => {
  seq = 0
  requests = []
  items = [
    mk({ kind: 'harness', name: 'Claude Code', status: 'in_use', pinned: true, summary: '终端 agent',
      tags: ['agent', 'coding', 'cli', 'daily'] }),
    mk({ kind: 'harness', name: 'OpenCode' }),
    mk({ kind: 'harness', name: 'Aider', status: 'archived' }),
    mk({ kind: 'model', name: 'Claude Sonnet 5.5', status: 'in_use',
      attrs: { vendor: 'Anthropic', context_window: 1000000 } }),
    mk({ kind: 'provider', name: 'OpenRouter', attrs: { provider_type: 'aggregator', api_compat: ['openai', 'anthropic'] } }),
    // Only links, so the details button exists because of them.
    mk({ kind: 'provider', name: 'Anthropic API',
      links: [{ label: '控制台', url: 'https://console.anthropic.com' }, { label: '', url: 'https://docs.anthropic.com' }] }),
  ]
  const id = (name: string) => items.find((i) => i.name === name)!.id
  relations = [
    { id: 'r1', type: 'uses', fromId: id('Claude Code'), toId: id('Claude Sonnet 5.5'), attrs: { is_default: true }, createdAt: '', updatedAt: '' },
    { id: 'r2', type: 'offered_by', fromId: id('Claude Sonnet 5.5'), toId: id('OpenRouter'), attrs: { input_price: 3, output_price: 15 }, createdAt: '', updatedAt: '' },
  ]
  failNextPut = false
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
})

afterEach(() => {
  vi.unstubAllGlobals()
  media.matches = false
})

test('renders columns in board order with cards built from field definitions', async () => {
  renderPage()
  await screen.findByText('AI 技术栈')
  const regions = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))
  expect(regions).toEqual(['Harness', 'Model', 'Provider'])

  const cc = within(card('Claude Code'))
  // jsdom has no layout, so every tag shows; TagStrip.test covers the cut.
  expect(cc.getAllByText('daily')).toHaveLength(2) // visible + measuring copy
  // Summary and fields live in the details popover, not on the card.
  expect(cc.queryByText('终端 agent')).toBeNull()
  expect(cc.getByRole('button', { name: 'Claude Code 详情' })).toBeInTheDocument()

  // Pinned + in_use first.
  const harness = within(column('Harness')).getAllByRole('button', { name: /^(Claude Code|OpenCode)$/ })
  expect(harness.map((c) => c.getAttribute('aria-label'))).toEqual(['Claude Code', 'OpenCode'])
  // Archived hidden by default.
  expect(screen.queryByRole('button', { name: 'Aider' })).toBeNull()
})

test('status toggles: multi-select with counts, at least one stays on, URL survives a reload', async () => {
  const user = userEvent.setup()
  const { unmount } = renderPage()
  await screen.findByText('AI 技术栈')
  const toggle = (label: string) => screen.getByRole('button', { name: new RegExp(`^${label}\\s*\\d+$`) })
  const pressed = () =>
    ['使用中', '关注中', '已弃用'].filter((l) => toggle(l).getAttribute('aria-pressed') === 'true')

  // Default: in use + watching; counts include the hidden archived item.
  expect(pressed()).toEqual(['使用中', '关注中'])
  // Pressed toggles show a check; an unpressed one keeps its space with a hidden one.
  const checked = (l: string) => !toggle(l).querySelector('svg')!.classList.contains('invisible')
  expect(['使用中', '关注中', '已弃用'].map(checked)).toEqual([true, true, false])
  // All toggles share one style; only the dot is status-colored.
  expect(new Set([toggle('使用中'), toggle('已弃用')].map((b) => b.className)).size).toBe(1)
  expect([toggle('使用中'), toggle('关注中'), toggle('已弃用')].map((b) => b.textContent)).toEqual([
    '使用中2', '关注中3', '已弃用1',
  ])
  expect(screen.queryByRole('button', { name: 'Aider' })).toBeNull()
  expect(screen.queryByRole('switch')).toBeNull()

  // Counts follow the search.
  await user.type(screen.getByLabelText('搜索'), '聚合') // matches a select option label
  expect(screen.queryByRole('button', { name: 'Claude Code' })).toBeNull()
  expect(card('OpenRouter')).toBeInTheDocument()
  expect(within(column('Harness')).getByText('没有符合筛选条件的 Harness')).toBeInTheDocument()
  expect(toggle('使用中').textContent).toBe('使用中0')
  expect(toggle('关注中').textContent).toBe('关注中1')
  await user.clear(screen.getByLabelText('搜索'))

  await user.click(toggle('关注中'))
  expect(screen.queryByRole('button', { name: 'OpenCode' })).toBeNull()
  expect(card('Claude Code')).toBeInTheDocument()
  expect(location).toContain('status=in_use')

  await user.click(toggle('已弃用'))
  expect(card('Aider').className).toContain('opacity-60')
  expect(location).toContain('status=in_use%2Carchived')

  // Down to archived only; the last one cannot be switched off.
  await user.click(toggle('使用中'))
  expect(screen.queryByRole('button', { name: 'Claude Code' })).toBeNull()
  await user.click(toggle('已弃用'))
  expect(pressed()).toEqual(['已弃用'])
  expect(card('Aider')).toBeInTheDocument()

  // "Reload" with the same URL: the selection comes back.
  const saved = location
  unmount()
  renderPage(saved)
  await screen.findByRole('button', { name: 'Aider' })
  expect(pressed()).toEqual(['已弃用'])
  expect(screen.queryByRole('button', { name: 'Claude Code' })).toBeNull()

  // Back to the default: the param leaves the URL.
  await user.click(toggle('使用中'))
  await user.click(toggle('关注中'))
  await user.click(toggle('已弃用'))
  expect(pressed()).toEqual(['使用中', '关注中'])
  expect(location).not.toContain('status=')
  expect(requests.every((r) => !r.path.startsWith('/api/v1/boards/') || r.path.endsWith('includeArchived=true'))).toBe(true)
})

test('older ?archived=1 links show archived items alongside the default', async () => {
  renderPage('/boards/ai-stack?archived=1')
  expect(await screen.findByRole('button', { name: 'Aider' })).toBeInTheDocument()
  expect(card('Claude Code')).toBeInTheDocument()
  expect(card('OpenCode')).toBeInTheDocument()
})

test('hidden archived items never bridge focus links, and cannot be focused', async () => {
  // OpenCode → Old Model (archived) → Anthropic API.
  const old = mk({ kind: 'model', name: 'Old Model', status: 'archived', attrs: { vendor: 'X' } })
  items.push(old)
  const id = (n: string) => items.find((i) => i.name === n)!.id
  relations.push(
    { id: 'r3', type: 'uses', fromId: id('OpenCode'), toId: old.id, attrs: {}, createdAt: '', updatedAt: '' },
    { id: 'r4', type: 'offered_by', fromId: old.id, toId: id('Anthropic API'), attrs: {}, createdAt: '', updatedAt: '' },
  )
  const { unmount } = renderPage(`/boards/ai-stack?focus=${id('OpenCode')}`)
  expect(await screen.findByRole('status', { name: '聚焦模式' })).toHaveTextContent('OpenCode')
  expect(within(column('Provider')).getByText('没有与 OpenCode 关联的 Provider')).toBeInTheDocument()
  unmount()

  // With archived shown, the chain is visible again.
  const { unmount: unmount2 } = renderPage(`/boards/ai-stack?status=in_use,watching,archived&focus=${id('OpenCode')}`)
  await screen.findByRole('status', { name: '聚焦模式' })
  expect(card('Anthropic API').dataset.emphasis).toBe('indirect')
  unmount2()

  // Focusing a hidden item does nothing.
  renderPage(`/boards/ai-stack?focus=${old.id}`)
  await screen.findByText('AI 技术栈')
  expect(screen.queryByRole('status', { name: '聚焦模式' })).toBeNull()
})

test('add drawer renders the kind-specific fields from definitions', async () => {
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('AI 技术栈')

  await user.click(screen.getByRole('button', { name: '新增 Harness' }))
  expect(location).toContain('new=harness')
  expect(within(sheet()).getByText('新增 Harness')).toBeInTheDocument()
  // Harness has no kind fields: the section is hidden and dropped fields are gone.
  expect(within(sheet()).queryByText('Harness 字段')).toBeNull()
  for (const gone of ['形态', '出品方', '开源', '计费方式', '配置位置']) expect(within(sheet()).queryByText(gone)).toBeNull()
  expect(within(sheet()).queryByLabelText(/上下文窗口/)).toBeNull()
  // Two-column layout: short fields take one cell, the summary spans both, and
  // the two relation groups sit side by side.
  const cell = (label: string | RegExp) => within(sheet()).getByLabelText(label).closest('div.grid')!
  expect(cell('一句话描述').className).toContain('sm:col-span-2')
  expect(cell(/^名称/).className).not.toContain('col-span')
  const groups = ['关联的 Model', '关联的 Provider'].map((name) => within(sheet()).getByRole('group', { name }))
  expect(groups[0].parentElement).toBe(groups[1].parentElement)
  expect(groups[0].parentElement!.className).toContain('sm:grid-cols-2')
  await user.click(within(sheet()).getByRole('button', { name: '取消' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  await user.click(screen.getByRole('button', { name: '新增 Provider' }))
  expect(within(sheet()).getByLabelText('Base URL')).toHaveAttribute('type', 'url')
  expect(within(sheet()).getByRole('group', { name: '兼容协议' })).toBeInTheDocument()
  expect(within(sheet()).getByText('Provider 字段')).toBeInTheDocument()
  for (const half of ['Base URL', '区域']) expect(cell(half).className).not.toContain('col-span')
})

test('create model: local validation, server field errors, 409, then success', async () => {
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('AI 技术栈')
  await user.click(screen.getByRole('button', { name: '新增 Model' }))
  const s = within(sheet())

  // Local zod validation blocks the request.
  await user.type(s.getByLabelText(/名称/), 'Claude Opus 5.5')
  await user.type(s.getByLabelText('上下文窗口'), '1.5')
  await user.click(s.getByRole('button', { name: '保存' }))
  expect(await s.findByText('必须是整数')).toBeInTheDocument()
  expect(s.getByText('必填')).toBeInTheDocument() // 出品方
  expect(requests.filter((r) => r.method === 'POST')).toHaveLength(0)

  // Server-side field error is shown under the matching input.
  await user.clear(s.getByLabelText('上下文窗口'))
  await user.type(s.getByLabelText('上下文窗口'), '200000')
  await user.type(s.getByLabelText(/出品方/), 'Rejected')
  await user.click(s.getByRole('button', { name: '保存' }))
  expect(await s.findByText('服务器拒绝了这个值')).toBeInTheDocument()

  // 409 lands under 名称.
  await user.clear(s.getByLabelText(/出品方/))
  await user.type(s.getByLabelText(/出品方/), 'Anthropic')
  await user.clear(s.getByLabelText(/名称/))
  await user.type(s.getByLabelText(/名称/), 'claude sonnet 5.5')
  await user.click(s.getByRole('button', { name: '保存' }))
  expect(await s.findByText('同类下已存在同名条目')).toBeInTheDocument()

  await user.clear(s.getByLabelText(/名称/))
  await user.type(s.getByLabelText(/名称/), 'Claude Opus 5.5')
  await user.click(s.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const post = requests.filter((r) => r.method === 'POST').at(-1)!
  expect(post.body).toMatchObject({ kind: 'model', name: 'Claude Opus 5.5', attrs: { vendor: 'Anthropic', context_window: 200000 } })
  expect(await screen.findByRole('button', { name: 'Claude Opus 5.5' })).toBeInTheDocument()
})

test('edit sends only changed fields and clears removed attrs', async () => {
  const user = userEvent.setup()
  renderPage()
  await user.click(await screen.findByRole('button', { name: 'Claude Sonnet 5.5' }))
  expect(location).toContain('item=')
  const s = within(sheet())
  const ctx = await s.findByLabelText('上下文窗口')
  expect(ctx).toHaveValue(1000000)
  await user.clear(ctx)
  await user.type(s.getByLabelText('一句话描述'), '主力')
  await user.click(s.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const patch = requests.find((r) => r.method === 'PATCH')!
  expect(patch.body).toEqual({ summary: '主力', attrs: { context_window: null } })
})

test('closing a dirty drawer asks for confirmation', async () => {
  const user = userEvent.setup()
  renderPage()
  await user.click(await screen.findByRole('button', { name: 'OpenCode' }))
  await user.type(await within(sheet()).findByLabelText('一句话描述'), 'x')
  await user.click(within(sheet()).getByRole('button', { name: '取消' }))
  expect(await screen.findByText('放弃未保存的修改？')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '放弃修改' }))
  await waitFor(() => expect(screen.queryAllByRole('dialog')).toHaveLength(0))
  expect(requests.some((r) => r.method === 'PATCH')).toBe(false)
})

test('card menu groups items with separators', async () => {
  const user = userEvent.setup()
  renderPage('/boards/ai-stack?archived=1')
  await screen.findByRole('button', { name: 'Aider' })
  // Menu entries and separators in order, separators as '|'.
  const layout = async (name: string) => {
    await user.click(screen.getByRole('button', { name: `${name} 菜单` }))
    const menu = await screen.findByRole('menu')
    const out = [...menu.querySelectorAll('[role=menuitem],[role=separator]')].map((el) =>
      el.getAttribute('role') === 'separator' ? '|' : el.textContent,
    )
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    return out
  }
  expect(await layout('Claude Code')).toEqual(
    ['取消置顶', '|', '设为关注中', '设为弃用', '|', '编辑', '|', '编辑关联…', '聚焦关联'])
  expect(await layout('OpenCode')).toEqual(
    ['置顶', '|', '设为使用中', '设为弃用', '|', '编辑', '|', '编辑关联…', '聚焦关联'])
  expect(await layout('Aider')).toEqual(['设为使用中', '设为关注中', '|', '删除'])
})

test('card menu: archive, set back to watching, pin and delete with confirmation', async () => {
  const user = userEvent.setup()
  renderPage('/boards/ai-stack?archived=1')
  await screen.findByRole('button', { name: 'Aider' })

  await user.click(screen.getByRole('button', { name: 'OpenCode 菜单' }))
  await user.click(await screen.findByRole('menuitem', { name: '置顶' }))
  await waitFor(() => expect(within(card('OpenCode')).getByLabelText('已置顶')).toBeInTheDocument())

  await user.click(screen.getByRole('button', { name: 'OpenCode 菜单' }))
  await user.click(await screen.findByRole('menuitem', { name: '设为弃用' }))
  await waitFor(() => expect(within(card('OpenCode')).getByText('已弃用')).toBeInTheDocument())

  await user.click(screen.getByRole('button', { name: 'Aider 菜单' }))
  await user.click(await screen.findByRole('menuitem', { name: '设为关注中' }))
  await waitFor(() => expect(within(card('Aider')).getByText('关注中')).toBeInTheDocument())

  await user.click(screen.getByRole('button', { name: 'OpenCode 菜单' }))
  await user.click(await screen.findByRole('menuitem', { name: '删除' }))
  expect(await screen.findByText('删除“OpenCode”？')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '删除' }))
  await waitFor(() => expect(screen.queryByRole('button', { name: 'OpenCode' })).toBeNull())

  const writes = requests.filter((r) => r.method !== 'GET').map((r) => [r.method, r.body])
  expect(writes).toEqual([
    ['PATCH', { pinned: true }],
    ['PATCH', { status: 'archived' }],
    ['PATCH', { status: 'watching' }],
    ['DELETE', undefined],
  ])
})

test('details popover opens on hovering its button and shows summary and tags', async () => {
  // While hover-open, Base UI sets pointer-events: none on the body and auto on
  // the popup; jsdom does not inherit computed styles, so skip user-event's check.
  const user = userEvent.setup({ pointerEventsCheck: 0 })
  renderPage()
  await screen.findByText('AI 技术栈')

  // Hovering the card itself shows nothing.
  await user.hover(card('Claude Code'))
  await new Promise((r) => setTimeout(r, 300))
  expect(screen.queryByText('终端 agent')).toBeNull()

  await user.hover(screen.getByRole('button', { name: 'Claude Code 详情' }))
  const popup = await screen.findByRole('dialog')
  expect(within(popup).getByText('终端 agent')).toBeInTheDocument()
  expect(within(popup).getByText('coding')).toBeInTheDocument() // all tags

  await user.unhover(screen.getByRole('button', { name: 'Claude Code 详情' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  // A click pins it open; clicks on the button or inside the popup never open
  // the drawer.
  const noDrawer = async () => {
    await new Promise((r) => setTimeout(r, 100))
    expect(screen.queryByText('编辑 Claude Code')).toBeNull()
  }
  await user.click(screen.getByRole('button', { name: 'Claude Code 详情' }))
  await noDrawer()
  await user.click(within(await screen.findByRole('dialog')).getByText('终端 agent'))
  await noDrawer()
  expect(screen.getByRole('dialog')).toBeInTheDocument()
})

test('details popover formats each field type', async () => {
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('AI 技术栈')
  const open = async (name: string) => {
    await user.click(screen.getByRole('button', { name: `${name} 详情` }))
    const popup = await screen.findByRole('dialog')
    const text = popup.textContent
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    return text
  }
  // Nothing to show: no summary, tags or card fields.
  expect(screen.queryByRole('button', { name: 'OpenCode 详情' })).toBeNull()
  expect(await open('Claude Sonnet 5.5')).toBe('出品方Anthropic上下文窗口1,000,000 tokens')
  expect(await open('OpenRouter')).toBe('类型聚合兼容协议openai / anthropic')
})

test('details popover lists links that open in a new tab', async () => {
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('AI 技术栈')
  await user.click(screen.getByRole('button', { name: 'Anthropic API 详情' }))
  const popup = await screen.findByRole('dialog')
  const console_ = within(popup).getByRole('link', { name: '控制台' })
  expect(console_).toHaveAttribute('href', 'https://console.anthropic.com')
  expect(console_).toHaveAttribute('target', '_blank')
  // A link without a label shows its URL.
  expect(within(popup).getByRole('link', { name: 'https://docs.anthropic.com' })).toBeInTheDocument()
  // Following a link never opens the drawer.
  console_.addEventListener('click', (e) => e.preventDefault())
  await user.click(console_)
  await new Promise((r) => setTimeout(r, 100))
  expect(screen.queryByText('编辑 Anthropic API')).toBeNull()
})

test('hovering a card highlights direct neighbours and dims the rest', async () => {
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('AI 技术栈')
  const emphasis = () =>
    Object.fromEntries(
      ['Claude Code', 'OpenCode', 'Claude Sonnet 5.5', 'OpenRouter', 'Anthropic API'].map((n) => [n, card(n).dataset.emphasis ?? '']),
    )

  await user.hover(card('Claude Code'))
  // Only one hop: Sonnet is linked, OpenRouter (Sonnet's provider) is not.
  await waitFor(() =>
    expect(emphasis()).toEqual({
      'Claude Code': 'focus', OpenCode: 'dim', 'Claude Sonnet 5.5': 'neighbor', OpenRouter: 'dim', 'Anthropic API': 'dim',
    }),
  )
  expect(card('OpenCode').className).toContain('opacity-30')

  await user.hover(card('Claude Sonnet 5.5'))
  await waitFor(() =>
    expect(emphasis()).toMatchObject({ 'Claude Code': 'neighbor', OpenRouter: 'neighbor', 'Anthropic API': 'dim' }),
  )

  await user.unhover(card('Claude Sonnet 5.5'))
  await waitFor(() => expect(Object.values(emphasis()).every((e) => e === '')).toBe(true))
})

test('sweeping across cards only highlights where the pointer rests', async () => {
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('AI 技术栈')
  const focused = () => screen.queryAllByRole('button').find((el) => el.dataset.emphasis === 'focus')?.getAttribute('aria-label')

  // Passing over Claude Code on the way to OpenCode highlights nothing yet.
  await user.hover(card('Claude Code'))
  await user.hover(card('OpenCode'))
  expect(focused()).toBeUndefined()
  await waitFor(() => expect(focused()).toBe('OpenCode'))

  // Moving on keeps the current highlight until the next one settles.
  await user.hover(card('Claude Sonnet 5.5'))
  expect(focused()).toBe('OpenCode')
  await waitFor(() => expect(focused()).toBe('Claude Sonnet 5.5'))
})

test('hovering counts neighbours scrolled out of view at the column edges', async () => {
  // Fake layout: every scroll area spans 0–100px; cards sit where `tops` says.
  const tops: Record<string, number> = { 'Claude Code': -100, 'Claude Sonnet 5.5': 300, OpenRouter: 50 }
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const name = this.getAttribute('aria-label') ?? ''
    if (this.hasAttribute('data-item-id')) {
      const top = tops[name] ?? 0
      return { top, bottom: top + 40, height: 40 } as DOMRect
    }
    if (this.classList.contains('overflow-y-auto')) return { top: 0, bottom: 100, height: 100 } as DOMRect
    return { top: 0, bottom: 0, height: 0 } as DOMRect
  })
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('AI 技术栈')

  await user.hover(card('Claude Code'))
  expect(await within(column('Model')).findByText('下方还有 1 个关联')).toBeInTheDocument()
  expect(within(column('Harness')).queryByText(/还有/)).toBeNull() // the hovered card's own column

  await user.hover(card('Claude Sonnet 5.5'))
  expect(await within(column('Harness')).findByText('上方还有 1 个关联')).toBeInTheDocument()
  expect(within(column('Provider')).queryByText(/还有/)).toBeNull() // OpenRouter is in view
  expect(within(column('Model')).queryByText(/还有/)).toBeNull()

  await user.unhover(card('Claude Sonnet 5.5'))
  await waitFor(() => expect(screen.queryByText(/还有 \d+ 个关联/)).toBeNull())
  vi.restoreAllMocks()
})

test('focus mode: other columns keep direct and second-hop items; Esc closes a drawer first', async () => {
  const user = userEvent.setup()
  renderPage()
  await user.click(await screen.findByRole('button', { name: 'Claude Code 菜单' }))
  await user.click(await screen.findByRole('menuitem', { name: '聚焦关联' }))

  expect(screen.getByRole('status', { name: '聚焦模式' })).toHaveTextContent('Claude Code')
  expect(location).toContain(`focus=${items[0].id}`)
  const names = (label: string) =>
    Array.from(column(label).querySelectorAll<HTMLElement>('article')).map((el) => [el.getAttribute('aria-label'), el.dataset.emphasis])
  // Own column stays complete; Sonnet is direct; OpenRouter offers Sonnet; Anthropic API is unrelated.
  expect(names('Harness')).toEqual([['Claude Code', 'selected'], ['OpenCode', 'dim']])
  expect(names('Model')).toEqual([['Claude Sonnet 5.5', 'neighbor']])
  expect(names('Provider')).toEqual([['OpenRouter', 'indirect']])

  // Hover linking is off while focused.
  await user.hover(card('OpenCode'))
  expect(card('Claude Sonnet 5.5').dataset.emphasis).toBe('neighbor')

  // Esc closes the drawer but keeps focus mode; a second Esc leaves it.
  await user.click(card('Claude Sonnet 5.5'))
  await screen.findByText('编辑 Claude Sonnet 5.5')
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByText('编辑 Claude Sonnet 5.5')).toBeNull())
  expect(screen.getByRole('status', { name: '聚焦模式' })).toBeInTheDocument()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('status', { name: '聚焦模式' })).toBeNull()
  expect(location).not.toContain('focus=')
  expect(card('Anthropic API')).toBeInTheDocument()
})

test('focus mode survives a reload and explains empty columns', async () => {
  const id = items.find((i) => i.name === 'Anthropic API')!.id
  renderPage(`/boards/ai-stack?focus=${id}`)
  expect(await screen.findByRole('status', { name: '聚焦模式' })).toHaveTextContent('Anthropic API')
  expect(within(column('Model')).getByText('没有与 Anthropic API 关联的 Model')).toBeInTheDocument()
  expect(within(column('Harness')).getByText('没有与 Anthropic API 关联的 Harness')).toBeInTheDocument()
  expect(card('OpenRouter').dataset.emphasis).toBe('dim')
})

test('drawer shows relations with summaries; adding one from the provider side shows on the model', async () => {
  const user = userEvent.setup()
  renderPage()
  await user.click(await screen.findByRole('button', { name: 'Claude Sonnet 5.5' }))
  const s = within(sheet())
  const harnessGroup = within(await s.findByRole('group', { name: '关联的 Harness' }))
  expect(harnessGroup.getByText('Claude Code')).toBeInTheDocument()
  expect(harnessGroup.getByText('默认')).toBeInTheDocument()
  const providerGroup = within(s.getByRole('group', { name: '关联的 Provider' }))
  expect(providerGroup.getByText('$3 / $15')).toBeInTheDocument()
  // A model links to harnesses and providers, never to other models.
  expect(s.queryByRole('group', { name: '关联的 Model' })).toBeNull()
  await user.click(s.getByRole('button', { name: '取消' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  // Link Sonnet from the Anthropic API side.
  await user.click(card('Anthropic API'))
  const p = within(sheet())
  const models = within(await p.findByRole('group', { name: '关联的 Model' }))
  await user.click(models.getByRole('button', { name: /添加 Model/ }))
  await user.click(await screen.findByRole('option', { name: 'Claude Sonnet 5.5' }))
  await user.click(p.getByRole('button', { name: /^Claude Sonnet 5.5/ }))
  await user.type(await screen.findByLabelText('输入价格'), '3')
  await user.click(p.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  const put = requests.find((r) => r.method === 'PUT')!
  expect(put.body).toEqual({
    links: [{ targetId: items.find((i) => i.name === 'Claude Sonnet 5.5')!.id, attrs: { input_price: 3 } }],
  })
  expect(requests.some((r) => r.method === 'PATCH')).toBe(false) // item fields unchanged

  // Open the model again: the new relation shows up from the other end.
  await user.click(card('Claude Sonnet 5.5'))
  const again = within(await within(sheet()).findByRole('group', { name: '关联的 Provider' }))
  expect(again.getByText('Anthropic API')).toBeInTheDocument()
})

test('removing a relation sends the remaining set; untouched relations carry no attrs', async () => {
  const user = userEvent.setup()
  renderPage()
  await user.click(await screen.findByRole('button', { name: 'Claude Sonnet 5.5' }))
  const s = within(sheet())
  await user.click(await s.findByRole('button', { name: '解除与 OpenRouter 的关联' }))
  await user.click(s.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const put = requests.find((r) => r.method === 'PUT')!
  expect(put.body).toEqual({ links: [{ targetId: items.find((i) => i.name === 'Claude Code')!.id }] })
  expect(relations.map((r) => r.id)).toEqual(['r1'])
})

test('relation save failure keeps the drawer open; retry resends only relations', async () => {
  const user = userEvent.setup()
  renderPage()
  await user.click(await screen.findByRole('button', { name: '新增 Harness' }))
  const s = within(sheet())
  await user.type(s.getByLabelText(/名称/), 'Cursor')
  const models = within(s.getByRole('group', { name: '关联的 Model' }))
  await user.click(models.getByRole('button', { name: /添加 Model/ }))
  await user.click(await screen.findByRole('option', { name: 'Claude Sonnet 5.5' }))

  failNextPut = true
  await user.click(s.getByRole('button', { name: '保存' }))
  expect(await s.findByText(/条目已保存，关联保存失败/)).toBeInTheDocument()
  expect(screen.getByRole('dialog')).toBeInTheDocument()

  await user.click(s.getByRole('button', { name: '保存' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  const writes = requests.filter((r) => r.method !== 'GET').map((r) => r.method)
  expect(writes).toEqual(['POST', 'PUT', 'PUT']) // no second POST
  const cursor = items.find((i) => i.name === 'Cursor')!
  expect(relations.some((r) => r.fromId === cursor.id && r.type === 'uses')).toBe(true)
})

test('relation mode: checkboxes on relatable columns, each toggle saves the full set', async () => {
  const user = userEvent.setup()
  renderPage()
  const idOf = (n: string) => items.find((i) => i.name === n)!.id
  await user.click(await screen.findByRole('button', { name: 'Claude Code 菜单' }))
  await user.click(await screen.findByRole('menuitem', { name: '编辑关联…' }))

  expect(screen.getByRole('status', { name: '关联模式' })).toHaveTextContent('Claude Code')
  // Models and providers become checkboxes; the source's own column does not.
  expect(screen.getByRole('checkbox', { name: 'Claude Sonnet 5.5' })).toHaveAttribute('aria-checked', 'true')
  expect(screen.getByRole('checkbox', { name: 'OpenRouter' })).toHaveAttribute('aria-checked', 'false')
  expect(screen.queryByRole('checkbox', { name: 'OpenCode' })).toBeNull()
  expect(screen.getByRole('button', { name: 'OpenCode' }).dataset.emphasis).toBe('dim')
  expect(screen.queryByRole('button', { name: 'OpenCode 菜单' })).toBeNull()

  await user.click(screen.getByRole('checkbox', { name: 'Anthropic API' }))
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Anthropic API' })).toHaveAttribute('aria-checked', 'true'))
  await user.click(screen.getByRole('checkbox', { name: 'Claude Sonnet 5.5' }))
  await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Claude Sonnet 5.5' })).toHaveAttribute('aria-checked', 'false'))

  const puts = requests.filter((r) => r.method === 'PUT').map((r) => r.body)
  expect(puts).toEqual([
    { links: [{ targetId: idOf('Claude Sonnet 5.5') }, { targetId: idOf('Anthropic API') }] },
    { links: [{ targetId: idOf('Anthropic API') }] },
  ])

  // Clicking a non-relatable card does nothing in this mode; Esc leaves it.
  await user.click(screen.getByRole('button', { name: 'OpenCode' }))
  expect(screen.queryByRole('dialog')).toBeNull()
  await user.keyboard('{Escape}')
  expect(screen.queryByRole('status', { name: '关联模式' })).toBeNull()
  expect(screen.queryByRole('checkbox', { name: 'Anthropic API' })).toBeNull()
})

test('narrow screens show one column per tab', async () => {
  media.matches = true
  const user = userEvent.setup()
  renderPage()
  const tabs = await screen.findAllByRole('tab')
  expect(tabs.map((t) => t.textContent)).toEqual(['Harness 2', 'Model 1', 'Provider 2'])
  expect(screen.getByRole('button', { name: 'Claude Code' })).toBeInTheDocument()
  await user.click(screen.getByRole('tab', { name: 'Model 1' }))
  expect(await screen.findByRole('button', { name: 'Claude Sonnet 5.5' })).toBeVisible()
})

test('data menu exports via a download link and imports a chosen file', async () => {
  const user = userEvent.setup()
  renderPage()
  await user.click(await screen.findByRole('button', { name: '数据' }))
  const exportItem = await screen.findByRole('menuitem', { name: '导出 JSON' })
  expect(exportItem.closest('a') ?? exportItem).toHaveAttribute('href', '/api/v1/export')
  await user.keyboard('{Escape}')

  const input = screen.getByLabelText('选择要导入的 JSON 文件')
  const doc = { version: 1, items: [{ kind: 'harness', name: 'X', slug: 'x' }], relations: [] }
  await user.upload(input, new File([JSON.stringify(doc)], 'data.json', { type: 'application/json' }))
  await waitFor(() => expect(requests.some((r) => r.path === '/api/v1/import')).toBe(true))
  expect(requests.find((r) => r.path === '/api/v1/import')!.body).toEqual(doc)

  await user.upload(input, new File(['not json'], 'bad.json', { type: 'application/json' }))
  expect(requests.filter((r) => r.path === '/api/v1/import')).toHaveLength(1)
})

test('models.dev import: search, pick, price goes to the matching provider, drawer opens', async () => {
  const user = userEvent.setup()
  renderPage()
  await user.click(await screen.findByRole('button', { name: '数据' }))
  await user.click(await screen.findByRole('menuitem', { name: '从 models.dev 导入模型…' }))
  const dlg = within(await screen.findByRole('dialog'))
  await user.type(dlg.getByLabelText('搜索模型'), 'opus')
  const option = await dlg.findByRole('option', { name: /Claude Opus 5.5/ })
  await waitFor(() => expect(dlg.queryByRole('option', { name: /Haiku/ })).toBeNull())
  await user.click(option)
  // "Anthropic API" is preselected because its name matches the catalog provider.
  expect(dlg.getByLabelText('同时把价格记录到渠道')).toHaveTextContent('Anthropic API')
  expect(dlg.getByText(/\$5 \/ \$25/, { selector: 'p' })).toBeInTheDocument()
  await user.click(dlg.getByRole('button', { name: '导入' }))

  await waitFor(() => expect(location).toContain('item='))
  const body = requests.find((r) => r.path === '/api/v1/catalog/import')!.body
  expect(body).toEqual({
    providerId: 'anthropic',
    modelId: 'claude-opus-5-5',
    linkTo: items.find((i) => i.name === 'Anthropic API')!.id,
  })
})

test('models.dev import: the provider filter narrows by typed text', async () => {
  const user = userEvent.setup()
  renderPage()
  await user.click(await screen.findByRole('button', { name: '数据' }))
  await user.click(await screen.findByRole('menuitem', { name: '从 models.dev 导入模型…' }))
  const dlg = within(await screen.findByRole('dialog'))
  const trigger = dlg.getByRole('button', { name: '按渠道筛选' })
  await waitFor(() => expect(trigger).toHaveTextContent('全部渠道'))

  await user.click(trigger)
  await user.type(await screen.findByLabelText('搜索渠道'), 'anth')
  // Scoped to the popup: the model list behind it is a listbox of options too.
  const list = () => within(screen.getByLabelText('搜索渠道').closest('[data-slot=command]') as HTMLElement)
  const names = () => list().getAllByRole('option').map((o) => o.textContent)
  await waitFor(() => expect(names()).toEqual(['Anthropic2']))
  await user.click(list().getByRole('option', { name: /Anthropic/ }))

  await waitFor(() => expect(trigger).toHaveTextContent('Anthropic（2）'))
  await waitFor(() => expect(requests.some((r) => r.path.includes('provider=anthropic'))).toBe(true))

  // The id matches too, and 全部渠道 resets the filter.
  await user.click(trigger)
  await user.type(await screen.findByLabelText('搜索渠道'), 'openrouter')
  await waitFor(() => expect(names()).toEqual(['OpenRouter9']))
  await user.clear(screen.getByLabelText('搜索渠道'))
  await user.click(list().getByRole('option', { name: '全部渠道' }))
  await waitFor(() => expect(trigger).toHaveTextContent('全部渠道'))
})

test('the Model column imports from a pasted model page link', async () => {
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('AI 技术栈')
  // Only the kind marked catalogImport gets the button.
  expect(within(column('Harness')).queryByRole('button', { name: /^导入/ })).toBeNull()
  expect(within(column('Provider')).queryByRole('button', { name: /^导入/ })).toBeNull()
  await user.click(within(column('Model')).getByRole('button', { name: '导入 Model' }))

  const dlg = within(await screen.findByRole('dialog', { name: '从 models.dev 导入模型' }))
  const link = 'https://openrouter.ai/anthropic/claude-sonnet-5-6'
  await user.type(dlg.getByLabelText('搜索模型'), link)
  await waitFor(() => expect(dlg.getByRole('option', { name: /Claude Sonnet 5.6/ })).toHaveAttribute('aria-selected', 'true'))
  expect(dlg.getByText('已从链接定位到该模型')).toBeInTheDocument()
  await user.click(dlg.getByRole('button', { name: '导入' }))

  await waitFor(() => expect(requests.some((r) => r.path === '/api/v1/catalog/import')).toBe(true))
  expect(requests.find((r) => r.path === '/api/v1/catalog/import')!.body).toEqual({
    providerId: 'openrouter',
    modelId: 'anthropic/claude-sonnet-5-6',
    linkTo: items.find((i) => i.name === 'OpenRouter')!.id, // guessed by name, as before
    sourceUrl: link,
  })
})

test('从链接更新 previews a dry run and writes only on confirm', async () => {
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('AI 技术栈')
  const menuItems = async (name: string) => {
    await user.click(screen.getByRole('button', { name: `${name} 菜单` }))
    const names = within(await screen.findByRole('menu')).getAllByRole('menuitem').map((m) => m.textContent)
    await user.keyboard('{Escape}')
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull())
    return names
  }
  expect(await menuItems('Claude Code')).not.toContain('从链接更新…')
  expect(await menuItems('OpenRouter')).not.toContain('从链接更新…')

  await user.click(screen.getByRole('button', { name: 'Claude Sonnet 5.5 菜单' }))
  await user.click(await screen.findByRole('menuitem', { name: '从链接更新…' }))
  const dlg = within(await screen.findByRole('dialog', { name: '用新版本更新 Claude Sonnet 5.5' }))
  expect(dlg.queryByLabelText('同时把价格记录到渠道')).toBeNull()
  expect(dlg.getByRole('button', { name: '更新' })).toBeDisabled()

  await user.type(dlg.getByLabelText('搜索模型'), 'https://openrouter.ai/anthropic/claude-sonnet-5-6')
  const preview = within(await dlg.findByRole('region', { name: '更新预览' }))
  expect(preview.getByText('名称')).toBeInTheDocument()
  expect(preview.getByText('上下文窗口').nextElementSibling).toHaveTextContent('1,000,000 tokens → 2,000,000 tokens')
  expect(preview.getByText('匹配 OpenRouter')).toBeInTheDocument()
  expect(preview.getByText('未找到对应渠道，保留旧价格')).toBeInTheDocument()
  const updates = () => requests.filter((r) => r.path === '/api/v1/catalog/update')
  expect(updates().map((r) => (r.body as { dryRun: boolean }).dryRun)).toEqual([true])

  await user.click(dlg.getByRole('button', { name: '更新' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  expect(updates().at(-1)!.body).toEqual({
    targetId: items.find((i) => i.name === 'Claude Sonnet 5.6')!.id,
    providerId: 'openrouter',
    modelId: 'anthropic/claude-sonnet-5-6',
    sourceUrl: 'https://openrouter.ai/anthropic/claude-sonnet-5-6',
    dryRun: false,
  })
  expect(await screen.findByRole('button', { name: 'Claude Sonnet 5.6' })).toBeInTheDocument()
})

test('a drop onto another group snaps back and explains the rule', async () => {
  items.push(mk({ kind: 'harness', name: 'Cursor', sortOrder: 50 }))
  const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const cards = Array.from(document.querySelectorAll('article'))
    const i = cards.indexOf(this.closest('article') as HTMLElement)
    const top = Math.max(i, 0) * 100
    return { x: 0, y: top, top, left: 0, width: 300, height: 80, right: 300, bottom: top + 80, toJSON() {} } as DOMRect
  })
  const info = vi.spyOn(toast, 'info')
  const user = userEvent.setup()
  renderPage()
  const handle = await screen.findByRole('button', { name: '拖动 Cursor' })

  // Cursor → past OpenCode → onto the pinned Claude Code, another group.
  handle.focus()
  await user.keyboard('[Space]')
  await user.keyboard('[ArrowUp]')
  await user.keyboard('[ArrowUp]')
  await user.keyboard('[Space]')

  await waitFor(() => expect(info).toHaveBeenCalledWith('无法移到这里', { description: '只能在置顶状态和状态都相同的卡片之间拖动排序' }))
  expect(requests.some((r) => r.path.endsWith('/move'))).toBe(false)
  // Lone cards take drops but still cannot be dragged.
  expect(screen.queryByRole('button', { name: '拖动 Claude Code' })).toBeNull()
  rect.mockRestore()
  info.mockRestore()
})

test('keyboard drag reorders within a group and saves the new neighbours', async () => {
  items.push(mk({ kind: 'harness', name: 'Cursor', sortOrder: 50 }))
  // jsdom has no layout: stack cards vertically by document order.
  const rect = vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const cards = Array.from(document.querySelectorAll('article'))
    const i = cards.indexOf(this.closest('article') as HTMLElement)
    const top = Math.max(i, 0) * 100
    return { x: 0, y: top, top, left: 0, width: 300, height: 80, right: 300, bottom: top + 80, toJSON() {} } as DOMRect
  })
  const user = userEvent.setup()
  renderPage()
  const handle = await screen.findByRole('button', { name: '拖动 Cursor' })
  // A card alone in its group (pinned Claude Code) has no handle, but keeps
  // its space so names line up with draggable cards.
  expect(screen.queryByRole('button', { name: '拖动 Claude Code' })).toBeNull()
  const lead = (name: string) => card(name).firstElementChild!.firstElementChild!
  expect(lead('Claude Code').getAttribute('data-handle')).toBe('blocked')
  expect(lead('Cursor')).toBe(handle)
  expect(lead('Claude Code').className.match(/-ml-\S+/)?.[0]).toBe(handle.className.match(/-ml-\S+/)?.[0])
  // Its greyed-out handle explains why.
  await user.hover(lead('Claude Code'))
  expect(await screen.findByText(/只能在置顶状态和状态都相同的卡片之间拖动排序，这一组只有这一张卡片/)).toBeInTheDocument()
  await user.unhover(lead('Claude Code'))

  handle.focus()
  await user.keyboard('[Space]')
  await user.keyboard('[ArrowUp]')
  await user.keyboard('[Space]')

  await waitFor(() => expect(requests.some((r) => r.path.endsWith('/move'))).toBe(true))
  const req = requests.find((r) => r.path.endsWith('/move'))!
  expect(req.path).toBe(`/api/v1/items/${items.find((i) => i.name === 'Cursor')!.id}/move`)
  expect(req.body).toEqual({ beforeId: null, afterId: items.find((i) => i.name === 'OpenCode')!.id })
  await waitFor(() => {
    const harness = within(column('Harness')).getAllByRole('button', { name: /^(OpenCode|Cursor)$/ })
    expect(harness.map((c) => c.getAttribute('aria-label'))).toEqual(['Cursor', 'OpenCode'])
  })
  rect.mockRestore()
})
