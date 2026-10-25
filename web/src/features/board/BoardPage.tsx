import { X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useParams } from 'react-router'
import { useBoard, useDeleteItem, useKinds, useMoveItem, useQuickUpdate, useSetLinks } from '@/api/queries'
import type { Item, Kind, Relation } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { CatalogDialog } from '@/features/catalog/CatalogDialog'
import { ItemSheet } from '@/features/editor/ItemSheet'
import { DEFAULT_STATUSES, matchesFilter, statusCounts } from '@/lib/filter'
import { buildAdjacency, focusLayers, otherEnd, relationTypeBetween } from '@/lib/relations'
import { compareItems } from '@/lib/sort'
import { useMediaQuery } from '@/lib/useMediaQuery'
import type { ItemActions } from './actions'
import { Column } from './Column'
import { DataMenu } from './DataMenu'
import type { Selectable } from './ItemCard'
import { Toolbar } from './Toolbar'
import { useBoardFilters } from './useBoardFilters'

// Hover linking only follows the pointer once it rests this long, so sweeping
// across cards does not flash highlights. Leaving waits too, so moving from one
// card to the next switches highlights directly instead of clearing in between.
const HOVER_DELAY = 150

function useSettledHover() {
  const [hovered, setHovered] = useState<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined)
  const onHover = useCallback((id: string | null) => {
    clearTimeout(timer.current)
    timer.current = setTimeout(() => setHovered(id), HOVER_DELAY)
  }, [])
  useEffect(() => () => clearTimeout(timer.current), [])
  return [hovered, onHover] as const
}

export function BoardPage() {
  const { key = '' } = useParams()
  const f = useBoardFilters()
  const kinds = useKinds()
  // Always fetch archived items too: the toolbar counts them, and relation mode
  // must see links to them so a toggle never drops those links.
  const board = useBoard(key, true)
  const quick = useQuickUpdate(key)
  const del = useDeleteItem(key)
  const move = useMoveItem(key)
  const setLinks = useSetLinks(key)
  const narrow = useMediaQuery('(max-width: 899px)')
  const [tab, setTab] = useState<string | null>(null)
  const [catalogOpen, setCatalogOpen] = useState(false)
  const [hovered, setHovered] = useSettledHover()
  const [linkSourceId, setLinkSourceId] = useState<string | null>(null)

  const relations = board.data?.relations
  // Items whose status is selected. Hover and focus linking only run through
  // these, so a hidden archived item never bridges two visible ones.
  const statuses = f.filter.statuses
  const visibleIds = useMemo(
    () => new Set((board.data?.items ?? []).filter((it) => statuses.includes(it.status)).map((it) => it.id)),
    [board.data, statuses],
  )
  const adjacency = useMemo(
    () => buildAdjacency((relations ?? []).filter((r) => visibleIds.has(r.fromId) && visibleIds.has(r.toId))),
    [relations, visibleIds],
  )
  const kindByKey = useMemo(
    () => new Map<string, Kind>((kinds.data?.kinds ?? []).map((k) => [k.key, k])),
    [kinds.data],
  )

  // Focus mode (?focus=<id>): null once the item is deleted or hidden.
  const focusItem = board.data?.items.find((it) => it.id === f.focusId && visibleIds.has(it.id)) ?? null
  const layers = useMemo(() => {
    if (!focusItem || !board.data) return null
    const kindOf = new Map(board.data.items.map((it) => [it.id, it.kind]))
    return focusLayers(adjacency, focusItem.id, (id) => kindOf.get(id))
  }, [focusItem, board.data, adjacency])

  const columns = useMemo(() => {
    const view = board.data
    if (!view) return []
    return view.board.columns.flatMap((col) => {
      const kind = kindByKey.get(col)
      if (!kind) return []
      let items = view.items
        .filter((it) => it.kind === col && matchesFilter(it, kind.fields, f.filter))
        .sort(compareItems)
      // Focus mode: other columns keep only related items, direct ones first.
      if (focusItem && layers && col !== focusItem.kind) {
        items = items.filter((it) => layers.has(it.id)).sort((a, b) => layers.get(a.id)! - layers.get(b.id)!)
      }
      return [{ kind, items }]
    })
  }, [board.data, kindByKey, f.filter, focusItem, layers])

  const q = f.filter.q
  const counts = useMemo(() => {
    const onBoard = new Set(board.data?.board.columns ?? [])
    return statusCounts(board.data?.items ?? [], (k) => (onBoard.has(k) ? kindByKey.get(k)?.fields : undefined), q)
  }, [board.data, kindByKey, q])

  // Relation mode: the source item (null once it is deleted or hidden).
  const linkSource = board.data?.items.find((it) => it.id === linkSourceId && visibleIds.has(it.id)) ?? null

  // Esc leaves relation or focus mode. An open drawer or dialog swallows Esc
  // itself, so closing one never ends the mode as well.
  const { setFocus } = f
  const inMode = !!linkSourceId || !!f.focusId
  useEffect(() => {
    if (!inMode) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      setLinkSourceId(null)
      setFocus(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [inMode, setFocus])

  // Entering focus mode brings the focused card into view.
  const focusId = focusItem?.id
  useEffect(() => {
    if (focusId) document.querySelector(`[data-item-id="${focusId}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [focusId])

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
  const hoverActive =
    !linkSource && !focusItem && hovered !== null && columns.some((c) => c.items.some((it) => it.id === hovered))
  const emphasis = (item: Item) => {
    if (linkSource) {
      if (item.id === linkSource.id) return 'selected'
      return relatable(linkSource.kind, item.kind) ? undefined : 'dim'
    }
    if (focusItem && layers) {
      if (item.id === focusItem.id) return 'selected'
      const layer = layers.get(item.id)
      return layer === 1 ? 'neighbor' : layer === 2 ? 'indirect' : 'dim'
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
    link: (it) => {
      f.setFocus(null)
      setLinkSourceId(it.id)
    },
    focus: (it) => {
      setLinkSourceId(null)
      f.setFocus(it.id)
    },
  }

  const error = kinds.error ?? board.error
  if (error) {
    return <p className="p-6 text-destructive">加载失败：{error.message}</p>
  }
  if (!kinds.data || !board.data) {
    return <p className="p-6 text-muted-foreground">加载中…</p>
  }

  const filtered = f.filter.q.trim() !== '' || DEFAULT_STATUSES.some((s) => !statuses.includes(s))
  const hoveredNeighbors = hoverActive && hovered ? (adjacency.get(hovered) ?? null) : null
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
      sortable={!linkSource && !focusItem}
      emptyText={focusItem && kind.key !== focusItem.kind ? `没有与 ${focusItem.name} 关联的 ${kind.label}` : undefined}
      hintTargets={hovered && items.some((it) => it.id === hovered) ? null : hoveredNeighbors}
    />
  )
  const activeTab = tab ?? columns[0]?.kind.key

  return (
    <div className="flex h-dvh flex-col">
      <Toolbar
        title={board.data.board.title}
        filter={f.filter}
        onQuery={f.setQuery}
        counts={counts}
        onStatuses={f.setStatuses}
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
      {focusItem && (
        <div role="status" aria-label="聚焦模式" className="flex items-center gap-3 border-b bg-primary/5 px-4 py-2 text-sm">
          <span className="min-w-0 flex-1">
            聚焦：<strong>{focusItem.name}</strong>。其他列只显示与它关联的条目，实线框为直接关联，虚线框为间接关联。按 Esc 退出。
          </span>
          <Button size="sm" onClick={() => f.setFocus(null)}>
            <X /> 退出
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
