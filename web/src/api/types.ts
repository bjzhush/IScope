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
  // Items of this kind can be imported and updated from the models.dev catalog.
  catalogImport?: boolean
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

export interface MoveInput {
  beforeId: string | null
  afterId: string | null
}

export interface TransferCounts {
  created: number
  updated: number
  unchanged: number
}

export interface SnapshotMeta {
  id: string
  label: string
  itemCount: number
  relationCount: number
  createdAt: string
}

// A board as it was in a snapshot; item and relation IDs are stand-ins.
export interface SnapshotBoardView extends BoardView {
  snapshot: SnapshotMeta
}

export interface ImportSummary {
  items: TransferCounts
  relations: TransferCounts
}

export interface CatalogEntry {
  providerId: string
  providerName: string
  modelId: string
  officialId: string
  name: string
  vendor: string
  releaseDate?: string
  context?: number
  output?: number
  modalities: string[]
  inputPrice?: number
  outputPrice?: number
}

export interface CatalogProvider {
  id: string
  name: string
  count: number
}

export interface CatalogSearch {
  providers: CatalogProvider[]
  entries: CatalogEntry[]
  total: number
  resolved: boolean // q was a model page link naming exactly this one entry
  modelKind: string // kind of the items an import creates
  linkKind: string // kind that can receive the model's prices
}

export interface CatalogImportInput {
  providerId: string
  modelId: string
  linkTo?: string
  sourceUrl?: string
}

export interface CatalogUpdateInput {
  targetId: string
  providerId: string
  modelId: string
  sourceUrl?: string
  dryRun: boolean
}

// One value the update replaces: 'name' or an attr key.
export interface CatalogChange {
  key: string
  old: AttrValue | null
  new: AttrValue | null
}

export interface CatalogPriceChange {
  providerId: string
  providerName: string
  source: string // the matched catalog provider, '' when none
  status: 'updated' | 'unchanged' | 'not_found'
  old: Record<string, AttrValue>
  new: Record<string, AttrValue>
}

export interface CatalogUpdateResult {
  item: Item
  snapshotId?: string
  changes: CatalogChange[]
  prices: CatalogPriceChange[]
  dryRun: boolean
}

export interface CatalogImportResult {
  item: Item
  created: boolean
  relation?: Relation
}
