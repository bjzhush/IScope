import type { Field, Item, Status } from '@/api/types'

export interface BoardFilter {
  q: string
  statuses: Status[] // which statuses are shown, in ALL_STATUSES order; never empty
}

export const ALL_STATUSES: Status[] = ['in_use', 'watching', 'archived']
export const DEFAULT_STATUSES: Status[] = ['in_use', 'watching']

const isStatus = (s: string): s is Status => (ALL_STATUSES as string[]).includes(s)

// URL form of the selection: ?status=in_use,archived, absent for the default.
// Older links still parse: ?status=in_use alone, and ?archived=1 (added to the
// default when no status is given).
export function parseStatuses(status: string | null, legacyArchived: boolean): Status[] {
  const picked = new Set((status ?? '').split(',').filter(isStatus))
  if (picked.size === 0) {
    for (const s of DEFAULT_STATUSES) picked.add(s)
    if (legacyArchived) picked.add('archived')
  }
  return ALL_STATUSES.filter((s) => picked.has(s))
}

export function formatStatuses(statuses: Status[]): string | null {
  const v = ALL_STATUSES.filter((s) => statuses.includes(s)).join(',')
  return v === DEFAULT_STATUSES.join(',') ? null : v
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

export function matchesQuery(item: Item, fields: Field[], query: string): boolean {
  const q = query.trim().toLowerCase()
  if (!q) return true
  return [item.name, item.summary, ...item.tags, ...attrTexts(fields, item)].some((s) =>
    s.toLowerCase().includes(q),
  )
}

export function matchesFilter(item: Item, fields: Field[], f: BoardFilter): boolean {
  return f.statuses.includes(item.status) && matchesQuery(item, fields, f.q)
}

// Per-status counts for the toolbar: items that match the search, whatever
// statuses are selected. `fieldsOf` is undefined for kinds not on the board.
export function statusCounts(
  items: Item[],
  fieldsOf: (kind: string) => Field[] | undefined,
  q: string,
): Record<Status, number> {
  const counts: Record<Status, number> = { in_use: 0, watching: 0, archived: 0 }
  for (const it of items) {
    const fields = fieldsOf(it.kind)
    if (fields && matchesQuery(it, fields, q)) counts[it.status]++
  }
  return counts
}
