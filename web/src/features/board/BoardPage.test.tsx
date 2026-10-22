// Page-level flows against an in-memory fake of the /api/v1 endpoints.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { Item } from '@/api/types'
import kinds from '@/test/kinds.json'
import { BoardPage } from './BoardPage'

let items: Item[]
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
    return json(200, { board: kinds.boards[0], items: items.filter((i) => all || i.status !== 'archived'), relations: [] })
  }
  if (url.pathname === '/api/v1/items' && method === 'POST') {
    if (items.some((i) => i.kind === body.kind && i.name.toLowerCase() === body.name.toLowerCase()))
      return fail(409, 'conflict', { name: '同类下已存在同名条目' })
    if (body.attrs?.vendor === 'Rejected') return fail(400, 'validation_failed', { 'attrs.vendor': '服务器拒绝了这个值' })
    const it = mk(body)
    items.push(it)
    return json(201, it)
  }
  if (id && !found) return fail(404, 'not_found', {})
  if (id && method === 'GET') return json(200, { ...found, relations: [] })
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
  ]
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
})

afterEach(() => vi.unstubAllGlobals())

test('renders columns in board order with cards built from field definitions', async () => {
  renderPage()
  await screen.findByText('AI 技术栈')
  const regions = screen.getAllByRole('region').map((r) => r.getAttribute('aria-label'))
  expect(regions).toEqual(['Harness', 'Model', 'Provider'])

  const cc = within(card('Claude Code'))
  expect(cc.getByText('终端 agent')).toBeInTheDocument()
  expect(cc.getByText('CLI')).toBeInTheDocument() // select label, open_source=false hidden
  expect(cc.getByText('+1')).toBeInTheDocument() // 4 tags, 3 shown
  expect(within(card('OpenCode')).getByText('CLI · 开源')).toBeInTheDocument()
  expect(within(card('Claude Sonnet 5.5')).getByText('Anthropic · 1,000,000 tokens')).toBeInTheDocument()
  expect(within(card('OpenRouter')).getByText('聚合 · openai / anthropic')).toBeInTheDocument()

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
