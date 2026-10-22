import type { Item, Status } from '@/api/types'

// Card-level actions, implemented once in BoardPage.
export interface ItemActions {
  edit: (item: Item) => void
  setStatus: (item: Item, status: Status) => void
  togglePin: (item: Item) => void
  remove: (item: Item) => void
}
