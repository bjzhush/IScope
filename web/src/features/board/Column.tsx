import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from '@dnd-kit/core'
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Plus } from 'lucide-react'
import type { Item, Kind } from '@/api/types'
import { KindIcon } from '@/components/KindIcon'
import { Button } from '@/components/ui/button'
import { groupKey, type MovePlan, planMove } from '@/lib/reorder'
import type { ItemActions } from './actions'
import { type Emphasis, ItemCard, type ItemCardProps, type Selectable } from './ItemCard'

interface Props {
  kind: Kind
  items: Item[] // already filtered and sorted
  filtered: boolean // a search or status filter is active
  actions: ItemActions
  onAdd: () => void
  emphasis: (item: Item) => Emphasis
  onHover: (id: string | null) => void
  onMove: (id: string, plan: MovePlan) => void
  // Relation mode: null when not linking; otherwise how each card behaves.
  linking: null | ((item: Item) => Selectable | undefined)
}

// Consecutive runs of cards that may be reordered among themselves.
function groups(items: Item[]): Item[][] {
  const out: Item[][] = []
  for (const it of items) {
    const last = out[out.length - 1]
    if (last && groupKey(last[0]) === groupKey(it)) last.push(it)
    else out.push([it])
  }
  return out
}

export function Column({ kind, items, filtered, actions, onAdd, emphasis, onHover, onMove, linking }: Props) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return
    const plan = planMove(items, String(active.id), String(over.id))
    if (plan) onMove(String(active.id), plan)
  }

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
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          {groups(items).map((group) => (
            // One sortable context per group, so cards never shift across groups.
            <SortableContext key={groupKey(group[0])} items={group.map((it) => it.id)} strategy={verticalListSortingStrategy}>
              {group.map((it) => (
                <SortableCard
                  key={it.id}
                  item={it}
                  fields={kind.fields}
                  actions={actions}
                  emphasis={emphasis(it)}
                  onHover={onHover}
                  linking={!!linking}
                  select={linking?.(it)}
                  disabled={!!linking || group.length < 2}
                />
              ))}
            </SortableContext>
          ))}
        </DndContext>
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

function SortableCard({ disabled, ...props }: ItemCardProps & { disabled: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.item.id,
    disabled,
  })
  return (
    <ItemCard
      {...props}
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      dragging={isDragging}
      dragHandleProps={disabled ? undefined : { ...attributes, ...listeners }}
    />
  )
}
