import { useMemo, useState } from 'react'
import { useParams } from 'react-router'
import { useBoard, useDeleteItem, useKinds, useQuickUpdate } from '@/api/queries'
import type { Item, Kind } from '@/api/types'
import { ItemSheet } from '@/features/editor/ItemSheet'
import { matchesFilter } from '@/lib/filter'
import { buildAdjacency } from '@/lib/relations'
import { compareItems } from '@/lib/sort'
import type { ItemActions } from './actions'
import { Column } from './Column'
import { Toolbar } from './Toolbar'
import { useBoardFilters } from './useBoardFilters'

export function BoardPage() {
  const { key = '' } = useParams()
  const f = useBoardFilters()
  const kinds = useKinds()
  const board = useBoard(key, f.filter.showArchived)
  const quick = useQuickUpdate(key)
  const del = useDeleteItem(key)

  const [hovered, setHovered] = useState<string | null>(null)
  const adjacency = useMemo(() => buildAdjacency(board.data?.relations ?? []), [board.data])

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

  // A card can vanish under the pointer (deleted, filtered) without mouseleave.
  const hoverActive = hovered !== null && columns.some((c) => c.items.some((it) => it.id === hovered))
  const emphasis = (id: string) => {
    if (!hoverActive) return undefined
    if (id === hovered) return 'focus'
    return adjacency.get(hovered)?.has(id) ? 'neighbor' : 'dim'
  }

  const actions: ItemActions = {
    edit: (it: Item) => f.openItem(it.id),
    setStatus: (it, status) => quick.mutate({ id: it.id, patch: { status } }),
    togglePin: (it) => quick.mutate({ id: it.id, patch: { pinned: !it.pinned } }),
    remove: (it) => del.mutate(it.id),
  }

  const error = kinds.error ?? board.error
  if (error) {
    return <p className="p-6 text-destructive">加载失败：{error.message}</p>
  }
  if (!kinds.data || !board.data) {
    return <p className="p-6 text-muted-foreground">加载中…</p>
  }

  const filtered = f.filter.q.trim() !== '' || f.filter.status !== ''
  return (
    <div className="flex h-dvh flex-col">
      <Toolbar
        title={board.data.board.title}
        filter={f.filter}
        onQuery={f.setQuery}
        onStatus={f.setStatus}
        onShowArchived={f.setShowArchived}
      />
      {/* Narrow screens scroll horizontally; the Tab layout comes in phase 3. */}
      <main
        className="grid min-h-0 flex-1 gap-3 overflow-x-auto p-4"
        style={{ gridTemplateColumns: `repeat(${columns.length}, minmax(280px, 1fr))` }}
      >
        {columns.map(({ kind, items }) => (
          <Column
            key={kind.key}
            kind={kind}
            items={items}
            filtered={filtered}
            actions={actions}
            onAdd={() => f.openNew(kind.key)}
            emphasis={emphasis}
            onHover={setHovered}
          />
        ))}
      </main>
      <ItemSheet
        boardKey={key}
        kinds={kindByKey}
        columns={board.data.board.columns}
        relationTypes={kinds.data.relationTypes}
        editingId={f.editingId}
        newKind={f.newKind}
        onClose={f.closeSheet}
      />
    </div>
  )
}
