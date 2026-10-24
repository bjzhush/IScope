import type { Item, Status } from '@/api/types'

// Card-level actions, implemented once in BoardPage.
export interface ItemActions {
  edit: (item: Item) => void
  setStatus: (item: Item, status: Status) => void
  togglePin: (item: Item) => void
  remove: (item: Item) => void
  link: (item: Item) => void // enter relation mode with this item as the source
  focus: (item: Item) => void // enter focus mode on this item
}
