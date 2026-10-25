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
import { ArrowDown, ArrowUp, Plus } from 'lucide-react'
import { useLayoutEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import type { Item, Kind } from '@/api/types'
import { KindIcon } from '@/components/KindIcon'
import { Button } from '@/components/ui/button'
import { offscreen } from '@/lib/offscreen'
import { crossesGroups, DRAG_RULE, groupKey, type MovePlan, planMove } from '@/lib/reorder'
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
  // Drag sorting is off in relation and focus mode.
  sortable: boolean
  // Snapshot preview: no add button, and read-only cards.
  readOnly?: boolean
  // Replaces the empty-column text, e.g. in focus mode.
  emptyText?: string
  // Hover linking: the hovered card's neighbours when they may be in this
  // column. Those scrolled out of view are counted at the column's edges.
  hintTargets: Set<string> | null
}

const NO_HINT = { above: 0, below: 0 }

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

export function Column(props: Props) {
  const { kind, items, filtered, actions, onAdd, emphasis, onHover, onMove, linking, sortable, readOnly, emptyText, hintTargets } =
    props
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  )
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    if (!over) return
    if (crossesGroups(items, String(active.id), String(over.id))) {
      toast.info('无法移到这里', { description: DRAG_RULE })
      return
    }
    const plan = planMove(items, String(active.id), String(over.id))
    if (plan) onMove(String(active.id), plan)
  }

  const scroller = useRef<HTMLDivElement>(null)
  const [hint, setHint] = useState(NO_HINT)
  useLayoutEffect(() => {
    const box = scroller.current
    const view = box?.getBoundingClientRect()
    // No targets, or not laid out (a hidden tab, jsdom).
    if (!box || !view || !hintTargets || view.height === 0) {
      setHint(NO_HINT)
      return
    }
    const cards = Array.from(box.querySelectorAll<HTMLElement>('[data-item-id]'))
    const spans = cards.filter((el) => hintTargets.has(el.dataset.itemId!)).map((el) => el.getBoundingClientRect())
    setHint(offscreen(view, spans))
  }, [hintTargets, items])

  return (
    <section aria-label={kind.label} className="flex min-h-0 flex-col rounded-xl bg-muted/40 p-2">
      <div className="flex items-center gap-2 px-1 pb-2">
        <KindIcon name={kind.icon} className="size-4 text-muted-foreground" />
        <h2 className="font-medium">{kind.label}</h2>
        <span className="text-sm text-muted-foreground">{items.length}</span>
        {!readOnly && (
          <Button variant="ghost" size="icon-sm" className="ml-auto" aria-label={`新增 ${kind.label}`} onClick={onAdd}>
            <Plus />
          </Button>
        )}
      </div>
      <div className="relative flex min-h-0 flex-col">
        <div ref={scroller} className="flex min-h-0 flex-col gap-2 overflow-y-auto">
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
                    readOnly={readOnly}
                    select={linking?.(it)}
                    // A card alone in its group cannot be dragged, but still
                    // takes drops, so a drop onto it can explain the rule.
                    draggable={sortable && group.length > 1}
                    droppable={sortable}
                  dragHint={sortable && group.length < 2 ? `${DRAG_RULE}，这一组只有这一张卡片` : undefined}
                  />
                ))}
              </SortableContext>
            ))}
          </DndContext>
          {items.length === 0 && (
            <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
              {emptyText ? (
                <p>{emptyText}</p>
              ) : filtered ? (
                <p>没有符合筛选条件的 {kind.label}</p>
              ) : readOnly ? (
                <p>快照里没有 {kind.label}</p>
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
        {hint.above > 0 && (
          <EdgeHint className="top-1">
            <ArrowUp /> 上方还有 {hint.above} 个关联
          </EdgeHint>
        )}
        {hint.below > 0 && (
          <EdgeHint className="bottom-1">
            <ArrowDown /> 下方还有 {hint.below} 个关联
          </EdgeHint>
        )}
      </div>
    </section>
  )
}

// Pointer-transparent: reaching for it would end the hover that shows it.
function EdgeHint({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <div
      className={`pointer-events-none absolute left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-full bg-primary px-2.5 py-0.5 text-xs whitespace-nowrap text-primary-foreground shadow-md [&>svg]:size-3 ${className}`}
    >
      {children}
    </div>
  )
}

function SortableCard({ draggable, droppable, ...props }: ItemCardProps & { draggable: boolean; droppable: boolean }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.item.id,
    disabled: { draggable: !draggable, droppable: !droppable },
  })
  return (
    <ItemCard
      {...props}
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform), transition }}
      dragging={isDragging}
      dragHandleProps={draggable ? { ...attributes, ...listeners } : undefined}
    />
  )
}
