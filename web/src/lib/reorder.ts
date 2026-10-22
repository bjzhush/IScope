import type { Item, MoveInput } from '@/api/types'

// Cards may only be reordered among cards with the same pin state and status,
// because the column always sorts by pinned → status → sortOrder.
export const groupKey = (it: Item) => `${it.pinned ? 1 : 0}|${it.status}`

export interface MovePlan {
  input: MoveInput
  sortOrder: number // the backend's result, applied optimistically
}

// Plans moving `activeId` onto the position of `overId` in a column that is
// already filtered and sorted as displayed. Returns null when the drop is a
// no-op or crosses groups.
export function planMove(column: Item[], activeId: string, overId: string): MovePlan | null {
  if (activeId === overId) return null
  const active = column.find((it) => it.id === activeId)
  const over = column.find((it) => it.id === overId)
  if (!active || !over || groupKey(active) !== groupKey(over)) return null

  const group = column.filter((it) => groupKey(it) === groupKey(active))
  const from = group.indexOf(active)
  const to = group.indexOf(over)
  const reordered = group.filter((it) => it !== active)
  reordered.splice(to, 0, active)
  if (from === to) return null

  const before = reordered[to - 1] ?? null
  const after = reordered[to + 1] ?? null
  let sortOrder: number
  if (before && after) sortOrder = before.sortOrder + (after.sortOrder - before.sortOrder) / 2
  else if (before) sortOrder = before.sortOrder + 1
  else if (after) sortOrder = after.sortOrder - 1
  else return null

  return { input: { beforeId: before?.id ?? null, afterId: after?.id ?? null }, sortOrder }
}
