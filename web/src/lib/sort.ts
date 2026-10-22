import type { Item, Status } from '@/api/types'

const statusRank: Record<Status, number> = { in_use: 0, watching: 1, archived: 2 }

// Column order: pinned first, then status (使用中, 关注中, 已弃用), then sortOrder.
export function compareItems(a: Item, b: Item): number {
  return (
    Number(b.pinned) - Number(a.pinned) ||
    statusRank[a.status] - statusRank[b.status] ||
    a.sortOrder - b.sortOrder ||
    a.id.localeCompare(b.id)
  )
}
