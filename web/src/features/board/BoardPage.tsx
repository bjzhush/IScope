import { X } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { useBoard, useDeleteItem, useKinds, useMoveItem, useQuickUpdate, useSetLinks } from '@/api/queries'
import type { Item, Kind, Relation } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CatalogDialog } from '@/features/catalog/CatalogDialog'
import { ItemSheet } from '@/features/editor/ItemSheet'
import { matchesFilter } from '@/lib/filter'
import { buildAdjacency, otherEnd, relationTypeBetween } from '@/lib/relations'
import { compareItems } from '@/lib/sort'
import { useMediaQuery } from '@/lib/useMediaQuery'
import type { ItemActions } from './actions'
import { Column } from './Column'
import { DataMenu } from './DataMenu'
import type { Selectable } from './ItemCard'
import { Toolbar } from './Toolbar'
import { useBoardFilters } from './useBoardFilters'

export function BoardPage() {
  const { key = '' } = useParams()
  const f = useBoardFilters()
  const kinds = useKinds()
  const board = useBoard(key, f.filter.showArchived)
  const quick = useQuickUpdate(key)
  const del = useDeleteItem(key)
  const move = useMoveItem(key)
  const setLinks = useSetLinks(key)
  const narrow = useMediaQuery('(max-width: 899px)')
  const [tab, setTab] = useState<string | null>(null)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [hovered, setHovered] = useState<string | null>(null)
  const [linkSourceId, setLinkSourceId] = useState<string | null>(null)

  const relations = board.data?.relations
  const adjacency = useMemo(() => buildAdjacency(relations ?? []), [relations])
  const kindByKey = useMemo(
    () => new Map<string, Kind>((kinds.data?.kinds ?? []).map((k) => [k.key, k])),
    [kinds.data],
  )

  const columns = useMemo(() => {
    const view = board.data
    if (!view) return []
    return view.board.columns.flatMap((col) => {
      const kind = kindByKey.get(col)
      if (!kind) return []
      const items = view.items
        .filter((it) => it.kind === col && matchesFilter(it, kind.fields, f.filter))
        .sort(compareItems)
      return [{ kind, items }]
    })
  }, [board.data, kindByKey, f.filter])

  // Relation mode: the source item (null once it is deleted or hidden); Esc exits.
  const linkSource = board.data?.items.find((it) => it.id === linkSourceId) ?? null
  useEffect(() => {
    if (!linkSourceId) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setLinkSourceId(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [linkSourceId])

  const relationTypes = kinds.data?.relationTypes ?? []
  const relatable = (a: string, b: string) => a !== b && !!relationTypeBetween(relationTypes, a, b)

  // Toggle one link of the source; the whole set is sent, existing attrs kept.
  const toggleLink = (source: Item, target: Item) => {
    const type = relationTypeBetween(relationTypes, source.kind, target.kind)
    if (!type) return
    const current = (relations ?? []).filter((r) => r.fromId === source.id || r.toId === source.id)
    const next: Relation[] = current.some((r) => otherEnd(r, source.id) === target.id)
      ? current.filter((r) => otherEnd(r, source.id) !== target.id)
      : [
          ...current,
          {
            id: `pending-${target.id}`,
            type: type.key,
            fromId: type.fromKind === source.kind ? source.id : target.id,
            toId: type.fromKind === source.kind ? target.id : source.id,
            attrs: {},
            createdAt: '',
            updatedAt: '',
          },
        ]
    setLinks.mutate({ sourceId: source.id, targets: next.map((r) => otherEnd(r, source.id)), optimistic: next })
  }

  const linking = (col: Kind) => {
    if (!linkSource) return null
    const linked = adjacency.get(linkSource.id)
    return (it: Item): Selectable | undefined =>
      relatable(linkSource.kind, col.key)
        ? { checked: linked?.has(it.id) ?? false, onToggle: () => toggleLink(linkSource, it) }
        : undefined
  }

  // A card can vanish under the pointer (deleted, filtered) without mouseleave.
  const hoverActive = !linkSource && hovered !== null && columns.some((c) => c.items.some((it) => it.id === hovered))
  const emphasis = (item: Item) => {
    if (linkSource) {
      if (item.id === linkSource.id) return 'focus'
      return relatable(linkSource.kind, item.kind) ? undefined : 'dim'
    }
    if (!hoverActive || !hovered) return undefined
    if (item.id === hovered) return 'focus'
    return adjacency.get(hovered)?.has(item.id) ? 'neighbor' : 'dim'
  }

  const actions: ItemActions = {
    edit: (it: Item) => f.openItem(it.id),
    setStatus: (it, status) => quick.mutate({ id: it.id, patch: { status } }),
    togglePin: (it) => quick.mutate({ id: it.id, patch: { pinned: !it.pinned } }),
    remove: (it) => del.mutate(it.id),
    link: (it) => setLinkSourceId(it.id),
  }

  const error = kinds.error ?? board.error
  if (error) {
    return <p className="p-6 text-destructive">加载失败：{error.message}</p>
  }
  if (!kinds.data || !board.data) {
    return <p className="p-6 text-muted-foreground">加载中…</p>
  }

  const filtered = f.filter.q.trim() !== '' || f.filter.status !== ''
  const renderColumn = ({ kind, items }: (typeof columns)[number]) => (
    <Column
      key={kind.key}
      kind={kind}
      items={items}
      filtered={filtered}
      actions={actions}
      onAdd={() => f.openNew(kind.key)}
      emphasis={emphasis}
      onHover={setHovered}
      onMove={(id, plan) => move.mutate({ id, input: plan.input, sortOrder: plan.sortOrder })}
      linking={linking(kind)}
    />
  )
  const activeTab = tab ?? columns[0]?.kind.key

  return (
    <div className="flex h-dvh flex-col">
      <Toolbar
        title={board.data.board.title}
        filter={f.filter}
        onQuery={f.setQuery}
        onStatus={f.setStatus}
        onShowArchived={f.setShowArchived}
        extra={<DataMenu onCatalog={() => setCatalogOpen(true)} />}
      />
      {linkSource && (
        <div role="status" aria-label="关联模式" className="flex items-center gap-3 border-b bg-primary/5 px-4 py-2 text-sm">
          <span className="min-w-0 flex-1">
            关联模式：勾选其他列中的条目，建立或解除与 <strong>{linkSource.name}</strong> 的关联，改动立即保存。按 Esc 退出。
          </span>
          <Button size="sm" onClick={() => setLinkSourceId(null)}>
            <X /> 完成
          </Button>
        </div>
      )}
      {narrow ? (
        <Tabs value={activeTab} onValueChange={(v) => setTab(String(v))} className="flex min-h-0 flex-1 flex-col p-2">
          <TabsList className="w-full">
            {columns.map(({ kind, items }) => (
              <TabsTrigger key={kind.key} value={kind.key}>
                {kind.label} {items.length}
              </TabsTrigger>
            ))}
          </TabsList>
          {columns.map((c) => (
            <TabsContent key={c.kind.key} value={c.kind.key} className="flex min-h-0 flex-1 flex-col">
              {renderColumn(c)}
            </TabsContent>
          ))}
        </Tabs>
      ) : (
        <main
          className="grid min-h-0 flex-1 gap-3 p-4"
          style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(0, 1fr))` }}
        >
          {columns.map(renderColumn)}
        </main>
      )}
      <ItemSheet
        boardKey={key}
        kinds={kindByKey}
        columns={board.data.board.columns}
        relationTypes={kinds.data.relationTypes}
        editingId={f.editingId}
        newKind={f.newKind}
        onClose={f.closeSheet}
      />
      <CatalogDialog
        open={catalogOpen}
        onOpenChange={setCatalogOpen}
        items={board.data.items}
        onImported={(id) => f.openItem(id)}
      />
    </div>
  )
}
