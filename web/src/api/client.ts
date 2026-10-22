import type {
  BoardView,
  CreateItemInput,
  Definitions,
  Item,
  ItemDetail,
  ItemPatch,
  Relation,
  RelationLink,
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
}
