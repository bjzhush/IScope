// Mirrors internal/kind and internal/item JSON. attrs keys stay snake_case.

export type FieldType =
  | 'text'
  | 'textarea'
  | 'number'
  | 'bool'
  | 'select'
  | 'multiselect'
  | 'date'
  | 'url'

export interface Option {
  value: string
  label: string
}

export interface Field {
  key: string
  label: string
  type: FieldType
  options?: Option[]
  required?: boolean
  unit?: string
  min?: number
  integer?: boolean
  showOnCard?: boolean // item field: on the card; relation field: in the chip summary
  placeholder?: string
  prefix?: string // number: compact display prefix, e.g. "$"
  shortLabel?: string // bool: compact text when true, e.g. "默认"
}

export interface Kind {
  key: string
  label: string
  icon: string
  fields: Field[]
}

export interface RelationType {
  key: string
  fromKind: string
  toKind: string
  label: string
  fields: Field[]
}

export interface Board {
  key: string
  title: string
  columns: string[]
}

export interface Definitions {
  kinds: Kind[]
  relationTypes: RelationType[]
  boards: Board[]
}

export type Status = 'in_use' | 'watching' | 'archived'

export interface Link {
  label: string
  url: string
}

export type AttrValue = string | number | boolean | string[]
export type Attrs = Record<string, AttrValue>

export interface Item {
  id: string
  kind: string
  name: string
  slug: string
  status: Status
  summary: string
  tags: string[]
  links: Link[]
  notes: string
  rating: number | null
  pinned: boolean
  sortOrder: number
  attrs: Attrs
  createdAt: string
  updatedAt: string
}

export interface Relation {
  id: string
  type: string
  fromId: string
  toId: string
  attrs: Attrs
  createdAt: string
  updatedAt: string
}

export interface ItemDetail extends Item {
  relations: Relation[]
}

export interface BoardView {
  board: Board
  items: Item[]
  relations: Relation[]
}

// One entry of PUT /items/{id}/relations; omitting attrs keeps existing ones.
export interface RelationLink {
  targetId: string
  attrs?: Attrs
}

export interface CreateItemInput {
  kind: string
  name: string
  status?: Status
  summary?: string
  tags?: string[]
  links?: Link[]
  notes?: string
  rating?: number | null
  pinned?: boolean
  attrs?: Attrs
}

// PATCH body: only changed fields; an attrs value of null deletes that key.
export type ItemPatch = Partial<Omit<CreateItemInput, 'kind' | 'attrs'>> & {
  attrs?: Record<string, AttrValue | null>
}
