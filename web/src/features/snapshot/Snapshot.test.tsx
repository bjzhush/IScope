// Snapshot list and the read-only preview, against a fake of the /api/v1 endpoints.
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import type { Item, Relation, SnapshotMeta } from '@/api/types'
import { BoardPage } from '@/features/board/BoardPage'
import kinds from '@/test/kinds.json'

let requests: { method: string; path: string; body?: unknown }[]
let snapshots: SnapshotMeta[]
let location = ''

const mk = (over: Partial<Item> & Pick<Item, 'id' | 'kind' | 'name'>): Item => ({
  slug: over.name.toLowerCase().replace(/\W+/g, '-'), status: 'in_use', summary: '', tags: [], links: [],
  notes: '', rating: null, pinned: false, sortOrder: 1, attrs: {}, createdAt: '', updatedAt: '', ...over,
})

const liveItems = [mk({ id: 'L1', kind: 'model', name: 'Claude Opus 5.6' })]

// The snapshot still has the old model, with a field that is not ShowOnCard and notes.
const snapItems = [
  mk({ id: 'harness:claude-code', kind: 'harness', name: 'Claude Code' }),
  mk({
    id: 'model:claude-opus-5-5', kind: 'model', name: 'Claude Opus 5.5', notes: '旧版本的笔记',
    attrs: { vendor: 'Anthropic', model_id: 'claude-opus-5-5' },
  }),
  mk({ id: 'provider:openrouter', kind: 'provider', name: 'OpenRouter' }),
]
const snapRelations: Relation[] = [
  { id: 'r', type: 'uses', fromId: 'harness:claude-code', toId: 'model:claude-opus-5-5', attrs: {}, createdAt: '', updatedAt: '' },
]

const json = (status: number, body?: unknown) =>
  new Response(body === undefined ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

async function fakeFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = new URL(String(input), 'http://localhost')
  const method = init?.method ?? 'GET'
  const body = init?.body ? JSON.parse(String(init.body)) : undefined
  requests.push({ method, path: url.pathname, body })
  const p = url.pathname
  if (p === '/api/v1/kinds') return json(200, kinds)
  if (p === '/api/v1/boards/ai-stack') return json(200, { board: kinds.boards[0], items: liveItems, relations: [] })
  if (p === '/api/v1/snapshots' && method === 'GET') return json(200, snapshots)
  if (p === '/api/v1/snapshots' && method === 'POST') {
    const m = { id: `S${snapshots.length + 1}`, label: body.label || '手动快照', itemCount: 1, relationCount: 0, createdAt: '2026-10-26T07:00:00Z' }
    snapshots = [m, ...snapshots]
    return json(201, m)
  }
  const del = p.match(/^\/api\/v1\/snapshots\/([^/]+)$/)?.[1]
  if (del && method === 'DELETE') {
    snapshots = snapshots.filter((s) => s.id !== del)
    return new Response(null, { status: 204 })
  }
  const view = p.match(/^\/api\/v1\/snapshots\/([^/]+)\/boards\/ai-stack$/)?.[1]
  if (view) {
    const m = snapshots.find((s) => s.id === view)
    if (!m) return json(404, { error: { code: 'not_found', message: '快照不存在' } })
    return json(200, { board: kinds.boards[0], items: snapItems, relations: snapRelations, snapshot: m })
  }
  return json(404, { error: { code: 'not_found', message: p } })
}

function LocationProbe() {
  const loc = useLocation()
  location = loc.pathname + loc.search
  return null
}

function renderAt(entry: string) {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const page = (
    <>
      <BoardPage />
      <LocationProbe />
    </>
  )
  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/boards/:key" element={page} />
          <Route path="/boards/:key/snapshots/:snapshotId" element={page} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

const writes = () => requests.filter((r) => r.method !== 'GET')

beforeEach(() => {
  requests = []
  snapshots = [
    { id: 'S1', label: '改模型前', itemCount: 3, relationCount: 1, createdAt: '2026-10-26T06:30:00Z' },
  ]
  vi.stubGlobal('fetch', vi.fn(fakeFetch))
})

afterEach(() => vi.unstubAllGlobals())

test('snapshot dialog lists, creates, downloads, deletes with confirmation and opens a preview', async () => {
  const user = userEvent.setup()
  renderAt('/boards/ai-stack')
  await user.click(await screen.findByRole('button', { name: '数据' }))
  await user.click(await screen.findByRole('menuitem', { name: '快照…' }))
  const dlg = within(await screen.findByRole('dialog'))

  const row = (await dlg.findByText('改模型前')).closest('tr')!
  expect(row.textContent).toContain('3 张卡片 · 1 条关联')
  expect(within(row).getByRole('link', { name: '下载 JSON' })).toHaveAttribute('href', '/api/v1/snapshots/S1/download')

  await user.type(dlg.getByLabelText('快照说明'), '大改前')
  await user.click(dlg.getByRole('button', { name: '创建快照' }))
  expect(await dlg.findByText('大改前')).toBeInTheDocument()
  expect(writes()).toEqual([{ method: 'POST', path: '/api/v1/snapshots', body: { label: '大改前' } }])
  expect(dlg.getByLabelText('快照说明')).toHaveValue('')

  const newRow = dlg.getByText('大改前').closest('tr')!
  await user.click(within(newRow).getByRole('button', { name: '删除' }))
  expect(await screen.findByText('删除快照"大改前"？')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '删除' }))
  await waitFor(() => expect(dlg.queryByText('大改前')).toBeNull())
  expect(writes().at(-1)).toEqual({ method: 'DELETE', path: '/api/v1/snapshots/S2', body: undefined })

  await user.click(within(dlg.getByText('改模型前').closest('tr')!).getByRole('button', { name: '预览' }))
  await waitFor(() => expect(location).toBe('/boards/ai-stack/snapshots/S1'))
  expect(await screen.findByRole('status', { name: '快照预览' })).toHaveTextContent('改模型前')
})

test('preview shows the snapshot read-only and never writes', async () => {
  const user = userEvent.setup()
  renderAt('/boards/ai-stack/snapshots/S1')
  const banner = await screen.findByRole('status', { name: '快照预览' })
  expect(banner).toHaveTextContent('正在查看快照：改模型前')
  expect(banner).toHaveTextContent('（只读）')

  // The snapshot's data, not the live board's, which is never fetched.
  const opus = await screen.findByRole('article', { name: 'Claude Opus 5.5' })
  expect(screen.queryByText('Claude Opus 5.6')).toBeNull()
  expect(requests.some((r) => r.path === '/api/v1/boards/ai-stack')).toBe(false)

  // No way to write: no add buttons, data menu, drag handles or clickable cards.
  expect(screen.queryByRole('button', { name: /^新增/ })).toBeNull()
  expect(screen.queryByRole('button', { name: /^导入/ })).toBeNull()
  expect(screen.queryByRole('button', { name: '数据' })).toBeNull()
  expect(screen.queryByRole('button', { name: /^拖动/ })).toBeNull()
  expect(document.querySelector('[data-handle="blocked"]')).toBeNull()
  await user.click(opus)
  expect(screen.queryByText(/^编辑 /)).toBeNull()

  // The details popover lists every field with a value, plus notes.
  await user.click(within(opus).getByRole('button', { name: 'Claude Opus 5.5 详情' }))
  const popup = within(await screen.findByRole('dialog'))
  expect(popup.getByText('模型 ID')).toBeInTheDocument() // not ShowOnCard
  expect(popup.getByText('旧版本的笔记')).toBeInTheDocument()
  await user.keyboard('{Escape}')
  await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())

  // The menu only offers focus, which works as usual.
  await user.click(within(opus).getByRole('button', { name: 'Claude Opus 5.5 菜单' }))
  const menu = await screen.findByRole('menu')
  expect(within(menu).getAllByRole('menuitem').map((m) => m.textContent)).toEqual(['聚焦关联'])
  await user.click(within(menu).getByRole('menuitem', { name: '聚焦关联' }))
  expect(await screen.findByRole('status', { name: '聚焦模式' })).toBeInTheDocument()
  expect(within(screen.getByRole('region', { name: 'Provider' })).queryByText('OpenRouter')).toBeNull()

  expect(writes()).toEqual([])

  await user.click(screen.getByRole('button', { name: '返回当前看板' }))
  await waitFor(() => expect(location).toBe('/boards/ai-stack'))
  expect(await screen.findByRole('button', { name: 'Claude Opus 5.6' })).toBeInTheDocument()
})

test('a missing snapshot says so and offers the way back', async () => {
  const user = userEvent.setup()
  renderAt('/boards/ai-stack/snapshots/gone')
  expect(await screen.findByText('加载失败：快照不存在')).toBeInTheDocument()
  await user.click(screen.getByRole('button', { name: '返回当前看板' }))
  await waitFor(() => expect(location).toBe('/boards/ai-stack'))
})
