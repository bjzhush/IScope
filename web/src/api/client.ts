import type {
  BoardView,
  CreateItemInput,
  Definitions,
  Item,
  ItemDetail,
  ItemPatch,
  CatalogImportInput,
  CatalogImportResult,
  CatalogSearch,
  CatalogUpdateInput,
  CatalogUpdateResult,
  ImportSummary,
  MoveInput,
  Relation,
  RelationLink,
  SnapshotBoardView,
  SnapshotMeta,
} from './types'

const BASE = '/api/v1'

export class ApiError extends Error {
  status: number
  code: string
  fields: Record<string, string>

  constructor(status: number, code: string, message: string, fields: Record<string, string> = {}) {
    super(message)
    this.status = status
    this.code = code
    this.fields = fields
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(BASE + path, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  if (res.status === 204) return undefined as T
  const data = await res.json().catch(() => null)
  if (!res.ok) {
    const e = data?.error
    throw new ApiError(res.status, e?.code ?? 'internal', e?.message ?? `请求失败 (${res.status})`, e?.fields)
  }
  return data as T
}

export const api = {
  kinds: () => request<Definitions>('GET', '/kinds'),
  board: (key: string, includeArchived: boolean) =>
    request<BoardView>('GET', `/boards/${encodeURIComponent(key)}${includeArchived ? '?includeArchived=true' : ''}`),
  item: (id: string) => request<ItemDetail>('GET', `/items/${encodeURIComponent(id)}`),
  createItem: (input: CreateItemInput) => request<Item>('POST', '/items', input),
  updateItem: (id: string, patch: ItemPatch) =>
    request<Item>('PATCH', `/items/${encodeURIComponent(id)}`, patch),
  deleteItem: (id: string) => request<void>('DELETE', `/items/${encodeURIComponent(id)}`),
  replaceRelations: (id: string, links: RelationLink[]) =>
    request<Relation[]>('PUT', `/items/${encodeURIComponent(id)}/relations`, { links }),
  moveItem: (id: string, input: MoveInput) => request<Item>('POST', `/items/${encodeURIComponent(id)}/move`, input),
  exportUrl: `${BASE}/export`,
  importData: (doc: unknown) => request<ImportSummary>('POST', '/import', doc),
  catalog: (q: string, provider: string) =>
    request<CatalogSearch>('GET', `/catalog?${new URLSearchParams({ q, provider })}`),
  catalogImport: (input: CatalogImportInput) => request<CatalogImportResult>('POST', '/catalog/import', input),
  catalogUpdate: (input: CatalogUpdateInput) => request<CatalogUpdateResult>('POST', '/catalog/update', input),
  snapshots: () => request<SnapshotMeta[]>('GET', '/snapshots'),
  createSnapshot: (label: string) => request<SnapshotMeta>('POST', '/snapshots', { label }),
  deleteSnapshot: (id: string) => request<void>('DELETE', `/snapshots/${encodeURIComponent(id)}`),
  snapshotDownloadUrl: (id: string) => `${BASE}/snapshots/${encodeURIComponent(id)}/download`,
  snapshotBoard: (id: string, key: string) =>
    request<SnapshotBoardView>('GET', `/snapshots/${encodeURIComponent(id)}/boards/${encodeURIComponent(key)}`),
}
