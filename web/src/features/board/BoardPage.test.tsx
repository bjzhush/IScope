// Page-level flows against an in-memory fake of the /api/v1 endpoints.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
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
    const entries = catalogEntries.filter((e) => e.name.toLowerCase().includes(q))
    return json(200, {
      providers: [{ id: 'anthropic', name: 'Anthropic', count: 2 }],
      entries,
      total: entries.length,
      modelKind: 'model',
      linkKind: 'provider',
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
      tags: ['agent', 'coding', 'cli', 'daily'], attrs: { form: 'cli', open_source: false } }),
    mk({ kind: 'harness', name: 'OpenCode', attrs: { form: 'cli', open_source: true } }),
    mk({ kind: 'harness', name: 'Aider', status: 'archived' }),
    mk({ kind: 'model', name: 'Claude Sonnet 5.5', status: 'in_use',
      attrs: { vendor: 'Anthropic', context_window: 1000000 } }),
    mk({ kind: 'provider', name: 'OpenRouter', attrs: { provider_type: 'aggregator', api_compat: ['openai', 'anthropic'] } }),
    mk({ kind: 'provider', name: 'Anthropic API', attrs: { provider_type: 'official' } }),
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

test('search, status filter and archived toggle update the URL and survive a reload', async () => {
  const user = userEvent.setup()
  const { unmount } = renderPage()
  await screen.findByText('AI 技术栈')

  await user.type(screen.getByLabelText('搜索'), '聚合') // matches a select option label
  expect(screen.queryByRole('button', { name: 'Claude Code' })).toBeNull()
  expect(card('OpenRouter')).toBeInTheDocument()
  expect(within(column('Harness')).getByText('没有符合筛选条件的 Harness')).toBeInTheDocument()
  await user.clear(screen.getByLabelText('搜索'))

  await user.click(screen.getByRole('button', { name: '使用中' }))
  expect(screen.queryByRole('button', { name: 'OpenCode' })).toBeNull()
  expect(card('Claude Code')).toBeInTheDocument()

  await user.click(screen.getByRole('switch'))
  await screen.findByRole('button', { name: 'Aider' }).catch(() => null)
  expect(location).toContain('status=in_use')
  expect(location).toContain('archived=1')

  // "Reload" with the same URL: filters come back.
  const saved = location
  unmount()
  renderPage(saved)
  await screen.findByText('AI 技术栈')
  expect(screen.queryByRole('button', { name: 'OpenCode' })).toBeNull()
  expect(screen.getByRole('switch')).toBeChecked()
  await user.click(screen.getByRole('button', { name: '全部' }))
  const aider = await screen.findByRole('button', { name: 'Aider' })
  expect(aider.className).toContain('opacity-60')
  expect(requests.some((r) => r.path === '/api/v1/boards/ai-stack?includeArchived=true')).toBe(true)
})

test('add drawer renders the kind-specific fields from definitions', async () => {
  const user = userEvent.setup()
  renderPage()
  await screen.findByText('AI 技术栈')

  await user.click(screen.getByRole('button', { name: '新增 Harness' }))
  expect(location).toContain('new=harness')
  expect(within(sheet()).getByText('新增 Harness')).toBeInTheDocument()
  expect(within(sheet()).getByLabelText('形态')).toBeInTheDocument()
  expect(within(sheet()).getByLabelText('配置位置')).toBeInTheDocument()
  expect(within(sheet()).queryByLabelText(/上下文窗口/)).toBeNull()
  await user.click(within(sheet()).getByRole('button', { name: '取消' }))
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  await user.click(screen.getByRole('button', { name: '新增 Provider' }))
  expect(within(sheet()).getByLabelText('Base URL')).toHaveAttribute('type', 'url')
  expect(within(sheet()).getByRole('group', { name: '兼容协议' })).toBeInTheDocument()
  expect(within(sheet()).queryByLabelText('形态')).toBeNull()
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

test('card menu: archive, restore, pin and delete with confirmation', async () => {
  const user = userEvent.setup()
  renderPage('/boards/ai-stack?archived=1')
  await screen.findByRole('button', { name: 'Aider' })

  await user.click(screen.getByRole('button', { name: 'OpenCode 菜单' }))
  await user.click(await screen.findByRole('menuitem', { name: '置顶' }))
  await waitFor(() => expect(within(card('OpenCode')).getByLabelText('已置顶')).toBeInTheDocument())

  await user.click(screen.getByRole('button', { name: 'OpenCode 菜单' }))
  await user.click(await screen.findByRole('menuitem', { name: '弃用' }))
  await waitFor(() => expect(within(card('OpenCode')).getByText('已弃用')).toBeInTheDocument())

  await user.click(screen.getByRole('button', { name: 'Aider 菜单' }))
  await user.click(await screen.findByRole('menuitem', { name: '恢复' }))
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

test('details popover opens on hovering its button and shows summary and labelled fields', async () => {
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
  expect(within(popup).getByText('形态')).toBeInTheDocument()
  expect(within(popup).getByText('CLI')).toBeInTheDocument()
  expect(within(popup).queryByText('开源')).toBeNull() // open_source=false hidden
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
  expect(await open('OpenCode')).toBe('形态CLI开源是')
  expect(await open('Claude Sonnet 5.5')).toBe('出品方Anthropic上下文窗口1,000,000 tokens')
  expect(await open('OpenRouter')).toBe('类型聚合兼容协议openai / anthropic')
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
  expect(emphasis()).toEqual({
    'Claude Code': 'focus', OpenCode: 'dim', 'Claude Sonnet 5.5': 'neighbor', OpenRouter: 'dim', 'Anthropic API': 'dim',
  })
  expect(card('OpenCode').className).toContain('opacity-30')

  await user.hover(card('Claude Sonnet 5.5'))
  expect(emphasis()).toMatchObject({ 'Claude Code': 'neighbor', OpenRouter: 'neighbor', 'Anthropic API': 'dim' })

  await user.unhover(card('Claude Sonnet 5.5'))
  expect(Object.values(emphasis()).every((e) => e === '')).toBe(true)
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
  // A card alone in its group (pinned Claude Code) has no handle.
  expect(screen.queryByRole('button', { name: '拖动 Claude Code' })).toBeNull()

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
