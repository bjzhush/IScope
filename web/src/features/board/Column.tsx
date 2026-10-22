import { Plus } from 'lucide-react'
import type { Item, Kind } from '@/api/types'
import { KindIcon } from '@/components/KindIcon'
import { Button } from '@/components/ui/button'
import type { ItemActions } from './actions'
import { ItemCard } from './ItemCard'

interface Props {
  kind: Kind
  items: Item[] // already filtered and sorted
  filtered: boolean // a search or status filter is active
  actions: ItemActions
  onAdd: () => void
}

export function Column({ kind, items, filtered, actions, onAdd }: Props) {
  return (
    <section aria-label={kind.label} className="flex min-h-0 flex-col rounded-xl bg-muted/40 p-2">
      <div className="flex items-center gap-2 px-1 pb-2">
        <KindIcon name={kind.icon} className="size-4 text-muted-foreground" />
        <h2 className="font-medium">{kind.label}</h2>
        <span className="text-sm text-muted-foreground">{items.length}</span>
        <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={`新增 ${kind.label}`} onClick={onAdd}>
          <Plus />
        </Button>
      </div>
      <div className="flex flex-col gap-2 overflow-y-auto">
        {items.map((it) => (
          <ItemCard key={it.id} item={it} fields={kind.fields} actions={actions} />
        ))}
        {items.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
            {filtered ? (
              <p>没有符合筛选条件的 {kind.label}</p>
            ) : (
              <>
                <p>还没有 {kind.label}，记录一个你正在使用或关注的吧</p>
                <Button variant="outline" size="sm" onClick={onAdd}>
                  <Plus /> 新增 {kind.label}
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </section>
  )
}
