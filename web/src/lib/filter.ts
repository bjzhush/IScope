import type { Field, Item, Status } from '@/api/types'

export interface BoardFilter {
  q: string
  status: Status | ''
  showArchived: boolean
}

// Text a keyword search can hit inside attrs: string values plus option labels.
function attrTexts(fields: Field[], item: Item): string[] {
  const out: string[] = []
  for (const f of fields) {
    const v = item.attrs[f.key]
    const values = Array.isArray(v) ? v : typeof v === 'string' ? [v] : []
    for (const s of values) {
      out.push(s)
      const label = f.options?.find((o) => o.value === s)?.label
      if (label) out.push(label)
    }
  }
  return out
}

export function matchesFilter(item: Item, fields: Field[], f: BoardFilter): boolean {
  if (item.status === 'archived' && !f.showArchived) return false
  if (f.status && item.status !== f.status) return false
  const q = f.q.trim().toLowerCase()
  if (!q) return true
  return [item.name, item.summary, ...item.tags, ...attrTexts(fields, item)].some((s) =>
    s.toLowerCase().includes(q),
  )
}
